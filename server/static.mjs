import fs from 'node:fs';
import path from 'node:path';
import { WEB_DIR } from './config.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

export function serveStatic(urlPath, res) {
  let rel = decodeURIComponent(urlPath.replace(/^\/web\//, '/'));
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(WEB_DIR, rel));
  if (!file.startsWith(WEB_DIR + path.sep)) { res.writeHead(403); res.end('forbidden'); return true; }
  let st;
  try { st = fs.statSync(file); } catch { return false; }
  if (!st.isFile()) return false;
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Content-Length': st.size,
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
  return true;
}
