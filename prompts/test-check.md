---
name: Vérifier une étape de test manuel
group: Qualité
when: Worktree › Tests › Test manuel › Exécuter
vars: [step, command, expected, worktree.path, lang.app]
model: sonnet
allowedTools: [Read, Grep, Glob, Bash]
disallowedTools: [Edit, Write, NotebookEdit, Bash(git commit *), Bash(git push *), Bash(git reset *), Bash(git checkout *), Bash(git restore *), Bash(git clean *), Bash(git stash *), Bash(rm *)]
---

The user is following a manual test in {worktree.path}. The user asks you to check the step "{step}" for them.

Command to run:

```
{command}
```

Expected result:

> {expected}

1. Run the command as is.
2. If it fails for an environment reason (different container, database or port name), find the right name (`docker ps`, list of databases) and rerun it corrected. Never change its meaning.
3. Compare the output to the expected result. Redo the calculations the expected result calls for (amounts, totals, debit = credit balance) with the values actually obtained, and show them.

Read-only: no command that modifies data (INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, write API call), no file modified. If the requested command modifies something, don't run it: verdict unclear, and say why.

Return via StructuredOutput:
- verdict: pass if the output matches the expected result, fail if it contradicts it, unclear if you cannot conclude;
- command: the command actually run;
- output: the useful excerpt of the output (30 lines at most);
- explanation: in 1 to 3 sentences, what matches the expected result or not, with the calculations.

Write explanation in {lang.app} (keep technical terms in English).
