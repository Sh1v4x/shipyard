---
name: Tester une PR
group: Qualité
when: Worktree › Tests › Lancer le test
vars: [subject, part, pr.number, pr.title, pr.base, worktree.path, ticket.id, ticket.title, ticket.description, capture, video, consigne, memory, previous, lang.app]
model: sonnet
allowedTools: [Read, Grep, Glob, Bash, mcp__playwright__*]
disallowedTools: [Edit, Write, Bash(git commit *), Bash(git push *), Bash(git reset *), Bash(git checkout *), Bash(rm -rf *)]
---

Test {subject} in {worktree.path}.

Ticket: {ticket.id} — {ticket.title}
{ticket.description}

{part}

{consigne}

{memory}

{previous}

1. Automated suite
   - Identify the package manager and the scripts (package.json, Makefile, CLAUDE.md).
   - Install dependencies if needed, then run the existing test suite. If it is very long, limit yourself to the tests of the files modified by the PR (`git diff --name-only origin/{pr.base}...HEAD`). The branch's base is `{pr.base}`: always compare against it, never against main or the repository's default branch.
2. Functional scenarios
   - Derive 3 to 6 scenarios from the ticket and the diff, including at least one edge case.
   - If the app has a UI, start it in the background and replay the scenarios on its platform, as described in "How to test and capture" below. Otherwise, test through the command line or HTTP requests. Starting the app is part of the test: a missing build, emulator, database or server is something to set up, never a reason to fall back on reading the diff. A scenario checked only by reading code is not tested.
   - If the port is already in use, don't touch the process holding it (Shipyard runs on 4317 and 5173): run the app on a free port (`env PORT=<port> …`). If the local database is missing, start Docker (`open -a Docker`) and the docker-compose services.
   - Environment problems (dependencies, missing `.env`, database behind on migrations, busy port, service to start) are to be solved: they are not scenarios. Note what you had to prepare in setup.
   - Each scenario is triggered, not waited for. Set up the state it requires yourself: data created or modified in the local dev database (record, status, date, lock, broken link...), user or role, failing or slow API response (in the browser, with `browser_run_code_unsafe` and `page.route(…)` to intercept the request and return the desired error), network cut off. A case "that did not show up" is never a reason not to test it.
   - warn is reserved for a scenario that is impossible to reproduce after at least two different attempts; detail then says what you tried and what blocked. A result that must be checked by a human (text, rendering) is still tested: describe what you observed.
   - Restore the database to its previous state for the data you modified, then stop the processes you started at the end.
3. Do not modify any file in the repository.

{capture}

{video}

StructuredOutput:
- suite: command (command run), passed, failed, summary (one sentence).
- setup: what you had to prepare to test (environment, data), in 1 to 3 sentences; empty if nothing.
- lessons: 0 to 5 lessons for future tests, one concrete sentence each: what made you lose time or fail, and the right way to do it. Not what is already in the memory above. For each one, scope:
  - `project`: true for any branch of the project (running the app, environment, database, ports, login, workstation tools);
  - `branch`: only applies to this PR (data or tables specific to its feature, screens it touches, pitfalls in its code). When in doubt, `branch`.
- scenarios: for each one, name, status (pass, fail or warn) and detail. detail gives how you triggered the case, the steps and the result obtained, in 1 to 3 sentences.
- decision, on a scenario: when the result depends on a choice the code does not settle (question raised by the ticket, ambiguous product behavior, gap between the ticket and what the PR does), set the scenario to warn and phrase what the user must decide: question (one sentence, no jargon), and 2 to 4 options. For each option, label (a few words) and fix: what would need to change in the code if the user picks it, precise and actionable (file, behavior); null for the option that keeps the PR as is. Otherwise, decision is null.

Write all text fields of your output in {lang.app} (keep technical terms in English).
