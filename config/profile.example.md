# User profile (example)

Copy this file to `~/.config/agent-skills/profile.md` and fill it in. Skills read it when it exists. It stays on your machine and never goes in the repo. Delete any section you do not need; every section is optional.

## About me

- Name: <how agents should refer to you>
- Role: <for example "backend engineer"; explain skills pitch to this level>

## My projects

Running examples for explanations, and context for reviews.

- <project>: <one line on what it is> (`~/code/<project>`)

## Before reviews and publication

- Before a security review or codebase tour, run: `<command, for example a repo classification script>`
- Before any push or PR: <your rule, for example "ask me first" or "PRs only, never push to main">
- Private reports go to: `<folder, for example ~/security-reviews>`

## Data rules

- Confidential code may go to: <providers, for example "Claude and Codex, or local models">
- Never send to: <providers or models>
- Workers must not: <anything extra, for example "write to my notes vault">

## Skills I use with these

- Learning tracker: <skill name, if you have one>

## GitHub defaults

- Personal account: <user>; organizations: <orgs and their rules>
- Commit author email: <email>
- License for new public repos: <for example MIT>
- Default baseline for `github-setup`: <personal-public | personal-private | team>

## Cloud defaults

- Provider and CLI configuration: <for example "Google Cloud, gcloud configuration 'personal'">
- Organization or folder for new projects: <id>
- Billing account: <id; agents must still ask before linking it>
- Default region and labels: <region>, <labels>
- Budget alert defaults: <amount and thresholds>

## Machine notes

- <anything unusual about this machine that changes how commands must run>
