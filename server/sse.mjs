import { SSE_HEARTBEAT_MS } from './config.mjs';

export class Sse {
  constructor() {
    this.clients = new Set();
    this.timer = setInterval(() => this.raw(': ping\n\n'), SSE_HEARTBEAT_MS);
    this.timer.unref();
  }
  add(req, res, initial) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    if (initial) res.write(format(initial.type, initial.data));
    this.clients.add(res);
    const drop = () => this.clients.delete(res);
    req.on('close', drop);
    res.on('error', drop);
  }
  send(type, data) { this.raw(format(type, data)); }
  raw(chunk) {
    for (const res of this.clients) {
      try { res.write(chunk); } catch { this.clients.delete(res); }
    }
  }
}

function format(type, data) {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}
