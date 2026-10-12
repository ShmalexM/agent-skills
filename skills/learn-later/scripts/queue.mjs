#!/usr/bin/env node
// Learn-later queue: where packs live, the index of topics, and a checker for finished packs.
// Usage:
//   node queue.mjs where                          exit 3 if no destination is set yet (ask the user, then init)
//   node queue.mjs init --root <folder>           save the destination in ~/.config/agent-skills/learn-later.json
//   node queue.mjs add "<Topic>" [--why "..."]    queue a topic; prints the pack path
//   node queue.mjs list [--status queued|ready|read] [--json]
//   node queue.mjs path "<Topic>"                 print the pack path
//   node queue.mjs set "<Topic>" --status queued|ready|read
//   node queue.mjs check "<Topic>"                check sections, sources and embedded SVGs
// Any command takes --root <folder> to override the saved destination for one run.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

export const STATUSES = ['queued', 'ready', 'read'];
export const INDEX_NAME = 'Learn Later.md';
const START = '<!-- learn-later:start -->';
const END = '<!-- learn-later:end -->';
const HEAD = '| Topic | Added | Status | Why |\n|---|---|---|---|';

export function configPath(env = process.env) {
  const dir = env.AGENT_SKILLS_CONFIG_DIR || join(env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config'), 'agent-skills');
  return join(dir, 'learn-later.json');
}

export function loadConfig(env = process.env) {
  const p = configPath(env);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
}

const expand = (p, env) => (p.startsWith('~/') ? join(env.HOME || homedir(), p.slice(2)) : p);

export function resolveRoot({ root, env = process.env } = {}) {
  if (root) return { root: resolve(expand(root, env)), source: '--root' };
  if (env.LEARN_LATER_DIR) return { root: resolve(expand(env.LEARN_LATER_DIR, env)), source: 'LEARN_LATER_DIR' };
  const cfg = loadConfig(env);
  if (cfg.root) return { root: resolve(expand(cfg.root, env)), source: configPath(env) };
  return null;
}

// Folder and file name for a topic: readable, filesystem-safe, stable.
export function topicName(topic) {
  const name = String(topic).replace(/[\\/:*?"<>|#^[\]]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!name) throw new Error('topic name is empty after removing unsafe characters');
  return name;
}

export const packRel = (topic) => `${topicName(topic)}/${topicName(topic)}.md`;
export const packPath = (root, topic) => join(root, topicName(topic), `${topicName(topic)}.md`);
const linkTo = (topic) => packRel(topic).split('/').map(encodeURIComponent).join('/');
const cell = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();

export function newIndex(header = []) {
  return ['# Learn Later', '', ...header, ...(header.length ? [''] : []),
    'Topics saved to learn about later. Status: queued → ready → read.', '', START, HEAD, END, ''].join('\n');
}

export function parseIndex(text) {
  const a = text.indexOf(START);
  const b = text.indexOf(END);
  if (a < 0 || b < a) throw new Error(`index has no ${START} ... ${END} block`);
  const rows = text.slice(a + START.length, b).split('\n')
    .filter((l) => l.startsWith('|') && !/^\|\s*Topic\s*\|/.test(l) && !/^\|[-|\s]+\|$/.test(l))
    .map((l) => {
      const c = l.slice(1, -1).split('|').map((s) => s.trim());
      const m = c[0].match(/^\[(.*)\]\((.*)\)$/);
      return { topic: m ? m[1] : c[0], added: c[1], status: c[2], why: c[3] || '' };
    });
  return { before: text.slice(0, a), rows, after: text.slice(b + END.length) };
}

export function renderIndex({ before, rows, after }) {
  const lines = rows.map((r) => `| [${cell(r.topic)}](${linkTo(r.topic)}) | ${cell(r.added)} | ${cell(r.status)} | ${cell(r.why)} |`);
  return `${before}${START}\n${HEAD}\n${lines.join('\n')}${lines.length ? '\n' : ''}${END}${after}`;
}

function readIndex(root, header) {
  const p = join(root, INDEX_NAME);
  if (!existsSync(p)) {
    mkdirSync(root, { recursive: true });
    writeFileSync(p, newIndex(header));
  }
  return { p, idx: parseIndex(readFileSync(p, 'utf8')) };
}

const find = (rows, topic) => rows.find((r) => r.topic.toLowerCase() === topicName(topic).toLowerCase());

export function addTopic(root, topic, why = '', { today = new Date().toISOString().slice(0, 10), header = [] } = {}) {
  const { p, idx } = readIndex(root, header);
  const existing = find(idx.rows, topic);
  if (existing) return { added: false, row: existing, pack: packPath(root, existing.topic) };
  const row = { topic: topicName(topic), added: today, status: 'queued', why };
  idx.rows.push(row);
  mkdirSync(dirname(packPath(root, topic)), { recursive: true });
  writeFileSync(p, renderIndex(idx));
  return { added: true, row, pack: packPath(root, topic) };
}

export function setStatus(root, topic, status) {
  if (!STATUSES.includes(status)) throw new Error(`status must be one of ${STATUSES.join(', ')}`);
  const { p, idx } = readIndex(root, []);
  const row = find(idx.rows, topic);
  if (!row) throw new Error(`"${topic}" is not in the queue`);
  row.status = status;
  writeFileSync(p, renderIndex(idx));
  return row;
}

// Checks a finished pack. svgCheck(path) returns null when the SVG parses, else an error string.
export function checkPack(text, packDir, { fileExists = existsSync, svgCheck = defaultSvgCheck } = {}) {
  const errors = [];
  const warnings = [];
  if (!text.startsWith('---\n')) errors.push('missing frontmatter (--- block at the top)');
  if (!/In one line:/i.test(text)) errors.push('missing the "In one line" answer');
  for (const h of ['How it works', 'Key terms', 'Check yourself', 'Go deeper']) {
    if (!new RegExp(`^## ${h}`, 'm').test(text)) errors.push(`missing section "## ${h}"`);
  }
  const svgs = [...text.matchAll(/!\[[^\]]*\]\(([^)\s]+\.svg)\)/g)].map((m) => decodeURIComponent(m[1]));
  if (!svgs.length) errors.push('no embedded SVG diagram');
  for (const s of svgs) {
    const p = join(packDir, s);
    if (!fileExists(p)) errors.push(`diagram not found: ${s}`);
    else {
      const bad = svgCheck(p);
      if (bad) errors.push(`diagram ${s} does not parse: ${bad}`);
    }
  }
  const deeper = (text.split(/^## Go deeper/m)[1] || '').split(/^## /m)[0];
  if ((deeper.match(/\]\(https?:\/\//g) || []).length < 2) errors.push('"Go deeper" needs at least 2 source links');
  if (!/^## Where it stands now \(as of \d{4}-\d{2}-\d{2}\)/m.test(text)) warnings.push('no dated "## Where it stands now (as of YYYY-MM-DD)" section');
  const words = text.replace(/^---[\s\S]*?\n---\n/, '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  if (words < 500) warnings.push(`only ${words} words; a pack is usually 700 to 1,400`);
  if (words > 2000) warnings.push(`${words} words; trim toward a 10-minute read`);
  return { errors, warnings, svgs, words };
}

function defaultSvgCheck(path) {
  const r = spawnSync('python3', ['-c', 'import sys, xml.etree.ElementTree as E; r = E.parse(sys.argv[1]).getroot(); sys.exit(0 if r.tag.endswith("svg") else "root element is not <svg>")', path], { encoding: 'utf8' });
  if (r.error) return null; // no python3: skip the parse check
  return r.status === 0 ? null : (r.stderr.trim().split('\n').pop() || 'parse error');
}

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a.startsWith('--')) o[a.slice(2)] = argv[++i];
    else o._.push(a);
  }
  return o;
}

function needRoot(o) {
  const r = resolveRoot({ root: o.root });
  if (!r) {
    console.error(`No destination set. Ask the user where reading packs should go, then run: queue.mjs init --root "<folder>" (saved in ${configPath()})`);
    process.exit(3);
  }
  return r.root;
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  const [cmd, topic] = o._;
  const cfg = loadConfig();
  if (cmd === 'where') {
    const r = resolveRoot({ root: o.root });
    if (!r) return needRoot(o);
    console.log(`${r.root}\n(from ${r.source}; index: ${join(r.root, INDEX_NAME)})`);
    return 0;
  }
  if (cmd === 'init') {
    if (!o.root) throw new Error('init needs --root <folder>');
    const p = configPath();
    mkdirSync(dirname(p), { recursive: true });
    const root = resolve(expand(o.root, process.env));
    writeFileSync(p, JSON.stringify({ ...cfg, root }, null, 2) + '\n');
    readIndex(root, cfg.index_header || []);
    console.log(`Reading packs will go to ${root}\nSaved in ${p}`);
    return 0;
  }
  const root = needRoot(o);
  if (cmd === 'add') {
    if (!topic) throw new Error('add needs a topic');
    const r = addTopic(root, topic, o.why || '', { header: cfg.index_header || [] });
    console.log(r.added ? `Queued "${r.row.topic}". Pack path: ${r.pack}` : `"${r.row.topic}" is already in the queue (${r.row.status}). Pack path: ${r.pack}`);
    return 0;
  }
  if (cmd === 'list') {
    const { idx } = readIndex(root, cfg.index_header || []);
    const rows = o.status ? idx.rows.filter((r) => r.status === o.status) : idx.rows;
    if (o.json) console.log(JSON.stringify(rows.map((r) => ({ ...r, pack: packPath(root, r.topic) })), null, 2));
    else if (!rows.length) console.log('Nothing in the queue' + (o.status ? ` with status ${o.status}` : '') + '.');
    else for (const r of rows) console.log(`${r.status.padEnd(7)} ${r.added}  ${r.topic}${r.why ? ` — ${r.why}` : ''}`);
    return 0;
  }
  if (cmd === 'path') {
    if (!topic) throw new Error('path needs a topic');
    console.log(packPath(root, topic));
    return 0;
  }
  if (cmd === 'set') {
    if (!topic || !o.status) throw new Error('set needs a topic and --status');
    const row = setStatus(root, topic, o.status);
    console.log(`"${row.topic}" is now ${row.status}.`);
    return 0;
  }
  if (cmd === 'check') {
    if (!topic) throw new Error('check needs a topic');
    const p = packPath(root, topic);
    if (!existsSync(p)) throw new Error(`no pack yet at ${p}`);
    const r = checkPack(readFileSync(p, 'utf8'), dirname(p));
    for (const w of r.warnings) console.log(`warn  ${w}`);
    for (const e of r.errors) console.log(`error ${e}`);
    console.log(r.errors.length ? `${r.errors.length} problem(s) in ${p}` : `ok: ${r.words} words, ${r.svgs.length} diagram(s) — ${p}`);
    return r.errors.length ? 1 : 0;
  }
  console.error('usage: queue.mjs where | init --root <folder> | add "<Topic>" [--why ...] | list [--status s] [--json] | path "<Topic>" | set "<Topic>" --status s | check "<Topic>"');
  return 2;
}

if (basename(process.argv[1] || '') === 'queue.mjs') {
  try {
    process.exit(main());
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
