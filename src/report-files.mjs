import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

/** Optional, local-only storage of an ALREADY purchased report. Never fetches
 * URLs or signs another payment. No writes unless WAI_REPORT_DIR is provided. */
export async function savePurchasedReport(result, outputDir) {
  if (!outputDir || result?.status !== 'ok' || result?.paymentAttempted !== true) return result;
  const report = result?.response;
  const id = report?.reportId;
  const serviceId = report?.serviceId;
  if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id) ||
      typeof serviceId !== 'string' || !/^[a-z0-9-]{1,64}$/.test(serviceId)) {
    return { ...result, localFileError: 'Completed report had invalid file metadata' };
  }
  const destination = resolve(outputDir);
  const filename = `wai-${serviceId}-${id}.json`;
  try {
    await mkdir(destination, { recursive: true, mode: 0o700 });
    // Files may be examined with standard JSON tools. Exclude the signed URL:
    // it is a bearer credential and should not be persisted unnecessarily.
    const { download: _download, ...reportData } = report;
    const file = join(destination, filename);
    await writeFile(file, JSON.stringify(reportData, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return { ...result, localFile: file };
  } catch (e) {
    // The agent still receives the PAID report even if local persistence fails.
    return { ...result, localFileError: e?.code === 'EEXIST' ? 'Report file already exists' : 'Could not write report file' };
  }
}
