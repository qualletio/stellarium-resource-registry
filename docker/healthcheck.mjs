// Usage: node healthcheck.mjs <port> [path]. Exits 0 when the service answers 2xx.
const [port, path = '/'] = process.argv.slice(2);
try {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(3_000) });
  process.exit(response.ok ? 0 : 1);
} catch {
  process.exit(1);
}
