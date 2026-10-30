---
name: Suivi de mes retours
group: Review
when: Worktree › Suivi des retours › Vérifier les correctifs
vars: [pr.number, pr.title, pr.author, ticket.id, diff.path, context, lang.app, lang.github]
model: sonnet
allowedTools: [Read, Grep, Glob, Bash(git diff *), Bash(git log *), Bash(git show *)]
---

I reviewed PR #{pr.number} ({pr.title}) by {pr.author}. Linked ticket: {ticket.id}. The author has updated the PR: for each of my threads still open, check what they did.

Your output is shown in Shipyard next to each thread, as a proposal (reply, resolve, or both) that I approve or reject. You post nothing yourself.

## Sources

- My open threads, with the author's replies: below.
- Full PR diff: {diff.path}. Current code: the current directory.
- The author's commits since my last review, if any: below. `git show <sha>` shows what each one changes.

## Method

For each thread:
1. Reread my comment: what exactly I asked for.
2. Open the current file at the targeted spot (the line may have moved: look for the relevant code, not just the line number) and check in the code what changed. A thread marked "line changed since" is not proof of a fix, and neither is a "done" reply: verify.
3. Read the author's reply, if there is one, and judge it against my request: is it consistent with what was done in the code (a "fixed" with no change is not)? Does their argument hold up given the code and the product?
4. Classify the thread:
   - `corrigé`: my request is in place in the code (or an equivalent alternative);
   - `partiel`: only part of it, or the fix introduces another problem;
   - `non-corrigé`: nothing changed, with no convincing reply;
   - `contesté`: the author did not change the code but argues. Say whether their argument is sound.
5. explanation: 1 to 3 factual sentences, with the current file and line. For a `contesté` thread, your opinion on the argument, and why.
6. The proposal, depending on what you found:
   - `corrigé`, and the author's reply is consistent: empty reply, resolve true (I resolve without replying);
   - `contesté`, and the author's argument is sound: short reply acknowledging it, resolve true;
   - `partiel`, `non-corrigé`, or `contesté` without a valid argument: reply stating precisely what is missing or why the argument does not hold, resolve false (the thread stays open for the author).
   reply is posted on GitHub: write it in {lang.github}, cordial and direct, 1 to 3 sentences, addressed to the author. No mention of Claude, an AI, or an assistant.

Copy the threadId provided for each thread exactly, and return one item per thread.

## Output

Call StructuredOutput once, at the very end:
- summary: 2 to 3 sentences, what is done, what remains, what is disputed;
- items: one per thread (threadId, status, explanation, reply, resolve).

Write summary and explanation in {lang.app} (keep technical terms in English); reply is in {lang.github}.

Do not modify any file in the repository.

{context}
