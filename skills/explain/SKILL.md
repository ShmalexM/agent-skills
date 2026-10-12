---
name: explain
description: Explain recent work in the current agent task when asked for a walkthrough or clarification. Use when the user types /explain or $explain, or asks "walk me through what you did", "why did you do X", or "explain this change".
---

# Explain

Connect the user's goal, the meaningful work, the evidence, and what remains. Treat `$explain` and `/explain` as requests about the current task unless the user names another subject.

Use the conversation and existing artifacts as evidence. Inspect relevant files, diffs, or results read-only when needed; do not rerun commands just to reconstruct activity. Distinguish what was proposed, attempted, completed, and verified.

Lead with what is now true and why it matters. Explain the decisions and causal flow at the depth the user needs. Include file links, command options, failures, tradeoffs, or side effects when they clarify the outcome. A short explanation does not need a section for every tool call or file.

Tie verification to what it proves: a passing component test does not establish an untested user flow. Call out material uncertainty and the next useful step if work remains. Use a compact diagram only when it makes a relationship easier to understand. Avoid canned conclusions and repeated status summaries.

Write the prose in plain style: follow the `explain-style` skill (80% of the way to ASD-STE100).
