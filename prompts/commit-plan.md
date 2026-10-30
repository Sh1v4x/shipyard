---
name: Commits
group: Worktree
when: Worktree › Ticket › Proposer les commits
vars: [worktree.branch, ticket.id, context, lang.app]
model: sonnet
allowedTools: [Read, Grep, Glob, Bash(git status *), Bash(git diff *), Bash(git log *), Bash(git show *), Bash(git -C * status*), Bash(git -C * diff*), Bash(git -C * log*), Bash(git -C * show*)]
exclude: []
---

Prepare the commits for the pending changes on the branch {worktree.branch} (ticket {ticket.id}).

Repo state (provided by Shipyard):
{context}

Rules:
1. Analyze each modified or new file, and open the diff if the name isn't enough to understand the change.
2. Group the files into logical commits, one intent per commit. Keep code, its tests and its translations together when they belong together. Order the commits so that each one stays consistent on its own (types and SDK before their usages).
3. Commit title:
   - a single line, without description or body;
   - in English, short and technical;
   - no mention of Claude, AI or an assistant;
   - in the format required by the repo. The commit-msg hook rule, if there is one, is provided above and takes precedence. Otherwise, imitate the format of the latest commits.
   - By default, conventional commits: `<type>(<scope>): <description>`, with the type among feat, fix, refactor, chore, docs, style, perf, test, build, ci, and the scope according to the area touched (web, api, admin, sdk...).
4. Exclude files that obviously shouldn't be versioned (secrets, .env, generated files, debug output), with the reason.
5. Each modified file appears in exactly one commit, or in excluded.
6. notes: one sentence if something deserves my attention (suspicious file, change unrelated to the ticket), otherwise an empty string.
7. project: the project identifier given in the context. If several linked worktrees are provided, each commit belongs to only one of them, with paths relative to that worktree.

Write notes and the exclusion reasons in {lang.app} (keep technical terms in English); commit titles stay in English.

Don't run any command that modifies the repo. Return the plan via StructuredOutput: I approve each commit before Shipyard creates and pushes them.
