import { pathToFileURL } from 'node:url';

export function publicationMatches(snapshot, expectedAsOf, expectedRunId) {
  return Number.isFinite(Date.parse(expectedAsOf))
    && snapshot?.asOf === expectedAsOf
    && snapshot?.publication?.runId === expectedRunId;
}

export async function verifyPublication({ url, expectedAsOf, expectedRunId, timeoutMs = 300_000 }) {
  if (!Number.isFinite(Date.parse(expectedAsOf)) || !expectedRunId) {
    throw new Error('Missing expected snapshot timestamp or workflow run ID');
  }
  const deadline = Date.now() + timeoutMs;
  let lastError;
  do {
    try {
      const options = { cache: 'no-store', headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(12_000) };
      const snapshotUrl = new URL('portfolio.json', url);
      snapshotUrl.searchParams.set('verify', `${expectedRunId}-${Date.now()}`);
      const response = await fetch(snapshotUrl, options);
      if (!response.ok) throw new Error(`Snapshot HTTP ${response.status}`);
      const snapshot = await response.json();
      if (!publicationMatches(snapshot, expectedAsOf, expectedRunId)) {
        throw new Error(`Pages serves ${snapshot.asOf ?? 'no timestamp'} (run ${snapshot.publication?.runId ?? 'unknown'}), expected ${expectedAsOf} (run ${expectedRunId})`);
      }
      const pageUrl = new URL(url);
      pageUrl.searchParams.set('verify', `${expectedRunId}-${Date.now()}`);
      const pageResponse = await fetch(pageUrl, { ...options, signal: AbortSignal.timeout(12_000) });
      if (!pageResponse.ok || !(await pageResponse.text()).includes(expectedAsOf)) {
        throw new Error('JSON is current, but the HTML page still serves another snapshot');
      }
      for (const [name, scan] of Object.entries(snapshot.sync ?? {})) {
        if (scan.ok === false) throw new Error(`Published snapshot has failed ${name} scan: ${scan.error}`);
      }
      console.log(`Verified public JSON and HTML: ${expectedAsOf}, run ${expectedRunId}`);
      return;
    } catch (error) {
      lastError = error;
      console.warn(`Publication not verified yet: ${error.message}`);
    }
    const remaining = deadline - Date.now();
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(15_000, remaining)));
  } while (Date.now() < deadline);
  throw new Error(`Public deployment verification failed: ${lastError?.message}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await verifyPublication({
    url: process.env.PORTFOLIO_URL,
    expectedAsOf: process.env.EXPECTED_AS_OF,
    expectedRunId: process.env.EXPECTED_RUN_ID,
  });
}
