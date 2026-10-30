---
name: Analyser un contrôle
group: Qualité
when: Worktree › Contrôles › Analyser
vars: [pr.number, pr.title, pr.base, worktree.path, report.title, report.body, report.command, report.output, lang.app]
model: sonnet
allowedTools: [Read, Grep, Glob, Bash(git diff *), Bash(git log *), Bash(git show *), Bash(git merge-base *), Bash(bun *), Bash(bunx *), Bash(pnpm *), Bash(npm run *), Bash(yarn *), Bash(ls *)]
disallowedTools: [Edit, Write, NotebookEdit, Bash(git commit *), Bash(git push *), Bash(git reset *), Bash(git checkout *), Bash(git restore *), Bash(git clean *), Bash(git stash *)]
---

An automated check commented on PR #{pr.number} ({pr.title}), in the worktree {worktree.path}. You triage what it reports so that the user can choose what to fix. Do not modify any file.

## Report posted on the PR: {report.title}

{report.body}

## Detailed report, run locally

Command: {report.command}

{report.output}

## What blocks the PR

Only the Oxlint findings on lines added by the PR ("Oxlint (added lines)" section, "Findings on added lines: N") block the PR. With 0 findings there, the PR passes. Everything else (Fallow complexity, dead code, duplication, suppressions already justified…) is advisory: list it, but it never blocks.

## Method

1. If the detailed report is missing or failed (missing dependencies, tool not installed), install the dependencies with the repo's package manager and rerun the command. If nothing works, work from the posted report and say what blocked in summary.
2. For each reported problem, read the relevant code and the PR diff (`git diff $(git merge-base origin/{pr.base} HEAD)`, base `{pr.base}`):
   - introduced: true if the PR introduced it (line added or modified, function made more complex by the PR), false if it already existed;
   - blocking: true only for an Oxlint finding on a line added by the PR, false for everything else;
   - verdict:
     - fix: can be fixed in the branch code, without a refactor that goes beyond the PR;
     - ignore: false positive, deliberate project convention, or old problem outside the PR's scope;
     - if the rule itself provides for a human-approved exception (comment `oxlint-disable-next-line … -- <pourquoi>`) and the case really qualifies: verdict fix, with the exact comment and its justification in fix, so that the user decides by checking it or not;
     - manual: the fix is outside the repo (secret or variable to create on the deployed environment, service configuration);
   - reason: why this verdict, in one sentence;
   - fix: the concrete fix (file, what changes), or for manual the action to take and where.
3. Group identical problems (same rule, same file) into a single item, but never group a blocking problem with an advisory one. List the blocking items first. Beyond 25 items, keep every blocking item and the most important advisory ones, and say how many you left out in summary.

StructuredOutput:
- summary: 1 to 3 sentences. Start with whether the PR is blocked (how many Oxlint findings on added lines), then what else deserves fixing.
- items: id (short and stable, e.g. `oxlint-no-unused-vars-foo.ts`), source (tool or report section), file (relative path or null), line (or null), problem, introduced, blocking, verdict, reason, fix.

Write all text fields of your output in {lang.app} (keep technical terms in English).
