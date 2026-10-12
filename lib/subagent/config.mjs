// Tier config, state paths and harness self-detection for the subagent CLI.
import { accessSync, constants, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const HARNESSES = ['claude', 'codex', 'opencode', 'ollama', 'dsh'];
export const TIERS = ['cheap', 'standard', 'frontier'];

export class UsageError extends Error {}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function merge(base, over) {
  if (!isPlainObject(base) || !isPlainObject(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = k in base ? merge(base[k], v) : v;
  return out;
}

export function userTiersPath(env = process.env) {
  if (env.AGENT_SKILLS_TIERS) return env.AGENT_SKILLS_TIERS;
  const configHome = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config');
  return join(configHome, 'agent-skills', 'tiers.json');
}

export function loadTiers(env = process.env) {
  const base = JSON.parse(readFileSync(join(REPO_ROOT, 'config', 'tiers.json'), 'utf8'));
  const userPath = userTiersPath(env);
  if (!existsSync(userPath)) return base;
  return merge(base, JSON.parse(readFileSync(userPath, 'utf8')));
}

// The model and reasoning effort a task gets: explicit flags win over the tier table.
export function resolveModel({ via, tier = 'cheap', model, effort }, tiers) {
  if (!TIERS.includes(tier)) throw new UsageError(`unknown tier "${tier}" (use ${TIERS.join(', ')})`);
  const row = (tiers[via] || {})[tier] || {};
  return { model: model ?? row.model ?? null, effort: effort ?? row.effort ?? null };
}

// Which harness is running this process, from the environment it sets.
export function detectSelf(env = process.env) {
  if (env.AGENT_SKILLS_SELF) return env.AGENT_SKILLS_SELF;
  if (env.CLAUDECODE) return 'claude';
  if (Object.keys(env).some((k) => k.startsWith('CODEX_'))) return 'codex';
  if (env.OPENCODE || env.OPENCODE_BIN_PATH) return 'opencode';
  if (env.DSH_HOME || env.DSH_PROFILE) return 'dsh';
  return null;
}

// "other" means a different model family from the caller, for second opinions.
export function resolveVia(via, env = process.env) {
  if (via !== 'other') return via;
  const self = detectSelf(env);
  return self === 'claude' ? 'codex' : 'claude';
}

function writable(dir) {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

// Run records go to the state dir; harness sandboxes often block it, so fall back to TMPDIR.
export function runsRoot(env = process.env) {
  const stateHome = env.XDG_STATE_HOME || join(env.HOME || homedir(), '.local', 'state');
  const preferred = env.AGENT_SKILLS_STATE ? join(env.AGENT_SKILLS_STATE, 'runs') : join(stateHome, 'agent-skills', 'runs');
  if (writable(preferred)) return preferred;
  const fallback = join(env.TMPDIR || tmpdir(), 'agent-skills', 'runs');
  if (writable(fallback)) return fallback;
  throw new Error(`no writable run directory (tried ${preferred} and ${fallback})`);
}

export function listSkills() {
  const dir = join(REPO_ROOT, 'skills');
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'SKILL.md')))
    .map((d) => d.name)
    .sort();
}
