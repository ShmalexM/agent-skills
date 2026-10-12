---
name: explain-style
description: Plain-writing rules ("80% of the way to ASD-STE100", Simplified Technical English) for explanations, walkthroughs and docs. Other explain skills load this file for their prose. Use directly when the user asks to rewrite text "in plain style", "in STE", "simpler", or "more readable".
---

# Explain style: 80% STE

ASD-STE100 (Simplified Technical English) is a controlled language from aerospace maintenance manuals. Its rules make text fast to read and hard to misread. We use about 80% of it: the rules below, without the strict approved-word dictionary.

## Sentences

- One idea per sentence. One instruction per sentence.
- Procedure sentences (do this, then that): 20 words or fewer.
- Description sentences (what something is or does): 25 words or fewer.
- Paragraphs: 6 sentences or fewer. Start with the main point.
- Use the active voice. Say who or what does the action: "The worker writes the row", not "The row is written".
- Write instructions in the imperative: "Run `make test`", not "You should run `make test`".
- Use simple tenses (present, past, future). Avoid "would have been", "is being".
- Keep "the", "a" and "this". Do not drop them to save words.

## Words

- Use one term for one thing, every time. If the code calls it a `finding`, do not also call it an "alert", "detection" or "event".
- Define each technical term once, at first use, in a few plain words.
- Use common, short words: "use", not "utilize"; "start", not "initiate"; "about", not "approximately".
- Give each word one meaning. Do not use "run" for "execute" in one place and for "a pipeline run" in another without care.
- No noun stacks longer than three words. "Case template seed migration step" becomes "the step that seeds case templates".
- Technical names (functions, files, products, flags) are allowed as they are. Put code names in backticks.

## What we relax (the other 20%)

- No fixed approved-word list. Domain words are fine when defined.
- Short lists, tables and fragments are fine where they scan better than sentences.
- A reason clause ("because …", "so that …") is fine; it is often the most useful part.
- Tone can be natural. Do not make it robotic.

## Check before you send

- Can a reader who is new to the subject follow each sentence on its own?
- Is the most important fact in the first sentence?
- Did any one term change its name halfway through?
- Is there a sentence over 25 words? Split it.
