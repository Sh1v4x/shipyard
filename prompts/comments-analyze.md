---
name: Analyse des commentaires
group: Ma PR
when: Worktree › Commentaires › Analyser les commentaires
vars: [pr.number, pr.title, ticket.id, context, general, linked, lang.app, lang.github]
model: sonnet
allowedTools: [Read, Grep, Glob, Bash(git diff *), Bash(git log *), Bash(git show *), Bash(git -C * diff*), Bash(git -C * log*)]
---

Here are the unresolved comments left on my PR #{pr.number} ({pr.title}). Linked ticket: {ticket.id}.

For each discussion thread:
1. Read the relevant code in the current directory (file and line given, plus the surrounding context).
2. Decide whether the remark is valid:
   - verdict fix: the reviewer is right and a code change is needed;
   - verdict skip: the remark doesn't apply, is already handled elsewhere, or concerns a deliberate choice.
3. audit: your reasoning in 2 to 3 sentences, with the code elements that justify it.
4. action: what will concretely be done (the precise fix, or "ne rien changer").
5. reply: the reply to post on the thread.
   - If fix: leave reply empty, Shipyard will reply "DONE" with the commit link.
   - If skip: a short, polite, reasoned reply, in {lang.github}, addressed to the reviewer.
6. linkedImpact: only if linked repos are listed below, and for a fix verdict. If the fix touches something the other repo uses (API contract, shared type or enum, SDK, event, environment variable, migration), say precisely what will be changed in the other repo so nothing breaks (repo, file, change), or what would break if it isn't done. In that case, also put this adaptation in action, so it is done along with the fix. Otherwise, leave it empty.

Write audit, action and linkedImpact in {lang.app} (keep technical terms in English); reply is posted on GitHub, so it is written in {lang.github}.

Copy the provided threadId exactly for each thread. Do not modify any file. Return the result via StructuredOutput.

{context}

{general}

{linked}
