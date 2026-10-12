---
name: state-of-the-world
description: Take stock of a whole piece of work, not just the last step. Restates the user's goal and the problem in your own words, shows a rendered, color-coded flow diagram from where the work started to the goal (done, in progress, blocked, not started), then explains what exists, why it went that way, and what still has to happen. Use when the user types /state-of-the-world or asks "where are we at", "recap this", "what's left", or "state of the world".
---

# State of the World

`/explain` looks back at what was just done. This skill looks at the **whole piece of work**, from the first ask to the finished goal, and works out what still has to happen to get there. It uses the same evidence discipline as `/explain`, applied to the full arc instead of the last step.

The subject is the work this thread is about, not only this conversation. If the work began before this session (an earlier session, a context summary, a memory file, a handoff note, open PRs), include that history. If the user names another subject (a project, a PR, an earlier session), use that instead.

## 1. Gather the evidence

- **Find the full scope.** Reread the whole thread, including any context summary. Then follow what it points to: relevant memory files, handoff or plan `.md` files, the repo's branches and PRs, inbox notes. The start of the work is the original problem, not the first message of this session.
- **Treat the conversation and existing artifacts as the evidence.** Inspect files, diffs, PR states and results read-only where they settle a status you would otherwise guess (`git status`, `git log`, `gh pr view`, whether a file exists). Do not rerun builds or tests to reconstruct what happened. Report the last known result and when it was.
- **Keep four states apart for every item:** proposed, attempted, completed, verified. Only verified work is green. Code that is written but untested is in progress. Work that "should work" but was never seen working is unverified. A step that waits on the user, a reviewer or access is blocked, and you say who or what it waits on.
- **Tie each verification to what it proves.** A passing unit test does not prove an untested user flow. A green CI run on one branch says nothing about the branch that has not been rebased. When the proof is narrower than the claim, the item stays amber.

## 2. Restate the goal and the problem (goes first)

In your own words, not the user's:

- **What I think you're trying to achieve.** The end outcome, in one to three sentences. Aim at the real goal behind the work. "Get PR #X merged" is a step. "Stop fresh Helm installs from silently losing tables" is the goal.
- **The problem underneath.** What is broken, missing or painful, and why it matters to the user and to the people they serve.
- **What I'm unsure about.** Any part of the intent you inferred rather than heard. Put it as a short question the user can correct.

## 3. Show the diagram

Render the diagram so the user actually sees it. A Mermaid code block shown as text does not count.

Use the first route that this harness has:

1. **Inline widget** (preferred; Claude Code desktop): call `mcp__visualize__read_me` with the `diagram` module silently, then `mcp__visualize__show_widget` with an SVG flow chart.
2. **Published page** (Claude Code: the `Artifact` tool): write one HTML page with inline SVG to the scratch folder and publish it. Load `artifact-design` first, as that tool requires. Give the link.
3. **File** (any harness): write one self-contained `.html` (inline SVG) or `.svg` file to the scratch folder. Show it with the harness's file tool if it has one (Claude Code: `SendUserFile` with `display: "render"`), and always give the absolute path so the user can open it.

What goes in the diagram:

- A flow from **Start** (the original problem) through the steps and branches to **Goal**, left to right, or top to bottom if it is long. Include the steps still needed to reach the goal, not just those already taken.
- One node per meaningful piece of work, labelled in a few plain words, with a short reference where it helps (PR number, file, command).
- Color every node by status, the same way every time:
  - **Green**: done and verified
  - **Yellow / amber**: in progress, or done but unverified
  - **Red**: blocked or failing, with a short "why" under the label
  - **Gray, dashed outline**: not started
  - **Blue outline** (optional): a decision point or open question
- Include a legend, and mark "you are here" at the current frontier.
- Draw dependencies as arrows. If order matters (A must merge before B), the arrows show it. Abandoned approaches can appear as a faded side branch if they explain the current route.
- Keep it to about 15 nodes. Group minor steps. Make it readable in light and dark themes (use the widget's CSS variables, or colors that keep contrast on both).

## 4. The written summary (after the diagram)

Lead with what is now true and why it matters, at the depth the user needs. Keep it scannable:

- **Where we started.** The original problem and the starting state, in two or three lines.
- **What exists now.** Each completed item with its evidence (file link, PR, command result), and a note on anything unverified.
- **How we got here.** Only the decisions and turns that shaped the path: why this approach, what failed and changed direction, the tradeoffs accepted, the side effects created. Skip anything that doesn't help explain the current state.
- **What's left.** An ordered list of what must still happen to reach the goal, most useful next action first. For each blocked item, name who or what unblocks it.
- **Risks and loose ends** (only if there are any): material uncertainty, stale assumptions, and things dropped along the way.

## Rules

- Write all prose in plain style: follow the `explain-style` skill (80% of the way to ASD-STE100).
- Report only what the evidence supports. Never promote "proposed" to "done". If a status is unclear, color it amber and say why.
- This skill takes stock. It does not do the remaining work. End with the top next step in one line.
- Don't list every tool call or file, and don't repeat the transcript. Avoid canned conclusions and restating the same status twice. The user wants the picture, not the minutes.
