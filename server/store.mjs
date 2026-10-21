import fs from 'node:fs';
import path from 'node:path';
import {
  DESK_COUNT, SEATS_PER_DESK, LOG_SIZE, SNAPSHOT_LOG, DESK_MEMORY_MS,
  SUBAGENT_TTL_MS, SUBAGENT_STALE_MS, SESSION_TTL_MS, ORPHAN_SESSION_MS, STATE_FILE,
} from './config.mjs';
import { debounce, safeJsonParse } from './util.mjs';

export class RingBuffer {
  constructor(n) { this.n = n; this.buf = []; }
  push(x) { this.buf.push(x); if (this.buf.length > this.n) this.buf.shift(); }
  toArray() { return this.buf.slice(); }
  last(k) { return this.buf.slice(-k); }
}

export const STATES = ['idle', 'thinking', 'reading', 'coding', 'terminal', 'searching', 'delegating', 'working', 'waiting', 'offduty'];
const BUSY_STATES = new Set(['thinking', 'reading', 'coding', 'terminal', 'searching', 'delegating', 'working']);
export const isBusyState = (s) => BUSY_STATES.has(s);

export class Store {
  constructor({ stateFile = STATE_FILE } = {}) {
    this.sessions = new Map();
    this.desks = {};           // sessionId -> { desk, at }
    this.stateFile = stateFile;
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
  }
  saveNow() {
    try {
      fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
      fs.writeFileSync(this.stateFile, JSON.stringify({ desks: this.desks, updatedAt: Date.now() }, null, 2));
    } catch (e) {
      console.error('[store] save failed:', e.message);
    }
  }

  // ---- events --------------------------------------------------------------
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type, data) { for (const fn of this.listeners) fn(type, data); }
  emitSession(s) { this.emit('session', this.serializeSession(s)); }

  // ---- desks ---------------------------------------------------------------
  usedDesks() {
    const used = new Set();
    for (const s of this.sessions.values()) if (!s.ended) used.add(s.desk);
    return used;
  }
  assignDesk(sessionId) {
    const used = this.usedDesks();
    const remembered = this.desks[sessionId];
    let desk;
    if (remembered && !used.has(remembered.desk)) desk = remembered.desk;
    else { desk = 0; while (used.has(desk)) desk++; }
    this.desks[sessionId] = { desk, at: Date.now() };
    this.save();
    return desk;
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
      if (init.cwd && !s.cwd) { s.cwd = init.cwd; if (!s.nameSource) s.name = path.basename(init.cwd) || s.name; }
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
      lastPrompt: null,
      lastThinking: null,
      lastThinkingAt: 0,
      turnStartedAt: 0,
      turnTools: 0,
      cost: null,          // { usd, linesAdded, linesRemoved, apiMs } from transcript
      pendingAgents: [],   // Agent tool calls waiting for their SubagentStart
      startedAt: init.startedAt || now,
      lastEventAt: now,
      hookEvents: 0,
      ended: false,
      endedAt: null,
      desk: this.assignDesk(id),
      permissionMode: null,
      transcriptPath: init.transcriptPath || null,
      orcaTerminal: null,  // Orca terminal handle (from hook env) for sending prompts
      log: new RingBuffer(LOG_SIZE),
      subagents: new Map(),
    };
    this.sessions.set(id, s);
    return s;
  }
  revive(s) {
    s.ended = false;
    s.endedAt = null;
    s.state = 'idle';
    s.stateSince = Date.now();
    s.desk = this.assignDesk(s.id);
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
      desk: s.desk, permissionMode: s.permissionMode, hookEvents: s.hookEvents, orcaTerminal: s.orcaTerminal,
      subagents: [...s.subagents.values()].map((a) => this.serializeSubagent(a)),
      log: s.log.last(logCount),
    };
  }
  snapshot() {
    return {
      now: Date.now(),
      deskCount: DESK_COUNT,
      seatsPerDesk: SEATS_PER_DESK,
      sessions: [...this.sessions.values()].map((s) => this.serializeSession(s)),
    };
  }
}
