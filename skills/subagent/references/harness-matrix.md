# Harness matrix

How each local harness finds skills, runs headless, spawns its own subagents, and where it trips. Checked on 2026-10-12 against Claude Code 2.1.283, Codex CLI 0.158.0, OpenCode 1.18.32, Ollama 0.33.0 and the DeepSeek harness (dsh) from the npx cache. Re-check with `subagent doctor --probe` after upgrades.

| | Claude Code | Codex | OpenCode | DeepSeek harness | Ollama |
|---|---|---|---|---|---|
| Skill folders (user) | `~/.claude/skills` | `~/.agents/skills`, `$CODEX_HOME/skills` | `~/.config/opencode/skills`, plus `~/.claude/skills` and `~/.agents/skills` | `~/.dsh/skills`, `~/.agents/skills` | none (no tools) |
| Invoke a skill | `/name` | `$name` or by description | by description (skill tool) | `/name` or by description | n/a |
| Native subagents | Agent tool (`model`, `subagent_type`, `isolation: "worktree"`), Workflow tool | `spawn_agent` (`model`, `reasoning_effort`), `wait_agent`, `close_agent` | task tool, agent files with `mode: subagent` | subagent tool | none |
| Headless command | `claude -p` | `codex exec` | `opencode run` | `dsh --profile headless "<task>"` | HTTP `POST /api/generate` |
| Read-only switch | `--permission-mode dontAsk` + read-only `--allowedTools` | `-s read-only` | `--agent plan` | none | always (no tools) |
| Model switch | `--model claude-haiku-5-5` (exact IDs; aliases lag) | `-m <slug>` + `-c model_reasoning_effort="low"` | `-m provider/model` | profile default only | `model` field |
| Signed-in check | `claude auth status` (JSON) | `codex login status` | `opencode auth list` | `~/.dsh/settings.yaml` | `GET /api/tags` |

`install.sh` links every skill into `~/.claude/skills` and `~/.agents/skills`. Those two folders cover all five harnesses. It also removes stale copies from `~/.codex/skills`, because Codex reads both folders and would show a skill twice.

## Traps

- **Nested sandboxes.** Inside Claude Code's sandbox, `codex exec` cannot reach its backend and `claude -p` cannot read the keychain. Run cross-harness calls with the sandbox override. Codex's own sandbox (`-s read-only`) still applies to what Codex does.
- **Nested Claude.** Claude Code sets `CLAUDECODE` in its children. The CLI strips it so `claude -p` starts cleanly.
- **Claude aliases lag.** `--model haiku` runs Haiku 4.5 and `--model sonnet` runs Sonnet 5 in Claude Code 2.1.283. The tiers use exact IDs (`claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`). The Agent tool only takes aliases.
- **Claude cost figures.** `total_cost_usd` from `claude -p` is Claude Code's own estimate, and its price table lags new models: it priced a Haiku 5.5 call at about 60 times the list price. On a subscription, runs use plan limits, not dollars. Each headless Claude call also loads about 20k to 45k tokens of setup, so many tiny Claude calls cost more than one batched call.
- **`--bare` breaks sign-in.** `claude --bare` skips the keychain, so OAuth (claude.ai) sign-in fails. The CLI does not use it.
- **Session protocol in workers.** Every harness loads global agent instructions (`AGENTS.md`, `CLAUDE.md`), and these may tell agents to claim tasks or log events. The worker preamble tells workers not to. Leave it on (do not pass `--raw`) for real work.
- **Codex model flag.** Codex's `spawn_agent` tells the model not to set `model` unless the user asks. /subagent is that ask.
- **Codex approvals.** Headless Codex runs with `approval_policy="never"`, so a blocked command fails back to the model instead of hanging.
- **OpenCode plan agent.** `--agent plan` blocks edits but may still ask for some shell commands; headless runs cannot answer, so those calls fail.
- **Ollama models.** A tier model must be pulled (`ollama list`). `subagent doctor` warns when it is not. Large models take a while to load on the first call.
- **Local models drift.** In the 2026-10-12 skill-list test, OpenCode on local qwen3-coder replied with a generic greeting instead of the answer. The run still counted as ok, because `ok` only means the harness returned text. Give local models narrow tasks with the input attached, and check every answer.
- **Models miscount lines in attached files.** In 2026-10-15 QA, files attached without line numbers led gpt-6-luna to get every line number wrong (often off by one) and qwen3-coder to be off too, while the same model reading the file with its own tools was right. `--attach` now numbers each line of a text file by default.
- **DeepSeek harness.** Headless dsh has no read-only mode and no model flag, so the CLI refuses it without `--allow-unsandboxed`. Check which provider and model its profile uses (`agent-default-model` in `~/.dsh/settings.yaml`) before you send it anything private, and run `subagent doctor --probe --include-unsandboxed` to confirm the model is still live: free preview models on OpenRouter are retired without notice.
