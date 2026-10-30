---
name: Re-tester un travail
group: Worktree
when: Worktree › Ticket › Résultat du travail › Re-tester
vars: [worktree.path, worktree.branch, plan, report, shots.dir, before.dir, note, capture, lang.app]
permissionMode: acceptEdits
allowedTools: [Read, Grep, Glob, TodoWrite, Bash(git status *), Bash(git diff *), Bash(git log *), Bash(npm run *), Bash(npm test *), Bash(pnpm *), Bash(bun *), Bash(bunx *), Bash(npx *), Bash(yarn *), Bash(node *), Bash(curl *), Bash(lsof *), Bash(sleep *), Bash(env *), Bash(docker *), Bash(open -a Docker*), Bash(psql *), Bash(pg_isready *), Bash(kill *), mcp__playwright__*, Bash(adb *), Bash(emulator *)]
disallowedTools: [Edit, Write, NotebookEdit, Bash(git commit *), Bash(git push *), Bash(git add *), Bash(git reset *), Bash(git stash *), Bash(git checkout *), Bash(git restore *), Bash(git clean *)]
---

Redo only the testing phase of the work you just delivered, in the worktree {worktree.path} (branch {worktree.branch}). The code is finished: do not modify any file in the repository. If a test reveals a problem, report it in the audit (check in fail, risks, followUps) without fixing it: The user will decide whether to request changes.

{note}

## Approved plan

{plan}

## Previous report

{report}

{capture}

## 1. Start the app

Find out how to run the app locally (CLAUDE.md, README, dev scripts in package.json, appNote of the previous report). Start it in the background and wait until it responds (curl on the port). It must run: find a way.
- Port already in use (EADDRINUSE, or the PORT variable points to a busy port): never touch the process holding it (Shipyard runs on 4317 and 5173). Pick a free port (check with `lsof -i :<port>`) and run the app on it, for example `env PORT=3101 bun run dev` or the script's port option. Do the same for each service (API, web), and pass the right API port to the front end through a script environment variable.
- Database missing: look at `DATABASE_URL` in the .env files and the repo's docker-compose. If Docker is stopped, start it (`open -a Docker`, then wait until `docker info` responds) and start the services (`docker compose up -d`). Apply the project's migrations and seed if there are any.
- Data needed for a screenshot (e.g. a job in a specific state): create it with the project's tools (seed, script, API call) or directly in the database with `psql` on the local dev database, never on a remote database.
- Give up only after really trying these options. In that case, list in appNote what you tried and what blocked, with the command and the error.

## 2. "Before" screenshots

Copy of the code from before the work: {before.dir}

If it is a folder, run the app from that folder, on different ports from the worktree's app (install dependencies if needed), and capture each screen of the plan on its platform (browser or Android emulator), named `before-<name>.png`. Then stop it. Otherwise, reuse the "before" screenshots of the previous report as they are.

## 3. Checks and "after" screenshots

On the worktree's app:
- run the lint, typecheck and tests related to the change;
- capture the same screens, with the same framing, named `after-<name>.png`;
- check on screen that the behavior requested by the plan is there (clicks, forms, planned error or loading states).

Screenshots go in the folder {shots.dir}, as described in "How to test and capture" above. At the end, stop everything you started (apps, containers you started), without touching anything else.

## 4. Report

Return the complete report via StructuredOutput, in the same format as the previous one, which it replaces:
- summary: what was done (taken from the previous report), then what the retest showed, in 3 to 5 sentences;
- changes: copied as they are from the previous report;
- checks: the checks redone, with pass, fail or skip and the detail. Keep the "Règles de dev" check from the previous report;
- screenshots: for each screen, name, platform (web or android), description, before and after (file names, or null if the screenshot is missing);
- appNote: how the app was started (ports, database, data created), or why it could not be;
- risks: what remains fragile or could not be verified;
- followUps: what remains to be done, or what the user must check by hand.

Write all text fields of your output in {lang.app} (keep technical terms in English).
