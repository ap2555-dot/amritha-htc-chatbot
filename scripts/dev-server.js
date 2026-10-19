// Tiny local server: serves public/ and routes /api/chat to api/chat.js.
// Usage: GROQ_API_KEY=... node scripts/dev-server.js   (or put it in .env)
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const handler = require('../api/chat.js');
const pub = path.join(root, 'public');
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
const port = process.env.PORT || 3000;

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/chat') {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try { req.body = raw ? JSON.parse(raw) : null; } catch { req.body = null; }
      handler(req, res);
    });
    return;
  }
  let file = path.normalize(path.join(pub, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(pub)) { res.statusCode = 403; return res.end('Forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(buf);
  });
}).listen(port, () => console.log(`Orbit dev server: http://localhost:${port}`));
