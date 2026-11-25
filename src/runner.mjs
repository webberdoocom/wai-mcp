import { savePurchasedReport } from './report-files.mjs';
import { validateInputs, permittedDynamicPayment } from './discovery.mjs';
import { extractChallenge, parseConfig, postURL, SERVICES, VERSION, selectPaymentOffer, paymentTermsMatch, safeError } from './core.mjs';

/** Normalize Fetch API inputs. The x402 SDK may retry using a Request
 * rather than a URL string and RequestInit. Never permit a changed route,
 * method or request body and do not follow redirects. */
export async function normalizePaymentRequest(target, init, expectedUrl, expectedBody) {
  const request = new Request(target, init);
  if (request.url !== expectedUrl) throw new Error('Payment client attempted an unexpected URL');
  if (request.method.toUpperCase() !== 'POST') throw new Error('Payment client attempted unexpected HTTP method');
  if ((await request.clone().text()) !== expectedBody) throw new Error('Payment client changed the report request body');
  return { headers: request.headers, signed: request.headers.has('payment-signature') || request.headers.has('x-payment') };
}

export function makeRunner({env = process.env, fetchImpl = globalThis.fetch, paymentFetchFactory = null} = {}) {
  const config = parseConfig(env);
  let reservedCents = 0;
  async function payFetch(url, options, service, amountCents, firstOffer) {
    if (config.mode !== 'on') throw new Error('Payments are disabled');
    // Recheck the shared budget at reservation time. Two concurrent calls can
    // both pass the preliminary quote check before either reserves its funds.
    // Retain each reservation even after an uncertain or failed attempt.
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0 ||
        amountCents > config.callLimitCents ||
        reservedCents + amountCents > config.sessionLimitCents) {
      throw new Error('Payment exceeds WAI_MAX_SESSION_USDC or WAI_MAX_PER_CALL_USDC');
    }
    reservedCents += amountCents;
    if (paymentFetchFactory) {
      // Mock-only seam used by offline tests. It never runs with the real SDK.
      const mockPay = await paymentFetchFactory(config, fetchImpl);
      try {
        return await mockPay(url, options);
      } catch {
        return undefined;
      }
    }
    const [{ x402Client }, { ExactEvmScheme }, { wrapFetchWithPayment }, { privateKeyToAccount }] = await Promise.all([
      import('@x402/core/client'), import('@x402/evm/exact/client'), import('@x402/fetch'), import('viem/accounts')
    ]);
    const client = new x402Client();
    client.register(config.network, new ExactEvmScheme(privateKeyToAccount(config.privateKey)));
    let unsignedRequests = 0;
    let signedRequests = 0;
    let signedRequestSent = false;
    let signedResponse;
    const guardedFetch = async (target, init = {}) => {
      const { headers, signed } = await normalizePaymentRequest(target, init, url, options.body);
      if (signed) {
        signedRequests++;
        if (signedRequests !== 1 || unsignedRequests !== 1) throw new Error('Unexpected repeated or premature signed payment request');
        signedRequestSent = true;
        signedResponse = await fetchImpl(url, { ...options, headers, redirect: 'error' });
        return signedResponse;
      }
      unsignedRequests++;
      if (unsignedRequests !== 1 || signedRequests) throw new Error('Unexpected extra unsigned payment request');
      const reply = await fetchImpl(url, { ...options, headers, redirect: 'error' });
      if (reply.status !== 402) throw new Error(`Payment challenge changed to HTTP ${reply.status} before signing`);
      const repeated = extractChallenge(reply);
      const chosen = selectPaymentOffer(repeated, config, service, reservedCents - amountCents);
      if (!paymentTermsMatch(firstOffer, chosen.offer))
        throw new Error('Payment quote changed between unsigned request and payment retry');
      // Present ONLY the validated selected offer to the signing SDK. This
      // prevents it from choosing the other (Sepolia/Mainnet) advertised offer.
      const restricted = { ...repeated, accepts: [chosen.offer] };
      const restrictedHeaders = new Headers(reply.headers);
      restrictedHeaders.set('payment-required', Buffer.from(JSON.stringify(restricted)).toString('base64'));
      return new Response(reply.body, { status: 402, statusText: reply.statusText, headers: restrictedHeaders });
    };
    const paymentFetch = wrapFetchWithPayment(guardedFetch, client);
    try {
      return await paymentFetch(url, options);
    } catch (error) {
      if (!signedRequestSent) throw error;
      // The server may have settled even if the connection or SDK failed.
      return signedResponse;
    }
  }
  async function runRequest(service, payload, dynamic = false) {
    if (!dynamic && !Object.hasOwn(SERVICES, service)) throw new Error('Unknown tool');
    if (dynamic) validateInputs(service, payload);
    const url = dynamic ? service.endpoint : postURL(config.base, service);
    const serviceId = dynamic ? service.id : SERVICES[service].id;
    const options = { method: 'POST', headers: { 'content-type': 'application/json', 'accept': 'application/json', 'user-agent': 'wai-mcp/' + VERSION }, body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(20000) };
    // An unsigned first request tests the quote. Signing is deliberately opt-in.
    const first = await fetchImpl(url, options);
    if (first.status !== 402) {
      if (first.headers.has('payment-response') || first.headers.has('x-payment-response')) {
        return interpretPayment(first, config.network, serviceId, false);
      }
      return interpret(first);
    }
    const challenge = extractChallenge(first);
    const { offer, priceUSDC: quotedUSDC } = selectPaymentOffer(challenge, config, service, reservedCents);
    if (config.mode === 'off' || (dynamic && !permittedDynamicPayment(service, env))) return { status: 'payment_required', service: dynamic ? service.id : service, network: config.network, priceUSDC: quotedUSDC, note: dynamic && !permittedDynamicPayment(service, env) ? 'Newly discovered service: payment blocked until its service ID is explicitly added to WAI_DYNAMIC_PAID_ALLOWLIST.' : 'No funds spent. Set WAI_PAYMENT_MODE=on and configure a dedicated buyer wallet to enable payment.' };
    const response = await payFetch(url, options, service, Math.ceil(quotedUSDC * 100), offer);
    const result = await interpretPayment(response, config.network, serviceId);
    return env.WAI_SAVE_REPORTS === 'false' ? result : savePurchasedReport(result, env.WAI_REPORT_DIR);
  }
  return { run: (service,payload) => runRequest(service,payload,false), runDynamic: (spec,payload) => runRequest(spec,payload,true), config };
}
async function readBody(response) {
  const raw = await response.text();
  try { return JSON.parse(raw); }
  catch { return { message: raw.slice(0, 2500) }; }
}

async function interpret(response) {
  const body = await readBody(response);
  if (!response.ok) throw new Error(`WAI returned HTTP ${response.status}: ${JSON.stringify(body).slice(0, 400)}`);
  return { status: 'ok', paymentAttempted: false, response: body };
}

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isReportId = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const isTransaction = value => typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);
const safeCode = value => typeof value === 'string' && /^[a-z0-9_-]{1,80}$/i.test(value) ? value : undefined;
const isPending = receipt => receipt?.success === false &&
  ['settlement_pending', 'settlement_unconfirmed'].includes(receipt.errorReason);

async function interpretPayment(response, network, serviceId, paymentAttempted = true) {
  const context = { paymentAttempted, network };
  const receipts = [];
  for (const name of ['payment-response', 'x-payment-response']) {
    const header = response?.headers.get(name);
    if (!header) continue;
    try {
      if (header.length > 16000) throw new Error('Oversized settlement receipt');
      const { decodePaymentResponseHeader } = await import('@x402/core/http');
      receipts.push(decodePaymentResponseHeader(header));
    } catch {
      receipts.push(null);
    }
  }

  // A signed response needs structured JSON. Keep the unpaid response path unchanged.
  const body = await response?.json().catch(() => undefined);
  const errorCode = safeCode(body?.error?.code);
  const pending = receipts.find(isPending);
  const failed = receipts.find(receipt => receipt?.success === false && !isPending(receipt));
  const receiptTransaction = receipts.find(receipt =>
    receipt?.network === network && isTransaction(receipt.transaction))?.transaction;
  const references = {
    ...context,
    httpStatus: response?.status,
    requestId: safeCode(body?.requestId),
    reportId: isReportId(body?.reportId) ? body.reportId : undefined,
    transaction: receiptTransaction ?? (isTransaction(body?.payment?.transaction) ? body.payment.transaction : undefined),
    errorCode,
    errorReason: safeCode((failed ?? pending)?.errorReason),
  };

  if (failed) {
    return { ...references, status: 'payment_failed', settlementStatus: 'failed',
      note: 'WAI reported failed settlement. Review the payment before placing another order.' };
  }

  const confirmed = receipts.length > 0 && receiptTransaction !== undefined && receipts.every(receipt =>
    receipt?.success === true && receipt.network === network && receipt.transaction === receiptTransaction);
  const settlementStatus = confirmed ? 'confirmed' : 'uncertain';
  if (confirmed && response.ok && references.reportId && body.serviceId === serviceId &&
      !Object.hasOwn(body, 'error') && isRecord(body.findings) && isRecord(body.evidence)) {
    return { ...context, httpStatus: response.status, transaction: receiptTransaction, settlementStatus,
      status: 'ok', response: body };
  }

  if (confirmed || (!pending && errorCode === 'report_failed')) {
    return { ...references, status: 'report_failed', settlementStatus,
      note: confirmed
        ? 'Payment settled, but WAI did not deliver a complete report. Check the purchase before retrying.'
        : 'WAI reported a report failure. Payment may already have settled. Check the purchase before retrying.' };
  }
  return { ...references, status: 'payment_uncertain', settlementStatus,
    note: 'Settlement could not be confirmed. Check the wallet or transaction records before retrying.' };
}

export function toMcpResult(fn) {
  return async (input) => {
    try {
      const result = await fn(input);
      const paymentError = ['payment_failed', 'payment_uncertain', 'report_failed'].includes(result?.status);
      return { ...(paymentError ? { isError: true } : {}), content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: safeError(e) }] };
    }
  };
}
