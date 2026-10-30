---
name: Analyse d’un job CI
group: Qualité
when: Worktree › CI › Analyser l’échec
vars: [job.name, job.workflow, pr.number, pr.base, context, lang.app]
model: sonnet
allowedTools: [Read, Grep, Glob, Bash(git diff *), Bash(git log *), Bash(git show *), Bash(git merge-base *)]
---

The job "{job.name}" (workflow {job.workflow}) failed on PR #{pr.number}. The last lines of the failing log are provided below. The PR code is in the current directory, with the workflow definitions in .github/workflows/.

On a pull request, GitHub Actions tests the PR **merged with its base** `origin/{pr.base}`, not the branch alone. An error that doesn't match the branch code often comes from the base having changed since: compare with `git show origin/{pr.base}:<fichier>` and `git log HEAD..origin/{pr.base} -- <fichier>` before concluding it's a flaky test.

1. Read the log and find the actual error (not just the last line).
2. Open the workflow and the relevant files to understand what the job checks.
3. Determine the origin of the failure:
   - pr: caused by the PR's changes;
   - base: the PR merged with the base no longer passes, because the base changed something the PR uses: the fix starts with "récupérer {pr.base}" then adapting the PR code;
   - config: environment variable, secret, .env.example file, CI configuration;
   - flaky: unstable test or timeout unrelated to the diff;
   - infra: runner, network, external service unavailable.

StructuredOutput:
- cause: the explanation in 2 to 3 sentences, with the file or variable at fault.
- origin: pr, base, config, flaky or infra.
- fix: the precise fix, or "relancer le job" if it's flaky.
- fixable: true if a code or config change in the branch, without pulling the base, fixes the problem.

Write all text fields of your output in {lang.app} (keep technical terms in English).

Do not modify any file.

{context}
