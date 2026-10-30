---
name: Auto-review de ma PR
group: Ma PR
when: Worktree › Fichiers › Analyser ma PR avec l’IA
vars: [pr.number, pr.title, ticket.id, ticket.title, diff.path, rules, threads, context, lang.app]
model: sonnet
allowedTools: [Read, Grep, Glob, Agent, Bash(git diff *), Bash(git log *), Bash(git show *)]
---

Review my PR #{pr.number} ({pr.title}) like a demanding reviewer, before my colleagues see it. Linked ticket: {ticket.id} ({ticket.title}).

Your output is shown in Shipyard, at the right line of the diff; each finding can be fixed by an agent. You don't modify anything yourself.

## Sources

- Diff to review: {diff.path}. Read it entirely, in chunks if it is long. The commits are listed below.
- PR code: the current directory. If the worktree differs from the diff, the diff is authoritative.
- The rest of the repository: callers, types, hooks, neighboring components and screens, to understand what the change affects and check whether a helper or component already exists.
- Team dev rules. They only apply to the areas they specify (a web rule does not apply to mobile, and vice versa):

{rules}

## Method

The goal: the PR reaches my colleagues with nothing left for them to point out. The review covers everything: the bugs and design problems you find through your analysis, and every deviation from the dev rules, style included.

1. Understand the PR: read the commits and the ticket's goal, then the diff file by file. For each modified file, open the full file with Read: what the change does, where it is called from, what it replaces.
2. Check that the PR actually addresses the ticket: missing feature, forgotten case, behavior different from what was requested.
3. Analyze each change yourself, like a senior developer who knows the product:
   - correctness: inverted logic, edge cases (empty, null, loading, network error, double click, long list), inconsistent states, wrong defaults, side effects, race conditions, missing cleanup;
   - regressions: an existing caller, screen or behavior that changes unintentionally (search usages with Grep);
   - UX and product: missing loading or error state, badly formatted text or amount, inconsistent navigation, accessibility;
   - design: misplaced responsibility, component or hook too big, logic duplicated with an existing one, unnecessary or missing abstraction, misleading naming;
   - performance, security and data: unnecessary renders or requests, exposed sensitive data, unvalidated input, swallowed error;
   - simplification: dead code, impossible branch, code longer than necessary.
4. Then check all added code against the dev rules, one by one, audit checklist included: every deviation is a finding, even a minor one. Pattern searches (Grep) are for spotting occurrences: verify each result in the code before turning it into a finding.

Only report what the PR adds or modifies: the full file is there to understand the context. A problem in untouched existing code is not reported, unless the change triggers or worsens it. No false positives: check in the code that each problem is real. Don't report what Biome or tsc already catch.

## Comments already posted

Discussion threads already opened on my PR by reviewers, with my replies:

{threads}

Before keeping a finding, check whether one of these threads already covers it:
- same topic, already fixed or already settled in the discussion: don't raise it again;
- same topic, still open or poorly fixed: keep the finding, put the thread's threadId in relatedThreadId, and say in body what is missing compared to the reviewer's request;
- different topic but same file and same area (a few lines): also set relatedThreadId, so I can see the previous discussion.
Otherwise relatedThreadId is null.

## Output

Call StructuredOutput once, at the very end:
- summary: 2 to 4 sentences on the state of the PR and what remains to be done before submitting it;
- findings, blocking ones first, 25 at most. For each finding:
  - id: f1, f2...;
  - file: relative path;
  - line: line number in the source file, new version, and present in the diff (added or context). The numbers Read shows in the margin of the .diff file are positions in that diff file, never code lines: take the number Read shows on the source file, or compute it from the hunk's @@ header;
  - severity: `bloquant` (bug, vulnerability, data loss, unmet ticket requirement, rule marked "hard rule"), `important` (to fix before merge: edge case, design, rule not followed), `suggestion` (optional improvement);
  - title: one line;
  - body: the problem and its consequence, in 1 to 3 sentences;
  - fix: the concrete fix (a short snippet is allowed). The same problem repeated in several places: one finding per place, with the same title.

Write all text fields of your output in {lang.app} (keep technical terms in English).

Do not modify any file in the repository.

{context}
