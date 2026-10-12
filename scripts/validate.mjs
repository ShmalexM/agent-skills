#!/usr/bin/env node
// Check every skill against the rules that keep it loadable in all harnesses, scan for secrets,
// and (when you keep a local list) for private terms that must never reach the public repo.
// Exit 1 on any error. Run: node scripts/validate.mjs
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const warnings = [];

// Frontmatter: only the fields every harness understands, parsed without a YAML dependency.
export function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return null;
  const fields = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  return { fields, body: text.slice(m[0].length) };
}

const SECRET_PATTERNS = [
  [/sk-ant-[A-Za-z0-9_-]{20,}/, 'Anthropic key'],
  [/sk-(proj-)?[A-Za-z0-9]{32,}/, 'OpenAI-style key'],
  [/sk-or-v1-[a-f0-9]{32,}/, 'OpenRouter key'],
  [/gh[pousr]_[A-Za-z0-9]{36,}/, 'GitHub token'],
  [/AKIA[0-9A-Z]{16}/, 'AWS access key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/xox[abprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
];

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules'].includes(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const skillsDir = join(ROOT, 'skills');
for (const name of readdirSync(skillsDir)) {
  const dir = join(skillsDir, name);
  if (!statSync(dir).isDirectory()) continue;
  const where = `skills/${name}/SKILL.md`;
  let text;
  try {
    text = readFileSync(join(dir, 'SKILL.md'), 'utf8');
  } catch {
    errors.push(`${where}: missing`);
    continue;
  }
  const fm = parseFrontmatter(text);
  if (!fm) { errors.push(`${where}: no YAML frontmatter`); continue; }
  const { name: fmName, description } = fm.fields;
  if (fmName !== name) errors.push(`${where}: name "${fmName}" must match the folder name "${name}"`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) errors.push(`${where}: folder name must be kebab-case`);
  if (!description) errors.push(`${where}: description is required`);
  else if (description.length > 1024) errors.push(`${where}: description is ${description.length} chars (max 1024)`);
  const extra = Object.keys(fm.fields).filter((k) => !['name', 'description'].includes(k));
  if (extra.length) warnings.push(`${where}: extra frontmatter fields ${extra.join(', ')} (not every harness reads them)`);
  // Relative links to files in the skill folder must exist.
  for (const m of fm.body.matchAll(/`((?:references|scripts)\/[\w./-]+)`/g)) {
    try {
      statSync(join(dir, m[1]));
    } catch {
      errors.push(`${where}: refers to ${m[1]}, which does not exist`);
    }
  }
}

// Private terms: one per line in ~/.config/agent-skills/private-terms.txt (outside the repo), '#' for comments.
export function privateTermsPath(env = process.env) {
  const dir = env.AGENT_SKILLS_CONFIG_DIR || join(env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config'), 'agent-skills');
  return join(dir, 'private-terms.txt');
}

export function loadPrivateTerms(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}

export function findPrivateTerms(text, terms) {
  const hits = [];
  for (const term of terms) {
    const re = new RegExp(`(^|[^\\w])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`, 'i');
    text.split('\n').forEach((line, i) => {
      if (re.test(line)) hits.push({ term, line: i + 1 });
    });
  }
  return hits;
}

const termsFile = privateTermsPath();
const terms = loadPrivateTerms(termsFile);
const ATTRIBUTION_FILES = new Set(['LICENSE']); // the copyright line names the author on purpose

for (const file of walk(ROOT)) {
  if (statSync(file).size > 2_000_000) continue;
  const text = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file);
  for (const [re, what] of SECRET_PATTERNS) {
    if (re.test(text)) errors.push(`${rel}: looks like a ${what}`);
  }
  if (!ATTRIBUTION_FILES.has(rel)) {
    for (const { term, line } of findPrivateTerms(text, terms)) errors.push(`${rel}:${line}: private term "${term}"`);
  }
}

for (const w of warnings) console.log(`warn  ${w}`);
for (const e of errors) console.log(`error ${e}`);
const termsNote = terms.length ? `, none of ${terms.length} private terms` : ` (no private-terms list at ${termsFile})`;
console.log(errors.length ? `${errors.length} error(s)` : `ok: ${readdirSync(skillsDir).length} skills valid, no secret patterns${termsNote}`);
process.exit(errors.length ? 1 : 0);
