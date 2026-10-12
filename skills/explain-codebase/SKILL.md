---
name: explain-codebase
description: Build an interactive, code-grounded tour of a repository (or one subsystem) as an HTML page, with a clickable architecture map, traced end-to-end flows with file:line links, "where do I change X" paths, a glossary and how to run it, pinned to a commit so it can be refreshed. Use when the user types /explain-codebase or /tour, or asks to "explain this codebase", "give me a tour of <repo>", "onboard me / someone to <repo>", "how does <repo> fit together". Not for recent work in this task (use /explain or /state-of-the-world).
---

# Explain a codebase

Produce a tour a new engineer can use to find their way around in an hour. Every claim on it points at real code at a pinned commit. The page is the answer; chat gets the link and a few lines.

## 1. Pin the subject

- **Repo and commit.** Resolve the checkout and the exact commit. Prefer the upstream default branch: `git fetch`, then read from a detached worktree of `origin/<default>` in the scratchpad (`git worktree add --detach <scratch>/<name> origin/main`). Never change the user's checkout to do this. Record the full SHA.
- **Scope.** Whole repo by default. If the repo is large (>~1,500 tracked files) or the user names an area, say which subsystem you cover and list the rest as "not covered".
- **Audience.** Default: an engineer new to this repo. Adjust for FDE/operator (deploy, config, runbooks) or PM/exec (capabilities and boundaries, little code).
- **Gate.** Read the user profile (`~/.config/agent-skills/profile.md`) if it exists and run any repository check it names. Read any repo `AGENTS.md`/`CLAUDE.md`. If the checkout is customer, demo, deployment or experimental (not OSS), the tour stays private and must leave out customer data, secrets and hostnames. Say this when you give the link.

## 2. Gather evidence (read-only)

1. Read the entry docs yourself: README, CONTEXT/INTENT/ARCHITECTURE files, docs index, top-level manifests (package/pyproject/compose/Helm/Makefile/start scripts). These give you the intended shape.
2. Map the tree: `git ls-files | awk -F/ '{print $1"/"$2}' | sort | uniq -c | sort -rn` and the entrypoints (main modules, servers, CLIs, workers, migrations).
3. **Fan out in parallel** with 3–5 read-only, cheap-tier workers (see the `subagent` skill: Explore agents in Claude Code, `spawn_agent` in Codex, or `subagent batch` from any shell), one slice each (for example: backend/API, data model and storage, background workers and integrations, frontend, deploy and config). Ask each for a structured return:
   - components: name, one-line role, key files, entrypoints, what it talks to (with the call site as `path:line`);
   - 1–2 flows that cross its boundary, step by step, each step with `path:line`;
   - terms of art and what they mean in this code;
   - for every claim: `checked` (read the code) or `inferred` (from names/docs).
4. **Pick 2–3 flows** that best explain the system (the main user action end to end, the main background loop, the deploy/startup path). Trace each yourself through the subagent leads until you have read every step.
5. **Verify citations mechanically.** Before writing the page, check that every `path:line` you will cite exists at the pinned SHA and that the line contains the symbol you name (`git show <sha>:<path> | sed -n '<line>p'`, or a short script over all citations). Fix or drop anything that fails. Report how many citations were checked.

## 3. Page structure

Load `explain-style` for all prose. If you will publish with the `Artifact` tool, load `artifact-design` before writing. Sections, in this order:

1. **Header stamp.** Repo, commit SHA (short) and date, scope, audience, and "checked / inferred" legend.
2. **What it is, in one paragraph.** What the system does, for whom, and its main moving parts.
3. **System map (centerpiece).** An inline SVG of the components and their connections, grouped by layer (clients, API, services/workers, storage, external systems). Each node is clickable and opens a side panel: role, key files (links), entrypoints, talks-to, and gotchas. Edge labels name the protocol or call (HTTP, MCP, queue, SQL).
4. **Traced flows.** For each flow, a step-through (Next/Back) that highlights the path on a small diagram and shows, for each step, what happens, the `path:line` link and a 1–5 line excerpt. Use real excerpts; keep each short.
5. **Where do I change X.** A table of 8–12 common tasks (add an API endpoint, add a connector/integration, add a DB column + migration, change a UI page, add a config value, add a test) → files to touch, in order, and the test to run.
6. **Glossary.** Domain terms as the code uses them, each linked to where it is defined.
7. **Run it, test it.** The minimum commands to start it locally and run the tests, taken from the repo (not invented), with prerequisites.
8. **Not covered / open questions.** What the tour skipped and what you could not confirm.

Links: if the repo has a public remote, use permalinks at the pinned SHA (`https://github.com/<org>/<repo>/blob/<sha>/<path>#L<line>`). For private repos, use permalinks too (they work for people with access); never inline large private code.

Code that is not pushed (a local change set): cite repo-relative paths, mark each cited file new / changed / unchanged against the pushed base commit, attach the cited lines (1–5) to every cite so the page opens them in place, and link only unchanged files at the base SHA. Say in a header status note that the change set is not in the repository yet. A change-set tour in the private tours folder (see section 4), if one exists on this machine, is the worked example.

Mark `inferred` items visibly (dashed outline on the map, a small tag in panels). Only `checked` items look solid.

## 4. Publish, keep, refresh

- Publish as a private Artifact where the harness has one (Claude Code: the `Artifact` tool, `icon`: "map"). Otherwise give the absolute path of the built HTML file. Title: "<Repo> Codebase Tour" (or "<Repo> <Subsystem> Tour").
- Keep the generator in the private tours folder, `~/.local/share/agent-skills/explain-codebase/tours/<repo>/`. It is outside the skills repo, so private tours are never committed, and it outlives the session's scratch folder. `install.sh` links `share_lint.py` into `~/.local/share/agent-skills/explain-codebase/`, so tour scripts that import it from two folders up keep working. If a tour already exists there, copy its layout: `data.py` (all content and `path:line` + symbol cites), `verify.py` (checks each cite with `git show <sha>:<path>` against the repo's git objects, so no checkout is needed; set `TOUR_REPO`), `template.html`, `build.py` and `parsecheck.js`. Run verify → build → parsecheck, then publish the built HTML. verify.py and build.py both call `share_lint.py` (see Rules) and fail on a hit. Add the artifact URL to `tours/<repo>/README` line once published.
- **Refresh mode.** When the user asks to refresh a tour, read the existing artifact, take `git diff --stat <old-sha>..<new-sha>`, re-verify every citation at the new SHA, update only the parts the diff touched, and republish to the same URL with a changelog line in the header.
- Reply with the link and 3–5 lines: scope and commit, the flows traced, the citation check result, and anything flagged as inferred or not covered.

## Rules

- **Shareable by default.** Write for someone who has the repository and nothing else. No local paths (`~/`, `/Users/`), personal launchers or instances, loopback ports other than the repo's documented defaults, private output folders, agent or tool names, people's names, or anything learned only from memory or private notes. Define every product, site and domain term in the glossary with a cite. Give run commands from the repo root using the repo's own scripts. `share_lint.py` enforces the mechanical part. Add personal patterns (your launchers, instance names, allowed default ports) to `~/.config/agent-skills/share_lint.json`, tour-specific patterns as `LINT_EXTRA` in data.py, and exact repo strings to allow (for example a default URL in cited code) with `LINT_ALLOW`.

- Read-only on the repo. No builds, installs or test runs are needed for a tour; quote commands, do not run them unless the user asks.
- Never cite a line you did not verify. Never describe intended behaviour (from docs) as actual behaviour (from code) without saying which it is.
- Prefer one accurate map with 10–20 nodes over an exhaustive one. Group small modules.
