import fs from 'node:fs';
import path from 'node:path';
import {
  SEATS_PER_DESK, LOG_SIZE, SNAPSHOT_LOG, DESK_MEMORY_MS,
  SUBAGENT_TTL_MS, SUBAGENT_STALE_MS, SESSION_TTL_MS, ORPHAN_SESSION_MS, STATE_FILE, SKINS_DIR,
} from './config.mjs';
import { debounce, safeJsonParse } from './util.mjs';
import { repoOf } from './repo.mjs';
import { DEFAULT_OFFICE, cloneOffice, deskCount, normalize, validate } from '../web/layout.js';

class RingBuffer {
  constructor(n) { this.n = n; this.buf = []; }
  push(x) { this.buf.push(x); if (this.buf.length > this.n) this.buf.shift(); }
  toArray() { return this.buf.slice(); }
  last(k) { return this.buf.slice(-k); }
}

const BUSY_STATES = new Set(['thinking', 'reading', 'coding', 'terminal', 'searching', 'delegating', 'working']);
export const isBusyState = (s) => BUSY_STATES.has(s);
export const CAT_FAMILIES = ['fable', 'opus', 'sonnet', 'haiku', 'other'];
export const SKIN_ID = /^[a-z0-9]{10}$/;
// a built-in breed (the list itself lives in web/sprites.js) or an uploaded skin, 'skin:<id>'
export const BREED_KEY = /^([a-z]{2,24}|skin:[a-z0-9]{10})$/;
export const DEFAULT_OFFICE_ID = 'default';
const newOffice = (id, name, repos, layout = cloneOffice(DEFAULT_OFFICE)) => ({ id, name, repos, layout });

export class Store {
  constructor({ stateFile = STATE_FILE, skinsDir = SKINS_DIR } = {}) {
    this.sessions = new Map();
    this.desks = {};           // sessionId -> { desk, office, at, terminal? }
    this.offices = [newOffice(DEFAULT_OFFICE_ID, '사무실', ['default'])]; // one per repo; repos: repo keys that work there
    this.cats = {};            // model family -> breed key the user picked (absent = default breed)
    this.skins = [];           // uploaded sprite sheets: { id, name, cellW, cellH }, image at skinsDir/<id>.png
    this.together = null;      // office id everyone works in regardless of repo, or null: each repo in its own office
    this.stateFile = stateFile;
    this.skinsDir = skinsDir;
    this.listeners = new Set();
    this.save = debounce(() => this.saveNow(), 500);
  }

  // ---- persistence -------------------------------------------------------
  load() {
    const data = safeJsonParse(fs.existsSync(this.stateFile) ? fs.readFileSync(this.stateFile, 'utf8') : '');
    const now = Date.now();
    this.desks = {};
    for (const [id, v] of Object.entries(data?.desks || {})) {
      if (v && typeof v.desk === 'number' && now - (v.at || 0) < DESK_MEMORY_MS) this.desks[id] = v;
    }
    this.skins = [];
    for (const k of Array.isArray(data?.skins) ? data.skins : []) {
      if (SKIN_ID.test(k?.id) && !this.skins.some((x) => x.id === k.id) && fs.existsSync(this.skinFile(k.id))) {
        this.skins.push({ id: k.id, name: String(k.name || '스킨'), cellW: k.cellW, cellH: k.cellH });
      }
    }
    this.cats = {};
    for (const [fam, breed] of Object.entries(data?.cats || {})) {
      if (CAT_FAMILIES.includes(fam) && BREED_KEY.test(breed) && this.hasBreed(breed)) this.cats[fam] = breed;
    }
    const offices = [];
    for (const o of Array.isArray(data?.offices) ? data.offices : []) {
      if (typeof o?.id !== 'string' || offices.some((x) => x.id === o.id) || !Array.isArray(o.repos)) continue;
      const layout = validate(normalize(o.layout)).length ? cloneOffice(DEFAULT_OFFICE) : normalize(o.layout); // a broken layout falls back to the default
      offices.push(newOffice(o.id, String(o.name || '사무실'), o.repos.filter((r) => typeof r === 'string'), layout));
    }
    if (!offices.some((o) => o.id === DEFAULT_OFFICE_ID)) offices.unshift(newOffice(DEFAULT_OFFICE_ID, '사무실', ['default']));
    this.offices = offices;
    this.together = offices.some((o) => o.id === data?.together) ? data.together : null;
  }
  saveNow() {
    try {
      fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
      fs.writeFileSync(this.stateFile, JSON.stringify({ desks: this.desks, cats: this.cats, skins: this.skins, offices: this.offices, together: this.together, updatedAt: Date.now() }, null, 2));
    } catch (e) {
      console.error('[store] save failed:', e.message);
    }
  }

  // ---- events --------------------------------------------------------------
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type, data) { for (const fn of this.listeners) fn(type, data); }
  emitSession(s) { this.emit('session', this.serializeSession(s)); }

  // ---- settings ------------------------------------------------------------
  /** Pick the breed a model family is drawn as; null restores the default. Pushed to every browser. */
  setCat(fam, breed) {
    if (breed) this.cats[fam] = breed; else delete this.cats[fam];
    this.save();
    this.emitSettings();
  }
  emitSettings() { this.emit('settings', { cats: this.cats, skins: this.skins }); }
  skinFile(id) { return path.join(this.skinsDir, `${id}.png`); }
  /** Skins must exist; built-in breed keys are checked by the browser (unknown ones draw the default). */
  hasBreed(breed) { return !breed.startsWith('skin:') || this.skins.some((k) => `skin:${k.id}` === breed); }
  /** Store an uploaded sprite sheet (already validated) and offer it to every browser. */
  addSkin({ name, cellW, cellH }, png) {
    let id;
    do id = Array.from({ length: 10 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
    while (this.skins.some((k) => k.id === id));
    fs.mkdirSync(this.skinsDir, { recursive: true });
    fs.writeFileSync(this.skinFile(id), png);
    const skin = { id, name, cellW, cellH };
    this.skins.push(skin);
    this.save();
    this.emitSettings();
    return skin;
  }
  /** Delete a skin; families drawn with it go back to their default breed. */
  removeSkin(id) {
    if (!this.skins.some((k) => k.id === id)) return false;
    this.skins = this.skins.filter((k) => k.id !== id);
    for (const [fam, breed] of Object.entries(this.cats)) if (breed === `skin:${id}`) delete this.cats[fam];
    try { fs.unlinkSync(this.skinFile(id)); } catch { /* already gone */ }
    this.save();
    this.emitSettings();
    return true;
  }

  // ---- offices --------------------------------------------------------------
  office(id) { return this.offices.find((o) => o.id === id); }
  emitOffices() { this.emit('offices', { offices: this.offices, together: this.together }); }
  /** The office a working directory belongs to: its repo's, created (with the default layout) the first time. */
  officeFor(cwd) {
    const repo = repoOf(cwd);
    let o = this.offices.find((x) => x.repos.includes(repo.key));
    if (!o) {
      o = newOffice(`o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, repo.name || '사무실', [repo.key]);
      this.offices.push(o);
      this.save();
      this.emitOffices();
    }
    return o.id;
  }
  /** Send a session to its repo's office, or the shared one (cwd can arrive after the session); a move gets it a desk there. */
  placeSession(s) {
    const own = this.officeFor(s.cwd); // created even while together, so splitting up later has somewhere to go
    const id = this.together ?? own;
    if (s.officeId === id) return false;
    s.officeId = id;
    if (!s.ended) s.desk = this.assignDesk(s.id, id);
    return true;
  }
  setCwd(s, cwd) {
    if (!cwd || s.cwd === cwd) return false;
    s.cwd = cwd;
    this.placeSession(s);
    return true;
  }
  /** Gather everyone in one office (null: back to their repos' offices), moving the staff right away. */
  setTogether(officeId) {
    this.together = officeId;
    for (const s of this.sessions.values()) if (this.placeSession(s)) this.emitSession(s);
    this.save();
    this.emitOffices();
  }
  /** Sessions in an office whose desk is gone (layout shrank) get a free one, if any. */
  reseat(officeId) {
    const n = deskCount(this.office(officeId).layout);
    for (const s of this.sessions.values()) {
      if (s.ended || s.officeId !== officeId || s.desk < n) continue;
      s.desk = this.assignDesk(s.id, officeId);
      this.emitSession(s);
    }
  }
  setLayout(officeId, layout) {
    const o = this.office(officeId);
    o.layout = layout;
    this.reseat(officeId);
    this.save();
    this.emitOffices();
  }
  renameOffice(officeId, name) {
    this.office(officeId).name = name;
    this.save();
    this.emitOffices();
  }
  /** Close an office: its repos and staff move to the default office. */
  deleteOffice(officeId) {
    const o = this.office(officeId), home = this.office(DEFAULT_OFFICE_ID);
    home.repos.push(...o.repos.filter((r) => !home.repos.includes(r)));
    this.offices = this.offices.filter((x) => x !== o);
    if (this.together === officeId) this.together = DEFAULT_OFFICE_ID;
    for (const s of this.sessions.values()) {
      if (s.officeId !== officeId) continue;
      s.officeId = DEFAULT_OFFICE_ID;
      if (!s.ended) s.desk = this.assignDesk(s.id, DEFAULT_OFFICE_ID);
      this.emitSession(s);
    }
    this.save();
    this.emitOffices();
  }

  // ---- desks ---------------------------------------------------------------
  assignDesk(sessionId, officeId) {
    const used = new Set();
    for (const s of this.sessions.values()) if (!s.ended && s.id !== sessionId && s.officeId === officeId) used.add(s.desk);
    const n = deskCount(this.office(officeId).layout);
    const remembered = this.desks[sessionId];
    let desk;
    if (remembered && (remembered.office ?? DEFAULT_OFFICE_ID) === officeId && remembered.desk < n && !used.has(remembered.desk)) desk = remembered.desk; // layouts can shrink
    else { desk = 0; while (used.has(desk)) desk++; } // past the last desk: standing in the lobby
    this.desks[sessionId] = { ...remembered, desk, office: officeId, at: Date.now() };
    this.save();
    return desk;
  }
  /** Link a session to its Orca terminal; remembered with the desk so a server restart keeps it. */
  setTerminal(s, handle) {
    if (!handle || s.orcaTerminal === handle) return;
    s.orcaTerminal = handle;
    const d = this.desks[s.id];
    if (d) { d.terminal = handle; this.save(); }
  }
  releaseDesk(sessionId) {
    delete this.desks[sessionId];
    this.save();
  }
  assignSeat(session) {
    const used = new Set();
    for (const a of session.subagents.values()) if (!a.ended) used.add(a.seat);
    let seat = 0;
    while (used.has(seat)) seat++;
    return seat; // >= SEATS_PER_DESK overflows to the bullpen on the client
  }

  // ---- sessions ------------------------------------------------------------
  getOrCreateSession(id, init = {}) {
    let s = this.sessions.get(id);
    if (s) {
      if (s.ended) this.revive(s);
      if (init.cwd && !s.cwd) { this.setCwd(s, init.cwd); if (!s.nameSource) s.name = path.basename(init.cwd) || s.name; }
      if (init.transcriptPath && !s.transcriptPath) s.transcriptPath = init.transcriptPath;
      return s;
    }
    const now = Date.now();
    s = {
      id,
      pid: init.pid ?? null,
      name: init.name || (init.cwd ? path.basename(init.cwd) : id.slice(0, 8)),
      nameSource: init.name ? 'registry' : null,
      title: null,
      cwd: init.cwd || '',
      model: init.model || null,
      state: 'idle',
      stateSince: now,
      currentTool: null,
      lastText: null,
      lastTextAt: 0,
      replyText: null,     // full markdown of lastText, for the reply dialog
      lastPrompt: null,
      lastThinking: null,
      lastThinkingAt: 0,
      turnStartedAt: 0,
      turnTools: 0,
      cost: null,          // { usd, linesAdded, linesRemoved, apiMs } from transcript
      pendingAgents: [],   // Agent tool calls waiting for their SubagentStart
      bgTasks: [],         // background work the idle session waits on, as of its last Stop
      awaitingShell: false, // registry status 'shell' (covers sessions without our hooks)
      startedAt: init.startedAt || now,
      lastEventAt: now,
      hookEvents: 0,
      ended: false,
      endedAt: null,
      officeId: null,
      desk: null,
      permissionMode: null,
      transcriptPath: init.transcriptPath || null,
      orcaTerminal: this.desks[id]?.terminal || null, // Orca terminal handle (hook env or resolved) for sending prompts
      log: new RingBuffer(LOG_SIZE),
      subagents: new Map(),
    };
    this.sessions.set(id, s);
    this.placeSession(s);
    return s;
  }
  revive(s) {
    s.ended = false;
    s.endedAt = null;
    s.state = 'idle';
    s.stateSince = Date.now();
    s.desk = this.assignDesk(s.id, s.officeId);
  }
  endSession(s, reason = 'ended') {
    if (s.ended) return;
    s.ended = true;
    s.endedAt = Date.now();
    s.state = 'offduty';
    s.stateSince = s.endedAt;
    s.currentTool = null;
    for (const a of s.subagents.values()) this.endSubagent(a);
    this.log(s, { ev: 'SessionEnd', text: reason });
  }

  getOrCreateSubagent(s, agentId, init = {}) {
    let a = s.subagents.get(agentId);
    if (a) {
      if (init.type && !a.type) a.type = init.type;
      return a;
    }
    const now = Date.now();
    a = {
      agentId,
      parentSessionId: s.id,
      type: init.type || null,
      model: init.model || null,
      description: init.description || null,
      task: init.task || null,       // prompt the parent gave this agent (head)
      toolUseId: init.toolUseId || null,
      lastThinking: null,
      lastThinkingAt: 0,
      toolCount: 0,
      state: 'thinking',
      stateSince: now,
      currentTool: null,
      lastText: null,
      lastTextAt: 0,
      replyText: null,     // full markdown of lastText, for the reply dialog
      startedAt: now,
      lastEventAt: now,
      ended: false,
      endedAt: null,
      seat: this.assignSeat(s),
      transcriptPath: init.transcriptPath || null,
    };
    s.subagents.set(agentId, a);
    return a;
  }
  endSubagent(a) {
    if (a.ended) return;
    a.ended = true;
    a.endedAt = Date.now();
    a.state = 'offduty';
    a.stateSince = a.endedAt;
    a.currentTool = null;
  }

  setState(ent, state) {
    if (ent.state === state) return;
    ent.state = state;
    ent.stateSince = Date.now();
  }

  log(s, entry) {
    s.log.push({ t: Date.now(), ...entry });
  }

  // ---- gc ------------------------------------------------------------------
  gc() {
    const now = Date.now();
    for (const s of this.sessions.values()) {
      let changed = false;
      for (const a of s.subagents.values()) {
        if (!a.ended && now - a.lastEventAt > SUBAGENT_STALE_MS) { this.endSubagent(a); changed = true; }
        if (a.ended && now - a.endedAt > SUBAGENT_TTL_MS) { s.subagents.delete(a.agentId); changed = true; }
      }
      if (!s.ended && !s.pid && now - s.lastEventAt > ORPHAN_SESSION_MS) {
        this.endSession(s, 'no events for 30 min');
        changed = true;
      }
      if (s.ended && now - s.endedAt > SESSION_TTL_MS) {
        this.sessions.delete(s.id);
        this.releaseDesk(s.id);
        this.emit('remove', { id: s.id });
        continue;
      }
      if (changed) this.emitSession(s);
    }
  }

  // ---- serialization -------------------------------------------------------
  serializeSubagent(a) {
    return {
      agentId: a.agentId, parentSessionId: a.parentSessionId, type: a.type, model: a.model, description: a.description, task: a.task,
      lastThinking: a.lastThinking, lastThinkingAt: a.lastThinkingAt, toolCount: a.toolCount,
      state: a.state, stateSince: a.stateSince, currentTool: a.currentTool, lastText: a.lastText, lastTextAt: a.lastTextAt,
      startedAt: a.startedAt, lastEventAt: a.lastEventAt, ended: a.ended, endedAt: a.endedAt, seat: a.seat,
    };
  }
  serializeSession(s, logCount = SNAPSHOT_LOG) {
    return {
      id: s.id, pid: s.pid, name: s.name, title: s.title, cwd: s.cwd, model: s.model,
      state: s.state, stateSince: s.stateSince, currentTool: s.currentTool,
      lastText: s.lastText, lastTextAt: s.lastTextAt, lastPrompt: s.lastPrompt,
      lastThinking: s.lastThinking, lastThinkingAt: s.lastThinkingAt, turnStartedAt: s.turnStartedAt, turnTools: s.turnTools, cost: s.cost,
      startedAt: s.startedAt, lastEventAt: s.lastEventAt, ended: s.ended, endedAt: s.endedAt,
      officeId: s.officeId, desk: s.desk, permissionMode: s.permissionMode, hookEvents: s.hookEvents, orcaTerminal: s.orcaTerminal, bgTasks: s.bgTasks, awaitingShell: s.awaitingShell,
      subagents: [...s.subagents.values()].map((a) => this.serializeSubagent(a)),
      log: s.log.last(logCount),
    };
  }
  snapshot() {
    return {
      now: Date.now(),
      offices: this.offices,
      together: this.together,
      seatsPerDesk: SEATS_PER_DESK,
      cats: this.cats,
      skins: this.skins,
      sessions: [...this.sessions.values()].map((s) => this.serializeSession(s)),
    };
  }
}
