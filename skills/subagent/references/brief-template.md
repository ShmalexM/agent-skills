# Brief template

Copy this, fill every heading, delete nothing. A heading with "none" is fine; a missing heading is how workers drift.

```markdown
## Goal
<One sentence: what to produce and why it matters.>

## Scope
- In: <files, folders, commit SHA, URLs>
- Out: <what not to touch or read>

## Constraints
- Mode: read-only | write (only inside <folder>)
- No network unless named here. No installs.
- Stop after <N minutes / N files / N findings>.

## What we already know
- <facts you have checked, so the worker does not rediscover them>
- <dead ends already tried>

## Output contract
Return exactly this, nothing before or after:
<headings, a table, or a JSON shape>
- Cite every claim as `path:line`.
- Tag every claim "checked" (read the code or ran it) or "inferred".
- If blocked, return `BLOCKED: <what and why>` and stop.

## Done when
<the stop condition>
```

## Example: cheap-tier inventory

```markdown
## Goal
List every HTTP route in this service so the security review can map its entry points.

## Scope
- In: backend/ at the current HEAD
- Out: tests/, migrations/, frontend/

## Constraints
- Mode: read-only. Stop after 200 routes.

## What we already know
- Routes are FastAPI decorators (@router.get, @app.post, ...); some routers mount with a prefix in backend/main.py.

## Output contract
A JSON array, one object per route:
{"method": "GET", "path": "/api/cases/{id}", "handler": "backend/api/cases.py:41", "auth": "require_user | none | unclear", "evidence": "checked | inferred"}

## Done when
Every file under backend/ that imports APIRouter or FastAPI has been read.
```

## Batch files (`subagent batch tasks.jsonl`)

One JSON object per line. Lines starting with `//` are comments. Relative paths resolve from the batch file's folder. Every line is checked before any task runs.

Keys: `id`, `via` (claude, codex, opencode, ollama, dsh, other), `tier`, `model`, `effort`, `mode` (read or write), `cwd`, `prompt` or `prompt_file`, `attach` (array), `timeout` (seconds), `label`, `budgetUsd`, `raw`, `allowUnsandboxed`.

```jsonl
// same review brief, two model families
{"id": "review-claude", "via": "claude", "tier": "standard", "cwd": "../repo", "prompt_file": "review.md"}
{"id": "review-codex", "via": "codex", "tier": "standard", "cwd": "../repo", "prompt_file": "review.md"}
// local summary of a big log, nothing leaves the machine
{"id": "log-summary", "via": "ollama", "attach": ["ci.log"], "prompt": "List each distinct failure with its first line number."}
```

The batch folder holds one run folder per task and `batch.json` with every task's status, model, time, cost and output path.
