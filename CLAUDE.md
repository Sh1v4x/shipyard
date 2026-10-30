# Shipyard: working on this repository

- Stack: Node 24, strict TypeScript, Hono (`server/`), React 19 + TanStack Query + Vite (`web/`). Package manager: pnpm.
- Before finishing: `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` (lefthook also runs them before commit and push).
- The data contract lives in `shared/types.ts`. Any new data exchanged between the server and the interface goes through this file.
- Agents' structured outputs are described twice: the type in `shared/types.ts` and the JSON schema (`as const`) in `server/schemas.ts`. `server/schemas.test-d.ts` checks they stay aligned: add every new schema to it.
- Every request body is validated by a zod schema from `server/inputs.ts` (`jsonBody(c, inputs.x)`), typed with `satisfies z.ZodType<T>` when the type exists in `shared/types.ts`.
- A new AI action needs:
  1. a `prompts/<kind>.md` with its front matter (name, group, when, vars, model, permissionMode, allowedTools);
  2. a handler in `server/actions/<domain>.ts` (registered in the table in `server/actions.ts`), which precomputes the context and does the remote writes in `onSuccess`;
  3. the kind added to `ActionKind`;
  4. the interface through `useAction()` (`web/src/data/runs.ts`) and `RunPanel`.
- Agents never write to GitHub or Linear and never commit: the server does it, after the user approves in the interface.
- Shipped prompts and rules (`prompts/`, `rules/`) stay generic. User edits go to `prompts.local/` and `rules.local/` (git-ignored), which override the shipped file with the same name.
- The interface is in French. Commits follow Conventional Commits, in English, title only.
- External calls: `gh` through `server/lib/github.ts`, Linear through `server/lib/linear.ts`, git through `server/lib/git.ts`. No direct call elsewhere.
- Routes: one Hono router per domain in `server/routes/`, mounted under `/api` in `server/index.ts`.
- Front-end data: everything goes through `web/src/data/` (a Biome rule enforces it for pages and components): cache keys in `keys.ts`, reads in `queries.ts` (one hook per piece of data), writes in `mutations.ts` (one hook per action). No `fetch`, `api()` or direct `useQuery` in pages. A mutation only invalidates what it changes (key prefix); after a remote write, `syncProject()` recomputes the project view.
- Server side, a project's view is served from cache and recomputed in the background (`services.overview`). After writing to GitHub, call `gh.clearPrCache(repo)`: it also clears that view.
