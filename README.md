# agent-skills

Agent skills that work in every local agent harness: Claude Code, Codex, OpenCode and the DeepSeek harness. There is one copy of each skill, and `install.sh` links it into the folders each harness reads. The repo also ships `subagent`, a small CLI that runs a task through any installed harness on a cheap, standard or frontier model.

## Skills

| Skill | Use it for |
|---|---|
| `subagent` | Hand bounded work to cheaper models and run it in parallel. Use the other harnesses as workers, second opinions or test runners, and check which ones work. |
| `security` | Defensive review of a diff, repo, dependencies or config. Scanners run first, then cheap models map the code, a stronger model hunts, and a different model family tries to disprove each finding. |
| `github-setup` | Audit a GitHub repo against a baseline (`personal-public`, `personal-private`, `team`) and apply the fixes you approve: branch rules, security features, Actions token, community files. Also sets up GitHub Projects boards. |
| `cloud-setup` | Audit a Google Cloud project (AWS and Azure by checklist) for budgets, IAM, keys, public exposure and logging, and bootstrap new projects with keyless GitHub Actions access. |
| `explain` | Explain recent work in the current task. |
| `state-of-the-world` | Take stock of a whole piece of work, with a color-coded flow diagram from the start to the goal. |
| `explain-concept` | Teach one concept as an interactive page. |
| `explain-codebase` | Build a code-grounded, citation-checked tour of a repo. |
| `explain-style` | The plain-writing rules the other skills use ("80% of ASD-STE100"). |

Invoke a skill with `/name` in Claude Code and the DeepSeek harness, and with `$name` in Codex. OpenCode picks skills by their description.

Every skill that changes something outside your machine is read-only by default. It audits, shows a plan, and changes only what you approve.

## Install

Requires Node 20 or newer. There are no dependencies.

```bash
gh repo clone ShmalexM/agent-skills ~/code/agent-skills
~/code/agent-skills/install.sh --dry-run   # show what would change
~/code/agent-skills/install.sh
subagent doctor --probe
```

`install.sh` links each skill into two folders, which together cover every harness:

| Folder | Read by |
|---|---|
| `~/.claude/skills/` | Claude Code, OpenCode |
| `~/.agents/skills/` | Codex, OpenCode, DeepSeek harness |

The installer also does three other things:

- It puts `subagent` in `~/.local/bin`.
- It moves copies with the same names out of `~/.codex/skills`, because Codex reads both folders and would show them twice.
- It links `share_lint.py` into `~/.local/share/agent-skills/explain-codebase/`, where your codebase tours live outside this repo.

Anything it replaces goes to `~/.local/share/agent-skills/backups/<time>/`; nothing is deleted. `install.sh --uninstall` removes only the links that point into this repo.

The harness folders are links to your checkout, so an edit shows up the next time a harness loads the skill. Restart a harness to see a newly added skill.

## Make it yours

Personal context lives in `~/.config/agent-skills/`, never in the repo. Every file is optional.

| File | What it does |
|---|---|
| `profile.md` | Who you are, your projects, the checks to run before reviews or pushes, data rules (which providers may see private code), GitHub and cloud defaults. Skills read it when it exists. Start from `config/profile.example.md`. |
| `tiers.json` | Your model per harness and tier. Deep-merged over `config/tiers.json`. |
| `share_lint.json` | Extra patterns that make a codebase tour fail the "shareable" check (your launchers, instance names), and default ports your repos document. |
| `private-terms.txt` | Words that must never appear in this repo (names, customers, internal hosts), one per line. `scripts/validate.mjs` fails if it finds one. Useful if you fork the repo and publish your changes. |

## The `subagent` CLI

```bash
subagent tiers                                    # model per harness and tier, and where the data goes
subagent doctor --probe                           # which harnesses are installed, signed in, and answering
subagent run --via codex --tier cheap --cwd ~/code/repo --prompt-file brief.md
subagent run --via other --tier frontier --prompt "Review this plan: ..."   # a different model family from yours
subagent run --via ollama --attach build.log --prompt "List each distinct error."
subagent batch tasks.jsonl --parallel 4
subagent run --via claude --prompt x --dry-run    # print the exact command, spend nothing
```

| Harness | cheap | standard | frontier | Data goes to |
|---|---|---|---|---|
| claude | claude-haiku-5-5 | claude-sonnet-5-5 | claude-opus-5-5 | Anthropic |
| codex | gpt-6-luna (low) | gpt-6.1-sol (medium) | gpt-6-astra (high) | OpenAI |
| opencode | ollama/qwen3.5 | ollama/qwen3-coder | openrouter/deepseek-v4-pro | the model's provider |
| ollama | qwen3.5 | qwen3-coder | qwen3.8:27b | stays local |
| dsh | profile default | profile default | profile default | the provider in your dsh profile |

Change any row in `~/.config/agent-skills/tiers.json`. Local models must be pulled first; `subagent doctor` warns when they are not.

Runs are read-only unless you pass `--mode write --cwd <scratch worktree>`. A preamble tells workers to stay in scope, cite `path:line`, and skip session rituals from your global agent instructions; `--raw` turns it off. Each run writes `brief.md`, `output.md`, the logs and `meta.json` (model, time, exit code, cost estimate) to `~/.local/state/agent-skills/runs/`, or to `$TMPDIR` when a sandbox blocks that folder.

Inside a sandboxed harness (Claude Code, Codex), calls to another harness need the sandbox override, because they need the network and the keychain. `skills/subagent/references/harness-matrix.md` has the details and the known traps.

## Develop

```bash
node scripts/validate.mjs && node --test test/*.test.mjs   # same as npm run check
```

The checks validate skill frontmatter and file references, scan for secret patterns and your private terms, and run the offline tests. Read `AGENTS.md` before you add a skill.

## License

MIT. See `LICENSE`.
