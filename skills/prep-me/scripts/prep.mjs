#!/usr/bin/env node
// Usage:
//   prep.mjs init --root <folder> --title "<title>" [--date YYYY-MM-DD]
//   prep.mjs merge <brief folder>
//   prep.mjs rank <brief folder>
//   prep.mjs sources <brief folder>
//   prep.mjs check <brief folder> [--avoid <file>] [--allow "term,term"]
// Exit codes: 0 ok, 1 problems found, 2 bad usage.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LANES = ['private', 'people', 'direct', 'parallel', 'self', 'video'];
const KINDS = ['fact', 'inference'];
const SENSITIVITY = ['public', 'private'];

const REQUIRED_SECTIONS = ['The simple version', 'Watch', 'How it works', 'What matters most', 'People', 'You in this', 'Say and don\'t say', 'Questions', 'Parallels', 'The details', 'Council', 'Not checked', 'Sources'];
const OPTIONAL_FOR_TOPIC = ['People', 'Say and don\'t say'];
const MIN_QUESTIONS = 5;

const STOP_WORDS = new Set('a an and are as at be by for from has have in is it its of on or that the this to was were which will with'.split(' '));

export function slugify(title) {
  const slug = String(title).trim().replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  return slug || 'prep';
}

export function folderName(title, date) {
  return `${date} ${slugify(title)}`;
}

export function parseCards(text, label = 'cards') {
  const cards = [];
  const errors = [];
  text.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    try {
      cards.push(JSON.parse(line));
    } catch {
      errors.push(`${label}:${i + 1}: not valid JSON`);
    }
  });
  return { cards, errors };
}

export function validateCard(card) {
  const problems = [];
  if (!/^E\d+$/.test(card.id || '')) problems.push('id must look like E12');
  if (!LANES.includes(card.lane)) problems.push(`lane must be one of ${LANES.join(', ')}`);
  if (!String(card.claim || '').trim()) problems.push('claim is empty');
  if (!String(card.source || '').trim()) problems.push('source is empty');
  if (!String(card.ref || '').trim()) problems.push('ref is empty');
  const undated = card.lane === 'video' && card.date === 'unknown'; // video metadata often has no upload date
  if (!undated && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(card.date || '')) problems.push('date must be YYYY, YYYY-MM or YYYY-MM-DD');
  if (!KINDS.includes(card.kind)) problems.push(`kind must be ${KINDS.join(' or ')}`);
  if (!SENSITIVITY.includes(card.sensitivity)) problems.push(`sensitivity must be ${SENSITIVITY.join(' or ')}`);
  if (card.sensitivity === 'public' && !/^https?:\/\//.test(card.ref || '')) problems.push('a public card needs a URL in ref');
  return problems;
}

function words(text) {
  return new Set(String(text).toLowerCase().match(/[a-z0-9$%.]+/g)?.filter((w) => !STOP_WORDS.has(w)) ?? []);
}

export function jaccard(a, b) {
  if (!a.size && !b.size) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared += 1;
  return shared / (a.size + b.size - shared);
}

export function findDuplicates(cards, threshold = 0.7) {
  const sets = cards.map((c) => words(c.claim));
  const pairs = [];
  for (let i = 0; i < cards.length; i += 1) {
    for (let j = i + 1; j < cards.length; j += 1) {
      const score = jaccard(sets[i], sets[j]);
      if (score >= threshold) pairs.push({ a: cards[i].id, b: cards[j].id, score: Number(score.toFixed(2)) });
    }
  }
  return pairs;
}

export function mergeCards(fileTexts) {
  const cards = [];
  const errors = [];
  const seen = new Set();
  for (const [name, text] of Object.entries(fileTexts)) {
    const parsed = parseCards(text, name);
    errors.push(...parsed.errors);
    for (const card of parsed.cards) {
      for (const p of validateCard(card)) errors.push(`${name}: ${card.id ?? '(no id)'}: ${p}`);
      if (seen.has(card.id)) errors.push(`${name}: ${card.id}: duplicate id`);
      else if (card.id) seen.add(card.id);
      cards.push(card);
    }
  }
  return { cards, errors, duplicates: findDuplicates(cards) };
}

export function rankCouncil(answers, knownIds, { overlap = 0.25 } = {}) {
  const errors = [];
  const known = new Set(knownIds);
  const groups = [];
  answers.forEach((answer, m) => {
    const member = answer.member || `member ${m + 1}`;
    if (!Array.isArray(answer.clusters) || !answer.clusters.length) {
      errors.push(`${member}: no clusters`);
      return;
    }
    const total = answer.clusters.length;
    answer.clusters.forEach((cluster, rank) => {
      const cards = (cluster.cards || []).filter((id) => {
        if (known.has(id)) return true;
        errors.push(`${member}: theme "${cluster.theme}" cites unknown card ${id}`);
        return false;
      });
      const set = new Set(cards);
      let best = null;
      let bestScore = 0;
      for (const g of groups) {
        if (g.entries.some((e) => e.member === member)) continue;
        const score = jaccard(set, g.cards);
        if (score >= overlap && score > bestScore) { best = g; bestScore = score; }
      }
      const entry = { member, theme: cluster.theme, why: cluster.why, rank: rank + 1, score: 1 - rank / total };
      if (best) {
        best.entries.push(entry);
        for (const id of set) best.cards.add(id);
      } else {
        groups.push({ entries: [entry], cards: set });
      }
    });
  });

  const memberCount = answers.filter((a) => Array.isArray(a.clusters) && a.clusters.length).length;
  const themes = groups.map((g) => ({
    themes: g.entries.map((e) => ({ member: e.member, theme: e.theme, rank: e.rank, why: e.why })),
    cards: [...g.cards].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))),
    agreed: g.entries.length >= 2,
    score: g.entries.reduce((sum, e) => sum + e.score, 0) / Math.max(memberCount, 1),
  })).sort((a, b) => Number(b.agreed) - Number(a.agreed) || b.score - a.score);

  const doubts = answers.flatMap((a, m) => (a.doubts || []).map((d) => ({ member: a.member || `member ${m + 1}`, card: d.card, why: d.why })));
  for (const d of doubts) if (!known.has(d.card)) errors.push(`${d.member}: doubts unknown card ${d.card}`);
  const missing = answers.flatMap((a, m) => (a.missing || []).map((text) => ({ member: a.member || `member ${m + 1}`, text })));
  const questions = answers.flatMap((a, m) => (a.questions || []).map((text) => ({ member: a.member || `member ${m + 1}`, text })));
  return { themes, doubts, missing, questions, errors, members: answers.map((a, m) => a.member || `member ${m + 1}`) };
}

export function renderConsensus(result) {
  const out = [`# Council consensus`, '', `Members: ${result.members.join(', ')}`, ''];
  const line = (t, i) => {
    const names = t.themes.map((x) => `${x.member} #${x.rank}: ${x.theme}`).join('; ');
    const why = t.themes.map((x) => x.why).filter(Boolean).join(' / ');
    return `${i + 1}. ${names}\n   - Cards: ${t.cards.join(', ') || 'none'}\n   - Why: ${why || 'not stated'}`;
  };
  const agreed = result.themes.filter((t) => t.agreed);
  const single = result.themes.filter((t) => !t.agreed);
  out.push('## Both members chose', '', ...(agreed.length ? agreed.map(line) : ['None.']), '');
  out.push('## One member chose', '', ...(single.length ? single.map(line) : ['None.']), '');
  out.push('## Doubted cards', '', ...(result.doubts.length ? result.doubts.map((d) => `- ${d.card} (${d.member}): ${d.why}`) : ['None.']), '');
  out.push('## Missing', '', ...(result.missing.length ? result.missing.map((m) => `- (${m.member}) ${m.text}`) : ['None.']), '');
  out.push('## Questions', '', ...(result.questions.length ? result.questions.map((q) => `- (${q.member}) ${q.text}`) : ['None.']), '');
  return `${out.join('\n')}\n`;
}

export function section(text, heading, level = 2) {
  const marks = '#'.repeat(level);
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() === `${marks} ${heading}`);
  if (start < 0) return null;
  const stop = new RegExp(`^#{1,${level}} `);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (stop.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start + 1, end).join('\n');
}

export function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return null;
  const fields = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  return fields;
}

export function embeddedFiles(text) {
  const decode = (path) => {
    try {
      return decodeURIComponent(path);
    } catch {
      return path;
    }
  };
  const md = [...text.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => decode(m[1]));
  const wiki = [...text.matchAll(/!\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)].map((m) => m[1]);
  return [...md, ...wiki].filter((p) => !/^https?:\/\//.test(p));
}

export function citations(text) {
  return [...new Set([...text.matchAll(/\[(E\d+)\]/g)].map((m) => m[1]))];
}

export function findTerms(text, terms) {
  const hits = [];
  for (const term of terms) {
    const safe = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|[^\\w])${safe}(?![\\w])`, 'i').test(text)) hits.push(term);
  }
  return hits;
}

export function loadTerms(text) {
  return text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}

function maskFences(text) {
  let open = null;
  return text.split('\n').map((line) => {
    const fence = line.match(/^\s*(`{3,}|~{3,})/);
    if (open) {
      if (fence && fence[1][0] === open) open = null;
      return ' '.repeat(line.length);
    }
    if (fence) {
      open = fence[1][0];
      return ' '.repeat(line.length);
    }
    return line;
  }).join('\n');
}

export function sourcesRange(text) {
  const masked = maskFences(text);
  const heading = /^## Sources[ \t]*$/m.exec(masked);
  if (!heading) return null;
  const after = heading.index + heading[0].length;
  const next = /^#{1,2} /m.exec(masked.slice(after));
  return { start: heading.index, end: next ? after + next.index : text.length };
}

export function replaceSources(text, list) {
  const range = sourcesRange(text);
  if (!range) return null;
  const rest = text.slice(range.end);
  return `${text.slice(0, range.start)}## Sources\n\n${list}\n${rest ? `\n${rest}` : ''}`;
}

export function renderSources(text, cards) {
  const range = sourcesRange(text);
  const body = range ? text.slice(0, range.start) + text.slice(range.end) : text;
  const byId = new Map(cards.map((c) => [c.id, c]));
  const ids = citations(body).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  return ids.filter((id) => byId.has(id)).map((id) => {
    const c = byId.get(id);
    const title = /^https?:\/\//.test(c.ref) ? `[${c.source.replace(/[[\]]/g, '')}](${c.ref})` : `${c.source} (${c.ref})`;
    return `- ${id}: ${title}, ${c.date}`;
  }).join('\n');
}

export function checkBrief(text, cards, { fileExists = () => true, svgCheck = () => null, avoid = [], narration = '' } = {}) {
  const errors = [];
  const warnings = [];
  const fm = frontmatter(text);
  if (!fm) errors.push('missing frontmatter (--- block at the top)');
  const type = fm?.prep_type;
  const isTopic = type === 'topic';
  if (fm && !type) errors.push('frontmatter needs prep_type');
  if (fm && !/^\d{4}-\d{2}-\d{2}$/.test(fm.facts_as_of || '')) errors.push('frontmatter needs facts_as_of as YYYY-MM-DD');
  if (!/\*\*In one line:\*\*/.test(text)) errors.push('missing the "In one line" answer');

  let last = -1;
  for (const heading of REQUIRED_SECTIONS) {
    const at = text.search(new RegExp(`^## ${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm'));
    if (at < 0) {
      if (!(isTopic && OPTIONAL_FOR_TOPIC.includes(heading))) errors.push(`missing section "## ${heading}"`);
      continue;
    }
    if (at < last) errors.push(`section "## ${heading}" is out of order`);
    last = at;
  }

  const byId = new Map(cards.map((c) => [c.id, c]));
  for (const id of citations(text)) {
    if (!byId.has(id)) errors.push(`cites ${id}, which is not in evidence/all.jsonl`);
  }
  const matters = section(text, 'What matters most') ?? '';
  const items = matters.split('\n').filter((l) => /^\d+\.\s/.test(l));
  if (section(text, 'What matters most') !== null && !items.length) errors.push('"What matters most" needs a numbered list');
  for (const item of items) {
    if (!citations(item).length) errors.push(`"What matters most" item has no citation: ${item.slice(0, 60)}`);
  }

  const sources = section(text, 'Sources') ?? '';
  for (const id of citations(text.replace(sources, ''))) {
    if (!new RegExp(`\\b${id}\\b`).test(sources)) errors.push(`${id} is cited but not listed under "Sources"`);
  }

  const files = embeddedFiles(text);
  if (!files.some((f) => f.endsWith('.svg') || f.endsWith('.png') || f.endsWith('.jpg'))) errors.push('no embedded diagram or image');
  for (const f of files) {
    if (!fileExists(f)) errors.push(`embedded file not found: ${f}`);
    else if (f.endsWith('.svg')) {
      const bad = svgCheck(f);
      if (bad) errors.push(`diagram ${f} does not parse: ${bad}`);
    }
  }

  const watch = section(text, 'Watch') ?? '';
  if (!/\]\(https?:\/\//.test(watch)) warnings.push('"Watch" lists no real video link');
  if (!files.some((f) => /\.(mp4|mov|webm)$/i.test(f)) && !/could not|not made|no video|skipped/i.test(watch)) {
    errors.push('"Watch" has no generated video and does not say why');
  }

  const people = section(text, 'People');
  if (people !== null) {
    const rows = people.split('\n').filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l)).slice(1);
    for (const row of rows) {
      if (!/\|\s*(confirmed|unconfirmed)\s*\|/.test(row)) errors.push(`people row has no confirmed or unconfirmed status: ${row.slice(0, 60)}`);
    }
    if (!rows.length && !isTopic) warnings.push('"People" has no table rows');
  }

  const say = section(text, 'Say', 3);
  if (say !== null) {
    const bullets = say.split('\n').filter((l) => /^\s*[-*]\s/.test(l));
    if (!bullets.length) errors.push('"Say" has no lines');
    for (const term of findTerms(say, avoid)) errors.push(`"Say" uses a term from the avoid list: ${term}`);
  } else if (!isTopic) {
    errors.push('missing "### Say"');
  }
  for (const term of findTerms(narration, avoid)) errors.push(`video narration uses a term from the avoid list: ${term}`);
  if (!isTopic && section(text, 'Don\'t say', 3) === null) errors.push('missing "### Don\'t say"');

  const simple = section(text, 'The simple version') ?? '';
  if (citations(simple).length) errors.push('"The simple version" must have no citations; put them in later sections');
  const hedges = (simple.match(/\b(may|might|unconfirmed|possibly|perhaps|guess)\b/gi) || []).length;
  if (hedges > 2) warnings.push(`"The simple version" hedges ${hedges} times; say each doubt once, in "Not checked"`);
  const doFirst = text.match(/\*\*Do first[^\n]*\n+((?:\d+\..*\n?)+)/);
  if (doFirst && doFirst[1].trim().split('\n').length > 3) warnings.push('"Do first" has more than 3 items; draft the rest for the user');
  const untimed = watch.split('\n').filter((l) => /^\s*[-*]\s.*\]\(https?:/.test(l) && !/[?&]t=\d+/.test(l));
  if (untimed.length) warnings.push(`${untimed.length} "Watch" link(s) have no start time; read the captions and point to the moment`);

  const qs = section(text, 'Questions') ?? '';
  const qCount = qs.split('\n').filter((l) => /^\d+\.\s/.test(l)).length;
  if (qCount < MIN_QUESTIONS) errors.push(`"Questions" has ${qCount} numbered questions; needs at least ${MIN_QUESTIONS}`);

  const parallels = section(text, 'Parallels') ?? '';
  for (const line of parallels.split('\n').filter((l) => /^\s*[-*]\s/.test(l))) {
    if (!/\*Link|inference/i.test(line)) errors.push(`"Parallels" item does not state its link: ${line.slice(0, 60)}`);
    if (!citations(line).length) errors.push(`"Parallels" item has no citation: ${line.slice(0, 60)}`);
  }

  const council = section(text, 'Council') ?? '';
  if (section(text, 'Council') !== null && !/\*\*Members:\*\*/.test(council)) errors.push('"Council" must name its members');
  if (!section(text, 'Not checked')?.trim()) warnings.push('"Not checked" is empty; confirm that you reached every source');

  if (/<[a-z][^<>\n]*\.\.\.>|<(what|a line|the single|Title|Theme|Name)[^>\n]*>/.test(text)) errors.push('an unreplaced <...> placeholder remains');

  const topPart = text.split(/^## The details\s*$/m)[0].replace(/^---[\s\S]*?\n---\n/, '');
  const readWords = topPart.split(/\s+/).filter(Boolean).length;
  if (readWords > 2000) warnings.push(`${readWords} words before "The details"; trim toward a 10-minute read`);
  const topCitations = (topPart.match(/\[E\d+\]/g) || []).length;
  if (topCitations > 30) warnings.push(`${topCitations} citations before "The details"; keep them where they change trust`);
  return { errors, warnings, readWords, citations: citations(text).length, files: files.length };
}

export function staleVideo(video, specTime, timeOf) {
  const output = timeOf(video.output || 'explainer.mp4');
  if (output === null) return 'not made';
  const inputs = [specTime, ...(video.scenes || []).filter((s) => s.image).map((s) => timeOf(s.image) ?? 0)];
  return inputs.some((t) => t > output) ? 'older than its script or pictures' : null;
}

export function narrationOf(video) {
  return (video.scenes || []).map((s) => [s.narration, s.html, ...(s.steps || []).map((x) => x.narration)].filter(Boolean).join(' ')).join(' ');
}

function defaultSvgCheck(path) {
  const r = spawnSync('python3', ['-I', '-c', 'import sys, xml.etree.ElementTree as E; r = E.parse(sys.argv[1]).getroot(); sys.exit(0 if r.tag.endswith("svg") else "root element is not <svg>")', path], { encoding: 'utf8' });
  if (r.error) return null;
  return r.status === 0 ? null : (r.stderr.trim().split('\n').pop() || 'parse error');
}

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) { o[argv[i].slice(2)] = argv[i + 1]; i += 1; } else o._.push(argv[i]);
  }
  return o;
}

function expand(p) {
  return p.startsWith('~/') ? join(homedir(), p.slice(2)) : p;
}

function fail(message) {
  console.error(message);
  process.exit(2);
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const o = parseArgs(rest);
  if (cmd === 'init') {
    if (!o.root || !o.title) fail('usage: prep.mjs init --root <folder> --title "<title>" [--date YYYY-MM-DD]');
    const date = o.date || new Date().toISOString().slice(0, 10);
    const dir = join(resolve(expand(o.root)), folderName(o.title, date));
    for (const sub of ['evidence', 'council', 'media']) mkdirSync(join(dir, sub), { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    console.log(dir);
    return;
  }
  const dir = o._[0] && resolve(expand(o._[0]));
  if (!dir || !existsSync(dir)) fail(`usage: prep.mjs ${cmd ?? '<init|merge|rank|sources|check>'} <brief folder>`);
  const evidenceDir = join(dir, 'evidence');
  const allPath = join(evidenceDir, 'all.jsonl');

  if (cmd === 'merge') {
    const files = existsSync(evidenceDir) ? readdirSync(evidenceDir).filter((f) => f.endsWith('.jsonl') && f !== 'all.jsonl') : [];
    const texts = Object.fromEntries(files.map((f) => [f, readFileSync(join(evidenceDir, f), 'utf8')]));
    const { cards, errors, duplicates } = mergeCards(texts);
    writeFileSync(allPath, cards.map((c) => JSON.stringify(c)).join('\n') + (cards.length ? '\n' : ''), { mode: 0o600 });
    const lanes = LANES.map((l) => `${l} ${cards.filter((c) => c.lane === l).length}`).join(', ');
    console.log(`${cards.length} cards (${lanes})`);
    for (const d of duplicates) console.log(`near-duplicate: ${d.a} and ${d.b} (${d.score})`);
    for (const e of errors) console.log(`error ${e}`);
    process.exit(errors.length ? 1 : 0);
  }

  if (cmd === 'rank') {
    if (!existsSync(allPath)) fail('no evidence/all.jsonl; run merge first');
    const { cards } = parseCards(readFileSync(allPath, 'utf8'));
    const councilDir = join(dir, 'council');
    const names = existsSync(councilDir) ? readdirSync(councilDir).filter((f) => f.endsWith('.json')) : [];
    if (names.length < 2) console.log(`warn only ${names.length} council answer(s); this is not a two-model council`);
    const answers = [];
    const errors = [];
    for (const f of names) {
      try {
        answers.push(JSON.parse(readFileSync(join(councilDir, f), 'utf8')));
      } catch {
        errors.push(`${f}: not valid JSON`);
      }
    }
    const result = rankCouncil(answers, cards.map((c) => c.id));
    writeFileSync(join(councilDir, 'consensus.md'), renderConsensus(result), { mode: 0o600 });
    console.log(`${result.themes.filter((t) => t.agreed).length} agreed themes, ${result.themes.filter((t) => !t.agreed).length} single-member themes, ${result.doubts.length} doubted cards`);
    for (const e of [...errors, ...result.errors]) console.log(`error ${e}`);
    console.log(join(councilDir, 'consensus.md'));
    process.exit(errors.length + result.errors.length ? 1 : 0);
  }

  if (cmd === 'sources') {
    const briefPath = join(dir, 'brief.md');
    if (!existsSync(briefPath) || !existsSync(allPath)) fail('needs brief.md and evidence/all.jsonl');
    const text = readFileSync(briefPath, 'utf8');
    const { cards } = parseCards(readFileSync(allPath, 'utf8'));
    const list = renderSources(text, cards);
    const updated = replaceSources(text, list);
    if (updated === null) fail('brief.md has no "## Sources" section');
    writeFileSync(briefPath, updated);
    console.log(`${list.split('\n').filter(Boolean).length} sources written`);
    return;
  }

  if (cmd === 'check') {
    const briefPath = join(dir, 'brief.md');
    if (!existsSync(briefPath)) fail(`no brief at ${briefPath}`);
    const { cards } = existsSync(allPath) ? parseCards(readFileSync(allPath, 'utf8')) : { cards: [] };
    const allowed = new Set(String(o.allow || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean));
    const avoid = (o.avoid ? loadTerms(readFileSync(expand(o.avoid), 'utf8')) : []).filter((t) => !allowed.has(t.toLowerCase()));
    const mediaDir = join(dir, 'media');
    const specs = existsSync(mediaDir) ? readdirSync(mediaDir).filter((f) => f.endsWith('.json')) : [];
    let narration = '';
    const videoErrors = [];
    for (const spec of specs) {
      try {
        const video = JSON.parse(readFileSync(join(mediaDir, spec), 'utf8'));
        if (!Array.isArray(video.scenes)) continue;
        narration +=` ${narrationOf(video)}`;
        const timeOf = (f) => {
          const p = isAbsolute(f) ? f : join(mediaDir, f);
          return existsSync(p) ? statSync(p).mtimeMs : null;
        };
        const stale = staleVideo(video, statSync(join(mediaDir, spec)).mtimeMs, timeOf);
        if (stale) videoErrors.push(`video for media/${spec} is ${stale}; run make_video.mjs again`);
      } catch {
        videoErrors.push(`media/${spec} is not valid JSON`);
      }
    }
    const inDir = (f) => (isAbsolute(f) ? f : join(dir, f));
    const r = checkBrief(readFileSync(briefPath, 'utf8'), cards, {
      fileExists: (f) => existsSync(inDir(f)),
      svgCheck: (f) => defaultSvgCheck(inDir(f)),
      avoid,
      narration,
    });
    r.errors.push(...videoErrors);
    for (const w of r.warnings) console.log(`warn  ${w}`);
    for (const e of r.errors) console.log(`error ${e}`);
    console.log(r.errors.length ? `${r.errors.length} problem(s) in ${briefPath}` : `ok: ${r.readWords} words before details, ${r.citations} cited cards, ${r.files} embedded files, ${avoid.length} avoid terms checked`);
    process.exit(r.errors.length ? 1 : 0);
  }

  fail('usage: prep.mjs <init|merge|rank|sources|check> ...');
}

// Compare real paths: the skill is usually installed through a symlink, and argv[1] keeps the link's path.
if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) main();
