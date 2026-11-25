import { API_BASE, MAINNET, SERVICES, USDC } from './core.mjs';

const NAME = /^[a-z][a-z0-9-]{1,63}$/;
const INPUT = /^[a-zA-Z][a-zA-Z0-9]{0,63}$/;
const MAX_SERVICES = 60;
const MAX_BYTES = 131072;
export const DEX_TOOL_NAME = 'wai_dex_liquidity';
export const DEX_PRICE_CENTS = 2;
const DEX_PROTOCOLS = Object.freeze({
  'uniswap-v2': [], 'uniswap-v3': ['fee'], 'uniswap-v4': ['fee','tickSpacing'],
  'aerodrome-classic': ['stable'], 'aerodrome-slipstream': ['tickSpacing'],
  'pancakeswap-v3': ['fee'], 'sushiswap-v2': [], 'sushiswap-v3': ['fee'],
});
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SIZE = /^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,18})?$/;


const DEX_SELECTORS = ['fee', 'tickSpacing', 'stable'];
const DEX_REQUIRED = ['chainId', 'protocol', 'tokenIn'];
const DEX_VARIANTS = Object.keys(DEX_PROTOCOLS);
const disallow = fields => Object.fromEntries(fields.map(field => [field, false]));

export const DEX_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: DEX_REQUIRED,
  properties: {
    chainId: { type: 'integer', const: 8453 },
    protocol: { type: 'string', enum: DEX_VARIANTS },
    tokenIn: { type: 'string', pattern: ADDRESS.source },
    tokenOut: { type: 'string', pattern: ADDRESS.source },
    poolAddress: { type: 'string', pattern: ADDRESS.source },
    fee: { type: 'integer', minimum: 0, maximum: 999999 },
    tickSpacing: { type: 'integer', minimum: 1, maximum: 32767 },
    stable: { type: 'boolean' },
    tradeSizes: {
      type: 'array',
      minItems: 1,
      maxItems: 5,
      uniqueItems: true,
      items: { type: 'string', pattern: SIZE.source, description: 'Positive amount in input-token units' },
      default: ['0.01', '1', '100'],
    },
  },
  if: { required: ['poolAddress'] },
  then: { properties: { protocol: { not: { const: 'uniswap-v4' } }, ...disallow(['tokenOut', ...DEX_SELECTORS]) } },
  else: {
    required: ['tokenOut'],
    oneOf: Object.entries(DEX_PROTOCOLS).map(([protocol, required]) => ({
      properties: { protocol: { const: protocol }, ...disallow(DEX_SELECTORS.filter(field => !required.includes(field))) },
      required,
    })),
  },
};

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
    if (s.id === 'dex-liquidity') {
      const dex = readDex(s, base);
      if (dex) result.set(tool, dex);
      continue;
    }
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

function hasExactly(values, expected) {
  return Array.isArray(values) && values.length === expected.length && expected.every(value => values.includes(value));
}

/** Match the published DEX schema: pool-address mode or a protocol-specific token-pair mode. */
function matchesConditionalDexSchema(schema) {
  const { properties } = schema;
  const required = DEX_REQUIRED;
  const selectors = DEX_SELECTORS;
  const protocols = DEX_VARIANTS;
  if (schema.type !== 'object' || schema.additionalProperties !== false ||
      !hasExactly(schema.required, required) ||
      !hasExactly(Object.keys(properties ?? {}), [...required, 'tokenOut', 'poolAddress', 'tradeSizes', ...selectors]) ||
      properties.chainId?.const !== 8453 || !hasExactly(properties.protocol?.enum, protocols)) return false;

  const pool = schema.then?.properties;
  if (!hasExactly(schema.if?.required, ['poolAddress']) || pool?.protocol?.not?.const !== 'uniswap-v4' ||
      !['tokenOut', ...selectors].every(field => pool[field] === false) ||
      !hasExactly(schema.else?.required, ['tokenOut'])) return false;

  const branches = schema.else.oneOf;
  if (!Array.isArray(branches) || !hasExactly(branches.map(branch => branch?.properties?.protocol?.const), protocols)) return false;
  return branches.every(branch => {
    const requiredSelectors = DEX_PROTOCOLS[branch.properties.protocol.const];
    return hasExactly(branch.required, requiredSelectors) &&
      selectors.every(field => requiredSelectors.includes(field)
        ? !Object.hasOwn(branch.properties, field)
        : branch.properties[field] === false);
  });
}

function matchesLegacyDexSchema(schema) {
  const { oneOf } = schema;
  if (!Array.isArray(oneOf) || !hasExactly(oneOf.map(branch => branch?.properties?.protocol?.const), Object.keys(DEX_PROTOCOLS))) return false;
  return oneOf.every(branch => {
    const protocol = branch.properties.protocol.const;
    const expected = ['chainId', 'protocol', 'tokenIn', 'tokenOut', 'tradeSizes', ...DEX_PROTOCOLS[protocol],
      ...(protocol === 'uniswap-v4' ? [] : ['poolAddress'])];
    return branch.type === 'object' && branch.additionalProperties === false &&
      branch.properties.chainId?.const === 8453 && hasExactly(Object.keys(branch.properties), expected);
  });
}

/** Fail-closed adapter for WAI's known, protocol-discriminated DEX schemas. */
function readDex(s, base) {
  let endpoint;
  try { endpoint = new URL(s.endpoint, base); } catch { return null; }
  if (endpoint.origin !== new URL(base).origin || endpoint.pathname !== '/api/v1/intelligence/dex-liquidity' ||
      endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return null;
  if (typeof s.priceUsdc !== 'string' && typeof s.priceUsdc !== 'number') return null;
  let cents;
  try { cents = cataloguePriceCents(String(s.priceUsdc)); } catch { return null; }
  if (cents !== DEX_PRICE_CENTS || s.payment?.network !== MAINNET || typeof s.payment.asset !== 'string' ||
      s.payment.asset.toLowerCase() !== USDC[MAINNET].toLowerCase()) return null;
  const schema = s.inputSchema;
  if (!schema || !(Object.hasOwn(schema, 'oneOf') ? matchesLegacyDexSchema(schema) : matchesConditionalDexSchema(schema))) return null;
  return { tool: DEX_TOOL_NAME, id:s.id, name:String(s.name || s.id).slice(0,120),
    description:String(s.description || '').slice(0,500), endpoint:endpoint.href, cents, dex:true,
    fields:{chainId:{type:'integer'},protocol:{type:'string'},tokenIn:{type:'string'},tokenOut:{type:'string'},poolAddress:{type:'string'},fee:{type:'integer'},tickSpacing:{type:'integer'},stable:{type:'boolean'},tradeSizes:{type:'array'}},
    required:['chainId','protocol','tokenIn'] };
}
export function validateDexInputs(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('DEX inputs must be an object');
  const protocol = data.protocol;
  if (data.chainId !== 8453 || !Object.hasOwn(DEX_PROTOCOLS, protocol)) throw new Error('DEX requires chainId 8453 and a supported protocol');
  const byPool = protocol !== 'uniswap-v4' && Object.hasOwn(data,'poolAddress');
  const required = ['chainId','protocol','tokenIn',...(byPool ? ['poolAddress'] : ['tokenOut',...DEX_PROTOCOLS[protocol]])];
  const allowed = [...required,'tradeSizes'];
  for (const key of required) if (!Object.hasOwn(data,key)) throw new Error(`Missing required ${key}`);
  for (const key of Object.keys(data)) if (!allowed.includes(key)) throw new Error(`Unexpected input ${key}`);
  for (const key of ['tokenIn','tokenOut','poolAddress']) if (Object.hasOwn(data,key) &&
      !(typeof data[key] === 'string' && (ADDRESS.test(data[key]) || (protocol === 'uniswap-v4' && key !== 'poolAddress' && data[key] === '0x0000000000000000000000000000000000000000')))) throw new Error(`Invalid ${key}`);
  if (data.tokenOut && data.tokenOut.toLowerCase() === data.tokenIn.toLowerCase()) throw new Error('Token addresses must differ');
  for (const key of ['fee','tickSpacing']) if (Object.hasOwn(data,key) &&
      (!Number.isInteger(data[key]) || data[key] < (key === 'fee' ? 0 : 1) || data[key] > (key === 'fee' ? 999999 : 32767))) throw new Error(`Invalid ${key}`);
  if (Object.hasOwn(data,'stable') && typeof data.stable !== 'boolean') throw new Error('Invalid stable');
  const sizes = data.tradeSizes ?? ['0.01','1','100'];
  if (!Array.isArray(sizes) || sizes.length < 1 || sizes.length > 5 ||
      sizes.some(v => typeof v !== 'string' || !SIZE.test(v) || !/[1-9]/.test(v)) ||
      new Set(sizes.map(v => v.includes('.') ? v.replace(/0+$/,'').replace(/\.$/,'') : v)).size !== sizes.length)
    throw new Error('tradeSizes must contain 1-5 distinct positive decimal strings');
  if (Buffer.byteLength(JSON.stringify(data)) > 16000) throw new Error('Inputs too large');
  return data;
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
  if (spec.dex) return validateDexInputs(data);
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
