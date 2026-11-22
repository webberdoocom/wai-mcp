import { fetchCatalog } from '../src/discovery.mjs';
import { parseConfig } from '../src/core.mjs';
console.log('WAI MCP discovery check — GET catalogue only, no wallet or payments');
try {
 const services=await fetchCatalog(parseConfig({WAI_PAYMENT_MODE:'off'}).base);
 console.log(`PASS: ${services.size} additional valid service(s) discovered`);
 for(const s of services.values()) console.log(`${s.tool}  $${(s.cents/100).toFixed(2)}  [payments require allowlisting]`);
 if (!services.size) console.log('This is expected while WAI only has the original four services.');
} catch(e) {console.error('FAIL: '+e.message);process.exitCode=1}
