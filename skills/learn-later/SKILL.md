---
name: learn-later
description: Keep a local queue of topics to learn about later, and turn any of them into a short reading pack in Markdown with SVG diagrams. A pack has a plain-language brief, key terms, a worked example, the current state with dated sources, and self-check questions. Packs are plain files in a folder the user picks once (an Obsidian vault works as is), with optional export to Notion or other doc apps. Use when the user types /learn-later, or says "save this for later", "I want to learn about X later", "remind me to read up on X", "what's on my learn-later list", or "prepare my reading on X".
---

# Learn later

The user is curious about something but has no time now. Capture it in seconds; later, prepare a reading pack they can finish in about 10 minutes, with pictures that make it click.

Read the user profile (`~/.config/agent-skills/profile.md`) if it exists. It may set where packs go, note rules for their notes app (links, tags), and their background.

The helper script is `scripts/queue.mjs` in this skill's folder. Run it with `node`.

## 0. Destination (ask once)

```bash
node <this skill's folder>/scripts/queue.mjs where
```

If it says the queue is not set up (exit code 3), ask the user one question: where should reading packs go? Offer:

- **A notes folder** they already use, for example an Obsidian vault folder. Obsidian, Logseq and most Markdown editors read the files as they are.
- **A plain folder**, for example `~/learn-later`.
- **Notion or another doc app**, if this harness has that connector. Packs are still written to a local folder first, then exported (section 4).

Then save the answer, so you never ask again:

```bash
node <this skill's folder>/scripts/queue.mjs init --root "<folder>"
```

The files are always Markdown plus SVG. Do not invent another format.

## 1. Capture (fast, no research)

When the user names a topic, or says "save this" right after asking about something, add it:

```bash
node <this skill's folder>/scripts/queue.mjs add "<Topic>" --why "<one line: what prompted it, from the conversation>"
```

Pick a short, stable topic name ("Stablecoins", not "that crypto dollar thing"). If you inferred the topic from the conversation, say it in one line so the user can correct it. Then offer: "Prepare the pack now, or leave it queued?" Capture alone takes one tool call; do not start research unless the user wants the pack.

## 2. Prepare a pack

1. **Scope.** One topic, about a 10-minute read: 700 to 1,400 words plus diagrams. If the topic is broad, pick the core idea and list the rest under "Next topics".
2. **Research.** For anything factual or current, use primary and reputable sources, and note the date each fact was true. For a bigger topic, hand source-gathering to a cheap or standard worker (the `subagent` skill) with an output contract of facts, URLs, dates, and checked or inferred. Check every number and date you keep. Never invent figures. Mark simplifications.
3. **Write** the pack from `references/pack-template.md` to the path that `queue.mjs path "<Topic>"` prints. Write in plain style (the `explain-style` skill). Lead with the one-line answer and the intuition, then mechanics, then the current state.
4. **Diagrams.** Draw 1 to 3 SVG diagrams by following `references/diagram-style.md`. Usually draw "how it works" (a flow), and add "the landscape" (types or players) or "timeline" when they help. Save them next to the pack and embed them with `![alt text](file.svg)`. For photos or third-party images, link to them; do not download them.
5. **Check, then mark it ready:**

   ```bash
   node <this skill's folder>/scripts/queue.mjs check "<Topic>"
   node <this skill's folder>/scripts/queue.mjs set "<Topic>" --status ready
   ```

   `check` makes sure the pack has its sections and sources, and that every embedded SVG exists and parses.
6. **Hand over.** Give the absolute path, the read time, and the one-line answer. Mention any open question you could not settle.

## 3. List and finish

- `queue.mjs list` shows the queue (`queued`, `ready`, `read`). `--status ready` shows what can be read now.
- When the user says they read a pack, run `queue.mjs set "<Topic>" --status read`. Offer to add two lines under "What stuck" in the pack; write them only if the user gives them.

## 4. Export (optional)

If the user chose Notion or a doc app and this harness has that connector, create a page from the pack's Markdown after step 2. Diagrams need care: many doc apps cannot take a local SVG. Attach a PNG of each diagram if the connector supports uploads, or leave a note in the page that points to the local file. Never publish a pack publicly without asking.

## Rules

- The queue and packs belong to the user; never delete entries or packs unless asked.
- Follow the profile's note rules for the destination (for example, required links or tags).
- Keep packs honest: date everything that can change, cite sources, and keep "Where it stands now" separate from the timeless explanation.
- No personal data in packs beyond what the user gave for the "why".
