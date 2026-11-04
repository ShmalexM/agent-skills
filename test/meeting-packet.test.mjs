// meeting-packet Quill reader: search, export and read-only behavior against a fixture database. Offline.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'skills', 'meeting-packet', 'scripts', 'quill.py');
const tmp = () => mkdtempSync(join(tmpdir(), 'meeting-packet-'));

const FIXTURE = String.raw`
import json, sqlite3, sys
db = sqlite3.connect(sys.argv[1])
db.executescript("""
CREATE TABLE Meeting (id TEXT, start INTEGER, end INTEGER, title TEXT, manualTitle TEXT, llmTitle TEXT, eventTitle TEXT,
  participants TEXT, word_count INTEGER, audio_transcript TEXT, deleteDate INTEGER, hidden INTEGER);
CREATE TABLE Note (meeting_id TEXT, title TEXT, body TEXT, createdAt INTEGER);
CREATE TABLE Contact (id TEXT, name TEXT);
CREATE TABLE ContactMeeting (contact_id TEXT, speaker_id TEXT, meeting_id TEXT, suggested_name TEXT);
""")
start = 1_790_000_000_000
def block(offset, speaker, text, source="system"):
    return {"from": start + offset, "text": text, "speaker_id": speaker, "source": source}
transcript = {"startTime": start, "blocks": [
    block(0, "A", "Thanks for joining."),
    block(5_000, "A", "Let's look at pricing."),
    block(70_000, "A", "One more thing."),
    block(75_000, "B", "I will send the proposal by Friday.", "mic"),
    block(3_700_000, "C", "Anything else?"),
    block(3_705_000, "C", "   "),
]}
rows = [
    ("m1", start, start + 3_800_000, None, "Northwind pricing review", None, None, "me, Dana Lee", 100, json.dumps(transcript), None, 0),
    ("m2", start + 86_400_000, start + 86_400_000, "Team standup", None, None, None, "me", 10,
     json.dumps({"startTime": start, "blocks": [block(0, "X", "Dana asked about Northwind pricing.")]}), None, 0),
    ("m3", start, start, "Northwind deleted", None, None, None, "me", 1, None, start, 0),
    ("m4", start, start, "Northwind hidden", None, None, None, "me", 1, None, None, 1),
    ("m5", start, start, None, None, None, None, "me", 0, None, None, 0),
]
db.executemany("INSERT INTO Meeting VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", rows)
db.execute("INSERT INTO Note VALUES ('m1', 'Summary', '## Decisions\n- Ship it', 1)")
db.execute("INSERT INTO Note VALUES ('m1', 'Empty', '', 2)")
db.execute("INSERT INTO Contact VALUES ('c1', 'Dana Lee')")
db.execute("INSERT INTO ContactMeeting VALUES ('c1', 'A', 'm1', NULL)")
db.execute("INSERT INTO ContactMeeting VALUES (NULL, 'B', 'm1', 'Sam Guess')")
db.commit()
`;

function fixture() {
  const path = join(tmp(), 'quill.db');
  const made = spawnSync('python3', ['-c', FIXTURE, path], { encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  return path;
}

const quill = (args, db) =>
  spawnSync('python3', [SCRIPT, ...args, '--db', db], { encoding: 'utf8' });

function json(result) {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('list finds by title or people first, then transcript, and skips deleted and hidden meetings', () => {
  const found = json(quill(['list', '--query', 'northwind dana'], fixture()));
  assert.deepEqual(found.map((m) => [m.id, m.matched_in]), [['m1', 'title_or_people'], ['m2', 'transcript']]);
  assert.equal(found[0].title, 'Northwind pricing review');
});

test('list --on keeps only that local day and rejects a bad date', () => {
  const db = fixture();
  const next = new Date(1_790_000_000_000 + 86_400_000);
  const pad = (n) => String(n).padStart(2, '0');
  const day = `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`;
  assert.deepEqual(json(quill(['list', '--on', day], db)).map((m) => m.id), ['m2']);
  assert.equal(quill(['list', '--on', 'tomorrow'], db).status, 2);
});

test('two untitled meetings get separate folders, so one cannot overwrite the other', () => {
  const db = fixture();
  const root = tmp();
  const first = json(quill(['show', 'm5', '--root', root], db));
  const second = json(quill(['show', 'm1', '--root', root], db));
  assert.match(first.folder, /untitled-meeting-m5$/);
  assert.notEqual(first.folder, second.folder);
});

test('list with no query returns visible meetings, newest first, and names untitled ones', () => {
  const found = json(quill(['list'], fixture()));
  assert.equal(found[0].id, 'm2');
  assert.deepEqual(found.map((m) => m.id).sort(), ['m1', 'm2', 'm5']);
  assert.equal(found.find((m) => m.id === 'm5').title, 'Untitled meeting');
});

test('show exports notes and a citable transcript into a private dated folder', () => {
  const root = tmp();
  const item = json(quill(['show', 'm1', '--root', root], fixture()));
  assert.match(item.folder, /\d{4}-\d{2}-\d{2}-northwind-pricing-review-m1$/);
  assert.equal(statSync(item.folder).mode & 0o777, 0o700);
  assert.equal(statSync(item.transcript_file).mode & 0o777, 0o600);
  const transcript = readFileSync(item.transcript_file, 'utf8');
  assert.match(transcript, /^\[00:00\] Dana Lee: Thanks for joining\. Let's look at pricing\.$/m);
  assert.match(transcript, /^\[01:10\] Dana Lee: One more thing\.$/m);
  assert.match(transcript, /^\[01:15\] Sam Guess: I will send the proposal by Friday\.$/m);
  assert.match(transcript, /^\[1:01:40\] Speaker 1 \(system\): Anything else\?$/m);
  assert.equal(item.turns, 4);
  const notes = readFileSync(item.notes_file, 'utf8');
  assert.match(notes, /## Summary\n\n## Decisions\n- Ship it/);
  assert.doesNotMatch(notes, /Empty/);
});

test('show without a transcript or notes writes neither file', () => {
  const root = tmp();
  const item = json(quill(['show', 'm5', '--root', root], fixture()));
  assert.equal(item.has_transcript, false);
  assert.equal(item.transcript_file, undefined);
  assert.equal(existsSync(join(item.folder, 'notes.md')), false);
});

test('an export refuses symlinks, so it cannot overwrite or redirect to another file', () => {
  const db = fixture();
  const root = tmp();
  const folder = json(quill(['show', 'm1', '--root', root], db)).folder;
  const target = join(tmp(), 'target.txt');
  writeFileSync(target, 'keep me');
  rmSync(join(folder, 'transcript.md'));
  symlinkSync(target, join(folder, 'transcript.md'));
  assert.equal(quill(['show', 'm1', '--root', root], db).status, 6);
  assert.equal(readFileSync(target, 'utf8'), 'keep me');

  const other = tmp();
  const linkRoot = tmp();
  symlinkSync(other, join(linkRoot, folder.split('/').pop()));
  assert.equal(quill(['show', 'm1', '--root', linkRoot], db).status, 6);
  assert.deepEqual(readdirSync(other), []);
});

test('the database is not changed', () => {
  const db = fixture();
  const before = readFileSync(db);
  json(quill(['show', 'm1', '--root', tmp()], db));
  json(quill(['list', '--query', 'northwind'], db));
  assert.deepEqual(readFileSync(db), before);
});

test('clear exits for a missing database, an unknown meeting and a changed schema', () => {
  const db = fixture();
  assert.equal(quill(['list'], join(tmp(), 'none.db')).status, 3);
  assert.equal(quill(['show', 'nope'], db).status, 4);
  assert.equal(quill(['show', 'm3'], db).status, 4);
  const empty = join(tmp(), 'empty.db');
  spawnSync('python3', ['-c', 'import sqlite3,sys; sqlite3.connect(sys.argv[1]).execute("CREATE TABLE t (a)")', empty]);
  const changed = quill(['list'], empty);
  assert.equal(changed.status, 5);
  assert.match(changed.stderr, /Quill may have changed/);
});
