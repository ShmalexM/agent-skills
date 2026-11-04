// prep-me: evidence cards, council merge, brief check, and video helpers. Offline; temp folders only.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkBrief, embeddedFiles, findDuplicates, findTerms, folderName, mergeCards, rankCouncil, renderConsensus, renderSources, replaceSources, section, validateCard } from '../skills/prep-me/scripts/prep.mjs';
import { buildSrt, captionLines, findBrowser, scenePage, speechTool, srtTime, validateVideo } from '../skills/prep-me/scripts/make_video.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'skills', 'prep-me', 'scripts', 'prep.mjs');

const card = (id, lane = 'direct', extra = {}) => ({ id, lane, claim: `Claim number ${id} about pricing`, source: 'Title', ref: 'https://example.com/a', date: '2026-10-01', kind: 'fact', sensitivity: 'public', ...extra });
const CARDS = [card('E1'), card('E2', 'self', { sensitivity: 'private', ref: 'resume' }), card('E3', 'parallel', { kind: 'inference' }), card('E4', 'people')];

const BRIEF = `---
title: Test
prep_type: interview
event: 2026-11-09 10:30 PT
prepared: 2026-11-04
facts_as_of: 2026-11-04
---

# Test

> **In one line:** Know this.

**A good outcome:** The next round.

## The simple version

Plain words.

## Watch

**Made for this brief:** ![Explainer](media/explainer.mp4)

- [Real talk](https://www.youtube.com/watch?v=abc), A channel. Good.

## Picture it

![Flow](media/flow.svg)

## What matters most

1. **Theme.** It matters. [E1]

## People

| Person | Role | Status | What they care about | Link to you |
|---|---|---|---|---|
| Sam Lee | VP | confirmed | Growth [E4] | none |

## You in this

- **Your real strength here:** Thing. [E2]

## Say and don't say

### Say

- **Opening:** "I build things." [E2]

### Don't say

- Customer names, because they are confidential.

## Questions

### They may ask you

1. One?
2. Two?

### You could ask them

1. Three?
2. Four?

### Ask yourself

1. Five?

## Parallels

- **Event.** It happened. *Link (inference):* It may matter. [E3]

## The details

More.

## Council

**Members:** gpt-x, claude-y. **Rounds:** 2.

## Not checked

- The work inbox.

## Sources

- E1: [One](https://example.com/a), 2026-10-01
- E2: resume, 2026
- E3: [Three](https://example.com/c), 2026-10-01
- E4: [Four](https://example.com/d), 2026-10-01
`;

const errorsOf = (text, opts = {}, cards = CARDS) => checkBrief(text, cards, opts).errors;

test('card: a good public and a good private card pass', () => {
  assert.deepEqual(validateCard(card('E1')), []);
  assert.deepEqual(validateCard(card('E2', 'private', { sensitivity: 'private', ref: 'email: Intro, 2026-11-03' })), []);
});

test('card: a public card needs a URL, and every field is checked', () => {
  assert.match(validateCard(card('E1', 'direct', { ref: 'a talk I heard' })).join(), /public card needs a URL/);
  const problems = validateCard({ id: 'x', lane: 'gossip', claim: '', source: '', ref: '', date: 'soon', kind: 'hunch', sensitivity: 'secret' });
  assert.equal(problems.length, 8);
});

test('card: only a video card may have an unknown date', () => {
  assert.deepEqual(validateCard(card('E1', 'video', { date: 'unknown' })), []);
  assert.match(validateCard(card('E1', 'direct', { date: 'unknown' })).join(), /date must be/);
});

test('merge: finds bad lines, bad cards, repeated ids and near-duplicates', () => {
  const same = 'Contoso bought Globex for two billion dollars in October';
  const { cards, errors, duplicates } = mergeCards({
    'direct.jsonl': `${JSON.stringify(card('E1', 'direct', { claim: same }))}\nnot json\n`,
    'parallel.jsonl': `${JSON.stringify(card('E1', 'parallel', { claim: 'Something else entirely happened here' }))}\n${JSON.stringify(card('E2', 'parallel', { claim: `${same}.` }))}\n`,
  });
  assert.equal(cards.length, 3);
  assert.ok(errors.some((e) => /direct.jsonl:2: not valid JSON/.test(e)));
  assert.ok(errors.some((e) => /E1: duplicate id/.test(e)));
  assert.deepEqual(duplicates.map((d) => [d.a, d.b]), [['E1', 'E2']]);
});

test('duplicates: different claims stay apart', () => {
  assert.deepEqual(findDuplicates([card('E1', 'direct', { claim: 'Revenue grew in 2025' }), card('E2', 'direct', { claim: 'The CEO joined from a rival firm' })]), []);
});

const answers = () => [
  { member: 'gpt', clusters: [{ theme: 'Growth by buying firms', why: 'Sets the agenda', cards: ['E1', 'E2'] }, { theme: 'Hiring freeze', why: 'Timing', cards: ['E3'] }], doubts: [{ card: 'E3', why: 'Old' }], missing: ['Team size'], questions: ['Why now?'] },
  { member: 'claude', clusters: [{ theme: 'Who owns the budget', why: 'Decides it', cards: ['E4'] }, { theme: 'Acquisition strategy', why: 'Agenda', cards: ['E2', 'E1'] }], doubts: [], missing: [], questions: ['Who decides?'] },
];

test('rank: joins themes by shared cards even when their names differ', () => {
  const r = rankCouncil(answers(), ['E1', 'E2', 'E3', 'E4']);
  assert.deepEqual(r.errors, []);
  const agreed = r.themes.filter((t) => t.agreed);
  assert.equal(agreed.length, 1);
  assert.deepEqual(agreed[0].cards, ['E1', 'E2']);
  assert.deepEqual(agreed[0].themes.map((t) => t.member), ['gpt', 'claude']);
});

test('rank: agreed themes come before a single member\'s top theme', () => {
  const r = rankCouncil(answers(), ['E1', 'E2', 'E3', 'E4']);
  assert.equal(r.themes[0].agreed, true);
  assert.equal(r.themes[1].agreed, false);
  assert.equal(r.themes[1].themes[0].theme, 'Who owns the budget');
});

test('rank: a member cannot agree with their own theme', () => {
  const r = rankCouncil([{ member: 'gpt', clusters: [{ theme: 'A', cards: ['E1'] }, { theme: 'B', cards: ['E1'] }] }], ['E1']);
  assert.equal(r.themes.length, 2);
  assert.equal(r.themes.some((t) => t.agreed), false);
});

test('rank: reports unknown cards and empty members', () => {
  const r = rankCouncil([{ member: 'gpt', clusters: [{ theme: 'A', cards: ['E9'] }], doubts: [{ card: 'E8', why: 'x' }] }, { member: 'claude', clusters: [] }], ['E1']);
  assert.ok(r.errors.some((e) => /unknown card E9/.test(e)));
  assert.ok(r.errors.some((e) => /doubts unknown card E8/.test(e)));
  assert.ok(r.errors.some((e) => /claude: no clusters/.test(e)));
});

test('consensus: the report keeps agreement, doubts and gaps apart', () => {
  const text = renderConsensus(rankCouncil(answers(), ['E1', 'E2', 'E3', 'E4']));
  assert.match(section(text, 'Both members chose'), /Growth by buying firms/);
  assert.match(section(text, 'One member chose'), /Who owns the budget/);
  assert.match(section(text, 'Doubted cards'), /E3 \(gpt\): Old/);
  assert.match(section(text, 'Missing'), /Team size/);
});

test('check: a complete brief passes', () => {
  const r = checkBrief(BRIEF, CARDS);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});

test('check: an unknown citation fails', () => {
  assert.ok(errorsOf(BRIEF.replace('It matters. [E1]', 'It matters. [E99]')).some((e) => /E99/.test(e)));
});

test('check: a citation missing from Sources fails', () => {
  assert.ok(errorsOf(BRIEF.replace('- E3: [Three](https://example.com/c), 2026-10-01\n', '')).some((e) => /E3 is cited but not listed/.test(e)));
});

test('check: a ranked theme with no citation fails', () => {
  assert.ok(errorsOf(BRIEF.replace('It matters. [E1]', 'It matters.')).some((e) => /What matters most" item has no citation/.test(e)));
});

test('check: a Say line needs a citation from the self or direct lane', () => {
  assert.ok(errorsOf(BRIEF.replace('"I build things." [E2]', '"I build things."')).some((e) => /"Say" line has no citation/.test(e)));
  assert.ok(errorsOf(BRIEF.replace('"I build things." [E2]', '"I build things." [E3]')).some((e) => /must cite a self or direct card/.test(e)));
});

test('check: the avoid list covers Say lines and narration, not Don\'t say', () => {
  assert.ok(errorsOf(BRIEF.replace('I build things.', 'I built it for Contoso Bank.'), { avoid: ['Contoso Bank'] }).some((e) => /avoid list: Contoso Bank/.test(e)));
  assert.ok(errorsOf(BRIEF, { avoid: ['Contoso Bank'], narration: 'We won at contoso bank last year.' }).some((e) => /narration uses a term/.test(e)));
  assert.deepEqual(errorsOf(BRIEF.replace('Customer names, because', 'Contoso Bank, because'), { avoid: ['Contoso Bank'] }), []);
});

test('check: a person needs a status', () => {
  assert.ok(errorsOf(BRIEF.replace('| VP | confirmed |', '| VP | probably |')).some((e) => /no confirmed or unconfirmed status/.test(e)));
  assert.deepEqual(errorsOf(BRIEF.replace('| VP | confirmed |', '| VP | unconfirmed |')), []);
});

test('check: missing files, bad SVGs and missing diagrams fail', () => {
  assert.ok(errorsOf(BRIEF, { fileExists: (f) => !f.endsWith('.svg') }).some((e) => /not found: media\/flow.svg/.test(e)));
  assert.ok(errorsOf(BRIEF, { svgCheck: () => 'mismatched tag' }).some((e) => /does not parse: mismatched tag/.test(e)));
  assert.ok(errorsOf(BRIEF.replace('![Flow](media/flow.svg)', '')).some((e) => /no embedded diagram/.test(e)));
});

test('check: a missing video must be explained', () => {
  const noVideo = BRIEF.replace('**Made for this brief:** ![Explainer](media/explainer.mp4)\n', '');
  assert.ok(errorsOf(noVideo).some((e) => /no generated video/.test(e)));
  assert.deepEqual(errorsOf(noVideo.replace('## Watch\n', '## Watch\n\nI could not make the video: ffmpeg is missing.\n')), []);
});

test('check: too few questions fail', () => {
  assert.ok(errorsOf(BRIEF.replace('1. Five?\n', '')).some((e) => /4 numbered questions/.test(e)));
});

test('check: a parallel item must state its link', () => {
  assert.ok(errorsOf(BRIEF.replace(' *Link (inference):* It may matter.', '')).some((e) => /does not state its link/.test(e)));
});

test('check: sections must exist and stay in order', () => {
  assert.ok(errorsOf(BRIEF.replace('## Council', '## Reviewers')).some((e) => /missing section "## Council"/.test(e)));
  const swapped = BRIEF.replace('## The simple version', '## TEMP').replace('## Watch', '## The simple version').replace('## TEMP', '## Watch');
  assert.ok(errorsOf(swapped).some((e) => /out of order/.test(e)));
});

test('check: a topic brief may skip People and Say, but an interview may not', () => {
  const stripped = BRIEF
    .replace(/## People[\s\S]*?(?=## You in this)/, '')
    .replace(/## Say and don't say[\s\S]*?(?=## Questions)/, '');
  assert.ok(errorsOf(stripped).some((e) => /missing section "## People"/.test(e)));
  assert.deepEqual(errorsOf(stripped.replace('prep_type: interview', 'prep_type: topic')), []);
});

test('check: leftover placeholders fail', () => {
  assert.ok(errorsOf(`${BRIEF}\n<what happened>\n`).some((e) => /placeholder/.test(e)));
});

test('sources: lists cited cards in order, and ignores ids in the old list', () => {
  const list = renderSources('Text [E4] and [E1] and [E99].\n\n## Sources\n\n- E2: old\n', CARDS);
  assert.equal(list, '- E1: [Title](https://example.com/a), 2026-10-01\n- E4: [Title](https://example.com/a), 2026-10-01');
  assert.equal(renderSources('[E2]', CARDS), '- E2: Title (resume), 2026-10-01');
});

test('sources: a heading inside a code block is not the section, and text after the section stays', () => {
  const text = 'Intro [E1]\n\n```markdown\n## Sources\n```\n\nMiddle [E4]\n\n## Sources\n\n- E2: old\n\n## Appendix\n\nLater [E2]\n';
  const list = renderSources(text, CARDS);
  assert.equal(list.split('\n').length, 3, 'cites E1, E2 and E4, but not the old list');
  const out = replaceSources(text, list);
  assert.match(out, /```markdown\n## Sources\n```\n\nMiddle \[E4\]/);
  assert.match(out, /## Appendix\n\nLater \[E2\]\n$/);
  assert.doesNotMatch(out, /- E2: old/);
  assert.equal(replaceSources('```\n## Sources\n```\n', 'x'), null);
  const end = replaceSources('A\n\n## Sources\n\n- old\n', '- new');
  assert.equal(end, 'A\n\n## Sources\n\n- new\n');
  assert.equal(replaceSources(end, '- new'), end, 'running it twice changes nothing');
});

test('embeddedFiles: bad URL encoding is reported, and does not crash the check', () => {
  assert.deepEqual(embeddedFiles('![x](foo%zz.svg)'), ['foo%zz.svg']);
  const broken = BRIEF.replace('media/flow.svg', 'media/foo%zz.svg');
  assert.ok(errorsOf(broken, { fileExists: (f) => !f.includes('%zz') }).some((e) => /not found: media\/foo%zz\.svg/.test(e)));
});

test('embeddedFiles: reads Markdown and Obsidian embeds and skips web images', () => {
  assert.deepEqual(embeddedFiles('![a](media/a%20b.svg) ![[media/c.mp4|300]] ![d](https://x.io/d.png)'), ['media/a b.svg', 'media/c.mp4']);
});

test('findTerms: matches whole terms in any case', () => {
  assert.deepEqual(findTerms('We met CONTOSO today', ['contoso', 'me', 'bank']), ['contoso']);
});

test('folderName: removes characters that break notes apps and file systems', () => {
  assert.equal(folderName('Contoso: Interview / round #2?', '2026-11-04'), '2026-11-04 Contoso Interview round 2');
});

test('cli: init makes a private folder, and merge and rank run end to end', () => {
  const root = mkdtempSync(join(tmpdir(), 'prep-me-'));
  const cli = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  const dir = cli('init', '--root', root, '--title', 'Contoso call', '--date', '2026-11-04').stdout.trim();
  assert.equal(dir, join(root, '2026-11-04 Contoso call'));
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  for (const sub of ['evidence', 'council', 'media']) assert.ok(existsSync(join(dir, sub)));

  writeFileSync(join(dir, 'evidence', 'direct.jsonl'), `${CARDS.map((c) => JSON.stringify(c)).join('\n')}\n`);
  const merged = cli('merge', dir);
  assert.equal(merged.status, 0, merged.stdout);
  assert.match(merged.stdout, /4 cards/);

  writeFileSync(join(dir, 'council', 'gpt.json'), JSON.stringify(answers()[0]));
  writeFileSync(join(dir, 'council', 'claude.json'), JSON.stringify(answers()[1]));
  const ranked = cli('rank', dir);
  assert.equal(ranked.status, 0, ranked.stdout);
  assert.match(ranked.stdout, /1 agreed themes/);
  assert.match(readFileSync(join(dir, 'council', 'consensus.md'), 'utf8'), /Both members chose/);
});

test('cli: check reads the brief, the files and the avoid file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prep-me-'));
  mkdirSync(join(dir, 'evidence'));
  mkdirSync(join(dir, 'media'));
  writeFileSync(join(dir, 'brief.md'), BRIEF);
  writeFileSync(join(dir, 'evidence', 'all.jsonl'), `${CARDS.map((c) => JSON.stringify(c)).join('\n')}\n`);
  writeFileSync(join(dir, 'media', 'explainer.mp4'), 'x');
  writeFileSync(join(dir, 'media', 'flow.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  writeFileSync(join(dir, 'media', 'video.json'), JSON.stringify({ scenes: [{ html: '<h1>Hi</h1>', narration: 'We won at Globex.' }] }));
  const avoid = join(dir, 'avoid.txt');
  writeFileSync(avoid, '# names\nGlobex\n');
  const cli = (...args) => spawnSync(process.execPath, [SCRIPT, 'check', dir, ...args], { encoding: 'utf8' });
  assert.equal(cli().status, 0);
  const blocked = cli('--avoid', avoid);
  assert.equal(blocked.status, 1);
  assert.match(blocked.stdout, /narration uses a term from the avoid list: Globex/);
  assert.equal(cli('--avoid', avoid, '--allow', 'globex').status, 0);
  writeFileSync(join(dir, 'media', 'flow.svg'), '<svg><text></svg>');
  assert.match(cli().stdout, /does not parse/);
});

test('video: the spec needs one picture and narration for each scene', () => {
  assert.deepEqual(validateVideo({ scenes: [{ image: 'a.svg', narration: 'Hi.' }, { html: '<p>x</p>', narration: 'There.' }] }), []);
  assert.match(validateVideo({ scenes: [{ image: 'a.svg', html: 'x', narration: 'Hi.' }] }).join(), /exactly one/);
  assert.match(validateVideo({ scenes: [{ image: 'a.svg', narration: ' ' }] }).join(), /narration is empty/);
  assert.match(validateVideo({ scenes: [{ image: 'a.gif', narration: 'Hi.' }] }).join(), /svg, png or jpeg/);
  assert.match(validateVideo({ scenes: [] }).join(), /non-empty/);
});

test('video: captions fill the clip in word order and split long sentences', () => {
  const lines = captionLines('One two. Three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen.', 10);
  assert.equal(lines.length, 3);
  assert.equal(lines[0].text, 'One two.');
  assert.equal(lines[0].start, 0);
  assert.ok(Math.abs(lines.at(-1).end - 10) < 1e-9);
  assert.ok(lines[1].start === lines[0].end);
});

test('video: caption file offsets each scene by the scenes before it', () => {
  assert.equal(srtTime(3723.5), '01:02:03,500');
  const srt = buildSrt([{ narration: 'First scene.', speech: 2, seconds: 2.5 }, { narration: 'Second scene.', speech: 2, seconds: 2.5 }]);
  assert.match(srt, /^1\n00:00:00,000 --> 00:00:02,000\nFirst scene\.\n/);
  assert.match(srt, /2\n00:00:02,500 --> 00:00:04,500\nSecond scene\./);
});

test('video: an image scene links the file, and an HTML scene keeps its markup', () => {
  assert.match(scenePage({ image: 'my flow.svg' }, '/tmp/x'), /file:\/\/\/tmp\/x\/my%20flow\.svg/);
  assert.match(scenePage({ html: '<h1>Why</h1>' }, '/tmp/x'), /<main><h1>Why<\/h1><\/main>/);
});

test('video: tools resolve in order and report absence', () => {
  assert.equal(findBrowser({ PREP_ME_BROWSER: '/x/chrome' }, (p) => p === '/x/chrome', () => false), '/x/chrome');
  assert.equal(findBrowser({}, () => false, (c) => c === 'chromium'), 'chromium');
  assert.equal(findBrowser({}, () => false, () => false), null);
  assert.equal(speechTool((c) => c === 'espeak-ng'), 'espeak-ng');
  assert.equal(speechTool(() => false), null);
});
