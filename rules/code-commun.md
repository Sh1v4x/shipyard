---
name: General code rules
projects: [all]
---

## Comments: none by default
Comment only a non-obvious *why* (hidden constraint, subtle invariant, workaround), in one or two lines. No comment that restates the code, no section banners, no narration of the change ("added X", "fixes #123").

## No unnecessary cast
No `as X` to silence the compiler. Acceptable: narrowing by a type guard, a real conversion (`String(x)`, `Number(x)`), or an isolated cast at an untyped external boundary (`JSON.parse`, a third-party API) right after a runtime check. `as unknown as T` is a red flag.

## No `any`, no widened nullables
Narrow, validate, or throw rather than working around a type uncertainty.

## Validate at the boundaries
Validate what comes in (request bodies, forms, external API payloads, webhooks) with a schema. Internal reads keep plain types.

## No default value that hides an absence
No `?? 0`, `?? ""`, `|| "N/A"` that makes missing data look like a real value: represent the absence honestly, or assert the invariant.

## One concept defined once
Before writing a type, constant, helper or hook, search whether it exists. A near-duplicate of an existing helper is a finding. A block of logic repeated with different arguments becomes a parameterized function.

## Flat flow
Guard clauses and early returns rather than nested conditions.

## Name after the business role
`overdueInvoices`, not `filteredList`. Identifiers, file names and log messages in English.

## Smallest clean implementation
No speculative branch, no compatibility layer nobody needs, no TODO instead of code, no fallback for a case no caller produces.

## No hardcoded user-facing text or secrets
User-facing strings go through the project's i18n when it has one. Never commit a key, token or password.

## No mention of an assistant in commits, PRs and reviews
No `Co-Authored-By` line, "Generated with" footer or reference to an AI in commit messages, PR descriptions or review comments.
