// Dependency-free guardrails, shared with offline tests.
export const VERSION = '0.2.2';
export const API_BASE = 'https://wai.webberdoo.com';
export const MAINNET = 'eip155:8453';
export const SEPOLIA = 'eip155:84532';
export const USDC = Object.freeze({
  [MAINNET]: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  [SEPOLIA]: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
});
export const SERVICES = Object.freeze({
  verify_uk_company: { id: 'company-verification', cents: 1 },
  investigate_uk_company: { id: 'company-due-diligence', cents: 3 },
  inspect_smart_contract: { id: 'smart-contract', cents: 3 },
  check_token_allowance: { id: 'token-allowance', cents: 2 },
  inspect_uk_business_insolvency: { id: 'business-insolvency', cents: 3 },
  inspect_website_trust: { id: 'website-trust', cents: 2 },
});
export function parseConfig(env = process.env) {
  const base = new URL(env.WAI_BASE_URL || API_BASE);
  if (base.username || base.password || base.search || base.hash || (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1','localhost'].includes(base.hostname)))) {
    throw new Error('WAI_BASE_URL must be HTTPS (HTTP localhost allowed for mock tests), without credentials, query or fragment');
  }
  if (base.pathname !== '/' && base.pathname !== '') throw new Error('WAI_BASE_URL must be an origin, not a subpath');
  const mode = env.WAI_PAYMENT_MODE || 'off';
  if (!['off', 'on'].includes(mode)) throw new Error('WAI_PAYMENT_MODE must be off or on');
  const network = env.WAI_NETWORK || MAINNET;
  if (network !== MAINNET) throw new Error('WAI_NETWORK must be Base Mainnet (eip155:8453)');
  const callLimitCents = parseCents(env.WAI_MAX_PER_CALL_USDC || '0.03');
  const sessionLimitCents = parseCents(env.WAI_MAX_SESSION_USDC || '0.10');
  if (sessionLimitCents < callLimitCents) throw new Error('Session limit must be >= call limit');
  if (mode === 'on' && !/^0x[0-9a-fA-F]{64}$/.test(env.WAI_EVM_PRIVATE_KEY || '')) {
    throw new Error('Payment mode on requires a 32-byte WAI_EVM_PRIVATE_KEY; use a dedicated low-value wallet');
  }
  return { base: base.origin, mode, network, callLimitCents, sessionLimitCents, privateKey: env.WAI_EVM_PRIVATE_KEY || '', receiver: (env.WAI_EXPECTED_PAY_TO || '').toLowerCase() };
}
export function parseCents(value) {
  if (!/^(?:0|[1-9]\d{0,3})(?:\.\d{1,2})?$/.test(String(value))) throw new Error('USDC cap must be a non-negative dollar value with at most 2 decimal places');
  const [d, c=''] = String(value).split('.');
  return Number(d) * 100 + Number(c.padEnd(2,'0'));
}
export function postURL(base, service) {
  if (!Object.hasOwn(SERVICES, service)) throw new Error('Unknown WAI service');
  return `${base}/api/v1/intelligence/${SERVICES[service].id}`;
}
export function extractChallenge(response) {
  const raw = response.headers.get('payment-required');
  if (!raw) throw new Error('Missing x402 v2 PAYMENT-REQUIRED header; refusing payment');
  if (raw.length > 16000) throw new Error('Oversized payment challenge');
  let data;
  try { data = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')); }
  catch { throw new Error('Invalid x402 payment challenge'); }
  if (!data || !Array.isArray(data.accepts) || data.accepts.length === 0) throw new Error('No x402 payment options');
  return data;
}
export function validateChallenge(challenge, config, service, spentCents = 0) {
  // Fail closed if a different option might be selected by the payment SDK.
  if (challenge.accepts.length !== 1) throw new Error('Expected exactly one payment option; refusing ambiguous payment challenge');
  const a = challenge.accepts[0];
  if (a.scheme !== 'exact' || a.network !== config.network) throw new Error('Unsupported payment scheme or network');
  if (String(a.asset).toLowerCase() !== USDC[config.network].toLowerCase()) throw new Error('Payment asset is not the expected USDC token');
  if (!/^\d+$/.test(String(a.amount))) throw new Error('Invalid atomic payment amount');
  const amount = BigInt(a.amount);
  const cents = typeof service === "object" ? service.cents : SERVICES[service]?.cents;
  if (!Number.isSafeInteger(cents) || cents < 1) throw new Error("Unknown service price");
  const maximum = BigInt(cents) * 10000n;
  if (amount > maximum || amount > BigInt(config.callLimitCents) * 10000n) throw new Error('Payment exceeds service price or WAI_MAX_PER_CALL_USDC');
  if (amount === 0n) throw new Error('Unexpected zero-value challenge');
  if (BigInt(spentCents) * 10000n + amount > BigInt(config.sessionLimitCents) * 10000n) throw new Error('Payment exceeds WAI_MAX_SESSION_USDC');
  if (config.receiver && String(a.payTo).toLowerCase() !== config.receiver) throw new Error('Unexpected payment recipient');
  return Number(amount) / 1000000;
}
/** Choose exactly one permitted payment option; never let the SDK choose from other networks. */
export function selectPaymentOffer(challenge, config, service, spentCents = 0) {
  if (!challenge || challenge.x402Version !== 2 || !Array.isArray(challenge.accepts) || challenge.accepts.length < 1)
    throw new Error('Expected an x402 v2 payment challenge with payment options');
  const matches = [];
  for (const a of challenge.accepts) {
    if (a?.scheme !== 'exact' || a?.network !== config.network ||
        String(a.asset).toLowerCase() !== USDC[config.network].toLowerCase()) continue;
    // A matching-network, matching-asset option with an invalid amount must be rejected,
    // not silently skipped in favour of another option.
    const usd = validateChallenge({ accepts: [a] }, config, service, spentCents);
    matches.push({ offer: a, priceUSDC: usd });
  }
  if (matches.length !== 1) throw new Error(`Expected exactly one permitted ${config.network} USDC payment option; found ${matches.length}`);
  return matches[0];
}
export function paymentTermsMatch(first, next) {
  if (!first || !next) return false;
  return ['scheme','network','asset','amount','payTo'].every(field =>
    String(first[field]).toLowerCase() === String(next[field]).toLowerCase());
}
export function safeError(error) {
  const s = error instanceof Error ? error.message : 'Unknown error';
  return s.replace(/0x[0-9a-fA-F]{64}/g, '[redacted-key]').slice(0, 500);
}
