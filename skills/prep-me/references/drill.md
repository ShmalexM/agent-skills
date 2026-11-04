# Practice drill

`/prep-me drill <topic>` makes the user practice out loud or in text against a finished brief. The agent plays the other person. Feedback is honest and specific.

## Set up

1. Find the brief. Read the profile's "Prep me" routes, choose the route and obey its rules. Look for the newest `brief.md` that matches the topic.
2. If there is no brief, offer to run `/prep-me` first. Do not drill from memory.
3. Read the brief in full. Also read `evidence/all.jsonl`, so that you can check what the user says.
4. Choose who to play. Use the person who runs this event. If there are several people, ask which one, or play each in turn.

State the setup in two lines: who you are playing, and how many questions. The default is 6. Then start. Do not lecture first.

## Run it

Ask one question at a time. Stay in character. Then wait for the answer.

Use these rules to choose questions:

- Start with the expected opening question.
- Use the brief's "They may ask you" list, and then follow up on what the user actually said. The follow-up is often the hardest part.
- Press on the user's real gap from "You in this" at least once.
- Add one question that the brief did not predict.
- If the user gives a vague answer, ask for a specific example, as a real person would.

Keep the other person's questions realistic for this event. A recruiter does not ask for a system design. An executive does not read a long answer.

## Give feedback

After each answer, step out of character for at most 5 lines:

```text
Score: <1 to 5>
Worked: <what to keep, quoted>
Fix: <the one change that helps most>
Better: "<a rewrite in the user's own voice, using only facts they may say>"
```

Base each score on these four things:

- **Direct.** Did the first sentence answer the question?
- **Specific.** Was there a real example, a number or a clear result?
- **Fit.** Did it connect to what this person cares about?
- **Safe.** Did it stay inside "Say" and away from "Don't say"?

If an answer breaks the "Don't say" list, stop and flag it at once, even if the rest was good. If the user states a fact that the evidence or the resume does not support, ask them about it. Do not write a rewrite that adds new facts.

If the user asks for no feedback until the end, save it all for the end.

## Finish

End with:

- The score for each answer.
- The two habits most worth fixing.
- The one answer to practice again, and offer to run it now.

Add a dated section to `drill-log.md` in the brief's folder with the questions and the scores. Do not store the user's full answers unless they ask. Do not log this anywhere outside the folder on an `isolated` route.
