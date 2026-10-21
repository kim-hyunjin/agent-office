import os from 'node:os';
import path from 'node:path';

export const PORT = Number(process.env.AGENT_OFFICE_PORT || process.env.PORT || 17777);
export const HOST = '127.0.0.1';

export const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
export const SESSIONS_DIR = path.join(CLAUDE_DIR, 'sessions');
export const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');

export const DATA_DIR = process.env.AGENT_OFFICE_DATA || path.join(os.homedir(), '.agent-office');
export const STATE_FILE = path.join(DATA_DIR, 'state.json');

// Native launcher, not orca.cmd: cmd.exe would reparse prompt text. On Linux bare `orca` is the screen reader.
export const ORCA_BIN = process.env.AGENT_OFFICE_ORCA_BIN || process.env.ORCA_CLI_COMMAND
  || (process.platform === 'win32' ? 'orca.exe' : process.platform === 'linux' ? 'orca-ide' : 'orca');
export const MAX_PROMPT_CHARS = 20_000;
export const MAX_REPLY_CHARS = 200_000; // full markdown reply kept per entity (served on demand, not over SSE)

export const WEB_DIR = path.resolve(import.meta.dirname, '../web');

export const DESK_COUNT = 16;
export const SEATS_PER_DESK = 3;
export const LOG_SIZE = 100;
export const SNAPSHOT_LOG = 30;

export const SUBAGENT_TTL_MS = 10_000;        // remove ended subagents after
export const SUBAGENT_STALE_MS = 10 * 60_000; // subagent with no events for this long is considered finished
export const SESSION_TTL_MS = 5 * 60_000;     // remove ended sessions after
export const ORPHAN_SESSION_MS = 30 * 60_000; // hook-only session (no pid) with no events for this long is considered gone
export const DESK_MEMORY_MS = 24 * 3600_000;  // forget desk assignment after
export const GC_INTERVAL_MS = 5_000;
export const REGISTRY_POLL_MS = 3_000;
export const TRANSCRIPT_POLL_MS = 2_000;
export const TRANSCRIPT_TAIL_BYTES = 512 * 1024;
export const STALE_TOOL_MS = 60_000;
export const MAX_BODY_BYTES = 1024 * 1024;
export const SSE_HEARTBEAT_MS = 15_000;
