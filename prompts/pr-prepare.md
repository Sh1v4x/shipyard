---
name: Création de PR
group: Ma PR
when: Worktree sans PR › Préparer la PR
vars: [worktree.branch, pr.base, ticket.id, ticket.title, ticket.url, template, example, context, tests, lang.pr]
model: sonnet
allowedTools: [Read, Grep, Glob, Bash(git status *), Bash(git diff *), Bash(git log *), Bash(git show *)]
---

Write the PR for the branch {worktree.branch} into {pr.base}, for the ticket {ticket.id} ({ticket.title}, {ticket.url}).

Commits and changes on the branch (provided by Shipyard):
{context}

Tests run on the branch (provided by Shipyard):
{tests}

Read the diff (`git diff origin/{pr.base}...HEAD`) and open the relevant files to understand what was done and why.

## Title
Same convention as the repository's commits, in English, one line summarizing the whole. For example: `feat(invoices): highlight AI fixed-asset proposals in the supplier invoice list`.

## Description
Write the description (body) in {lang.pr}, following the repository's PR template below exactly:
- keep all its sections, in the same order, with the same headings and emojis;
- remove the HTML comments (`<!-- … -->`);
- check (`[x]`) only what is true according to the diff. Don't check a test, coordination or checklist box that you cannot verify: leave it empty;
- for a conditional section that doesn't apply (for example "Pour les changements API" with no change in apps/api), leave its boxes empty;
- Résumé: 2 to 4 sentences on the what and the why, citing the business concepts;
- Changements détaillés: one bullet per significant change, with the file or module in backticks and what changes;
- Tests: under the template's boxes, first a checked box saying the PR was tested by the AI, with its outcome in one line (e.g. `- [x] Testée par l’IA : 5 scénarios réussis, 1 à vérifier`), only if an AI test is provided above. Then "Testé manuellement": the list of the manual test steps, checked as provided, with the result of their command check if there is one. Check a template test box only if these results prove it. Report a failed scenario or a skipped step frankly. With no test provided, say what the commits or test files show;
- Liens: `Resolves {ticket.id}` with the ticket link. Remove the "Related to" line if nothing is linked.

Repository template:
```markdown
{template}
```

Example of one of my recent PRs, for tone and level of detail:
```markdown
{example}
```

Do not commit or push. Return via StructuredOutput: commits (always an empty list, the commits are made beforehand), title (in English), body (in {lang.pr}).
