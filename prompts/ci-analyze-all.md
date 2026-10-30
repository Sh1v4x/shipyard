---
name: Analyse de tous les jobs CI en échec
group: Qualité
when: Worktree › CI › Analyser tous les échecs
vars: [pr.number, pr.base, behind, external, context, lang.app]
model: sonnet
allowedTools: [Read, Grep, Glob, Bash(git diff *), Bash(git log *), Bash(git show *), Bash(git merge-base *)]
---

Several CI jobs failed on PR #{pr.number}. Their logs (last lines) are provided below, one per job. The PR code is in the current directory, with the workflow definitions in .github/workflows/.

Important: on a pull request, GitHub Actions tests the PR **merged with its base** `origin/{pr.base}`, not the branch alone. {behind} An error that doesn't match the branch code (different signature, type, file, import) often comes from the base having changed since: compare with `git show origin/{pr.base}:<fichier>` and `git log HEAD..origin/{pr.base} -- <fichier>` before concluding it's a flaky test.

{external}

For each job:
1. Read its log and find the actual error (not just the last line). Without a log, read the annotations: a job that never started for an account reason (payment, spending limit) is infra.
2. Open the workflow and the relevant files to understand what the job checks.
3. Determine the origin:
   - pr: caused by the PR's changes;
   - base: the PR merged with the base no longer passes, because the base changed something the PR uses; the fix starts with "récupérer {pr.base}" then adapting the PR code (say exactly what);
   - config: environment variable, secret, .env.example, CI configuration;
   - flaky: unstable test or timeout unrelated to the diff or the base;
   - infra: runner, network, external service, GitHub account.
4. Several jobs failing for the same cause: say so in summary and give each the same diagnosis.

StructuredOutput:
- summary: 1 to 3 sentences: the causes, what they have in common, and in what order to act.
- jobs: one per job, with jobId and name copied as is:
  - cause: the explanation in 2 to 3 sentences, with the file or variable at fault;
  - origin: pr, base, config, flaky or infra;
  - fix: the precise fix, "relancer le job", or "récupérer {pr.base}, puis …";
  - fixable: true if a code or config change in the branch, without pulling the base, fixes the problem.

Write all text fields of your output in {lang.app} (keep technical terms in English).

Do not modify any file.

{context}
