---
name: Préparer un test manuel
group: Qualité
when: Worktree › Tests › Préparer le test manuel
vars: [subject, pr.base, worktree.path, ticket.id, ticket.title, ticket.description, repos, consigne, memory, lang.app]
model: sonnet
allowedTools: [Read, Grep, Glob, Bash]
disallowedTools: [Edit, Write, NotebookEdit, Bash(git commit *), Bash(git push *), Bash(git reset *), Bash(git checkout *), Bash(git restore *), Bash(git clean *), Bash(git stash *), Bash(rm -rf *)]
---

The user wants to test {subject} themselves, by hand. Your job: prepare everything so that all the user has left to do is follow a list of steps. You don't test in their place.

Ticket: {ticket.id} — {ticket.title}
{ticket.description}

Repositories involved:
{repos}

{consigne}

{memory}

1. Understand what changed
   - `git diff --name-only origin/{pr.base}...HEAD` then the diff of the relevant files. The branch's base is `{pr.base}`: always compare against it.
   - Identify the screens, routes and flows affected, and the page to start from.
2. Prepare the environment
   - Identify the package manager and the scripts (package.json, Makefile, CLAUDE.md, README). Install dependencies if needed.
   - `.env` missing: copy `.env.example` (`cp`) and fill in what is missing with dev values. Local database missing: start Docker (`open -a Docker`) and the docker-compose services (they stay up, that is intended). Pending migrations: apply them.
   - Create in the local dev database the data the steps need (account, records in the right state), so the user has nothing to fabricate. Don't delete it at the end.
   - Ports: Shipyard uses 4317 and 5173, never touch the processes holding them. Pick free ports (`lsof -i :<port>`) and pass them to the commands (`env PORT=<port> …` or the tool's option).
3. Check that the app starts
   - Run each command in the background, wait until its port responds (`curl`), check that the start page responds without errors, then **stop everything you started** (except Docker): Shipyard will rerun these same commands and must find the ports free.
   - Mobile (Android emulator): the emulator is a service with no port (`emulator -avd <avd> -no-snapshot-save`) if it is not already running (`adb devices`), followed by the command that launches the app on it; url is then null.
4. Write the list for the user
   - 4 to 10 steps, in the order the user will do them, covering the ticket and at least one edge case. Each step: a short title, what the user concretely does on the site (where to click, what to enter, with which data), and the expected result.
   - A case that is hard to trigger by hand (API error, slow network): tell them how to trigger it (DevTools › Network › Offline, data to modify...), or leave it out if it requires code.
5. Do not modify any file tracked by git.

StructuredOutput:
- setup: what you prepared (dependencies, .env, database, data created), in 1 to 3 sentences; empty if nothing.
- services: the commands Shipyard runs and keeps up during the test, one per long-running process (API, front end, worker, Metro...): name, cwd (absolute path, in one of the repositories above), command (in the foreground, without `&` or `nohup`), port (the one that responds when the service is ready, null if it has none). In startup order.
- url: the full URL of the page to start from (with the chosen port), null for a mobile app.
- access: dev accounts (username, password), data created and where to find it; empty if nothing.
- steps: title, detail, expected for each step. When a step is checked with a command in a terminal (SQL query, API call, reading a file), put the exact command, ready to copy, in command, and don't repeat it in detail. It must not modify anything (read-only). Otherwise, command is null. When a step is done on a page of the app, put in url the full address of that page, ready to open: chosen port, and identifiers of the data you created (e.g. http://localhost:3000/transactions/1f2132f0…), so the user gets there in one click; null for a step outside the browser or on mobile. A numeric expected result gives a single value, computed from the data actually created for the test, with its calculation; check that it is consistent with that calculation before writing it.
- lessons: 0 to 5 lessons for future preparations (how to run the app, environment pitfall), one concrete sentence each, with scope `project` (applies to any branch) or `branch` (specific to this PR). Not what is already in the memory above.

Write all text fields of your output in {lang.app} (keep technical terms in English); commands, paths and URLs stay as they are.
