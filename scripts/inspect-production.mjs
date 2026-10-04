// Read-only verification: no login, credentials, ledger API, Sheets or Gmail.
const base = 'https://duanos.pages.dev';
const markers = [
  'BRIDGE_REMOTE_INVALID_SIGNATURE', 'BRIDGE_REMOTE_NOT_CONFIGURED',
  'BRIDGE_REMOTE_INVALID_REQUEST', 'BRIDGE_REMOTE_STALE_REQUEST',
  'BRIDGE_REMOTE_LEDGER_SHEET_NOT_FOUND', 'BRIDGE_REMOTE_SHEET_NOT_WRITTEN',
  'CLOUD_FETCH_ERROR', 'CLOUD_HTTP_ERROR', 'CLOUD_JSON_ERROR',
  'CLOUD_RESPONSE_ERROR', 'LEDGER_STATE_READ_ERROR',
];
async function get(path) {
  try {
    const response = await fetch(base + path, {
      headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(15000),
    });
    return { status: response.status, body: await response.text() };
  } catch { return { status: 0, body: '' }; }
}
for (let attempt = 1; attempt <= 10; attempt++) {
  const home = await get('/?check=' + Date.now());
  // Inspect only same-origin script paths, with a bounded number of requests.
  const paths = [...home.body.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)]
    .map(m => m[1])
    .filter(p => /^\/(?:_expo\/static\/js\/web|assets)\/[A-Za-z0-9_-]+\.js$/.test(p)).slice(0, 5);
  let js = ''; const bundles = [];
  for (const path of paths) {
    const r = await get(path + '?check=' + Date.now());
    if (r.status === 200) js += r.body;
    bundles.push({ path, status: r.status });
  }
  const health = await get('/api/health?check=' + Date.now());
  let protocol = null;
  try { const h = JSON.parse(health.body); if (h.ok === true && h.ledgerProtocol === 2) protocol = 2; } catch {}
  const present = Object.fromEntries(markers.map(m => [m, js.includes(m)]));
  const verified = home.status === 200 && protocol === 2 && markers.every(m => present[m]);
  // Log only public asset paths and fixed diagnostics; never response bodies/headers.
  console.log('PRODUCTION_READ_ONLY_RESULT=' + JSON.stringify({ attempt, homepage: home.status, bundles, markers: present, health: health.status, ledgerProtocol: protocol, verified }));
  if (verified) process.exit(0);
  if (attempt < 10) await new Promise(resolve => setTimeout(resolve, 15000));
}
process.exitCode = 1;
