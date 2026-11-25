import {test} from 'node:test';
import assert from 'node:assert/strict';
import { MAINNET, USDC } from '../src/core.mjs';
import {fetchCatalog,readCatalog,validateInputs} from '../src/discovery.mjs';
const names = {'uniswap-v2':[], 'uniswap-v3':['fee'], 'uniswap-v4':['fee','tickSpacing'], 'aerodrome-classic':['stable'], 'aerodrome-slipstream':['tickSpacing'], 'pancakeswap-v3':['fee'], 'sushiswap-v2':[], 'sushiswap-v3':['fee']};
const branches=Object.entries(names).map(([protocol,selectors])=>({type:'object',additionalProperties:false,properties:Object.fromEntries(['chainId','protocol','tokenIn','tokenOut','tradeSizes',...selectors,...(protocol==='uniswap-v4'?[]:['poolAddress'])].map(k=>[k,k==='protocol'?{const:protocol}:k==='chainId'?{const:8453}:{}]))}));
const service={id:'dex-liquidity',available:true,endpoint:'https://wai.webberdoo.com/api/v1/intelligence/dex-liquidity',priceUsdc:'0.020000',payment:{network:MAINNET,asset:USDC[MAINNET]},inputSchema:{oneOf:branches}};
const spec=readCatalog({services:[service]}).get('wai_dex_liquidity');
const a='0x'+'1'.repeat(40), b='0x'+'2'.repeat(40);
test('discovers DEX and rejects changed price or missing protocol',()=>{assert.ok(spec);assert.equal(spec.cents,2);assert.equal(readCatalog({services:[{...service,priceUsdc:'0.030000'}]}).size,0);assert.equal(readCatalog({services:[{...service,inputSchema:{oneOf:branches.slice(1)}}]}).size,0);});
test('validates all eight DEX protocol selectors and trade sizes',()=>{for(const [protocol,selectors] of Object.entries(names)){const args={chainId:8453,protocol,tokenIn:a,tokenOut:b,...Object.fromEntries(selectors.map(k=>[k,k==='stable'?false:k==='fee'?500:10])),tradeSizes:['0.01','1']};assert.deepEqual(validateInputs(spec,args),args);assert.throws(()=>validateInputs(spec,{...args,amountIn:'100'}));if(selectors.length) {const missing={...args};delete missing[selectors[0]];assert.throws(()=>validateInputs(spec,missing));}}});
test('DEX pool mode and bad tradeSizes are rejected appropriately',()=>{const args={chainId:8453,protocol:'uniswap-v3',tokenIn:a,poolAddress:b};assert.deepEqual(validateInputs(spec,args),args);assert.throws(()=>validateInputs(spec,{...args,fee:500}));assert.throws(()=>validateInputs(spec,{...args,tradeSizes:['0']}));assert.throws(()=>validateInputs(spec,{...args,tradeSizes:['1','1.0']}));});

const selectorFields = ['stable', 'fee', 'tickSpacing'];
const disallow = fields => Object.fromEntries(fields.map(field => [field, false]));
const productionService = {
  ...service,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['chainId', 'protocol', 'tokenIn'],
    properties: {
      chainId: { type: 'integer', const: 8453 },
      protocol: { type: 'string', enum: Object.keys(names) },
      tokenIn: { type: 'string' }, tokenOut: { type: 'string' }, poolAddress: { type: 'string' },
      tradeSizes: { type: 'array' }, stable: { type: 'boolean' }, fee: { type: 'integer' },
      tickSpacing: { type: 'integer' },
    },
    if: { required: ['poolAddress'] },
    then: { properties: { protocol: { not: { const: 'uniswap-v4' } }, ...disallow(['tokenOut', ...selectorFields]) } },
    else: {
      required: ['tokenOut'],
      oneOf: Object.entries(names).map(([protocol, required]) => ({
        properties: { protocol: { const: protocol }, ...disallow(selectorFields.filter(field => !required.includes(field))) },
        required,
      })),
    },
  },
};

test('discovers and validates the production conditional DEX catalogue through its GET loader', async () => {
  const catalogue = await fetchCatalog('https://wai.webberdoo.com', async (url, options) => {
    assert.equal(url, 'https://wai.webberdoo.com/api/v1/services');
    assert.equal(options.method, 'GET');
    return Response.json({ services: [productionService] });
  });
  const dex = catalogue.get('wai_dex_liquidity');
  assert.equal(dex.id, 'dex-liquidity');
  assert.equal(dex.endpoint, service.endpoint);
  assert.equal(dex.cents, 2);
  const args = { chainId: 8453, protocol: 'uniswap-v3', tokenIn: a, tokenOut: b, fee: 500 };
  assert.deepEqual(validateInputs(dex, args), args);
  assert.throws(() => validateInputs(dex, { ...args, chainId: 84532 }));
});

test('production DEX discovery rejects changes to price, network, asset, endpoint and schema', () => {
  const changes = [
    entry => { entry.priceUsdc = '0.020001'; },
    entry => { entry.priceUsdc = ['0.020000']; },
    entry => { delete entry.payment; },
    entry => { entry.payment.network = 'eip155:84532'; },
    entry => { entry.payment.asset = a; },
    entry => { entry.endpoint += '?redirect=1'; },
    entry => { entry.inputSchema.properties.chainId.const = 84532; },
    entry => { entry.inputSchema.else.oneOf[0] = entry.inputSchema.else.oneOf[1]; },
    entry => { entry.inputSchema.else.oneOf[1].required = []; },
    entry => { delete entry.inputSchema.then.properties.fee; },
  ];
  for (const change of changes) {
    const entry = structuredClone(productionService);
    change(entry);
    assert.equal(readCatalog({ services: [entry] }).has('wai_dex_liquidity'), false);
  }
});
