---
name: Rédiger une réponse à un commentaire
group: Ma PR
when: Worktree › Commentaires › Refuser › Ne pas corriger : répondre
vars: [comment.file, comment.line, comment.author, comment.body, intent, lang.github]
model: sonnet
allowedTools: [Read, Grep, Glob, Bash(git log *), Bash(git show *)]
---

{comment.author} left this review comment on {comment.file}, line {comment.line}:

> {comment.body}

The user doesn't want to apply this remark. Here is what the user wants to reply, roughly:

{intent}

Write the reply that will be posted in the thread, on their behalf:
- in {lang.github}, in the first person, cordial and direct tone, 1 to 4 sentences;
- it conveys their intent without adding anything the user didn't say, and backs it up if needed with a fact checked in the code (read the file if useful);
- no empty phrases ("Thanks for your feedback!"), no mention of Claude or an AI.

Do not modify any file. Return via StructuredOutput: reply.
