# Security policy

## Reporting a vulnerability

Please report security problems privately. Do not open a public issue.

Use the **Report a vulnerability** button on this repository's **Security** tab. This opens a private advisory that only the maintainer can see. Include:

- what you found and where (file and line, or the command);
- how to reproduce it;
- what an attacker could do with it.

This is a personal project that is maintained in spare time. You will get a reply as soon as possible. Please give a reasonable time for a fix before you share details publicly.

## Supported versions

Only the latest commit on `main` is supported. There are no release branches.

## Scope

In scope:

- the `subagent` CLI (`bin/`, `lib/`);
- the scripts bundled with skills (`skills/*/scripts/`);
- `install.sh`;
- skill instructions that could lead an agent to leak data, run unsafe commands, or skip a user approval.

Out of scope:

- the agent harnesses themselves (Claude Code, Codex, OpenCode, the DeepSeek harness) and the models behind them. Report those to their vendors;
- your own local configuration in `~/.config/agent-skills/`.
