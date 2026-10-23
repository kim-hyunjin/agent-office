// Picks how sessions are run: Orca CLI or a headless `claude -p` (stub until the runner lands).
import * as orca from './orca.mjs';
import { BACKEND } from '../config.mjs';

const headless = { probe: async () => ({ available: false, reason: '아직 지원하지 않습니다.' }) };

export { orca };

export async function backends() {
  const [o, h] = await Promise.all([orca.probe(), headless.probe()]);
  const forced = BACKEND !== 'auto', ok = { orca: o.available, headless: h.available };
  // a forced backend wins only while it works; otherwise fall back like auto
  const def = forced && ok[BACKEND] ? BACKEND : ok.orca ? 'orca' : ok.headless ? 'headless' : null;
  return { orca: o, headless: h, default: def, forced };
}
