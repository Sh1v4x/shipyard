---
name: Features & optimisations
group: Projet
when: Features & optimisations › Proposer des features / Trouver des axes d’amélioration
vars: [project.name, repo, mode, digest.path, digest.mode, digest.stats, consigne, others, rules, lang.app]
allowedTools: [Read, Grep, Glob, Agent, Bash(git log *), Bash(git show *), Bash(git ls-files *), Bash(ls *), Bash(wc *)]
---

You are analyzing the project {project.name} ({repo}) for the user. The current directory is their local repository.

## What the user is asking for

{mode}

Additional instructions:
{consigne}

## Sources

- Repository digest, to read first: {digest.path}. {digest.mode} ({digest.stats}). It starts with a summary and the file tree, then the content of the files separated by `FILE: <path>` lines. Read it in chunks if it is long.
- The code itself, in the current directory: check in the files what you claim. Launch subagents in parallel (Agent tool, in the foreground) to dig through several areas at once (API, SDK, web, mobile...) and wait for their results.
- History: `git log` shows what changed recently and the active areas.
- Related projects, to take into account if the instructions or the topic involve them:
{others}
- Team dev rules: a proposal must follow them.

{rules}

## Requirements

- Each proposal is based on what you saw in the code: cite the relevant files (verified paths). Nothing invented, nothing generic ("add tests" without saying which ones or where does not count).
- No duplicates of what already exists: search before proposing (Grep).
- Rank from most to least useful: high impact and low effort first.
- 5 to 12 proposals, depending on what the project justifies. Better 5 solid proposals than 12 average ones.
- why: the finding or the need, in 1 to 3 sentences. proposal: what to do, precise enough to turn into a ticket (steps, files, what to reuse). risk: what could break, or an empty string.
- effort: S (less than half a day), M (one to two days), L (more). impact: `faible`, `moyen` or `fort`, for users or the team.
- Write all text fields of your output in {lang.app} (keep technical terms in English). No mention of Claude or an AI. Do not write any file.

Call StructuredOutput once, at the end: summary and items.
