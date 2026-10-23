// Small DOM and formatting helpers shared by the office, its panels and dialogs.
import { spriteSize } from './sprites.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const fmtTime = (t) => new Date(t).toTimeString().slice(0, 8);
/** A status line under a form: kind '' | 'ok' | 'err' (styled by .msg in style.css). */
export const setMsg = (el, text, kind = '') => { el.textContent = text; el.className = `msg ${kind}`; };

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: filename }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A drawable (sprite frame or skin frame) on a canvas, sized by its world size × zoom (uploaded skins carry a scale). */
export function pic(img, zoom = 1, canvas = document.createElement('canvas')) {
  const { w, h } = spriteSize(img);
  canvas.width = Math.round(w * zoom); canvas.height = Math.round(h * zoom);
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** A modal <dialog> closes from its × button and from a click on the backdrop. */
export function bindDialogClose(dlg, closeBtn) {
  closeBtn.addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // backdrop
}

// localStorage that never throws (blocked storage, private mode). Keys stay as they are: renaming one resets a setting.
export const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
  remove(k) { try { localStorage.removeItem(k); } catch { /* storage blocked */ } },
};
