// Stands in for `claude -p --input-format stream-json --output-format stream-json` in tests: ignores flags it doesn't need.
const i = process.argv.indexOf('--session-id');
const sid = i > 0 ? process.argv[i + 1] : null;
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
out({ type: 'system', subtype: 'init', model: 'fake', session_id: sid });
let rem = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  const lines = (rem + chunk).split('\n'); rem = lines.pop();
  for (const line of lines) {
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o?.type !== 'user') continue;
    out({ type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] }, session_id: sid });
    out({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.001, result: 'ok', session_id: sid });
  }
});
process.stdin.on('end', () => process.exit(0));
