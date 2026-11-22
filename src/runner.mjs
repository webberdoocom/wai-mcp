import { savePurchasedReport } from './report-files.mjs';
import { validateInputs, permittedDynamicPayment } from './discovery.mjs';
import { extractChallenge, parseConfig, postURL, SERVICES, selectPaymentOffer, paymentTermsMatch, safeError } from './core.mjs';

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
  async function payFetch(url, options, service, amountCents, firstChallenge, firstOffer) {
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
      return mockPay(url, options);
    }
    const [{ x402Client }, { ExactEvmScheme }, { wrapFetchWithPayment }, { privateKeyToAccount }] = await Promise.all([
      import('@x402/core/client'), import('@x402/evm/exact/client'), import('@x402/fetch'), import('viem/accounts')
    ]);
    const client = new x402Client();
    client.register(config.network, new ExactEvmScheme(privateKeyToAccount(config.privateKey)));
    let unsignedRequests = 0;
    let signedRequests = 0;
    const guardedFetch = async (target, init = {}) => {
      const { headers, signed } = await normalizePaymentRequest(target, init, url, options.body);
      if (signed) {
        signedRequests++;
        if (signedRequests !== 1 || unsignedRequests !== 1) throw new Error('Unexpected repeated or premature signed payment request');
        return fetchImpl(url, { ...options, headers, redirect: 'error' });
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
    return paymentFetch(url, options);
  }
  async function runRequest(service, payload, dynamic = false) {
    if (!dynamic && !Object.hasOwn(SERVICES, service)) throw new Error('Unknown tool');
    if (dynamic) validateInputs(service, payload);
    const url = dynamic ? service.endpoint : postURL(config.base, service);
    const options = { method: 'POST', headers: { 'content-type': 'application/json', 'accept': 'application/json', 'user-agent': 'wai-mcp/0.1.0' }, body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(20000) };
    // An unsigned first request tests the quote. Signing is deliberately opt-in.
    const first = await fetchImpl(url, options);
    if (first.status !== 402) return interpret(first, false);
    const challenge = extractChallenge(first);
    const { offer, priceUSDC: quotedUSDC } = selectPaymentOffer(challenge, config, service, reservedCents);
    if (config.mode === 'off' || (dynamic && !permittedDynamicPayment(service, env))) return { status: 'payment_required', service: dynamic ? service.id : service, network: config.network, priceUSDC: quotedUSDC, note: dynamic && !permittedDynamicPayment(service, env) ? 'Newly discovered service: payment blocked until its service ID is explicitly added to WAI_DYNAMIC_PAID_ALLOWLIST.' : 'No funds spent. Set WAI_PAYMENT_MODE=on and configure a dedicated buyer wallet to enable payment.' };
    const response = await payFetch(url, options, service, Math.ceil(quotedUSDC * 100), challenge, offer);
    return savePurchasedReport(await interpret(response, true), env.WAI_REPORT_DIR);
  }
  return { run: (service,payload) => runRequest(service,payload,false), runDynamic: (spec,payload) => runRequest(spec,payload,true), config };
}
async function interpret(response, paymentAttempted) {
  const raw = await response.text();
  let body;
  try { body = JSON.parse(raw); } catch { body = { message: raw.slice(0, 2500) }; }
  if (response.status === 402) throw new Error('Paid request was not accepted (HTTP 402); verify wallet, network and challenge');
  if (!response.ok) throw new Error(`WAI returned HTTP ${response.status}: ${JSON.stringify(body).slice(0, 400)}`);
  return { status: 'ok', paymentAttempted, response: body };
}
export function toMcpResult(fn) {
  return async (input) => {
    try {
      return { content: [{ type: 'text', text: JSON.stringify(await fn(input), null, 2) }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: safeError(e) }] };
    }
  };
}
