import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const paymentFields = new Set(['network', 'amount', 'amountUsdc', 'transaction', 'transactionHash', 'payer', 'recipient']);
const credentialFields = new Set([
  'privatekey', 'walletprivatekey', 'waievmprivatekey', 'seedphrase', 'mnemonic',
  'signature', 'paymentsignature', 'xpaymentsignature', 'xpayment', 'paymentpayload', 'authorization',
  'signedauthorization', 'apikey', 'accesstoken', 'refreshtoken', 'authtoken', 'bearertoken',
  'secret', 'download', 'downloadtoken', 'downloadurl', 'signeddownloadtoken',
  'signeddownloadurl', 'signedurl',
]);

function reportFileField(key, value) {
  const field = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (credentialFields.has(field)) return undefined;
  if (field === 'payment') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return Object.fromEntries(Object.entries(value).filter(([name]) => paymentFields.has(name)));
  }
  if (typeof value === 'string' && /^https?:\/\//i.test(value) &&
      /[?&](?:token|signature|sig|access_token|x-amz-signature)=/i.test(value)) {
    return undefined;
  }
  return value;
}

/** Save a local copy only after payment and report delivery have been confirmed. */
export async function savePurchasedReport(result, outputDir) {
  if (result?.status !== 'ok' || result?.paymentAttempted !== true || result?.settlementStatus !== 'confirmed') return result;
  const report = result?.response;
  const id = report?.reportId;
  const serviceId = report?.serviceId;
  if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id) ||
      typeof serviceId !== 'string' || !/^[a-z0-9-]{1,64}$/.test(serviceId)) {
    return { ...result, localFileError: 'Completed report had invalid file metadata' };
  }
  const filename = `wai-${serviceId}-${id}.json`;
  try {
    const destination = resolve(outputDir || 'reports');
    await mkdir(destination, { recursive: true, mode: 0o700 });
    const file = join(destination, filename);
    await writeFile(file, JSON.stringify(report, reportFileField, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return { ...result, localFile: file };
  } catch (e) {
    // The agent still receives the PAID report even if local persistence fails.
    const duplicate = e?.code === 'EEXIST' && e.syscall === 'open';
    return { ...result, localFileError: duplicate ? 'Report file already exists' : 'Could not write report file' };
  }
}
