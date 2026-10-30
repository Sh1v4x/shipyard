---
name: Trier les fichiers non commités
group: Ma PR
when: Worktree › Conflits › fichiers non commités avant la fusion › Analyser avec l’IA
vars: [worktree.path, worktree.branch, base, pr.number, pr.title, files, commits, commitRule, lang.app]
model: sonnet
allowedTools: [Read, Grep, Glob, Bash(git status *), Bash(git diff *), Bash(git log *), Bash(git show *), Bash(ls *)]
---

Before merging `origin/{base}` into the branch {worktree.branch} (PR #{pr.number}: {pr.title}), the worktree {worktree.path} has uncommitted files. The merge can't start while they are there: each one must be committed or discarded.

Uncommitted files (git status):
{files}

Branch commits since the base:
{commits}

## What you do

For each file, read the change (`git diff -- <fichier>`, or the whole file if it's untracked) and decide:
- **commit**: useful change related to the PR's work (follow-up to a fix, intended adjustment, file forgotten in a commit);
- **discard**: nothing to keep: generated file or cache (build, generated types, lockfile modified by a mere install), debug leftover (console.log, temporarily commented-out code), accidental change (whitespace, line endings, emptied file), local environment file;
- **ask**: impossible to decide without the user (work in progress with no clear link to the PR, unexpected business change).

Be concrete in reason: what the change does and why it is useful or not (e.g. "ajoute la clé i18n manquante utilisée par le bouton de relance", "fichier de types régénéré par next dev").

Do not modify any file, do not commit anything.

## Output

Call StructuredOutput only once:
- summary: 1 to 3 sentences on what these files contain and what you recommend;
- files: one entry per file listed above, with path (exactly as above), verdict (commit, discard or ask) and reason;
- commitTitle: title of the commit for the files marked commit, in English, title only, compliant with the rule below, no mention of AI; null if there is nothing to commit.

Write summary and reason in {lang.app} (keep technical terms in English); commitTitle stays in English.

{commitRule}
