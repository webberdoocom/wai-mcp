import { API_BASE, SERVICES } from './core.mjs';

const NAME = /^[a-z][a-z0-9-]{1,63}$/;
const INPUT = /^[a-zA-Z][a-zA-Z0-9]{0,63}$/;
const MAX_SERVICES = 60;
const MAX_BYTES = 131072;

/** Strictly convert a trusted WAI catalogue into bounded, inert descriptors.
 * Does not execute catalogue-supplied code, follow URLs, or grant payment access. */
export function readCatalog(json, base = API_BASE) {
  if (!json || !Array.isArray(json.services) || json.services.length > MAX_SERVICES)
    throw new Error('Invalid or oversized WAI service catalogue');
  const result = new Map();
  for (const s of json.services) {
    if (!s || s.available !== true || typeof s.id !== 'string' || !NAME.test(s.id)) continue;
    const tool = `wai_${s.id.replaceAll('-', '_')}`;
    if (Object.hasOwn(SERVICES, s.id) || Object.values(SERVICES).some(v => v.id === s.id)) continue;
    if (!s.inputSchema || s.inputSchema.type !== 'object' || s.inputSchema.additionalProperties !== false ||
      !s.inputSchema.properties || typeof s.inputSchema.properties !== 'object' || Array.isArray(s.inputSchema.properties)) continue;
    const entries = Object.entries(s.inputSchema.properties);
    if (entries.length > 16 || !Array.isArray(s.inputSchema.required)) continue;
    const fields = {};
    let valid = true;
    for (const [key, prop] of entries) {
      if (!INPUT.test(key) || !prop || !['string','boolean','integer','number'].includes(prop.type) ||
          (prop.enum !== undefined && (!Array.isArray(prop.enum) || prop.enum.length > 30)) ||
          (prop.pattern !== undefined && (typeof prop.pattern !== 'string' || prop.pattern.length > 160))) { valid = false; break; }
      fields[key] = { type: prop.type, ...(prop.enum ? { enum: prop.enum } : {}), ...(prop.pattern ? { pattern: prop.pattern } : {}) };
    }
    if (!valid || s.inputSchema.required.some(k => !Object.hasOwn(fields,k))) continue;
    let endpoint;
    try { endpoint = new URL(s.endpoint, base); } catch { continue; }
    if (endpoint.origin !== new URL(base).origin || endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
      endpoint.pathname !== `/api/v1/intelligence/${s.id}`) continue;
    if (typeof s.priceUsdc !== 'string' && typeof s.priceUsdc !== 'number') continue;
    let cents;
    try { cents = cataloguePriceCents(String(s.priceUsdc)); } catch { continue; }
    if (cents < 1 || cents > 999) continue;
    if (result.has(tool)) continue;
    result.set(tool, { tool, id:s.id, name: typeof s.name === 'string' ? s.name.slice(0,120) : s.id,
      description: typeof s.description === 'string' ? s.description.slice(0,500) : '',
      endpoint: endpoint.href, cents, fields, required: [...s.inputSchema.required] });
  }
  return result;
}

export function cataloguePriceCents(value) {
  if (!/^(?:0|[1-9]\d{0,3})(?:\.\d{1,6})?$/.test(value)) throw new Error('Invalid WAI price');
  const [whole, fraction=''] = value.split('.');
  const padded = fraction.padEnd(6, '0');
  if (padded.slice(2) !== '0000') throw new Error('Fractional cent price is not supported');
  return Number(whole) * 100 + Number(padded.slice(0,2));
}

export async function fetchCatalog(base = API_BASE, fetchImpl = fetch) {
  const url = `${base}/api/v1/services`;
  const response = await fetchImpl(url, {method:'GET',headers:{accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(8000)});
  if (!response.ok || Number(response.headers.get('content-length') || 0) > MAX_BYTES) throw new Error(`WAI discovery returned HTTP ${response.status}`);
  const raw = await response.text();
  if (Buffer.byteLength(raw) > MAX_BYTES) throw new Error('WAI catalogue too large');
  return readCatalog(JSON.parse(raw), base);
}

export function validateInputs(spec, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Expected JSON object');
  for (const key of Object.keys(data)) {
    const rule = spec.fields[key];
    if (!rule) throw new Error(`Unexpected input ${key}`);
    const value = data[key];
    if (rule.type === 'string' && (typeof value !== 'string' || value.length > 512)) throw new Error(`Invalid ${key}`);
    if (rule.type === 'boolean' && typeof value !== 'boolean') throw new Error(`Invalid ${key}`);
    if (rule.type === 'integer' && (!Number.isSafeInteger(value))) throw new Error(`Invalid ${key}`);
    if (rule.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error(`Invalid ${key}`);
    if (rule.enum && !rule.enum.includes(value)) throw new Error(`Invalid ${key}: not in allowed values`);
    if (rule.pattern && !new RegExp(rule.pattern).test(value)) throw new Error(`Invalid ${key}: pattern mismatch`);
  }
  for (const key of spec.required) if (!Object.hasOwn(data,key)) throw new Error(`Missing required ${key}`);
  if (Buffer.byteLength(JSON.stringify(data)) > 16000) throw new Error('Inputs too large');
  return data;
}

export function permittedDynamicPayment(spec, env = process.env) {
  // New services never automatically inherit paid execution privileges.
  const allowed = (env.WAI_DYNAMIC_PAID_ALLOWLIST || '').split(',').map(s=>s.trim());
  return allowed.includes(spec.id);
}
