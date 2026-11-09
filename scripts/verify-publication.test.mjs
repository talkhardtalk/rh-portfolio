import assert from 'node:assert/strict';
import test from 'node:test';
import { publicationMatches, verifyPublication } from './verify-publication.mjs';

const isSnapshot = (url) => url instanceof URL && url.pathname.endsWith('/portfolio.json');

test('only the exact published snapshot and run count as a verified deployment', () => {
  const asOf = '2026-11-09T07:08:28.653Z';
  const snapshot = { asOf, publication: { runId: '123' } };
  assert.equal(publicationMatches(snapshot, asOf, '123'), true);
  assert.equal(publicationMatches({ ...snapshot, asOf: '2026-11-08T19:58:21.027Z' }, asOf, '123'), false);
  assert.equal(publicationMatches({ ...snapshot, publication: { runId: '122' } }, asOf, '123'), false);
  assert.equal(publicationMatches(null, asOf, '123'), false);
  assert.equal(publicationMatches(snapshot, 'invalid', '123'), false);
});

test('verification checks both JSON and HTML and reports stale deployments', async () => {
  const originalFetch = globalThis.fetch;
  const asOf = '2026-11-09T07:08:28.653Z';
  const options = { url: 'https://example.com/portfolio/', expectedAsOf: asOf, expectedRunId: '123', timeoutMs: 0 };
  try {
    globalThis.fetch = async (url) => isSnapshot(url)
      ? Response.json({ asOf, publication: { runId: '123' } }) : new Response(`<html>${asOf}</html>`);
    await verifyPublication(options);
    globalThis.fetch = async () => Response.json({ asOf: 'old' });
    await assert.rejects(verifyPublication(options), /Pages serves old/);
    globalThis.fetch = async (url) => isSnapshot(url)
      ? Response.json({ asOf, publication: { runId: '123' } }) : new Response('old HTML');
    await assert.rejects(verifyPublication(options), /HTML page/);
    globalThis.fetch = async (url) => isSnapshot(url)
      ? Response.json({ asOf, publication: { runId: '123' }, sync: { purchases: { ok: false, error: 'RPC failed' } } })
      : new Response(asOf);
    await assert.rejects(verifyPublication(options), /failed purchases scan/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
