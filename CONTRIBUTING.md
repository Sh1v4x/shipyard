# Contributing

Thanks for your interest in Shipyard. Issues and pull requests are welcome.

## Setup

See [Getting started](README.md#getting-started). `pnpm dev:mock` runs the interface on demo data, without GitHub, Linear or Claude.

## Before opening a pull request

- `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass (the git hooks run them for you).
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/), in English, title only.
- New data exchanged between the server and the interface goes through `shared/types.ts`.
- Every request body is validated by a schema in `server/inputs.ts`.
- An agent's structured output is described twice: its type in `shared/types.ts` and its JSON schema in `server/schemas.ts`; add it to `server/schemas.test-d.ts`, which checks they stay aligned.
- Agents never write to GitHub or Linear and never commit: the server does it after the user approves.
- The interface text is in French.

[CLAUDE.md](CLAUDE.md) describes the conventions in more detail, including how to add a new AI action.
