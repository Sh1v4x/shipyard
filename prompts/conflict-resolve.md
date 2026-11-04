---
name: Résoudre les conflits
group: Ma PR
when: Worktree › Conflits › Résoudre avec l’IA (puis Répondre et continuer) · Worktree › Récupérer develop (mode automatique)
vars: [worktree.path, worktree.branch, base, pr.number, pr.title, conflicted, ours, theirs, answers, rules, lang.app]
permissionMode: acceptEdits
allowedTools: [Read, Grep, Glob, Edit, Write, TodoWrite, Agent, Bash(git diff *), Bash(git log *), Bash(git show *), Bash(git status *), Bash(git merge-base *), Bash(git ls-files *), Bash(pnpm *), Bash(npm run *), Bash(npm install*), Bash(npm i *), Bash(npm ci*), Bash(npm uninstall *), Bash(npm ls*), Bash(npm -v), Bash(npx *), Bash(bun *), Bash(bunx *), Bash(yarn *)]
disallowedTools: [Bash(git add *), Bash(git commit *), Bash(git push *), Bash(git merge *), Bash(git rebase *), Bash(git reset *), Bash(git checkout *), Bash(git restore *), Bash(git stash *), Bash(git clean *), Bash(git rm *)]
---

You are resolving the merge conflicts of PR #{pr.number} ({pr.title}), in the worktree {worktree.path}, branch {worktree.branch}.

The base branch `origin/{base}` has just been merged into the branch, without a commit. The files below contain conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`). The "ours" side (HEAD): the PR's work. The "theirs" side (`origin/{base}`): what has been merged into the base since.

Conflicted files:
{conflicted}

PR commits since the common ancestor (ours):
{ours}

Commits that landed in the base since (theirs):
{theirs}

{answers}

## Method

For each conflicted file:
1. Understand the intent of both sides before touching the file:
   - base side: `git log -p origin/{base} --not HEAD -- <fichier>` (and `git show` on the useful commits): what changed and why;
   - PR side: `git log -p HEAD --not origin/{base} -- <fichier>`: what the PR is trying to do;
   - read the whole file, and what depends on it (callers, types, imports, tests) with Grep.
2. Distinguish the cases:
   - independent changes (two different areas, imports, additions to the same list): keep both;
   - the base renamed, moved or refactored what the PR modifies: reapply the PR's intent on the base's new version, without reintroducing the old code;
   - both sides do the same thing differently: keep the base version, then add only what the PR brings on top;
   - generated files or lockfiles (`pnpm-lock.yaml`...): take the base version, then regenerate if the PR had added a dependency (`pnpm install` updates the lockfile), otherwise keep the base as is.
3. Check what could break: a signature, type or name changed by the base and still used by the PR elsewhere (even in files without conflicts), a removed import, a duplicated or misordered database migration, a renamed i18n key. Fix those files too.
4. The resolved code follows the team's dev rules (below) like any PR code.

## Doubt

Don't decide at random. If a conflict touches business behavior and the two versions are incompatible, or if you don't know which of the two intents should win:
- leave that conflict in place in the file, markers included;
- ask a question in questions: the file, what each side does in one sentence, and 2 to 4 concrete options (e.g. "Garder le calcul de la base et ajouter le cas de la PR", "Garder la version de la PR").
Resolve everything else normally: a question only blocks its own conflict.

When the user's answers are provided above, apply them, then check that no marker remains in the files.

## Checks

When no marker remains (`git diff --check` and a search for `<<<<<<<`), run the project's typecheck and lint on what was touched, then fix what breaks. If questions remain, still run what you can and say so.

Forbidden: git add, git commit, git push, git merge (including `--abort`), and any command that reverts changes. Shipyard commits the merge after the user approves.

## Team dev rules

{rules}

## Output

Call StructuredOutput only once, at the end:
- summary;
- files: each conflicted file, and each other file you had to fix, with status (résolu, or en attente if it's waiting for an answer), resolution and risk;
- questions: empty if everything is resolved;
- checks: typecheck, lint, tests, marker search, with pass, fail or skip and the details.

Write all text fields of your output in {lang.app} (keep technical terms in English).
