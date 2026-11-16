---
name: Corriger un contrôle
group: Qualité
when: Worktree › Contrôles › Corriger la sélection
vars: [report.title, report.command, items, pr.base, rules, lang.app]
permissionMode: acceptEdits
allowedTools: [Read, Grep, Glob, WebSearch, WebFetch, Edit, Write, TodoWrite, Bash(git diff *), Bash(git status *), Bash(git merge-base *), Bash(npm run *), Bash(npm install*), Bash(npm i *), Bash(npm ci*), Bash(npm uninstall *), Bash(npm ls*), Bash(npm -v), Bash(pnpm *), Bash(bun *), Bash(bunx *), Bash(npx *), Bash(yarn *)]
disallowedTools: [Bash(git commit *), Bash(git push *), Bash(git add *), Bash(git reset *), Bash(git stash *), Bash(git checkout *), Bash(git restore *), Bash(git clean *)]
---

The check "{report.title}" reported problems on this PR. The user chose the ones to fix:

{items}

Rules:
- Read each file before modifying it, with what depends on the spot (callers, types, tests). Minimal fix for each listed problem, nothing else: no refactoring around it, no unlisted problem.
- Before writing, understand what the rule behind each problem wants (its message, its source or documentation in the repo, the official documentation online of the tool or library when needed) and how the project already writes the same case elsewhere. The listed fix is the plan; you are responsible for the result being clean. Making the tool silent with the same logic hidden behind a wrapper, a helper, an intermediate variable, a cast or a re-validation is not a fix.
- Fix by rewriting the code so that the rule is satisfied. Never disable, suppress or loosen a rule to silence the check (`oxlint-disable`, `eslint-disable`, `biome-ignore`, `@ts-expect-error`, `@ts-ignore`, an `any`, an entry in the tool's config), whatever the justification you could write next to it.
- The only exception: a problem listed above with "Exception approved by the user". For that problem only, add exactly the approved exception, with the justification required by the rule (`-- <pourquoi>`). A problem listed with "Fix" never gets one, even if its text mentions a disable comment.
- If a listed fix turns out not to work (the rewrite breaks the behavior, the types or a test, or the rule still fires), leave that problem unfixed, revert what you tried for it, and explain in summary what you found, what you tried and what you would do instead (including the exception you would ask for). The user decides and reruns the analysis.
- Excessive complexity is fixed by extracting a well-named function, in the same file unless the project does otherwise.
- The code you write follows the team dev rules below, like any other code of the PR. Surgical does not mean dirty: a fix that satisfies the check but breaks one of these rules is not acceptable. If the fix you were given cannot be applied without breaking one, apply the clean variant and say so in summary; if there is none, leave that problem unfixed and explain why.
- Then verify: rerun the check's command if it exists ({report.command}), then the repo's lint and typecheck on the touched files. Fix what you broke.

### Team dev rules

{rules}

StructuredOutput:
- changed: true if files were modified.
- commitTitle: a single commit title in English for the whole set, conventional commits format (`refactor(<scope>): <description>` or `fix(<scope>): <description>`), title only, no mention of AI.
- summary: what was done, in one or two sentences, and what couldn't be.

Write all text fields of your output in {lang.app} (keep technical terms in English), except commitTitle, which stays in English.
