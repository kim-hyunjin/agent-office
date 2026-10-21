import { summarizeToolInput, detailForTool, truncate, cleanText, replyText, oneLine } from './util.mjs';

const TOOL_STATE = [
  [/^(Read|Grep|Glob|LS)$/, 'reading'],
  [/^(Edit|Write|MultiEdit|NotebookEdit)$/, 'coding'],
  [/^Bash$/, 'terminal'],
  [/^(WebFetch|WebSearch)$/, 'searching'],
  [/^(Agent|Task)$/, 'delegating'],
  [/^AskUserQuestion$/, 'waiting'],
];
export function stateForTool(tool) {
  for (const [re, st] of TOOL_STATE) if (re.test(tool)) return st;
  return 'working';
}

/**
 * Apply one Claude Code hook payload to the store. Never throws.
 * Returns the affected session (or null).
 */
export function applyHook(store, ev) {
  try { return apply(store, ev); }
  catch (e) { console.error('[reducer]', e); return null; }
}

function apply(store, ev) {
  if (!ev || typeof ev !== 'object') return null;
  const name = String(ev.hook_event_name || '');
  const sid = ev.session_id;
  if (!sid || !name) return null;
  delete ev.tool_response;

  const now = Date.now();
  const s = store.getOrCreateSession(sid, { cwd: ev.cwd, transcriptPath: ev.transcript_path });
  s.hookEvents++;
  s.lastEventAt = now;
  if (ev.permission_mode) s.permissionMode = ev.permission_mode;
  if (ev.transcript_path && !s.transcriptPath) s.transcriptPath = ev.transcript_path;
  if (typeof ev.orca_terminal === 'string' && ev.orca_terminal) s.orcaTerminal = ev.orca_terminal;

  const agentId = ev.agent_id ? String(ev.agent_id) : null;
  const agent = agentId ? store.getOrCreateSubagent(s, agentId, { type: ev.agent_type }) : null;
  if (agent) agent.lastEventAt = now;
  const ent = agent || s;
  const who = agent ? `[${agent.type || 'agent'}] ` : '';

  switch (name) {
    case 'SessionStart': {
      if (ev.model) s.model = ev.model;
      if (ev.session_title) s.title = oneLine(ev.session_title);
      if (!agent) store.setState(s, 'idle');
      store.log(s, { ev: name, text: ev.source || '' });
      break;
    }
    case 'UserPromptSubmit': {
      const prompt = cleanText(ev.prompt || '', 400);
      if (!agent) { store.setState(s, 'thinking'); s.lastPrompt = prompt; s.turnStartedAt = now; s.turnTools = 0; }
      if (ev.session_title) s.title = oneLine(ev.session_title);
      store.log(s, { ev: name, text: prompt });
      break;
    }
    case 'PreToolUse': {
      const tool = String(ev.tool_name || '');
      const target = summarizeToolInput(tool, ev.tool_input);
      const detail = detailForTool(tool, ev.tool_input);
      ent.currentTool = { name: tool, target, detail, startedAt: now, toolUseId: ev.tool_use_id || null };
      if (agent) agent.toolCount++; else s.turnTools++;
      if (!agent && /^(Agent|Task)$/.test(tool) && ev.tool_input) {
        const inp = ev.tool_input;
        s.pendingAgents.push({ type: inp.subagent_type || null, description: oneLine(inp.description || ''), task: cleanText(inp.prompt || '', 600), toolUseId: ev.tool_use_id || null, at: now });
        if (s.pendingAgents.length > 20) s.pendingAgents.shift();
      }
      store.setState(ent, stateForTool(tool));
      store.log(s, { ev: name, tool, target, detail, text: who });
      break;
    }
    case 'PostToolUse':
    case 'PostToolUseFailure': {
      const tool = String(ev.tool_name || '');
      const target = summarizeToolInput(tool, ev.tool_input);
      ent.currentTool = null;
      if (ent.state !== 'offduty') store.setState(ent, 'thinking');
      const err = name === 'PostToolUseFailure' ? truncate(oneLine(ev.error || 'failed'), 200) : '';
      const result = typeof ev.tool_response_head === 'string' ? truncate(oneLine(ev.tool_response_head), 240) : '';
      store.log(s, { ev: name, tool, target, text: who + err, result, ms: ev.duration_ms, len: ev.tool_response_len });
      break;
    }
    case 'PermissionRequest': {
      const tool = String(ev.tool_name || '');
      const target = summarizeToolInput(tool, ev.tool_input);
      store.setState(s, 'waiting');
      store.log(s, { ev: name, tool, target, text: 'permission' });
      break;
    }
    case 'Notification': {
      const kind = String(ev.notification_type || '');
      if (kind === 'permission_prompt' || kind === 'elicitation_dialog') store.setState(s, 'waiting');
      else if (kind === 'idle_prompt') store.setState(s, 'idle');
      store.log(s, { ev: name, text: truncate(oneLine(`${kind} ${ev.message || ''}`), 160) });
      break;
    }
    case 'Stop': {
      const text = cleanText(ev.last_assistant_message || '', 280);
      ent.currentTool = null;
      store.setState(ent, 'idle');
      if (text) { ent.lastText = text; ent.lastTextAt = now; ent.replyText = replyText(ev.last_assistant_message); }
      store.log(s, { ev: name, text: who + truncate(text, 200) });
      break;
    }
    case 'SubagentStart': {
      if (agent) {
        store.setState(agent, 'thinking');
        // Attach the Agent tool call that most likely spawned this subagent (same type, oldest first).
        let idx = s.pendingAgents.findIndex((p) => !p.type || !agent.type || p.type === agent.type);
        if (idx < 0 && s.pendingAgents.length) idx = 0;
        if (idx >= 0) {
          const p = s.pendingAgents.splice(idx, 1)[0];
          if (!agent.description) agent.description = p.description || null;
          agent.task = p.task || null;
          agent.toolUseId = p.toolUseId;
        }
      }
      store.log(s, { ev: name, text: `${agent?.type || ''} ${agentId || ''}`.trim() });
      break;
    }
    case 'SubagentStop': {
      if (agent) {
        const text = cleanText(ev.last_assistant_message || '', 280);
        if (text) { agent.lastText = text; agent.lastTextAt = now; agent.replyText = replyText(ev.last_assistant_message); }
        if (ev.agent_transcript_path) agent.transcriptPath = ev.agent_transcript_path;
        store.endSubagent(agent);
      }
      const live = [...s.subagents.values()].some((a) => !a.ended);
      if (!live && s.state === 'delegating') store.setState(s, 'thinking');
      store.log(s, { ev: name, text: `${agent?.type || ''} ${agentId || ''}`.trim() });
      break;
    }
    case 'SessionEnd': {
      if (!agent) store.endSession(s, ev.reason || 'ended');
      break;
    }
    case 'PreModelSwitch':
    case 'PostModelSwitch': {
      if (ev.to_model) s.model = String(ev.to_model);
      store.log(s, { ev: name, text: `${ev.from_model || ''} → ${ev.to_model || ''}` });
      break;
    }
    default: {
      store.log(s, { ev: name, text: truncate(oneLine(ev.message || ev.reason || ev.trigger || ''), 120) });
    }
  }
  store.emitSession(s);
  return s;
}
