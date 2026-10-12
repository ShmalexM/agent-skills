# Pack template

Replace every `<...>`. Keep the headings: `queue.mjs check` looks for them. Target 700 to 1,400 words plus diagrams, about a 10-minute read.

```markdown
---
topic: <Topic>
status: ready
added: <YYYY-MM-DD>
prepared: <YYYY-MM-DD>
read_time: <N> min
facts_as_of: <YYYY-MM-DD>
tags: [learn-later]
---

# <Topic>

> **In one line:** <what it is and the problem it solves, in one sentence>

**Why you saved this:** <the one-line why from the queue>

## The 5-minute version

<3 to 5 short paragraphs. Start with a concrete picture or analogy, and say where the analogy breaks. Then the core mechanism. Then why people care.>

## How it works

![<alt text that says what the diagram shows>](<slug>-how-it-works.svg)

<A numbered walk-through that matches the diagram's labels, 4 to 8 steps.>

## The landscape

<Optional: types, players or variants. A short table or a second diagram.>

## Key terms

- **<term>:** <one plain line>
<5 to 8 terms; use the same words as the diagrams.>

## Worked example

<One concrete pass with real or clearly made-up-but-realistic numbers, step by step. Say which it is.>

## Where it stands now (as of <YYYY-MM-DD>)

<Current facts that can change: size, rules, recent events. Each with a date and a source link.>

## Risks and misconceptions

- <the common wrong belief, and what is true>
- <the main risks, with one real example each if there is one>

## Check yourself

<details><summary>1. <question that tests the mechanism></summary>

<answer>

</details>

<details><summary>2. <question that asks the reader to predict what happens when something changes></summary>

<answer>

</details>

<details><summary>3. <question that connects to the user's world></summary>

<answer>

</details>

## Go deeper

- [<source title>](<url>): <why read it> (<date>)
<3 to 5 links, best first.>

## Next topics

- <related topic to queue next>

## What stuck

<Leave empty. The user fills this in after reading.>
```
