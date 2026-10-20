import { TILE } from './tilemap.js';

export const SPEED = 44; // logical px per second

/** Advance an entity along its path. Returns true if it moved. */
export function step(ent, dt) {
  if (!ent.path || ent.path.length === 0) return false;
  const next = ent.path[0];
  const tx = next.x * TILE, ty = next.y * TILE;
  const dx = tx - ent.x, dy = ty - ent.y;
  const dist = Math.hypot(dx, dy);
  const d = SPEED * dt;
  if (dist <= d) {
    ent.x = tx; ent.y = ty;
    ent.path.shift();
    if (ent.path.length === 0 && ent.onArrive) { const f = ent.onArrive; ent.onArrive = null; f(); }
  } else {
    ent.x += (dx / dist) * d;
    ent.y += (dy / dist) * d;
  }
  return true;
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
