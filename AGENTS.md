# Working on agent-skills

Every skill in this repo must load and work in Claude Code, Codex, OpenCode and the DeepSeek harness, for any user.

## Layout

- `skills/<name>/SKILL.md` is a skill. Bundled files sit next to it in `references/` and `scripts/`.
- `bin/subagent` and `lib/subagent/` are the dispatch CLI. No dependencies; Node 20+.
- `config/tiers.json` holds the default model per harness and tier. `config/profile.example.md` is the template for a user's profile.
- `install.sh` links skills into `~/.claude/skills` and `~/.agents/skills`.
- `scripts/validate.mjs` and `test/` are the checks.

## Rules for a skill

- Frontmatter has only `name` (kebab-case, equal to the folder name) and `description` (1024 characters or fewer). Other fields are not read by every harness.
- The description says what the skill does and when to use it, with the trigger phrases (for example "Use when the user types /name or asks ...").
- Write the body for any harness. When a step needs a harness-specific tool, name the tool for each harness, or give a fallback that works from a shell. `skills/state-of-the-world/SKILL.md` (diagram routes) shows the pattern.
- Write for any user. Personal context (names, projects, internal tools, private paths, report folders) belongs in `~/.config/agent-skills/profile.md`. A skill that needs it says "read the user profile if it exists" and works without it.
- Skills that change things outside the machine (repos, cloud, messages) audit first, show a plan, and act only after the user says yes.
- Refer to bundled files by relative path (`references/x.md`, `scripts/y.mjs`). The validator checks they exist.
- Scripts in skills use Node or Python with no dependencies. Keep the logic that decides pass or fail in pure functions, and test them with fixtures in `test/`.
- Write prose in plain style: follow `skills/explain-style/SKILL.md`.
- No secrets, customer data or private content. Keep your own private-terms list in `~/.config/agent-skills/private-terms.txt` so the validator can catch slips.

## Before you commit

```bash
node scripts/validate.mjs && node --test test/*.test.mjs
```

(`npm run check` runs the same thing.) For a change to `bin/` or `lib/` that affects how a harness is called, also run `subagent doctor --probe`, which sends one short task per harness.
