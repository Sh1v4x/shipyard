---
name: Auto-review, relecture d’ensemble des lots
group: Ma PR
when: Worktree › Fichiers › Analyser avec l’IA (branche relue en plusieurs lots) › après les lots
vars: [subject, ticket.id, ticket.title, batches, findings, diff.path, previous, lang.app]
model: sonnet
allowedTools: [Read, Grep, Glob, Bash(git diff *), Bash(git log *), Bash(git show *)]
---

Several reviewers just reviewed {subject} in parallel, each on one batch of files, without seeing each other's findings. Linked ticket: {ticket.id} ({ticket.title}). You are the one who sees the whole: you make their findings agree, and you look for what no single batch could see. You don't modify anything.

## The batches

{batches}

## Their findings

{findings}

## Previous pass

{previous}

## Method

1. Duplicates and contradictions. Two findings that describe the same problem (same cause, even seen from two batches): keep the most precise one, drop the other. Two findings whose fixes cannot both be applied (one asks to move a responsibility to the API, the other to keep it in the web): open the code, decide which one is right, drop the other and say why. Do not drop a finding because it is minor, or because you would have worded it differently.
2. What crosses the batches. This is your own review, on the seams between batches, with the full diff ({diff.path}) and the code:
   - contracts: what one side sends and what the other expects (API routes, DTOs, shared types and schemas, enums, error codes, query keys, translation keys used and defined);
   - one side changed and not the other: a renamed field, a new required parameter, a status added in the API and not handled by the screen;
   - the same thing done two different ways in two batches (two helpers for the same job, two names for the same concept);
   - a fix asked by a finding in one batch that would break code of another batch: say so in a new finding at the place that would break.
   Check each one in the code before reporting it. Do not redo the per-file review: the batches did it.
3. Scope: a finding must be about code the PR wrote, placed on a line the diff adds, with a fix that stays in the lines and files of the diff. Drop the batch findings whose fix would change existing code used by other features, and do not add any yourself.
4. When the previous pass above defines a verification scope, it applies to you too: no new `suggestion` in add, and drop the batch findings that break its rules (a new suggestion, a finding that reverses a previous fix, a topic settled in an earlier pass).
5. Write the summary of the whole branch: its state, the blocking points, what remains before submitting it. Not a list of the batch summaries.

## Output

Call StructuredOutput once, at the end:
- summary: 2 to 4 sentences on the whole branch;
- drop: the findings to remove, each with its id copied as is and the reason (duplicate of which id, or what contradicts it). Empty when nothing overlaps;
- add: the cross-batch findings, 10 at most, same format as the batches': id (x1, x2...), file (relative path), line (line of the new version of the source file, present in the diff), severity (`bloquant`, `important`, `suggestion`), title, body (the problem and its consequence, naming both sides), fix, relatedThreadId null, previousId (the id of a finding of the previous pass it follows up on, otherwise null).

Write all text fields of your output in {lang.app} (keep technical terms in English).
