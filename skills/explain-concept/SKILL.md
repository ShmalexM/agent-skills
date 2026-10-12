---
name: explain-concept
description: Teach one concept (an algorithm, protocol, math idea, ML technique, security mechanism, system design pattern) as an interactive HTML page the user can play with, with an intuition, a diagram, a live widget, a worked example and quick self-check questions. Use when the user types /explain-concept or asks "explain X to me", "help me understand X", "teach me X", "make me an explainer for X". Not for recent work in this task (use /explain) or for a whole codebase (use /explain-codebase).
---

# Explain a concept

Make one throwaway, interactive web page that teaches one idea well. The page is the answer. Chat gets one or two lines and the link.

## 1. Pin the target (no questions unless it is ambiguous)

- **The concept.** Name it in one line. If the ask is broad ("explain transformers"), pick the one idea under it that unlocks the rest (attention) and say so.
- **The reader.** Default: the user. Read the user profile (`~/.config/agent-skills/profile.md`) if it exists; without one, assume a strong engineer who is not a specialist in this topic. Adjust if the user names another audience (a customer, a new hire, an exec).
- **The anchor.** If the concept shows up in the user's own work (the profile may list their projects), use that as the running example. A concept tied to the reader's own system sticks better than a textbook one.
- **The format rung.** Pick the lowest that works and say which:
  - one-paragraph answer → reply in chat in plain style, no page;
  - structure or flow → a diagram (inline widget, or a page with one SVG);
  - something to explore or tune → **interactive page (the default for this skill)**.

## 2. Get it right before making it pretty

- Work out the explanation first, then design. A beautiful wrong page is worse than a plain right one.
- For anything factual, current or version-specific, check sources (docs, papers, the code itself). Cite them on the page with links.
- If the widget computes something (a hash, a gradient step, a scheduling order), run the core function once on a sample input before publishing. The numbers the reader sees must be real.
- Mark simplifications on the page ("This ignores X; that matters when Y").

## 3. Page structure

Load `explain-style` for all prose on the page. If you will publish with the `Artifact` tool, load `artifact-design` before writing (that tool requires it). Then, in this order:

1. **One-sentence answer.** What the concept is and what problem it solves, at the very top.
2. **Intuition.** A concrete analogy or picture, 3–5 sentences. Say where the analogy breaks.
3. **The diagram.** One SVG showing the moving parts and how data or control flows between them. Label with the same terms as the text.
4. **The live widget (the centerpiece).** One thing the reader changes to see the idea work: a slider, a step-through with Next/Back, an editable input, a toggle between two cases. It opens in a meaningful state, not empty. Show the effect next to the control.
5. **Worked example.** One full pass with real values, step by step.
6. **Where it shows up / why it matters.** Tie back to the anchor (the user's system) if there is one. Name the usual failure modes and gotchas.
7. **Check yourself.** Three short questions with click-to-reveal answers. At least one asks the reader to predict what the widget will do.
8. **Go deeper.** 2–4 links to the best sources, plus the related concepts to learn next.

Keep the page to what fits on about three screens before the widget. Cut anything the reader does not need to reach the "aha".

## 4. Publish and hand over

- Publish as a private Artifact where the harness has one (Claude Code: the `Artifact` tool, `icon`: "lightbulb" or similar). Otherwise write one self-contained HTML file (inline CSS, JS and SVG; no build step) to a scratch folder and give its absolute path. Title: the concept's name, e.g. "Raft Leader Election".
- Reply with the link and one line: what the widget lets you try first.
- If the user has a learning-tracker skill (the profile may name it), offer to log the concept there (do not log without a yes).

## Rules

- One concept per page. Offer a second page instead of growing this one.
- Never invent numbers, benchmarks or citations. If unsure, say so on the page.
- No secrets, customer data or private code on a page about a public concept. A page that uses the user's private code as the anchor stays private; say that when you give the link.
