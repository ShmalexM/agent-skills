#!/usr/bin/env python3
"""Find a meeting in Quill's local database and export its notes and transcript.

The database is opened read-only. Exported files are private to the current user.

  quill.py list [--query TEXT] [--days N] [--on YYYY-MM-DD] [--limit N] [--db PATH]
  quill.py show MEETING_ID [--root DIR] [--db PATH]

Exit codes: 0 ok, 2 usage, 3 database missing, 4 meeting not found, 5 unexpected schema, 6 unsafe export path.
"""
import argparse
import datetime
import json
import os
import re
import sqlite3
import sys
import time
import urllib.parse

DEFAULT_DB = "~/Library/Application Support/Quill/quill.db"
MAX_TURN_MS = 60_000


def meeting_title(row):
    for key in ("manualTitle", "title", "llmTitle", "eventTitle"):
        if row[key]:
            return row[key]
    return "Untitled meeting"


def slugify(text, limit=60):
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:limit].rstrip("-") or "meeting"


def clock(offset_ms):
    seconds = max(0, offset_ms) // 1000
    hours, rest = divmod(seconds, 3600)
    minutes, secs = divmod(rest, 60)
    return f"{hours:d}:{minutes:02d}:{secs:02d}" if hours else f"{minutes:02d}:{secs:02d}"


def speaker_label(block, names, numbers):
    speaker = block.get("speaker_id")
    if speaker in names:
        return names[speaker]
    number = numbers.setdefault(speaker, len(numbers) + 1)
    return f"Speaker {number} ({block.get('source') or 'unknown'})"


def transcript_turns(transcript, names):
    """Merge consecutive blocks from one speaker. A turn stays under a minute so citations stay precise."""
    start = transcript.get("startTime") or 0
    numbers = {}
    turns = []
    for block in sorted(transcript.get("blocks") or [], key=lambda b: b.get("from") or 0):
        text = (block.get("text") or "").strip()
        if not text:
            continue
        label = speaker_label(block, names, numbers)
        begin = block.get("from") or start
        last = turns[-1] if turns else None
        if last and last["speaker"] == label and begin - last["begin"] < MAX_TURN_MS:
            last["text"] += " " + text
        else:
            turns.append({"begin": begin, "speaker": label, "text": text})
    return [{"at": clock(t["begin"] - start), "speaker": t["speaker"], "text": t["text"]} for t in turns]


def render_transcript(title, turns):
    lines = [f"# Transcript: {title}", ""]
    lines.extend(f"[{t['at']}] {t['speaker']}: {t['text']}" for t in turns)
    return "\n".join(lines) + "\n"


def render_notes(title, notes):
    lines = [f"# Quill notes: {title}", ""]
    for note in notes:
        lines.extend([f"## {note['title']}", "", note["body"].strip(), ""])
    return "\n".join(lines)


def local_time(epoch_ms):
    if not epoch_ms:
        return None
    return datetime.datetime.fromtimestamp(epoch_ms / 1000).astimezone().isoformat(timespec="minutes")


def connect(path):
    path = os.path.expanduser(path)
    if not os.path.exists(path):
        fail(3, f"Quill database not found at {path}. Ask the user for a transcript or notes, or pass --db.")
    connection = sqlite3.connect(f"file:{urllib.parse.quote(path)}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


META = """
    m.id, m.start, m.end, m.title, m.manualTitle, m.llmTitle, m.eventTitle, m.participants, m.word_count,
    coalesce(length(m.audio_transcript), 0) > 0 AS has_transcript,
    (SELECT count(*) FROM Note n WHERE n.meeting_id = m.id) AS note_count,
    (SELECT group_concat(coalesce(c.name, cm.suggested_name), ', ')
       FROM ContactMeeting cm LEFT JOIN Contact c ON c.id = cm.contact_id
      WHERE cm.meeting_id = m.id AND coalesce(c.name, cm.suggested_name) IS NOT NULL) AS people
"""
VISIBLE = "m.deleteDate IS NULL AND coalesce(m.hidden, 0) = 0"


def summary(row, matched=None):
    item = {
        "id": row["id"],
        "title": meeting_title(row),
        "start": local_time(row["start"]),
        "end": local_time(row["end"]),
        "participants": row["participants"] or "",
        "people": row["people"] or "",
        "words": row["word_count"],
        "has_transcript": bool(row["has_transcript"]),
        "notes": row["note_count"],
    }
    if matched:
        item["matched_in"] = matched
    return item


def day_range_ms(day):
    try:
        start = datetime.datetime.strptime(day, "%Y-%m-%d").astimezone()
    except ValueError:
        fail(2, f"--on needs a date like 2026-01-31, not {day}.")
    return int(start.timestamp() * 1000), int((start + datetime.timedelta(days=1)).timestamp() * 1000)


def list_meetings(connection, query, days, limit, on=None):
    tokens = (query or "").lower().split()
    where, params = [VISIBLE], []
    if days:
        where.append("m.start >= ?")
        params.append(int((time.time() - days * 86400) * 1000))
    if on:
        where.append("m.start >= ? AND m.start < ?")
        params.extend(day_range_ms(on))
    for token in tokens:
        where.append("instr(lower(coalesce(m.audio_transcript, '')) || ' ' || lower(" + META_TEXT + "), ?) > 0")
        params.append(token)
    rows = connection.execute(
        f"SELECT {META} FROM Meeting m WHERE {' AND '.join(where)} ORDER BY m.start DESC", params
    ).fetchall()
    items = []
    for row in rows:
        haystack = " ".join(
            str(row[k] or "") for k in ("title", "manualTitle", "llmTitle", "eventTitle", "participants", "people")
        ).lower()
        in_meta = all(token in haystack for token in tokens)
        items.append(summary(row, ("title_or_people" if in_meta else "transcript") if tokens else None))
    items.sort(key=lambda item: item.get("matched_in") != "transcript", reverse=True)
    return items[:limit]


META_TEXT = """
    coalesce(m.title, '') || ' ' || coalesce(m.manualTitle, '') || ' ' || coalesce(m.llmTitle, '') || ' ' ||
    coalesce(m.eventTitle, '') || ' ' || coalesce(m.participants, '') || ' ' || coalesce((
      SELECT group_concat(coalesce(c.name, cm.suggested_name), ' ')
        FROM ContactMeeting cm LEFT JOIN Contact c ON c.id = cm.contact_id WHERE cm.meeting_id = m.id), '')
"""


def speaker_names(connection, meeting_id):
    rows = connection.execute(
        """SELECT cm.speaker_id, coalesce(c.name, cm.suggested_name) AS name
             FROM ContactMeeting cm LEFT JOIN Contact c ON c.id = cm.contact_id
            WHERE cm.meeting_id = ? AND cm.speaker_id IS NOT NULL""",
        (meeting_id,),
    )
    return {row["speaker_id"]: row["name"] for row in rows if row["name"]}


def meeting_notes(connection, meeting_id):
    rows = connection.execute(
        "SELECT title, body FROM Note WHERE meeting_id = ? AND length(coalesce(body, '')) > 0 ORDER BY createdAt",
        (meeting_id,),
    )
    return [{"title": row["title"] or "Note", "body": row["body"]} for row in rows]


def write_private(path, text):
    # O_NOFOLLOW: a planted symlink must not redirect a transcript or overwrite its target.
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    except OSError as error:
        fail(6, f"Refusing to write {path}: {error}. Remove it if it is a symlink, then export again.")
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        handle.write(text)


def show_meeting(connection, meeting_id, root):
    row = connection.execute(
        f"SELECT {META}, m.audio_transcript FROM Meeting m WHERE m.id = ? AND {VISIBLE}", (meeting_id,)
    ).fetchone()
    if row is None:
        fail(4, f"No visible meeting with id {meeting_id}. Run list to find the id.")
    item = summary(row)
    transcript = json.loads(row["audio_transcript"]) if row["has_transcript"] else {}
    turns = transcript_turns(transcript, speaker_names(connection, meeting_id))
    notes = meeting_notes(connection, meeting_id)
    item["turns"] = len(turns)
    if root:
        date = (item["start"] or "undated")[:10]
        # The id keeps two meetings with the same title on one day in separate folders.
        folder = os.path.join(os.path.expanduser(root), f"{date}-{slugify(item['title'])}-{slugify(meeting_id[:6])}")
        if os.path.islink(folder):
            fail(6, f"Refusing to export into {folder}: it is a symlink.")
        os.makedirs(folder, mode=0o700, exist_ok=True)
        os.chmod(folder, 0o700)
        item["folder"] = folder
        if turns:
            item["transcript_file"] = os.path.join(folder, "transcript.md")
            write_private(item["transcript_file"], render_transcript(item["title"], turns))
        if notes:
            item["notes_file"] = os.path.join(folder, "notes.md")
            write_private(item["notes_file"], render_notes(item["title"], notes))
    return item


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    find = commands.add_parser("list", help="find meetings, newest first, with title and people matches on top")
    find.add_argument("--query", help="words that must all appear in the title, people or transcript")
    find.add_argument("--days", type=int, help="only meetings from the last N days")
    find.add_argument("--on", help="only meetings on this local date, YYYY-MM-DD")
    find.add_argument("--limit", type=int, default=15)
    find.add_argument("--db", default=os.environ.get("QUILL_DB", DEFAULT_DB))
    show = commands.add_parser("show", help="print one meeting's details and export its notes and transcript")
    show.add_argument("meeting_id")
    show.add_argument("--root", help="write notes.md and transcript.md to a new folder under this folder")
    show.add_argument("--db", default=os.environ.get("QUILL_DB", DEFAULT_DB))
    args = parser.parse_args()

    connection = connect(args.db)
    try:
        if args.command == "list":
            result = list_meetings(connection, args.query, args.days, args.limit, args.on)
        else:
            result = show_meeting(connection, args.meeting_id, args.root)
    except sqlite3.OperationalError as error:
        fail(5, f"Quill's database does not have the expected tables or columns ({error}). Quill may have changed.")
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
