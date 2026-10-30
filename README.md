# Shipyard

A local control panel for your day-to-day development work. It brings together your git worktrees, Linear tickets, GitHub pull requests and CI, and drives [Claude Code](https://docs.claude.com/en/docs/claude-code) (`claude -p`) to do the repetitive parts:

- plan and implement a Linear ticket in its own worktree, with before/after screenshots;
- prepare commits and the pull request description;
- self-review your PR before asking for a review, with four specialised reviewers (architecture, quality, security, performance);
- review a colleague's PR and post the comments you approve as one GitHub review;
- triage and fix review comments, CI failures, bot reports and commits rejected by git hooks;
- resolve merge conflicts and keep a branch up to date with its base;
- test a PR in the browser (Playwright) or on an Android emulator, recorded on video, or prepare a guided manual test;
- write your daily stand-up notes from your GitHub activity.

**Nothing is written to GitHub or Linear without your approval.** Agents never commit, push or post: the server does it once you validate the result in the interface.

> The interface is in French. The language of what the agents write (analyses, GitHub comments, PR descriptions, tickets) can be set to English or French in the settings.

## Requirements

- macOS (notifications and a few helpers use macOS tools; the rest is portable but untested elsewhere)
- Node.js 24 and pnpm 10
- [Claude Code](https://docs.claude.com/en/docs/claude-code), logged in (`claude`): runs on your Claude subscription, no Anthropic API key needed
- [GitHub CLI](https://cli.github.com/), logged in (`gh auth status`)
- A Linear personal API key (Linear › Settings › Security & access › Personal API keys), optional if you don't use Linear
- Optional: Google Chrome (browser tests and test videos), the Android SDK (mobile tests), the Xcode command line tools (`swiftc`, richer notifications)

## Getting started

```bash
git clone <this repository> shipyard && cd shipyard
pnpm install                  # also installs the git hooks (lefthook)
cp .env.example .env.local    # then fill in LINEAR_API_KEY and, if you like, your folders
pnpm dev                      # API on 127.0.0.1:4317, interface on http://localhost:5173
```

Open http://localhost:5173 and add a project from its GitHub URL. Keys can also be set later from **Réglages › Connexions**; they are checked, then stored in `.env.local`.

To run it without the dev tooling: `pnpm build && pnpm start`, then open http://localhost:4317.

A demo project with fake data is available with `pnpm dev:mock`.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `LINEAR_API_KEY` | — | Linear personal API key |
| `GH_TOKEN` | `gh` login | GitHub token, if you don't want to use the `gh` login |
| `PORT` | `4317` | API port (the Vite dev server always uses 5173) |
| `WORKTREE_ROOT` | `~/shipyard/worktrees/{project}` | Where new worktrees are created |
| `PROJECTS_ROOT` | `~/shipyard/projects` | Where a project added without a local path is cloned |
| `PANEL_URL` | `http://localhost:5173/` | Opened when you click a notification |

## Making it yours

Everything the agents are told lives in Markdown files you can edit from the **Prompts** page:

| Folder | Content |
|---|---|
| `prompts/*.md` | One prompt per AI action. The front matter sets the model, the permission mode and the allowed tools. |
| `prompts/_system.md` | Common rules appended to every agent. |
| `agents/*.md` | Sub-agents passed to `claude --agents` (the four reviewers). |
| `rules/*.md` | Your team's development rules, applied by reviews and fixes. Each rule lists the projects it applies to. |

Your changes never touch the shipped files: they are saved in `prompts.local/` and `rules.local/`, which git ignores. A local file replaces the shipped one with the same name, and **Revenir au prompt par défaut** removes it. Put your team's own rules in `rules.local/` (or create them from the Prompts page): they stay on your machine.

## How agents are run

Each action starts `claude -p` in the relevant worktree with:

- **a lean profile** (`--setting-sources project,local --strict-mcp-config`): your global hooks and plugins are not loaded, which keeps the start-up cost low;
- **precomputed context**: the server fetches the diff, comments and CI logs and puts them in the prompt, so the agent doesn't spend turns looking for them;
- **structured output** (`--json-schema`), displayed as is by the interface;
- **minimal permissions**, set in each prompt's front matter: analyses are read-only, fixes get `acceptEdits` and the project's lint and test commands;
- **no remote writes**: commits, pushes, replies, reviews and PRs are done by the server after your approval.

Runs are streamed live (SSE) and saved in `.data/runs/`. Reloading the page brings every screen back to its last run, and **Arrêter** stops `claude` and everything it started.

## Security model

Shipyard runs agents that edit code on your machine, so the API only accepts the local interface:

- it listens on `127.0.0.1` only;
- it rejects unknown `Host` headers (DNS rebinding), other origins, cross-site requests (`Sec-Fetch-Site`) and non-JSON bodies;
- every request body is validated before reaching the business logic.

Do not expose the port to a network. Your keys stay in `.env.local` and your data in `.data/`, both ignored by git.

## Project layout

| Folder | Role |
|---|---|
| `server/` | Hono API. `routes/` holds the routes by domain, `inputs.ts` validates request bodies (zod), `actions.ts` dispatches AI actions to `actions/<domain>.ts`, `services.ts` holds the business logic and `lib/` the integrations (git, gh, Linear, the `claude -p` runner, run storage). |
| `web/` | React 19 interface (Vite, TanStack Query). |
| `shared/` | Data contract between the server and the interface. |
| `mock/` | Demo data for `pnpm dev:mock`, generated by `pnpm mock`. |

## Development

```bash
pnpm typecheck   # TypeScript
pnpm lint        # Biome
pnpm test        # Vitest
pnpm build       # production build of the interface
```

Typecheck and lint run before each commit, tests and build before each push (lefthook). See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
