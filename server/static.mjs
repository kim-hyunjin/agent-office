import fs from 'node:fs';
import path from 'node:path';
import { WEB_DIR } from './config.mjs';
import { decode } from './util.mjs';

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

/** 200 + headers (+ Content-Length when `size` is known), then stream `file`; a read error just drops the connection. */
export function sendFile(res, file, size, headers) {
  res.writeHead(200, size == null ? headers : { ...headers, 'Content-Length': size });
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

export function serveStatic(urlPath, res) {
  let rel = decode(urlPath.replace(/^\/web\//, '/'));
  if (rel === null) return false; // malformed %-escape names no file we have → 404
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(WEB_DIR, rel));
  if (!file.startsWith(WEB_DIR + path.sep)) { res.writeHead(403); res.end('forbidden'); return true; }
  let st;
  try { st = fs.statSync(file); } catch { return false; }
  if (!st.isFile()) return false;
  sendFile(res, file, st.size, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  return true;
}
