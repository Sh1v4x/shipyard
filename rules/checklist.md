---
name: Diff audit checklist
projects: [all]
---

Run on the PR's changed files (`$FILES` = `git diff --name-only origin/<base>...HEAD`). Every hit is checked in the code before it becomes a comment.

- `grep -nE '(^\s*//|^\s*/\*|^\s*\*)' $FILES` → each comment explains a non-obvious why; otherwise delete it.
- `grep -nE '\b as [A-Za-z]' $FILES` → each cast is justified (type guard, conversion, checked external boundary).
- `grep -nE 'as unknown as|: any\b|<any>' $FILES` → none, unless there is truly no other way.
- `grep -nE 'console\.(log|debug)' $FILES` → none outside scripts.
- `grep -nE 'TODO|FIXME|XXX' $FILES` → no new one without a ticket.
- `grep -nE '(\?\? 0|\?\? ""|\|\| "N/A")' $FILES` → no default value that hides missing data.
- `grep -niE '(api[_-]?key|secret|password|token)\s*[:=]\s*["'\''][^"'\'']{8,}' $FILES` → no hardcoded secret.
- Web: `grep -nE '<(button|input|textarea|select|table)\b' $FILES` → use the design system's component when one exists.
- Web: `grep -nE 'style=\{\{|\-\[[0-9]' $FILES` → no inline style or arbitrary Tailwind value for layout.
