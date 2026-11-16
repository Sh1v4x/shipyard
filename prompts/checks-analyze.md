---
name: Analyser un contrôle
group: Qualité
when: Worktree › Contrôles › Analyser
vars: [pr.number, pr.title, pr.base, worktree.path, report.title, report.body, report.command, report.output, rules, lang.app]
model: sonnet
allowedTools: [Read, Grep, Glob, WebSearch, WebFetch, Bash(git diff *), Bash(git log *), Bash(git show *), Bash(git merge-base *), Bash(bun *), Bash(bunx *), Bash(pnpm *), Bash(npm run *), Bash(npm install*), Bash(npm i *), Bash(npm ci*), Bash(npm uninstall *), Bash(npm ls*), Bash(npm -v), Bash(yarn *), Bash(ls *)]
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
2. Understand each rule that fires before judging a single finding. A finding is the symptom; the rule tells you what the code should have been:
   - read the rule's message, then its source or documentation in the repo (linter config, custom plugin folder such as `tools/oxlint/`, CLAUDE.md, docs): what it forbids, why the team added it, what it expects instead, and the examples of valid code it gives;
   - search the codebase (Grep) for how the same situation is already written in code the rule accepts: that is the project's way, reuse it;
   - when the clean way depends on a library, a framework or a tool (schema validation, typed errors, HTTP client, router, form library…), read its official documentation online (WebSearch, WebFetch) to find the construct made for the case, instead of hand-rolling one.
3. For each reported problem, read the relevant code (the function, its callers, the types that flow into it) and the PR diff (`git diff $(git merge-base origin/{pr.base} HEAD)`, base `{pr.base}`):
   - introduced: true if the PR introduced it (line added or modified, function made more complex by the PR), false if it already existed;
   - blocking: true only for an Oxlint finding on a line added by the PR, false for everything else;
   - verdict:
     - fix: can be fixed by rewriting the branch code so that the rule is satisfied, without a refactor that goes beyond the PR. A fix never disables, suppresses or loosens the rule;
     - ignore: deliberate project convention, old problem outside the PR's scope, or advisory finding not worth a change. Never for a blocking problem: ignoring it leaves the PR blocked;
     - ask: you see no way of writing the code that satisfies the rule without breaking the behavior, or you are unsure the finding is legitimate (possible false positive). The only thing left would be an exception (`oxlint-disable-next-line … -- <pourquoi>`, `eslint-disable`, `biome-ignore`, `@ts-expect-error`, an entry in the tool's config). You never decide that yourself: the user does;
     - manual: the fix is outside the repo (secret or variable to create on the deployed environment, service configuration);
   - reason: why this verdict, in one sentence. For ask: what you found in the code, the rewrites you considered and why each one fails, in a few sentences, so that the user can judge without opening the file;
   - fix: the concrete fix (file, what changes), for manual the action to take and where, or for ask the exact exception you would add (comment and its justification).
4. A fix removes the cause, it does not move the symptom. For each fix verdict, say in fix which construct replaces which, precisely enough to be applied as is, and make sure that:
   - it is what the rule wants: the value gets its real type at the boundary where it enters (typed client, schema already used by the project, type guard), the missing case is handled where it matters, the unknown parameter gets a precise type. Not the same logic hidden from the tool behind a wrapper, a helper, an intermediate variable, a cast, a re-validation or another indirection;
   - it is proportionate: the smallest change that makes the code right. Ten findings do not justify new machinery; if several findings share one cause (the same untyped value read in several places), fix that cause once and say so;
   - it follows the team dev rules below, like any code of the PR, and keeps the behavior, the callers and the tests working;
   - it is the code a senior developer of this project would have written in the first place. If you would not defend it in review, it is not the fix.
   If the only clean fix is a refactor that goes beyond the PR, say so in reason and describe it in fix: the user decides, do not shrink it into a workaround.
5. An exception is the last resort, not a shortcut. Before choosing ask, actually look for the rewrite the rule wants: read what the rule is for (its source or documentation in the repo, e.g. the linter's plugin folder or config), then try a type guard or a schema instead of a runtime type test, a precise type instead of `unknown`, an explicit handling of the missing value instead of a silent fallback, and so on. An exception is acceptable only when no clean rewrite exists at all. "The value comes from an external API", "it is a helper", "the neighboring code does the same" are not reasons for an exception: they are the cases these rules exist for. Several ask items in one analysis means you gave up too early: go back over each of them. When in doubt between fix and ask, describe the rewrite in fix and say what worries you in reason.
6. Group identical problems (same rule, same file) into a single item, but never group a blocking problem with an advisory one. List the blocking items first. Beyond 25 items, keep every blocking item and the most important advisory ones, and say how many you left out in summary.

### Team dev rules

They apply to the fixes you propose. A rule only applies to the areas it names.

{rules}

StructuredOutput:
- summary: 1 to 3 sentences. Start with whether the PR is blocked (how many Oxlint findings on added lines), then what else deserves fixing, then how many problems await the user's decision (ask), if any.
- items: id (short and stable, e.g. `oxlint-no-unused-vars-foo.ts`), source (tool or report section), file (relative path or null), line (or null), problem, introduced, blocking, verdict, reason, fix.

Write all text fields of your output in {lang.app} (keep technical terms in English).
