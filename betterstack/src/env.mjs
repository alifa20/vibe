// Imported first by server.mjs so .env is loaded before any other module runs,
// as `dotenv/config` did. A missing .env is fine, and variables already set win.
try {
  process.loadEnvFile('.env');
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}
