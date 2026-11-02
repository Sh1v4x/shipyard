---
name: Rédiger des tickets Linear
group: Linear
when: Barre du haut › Nouveau ticket › Analyser le projet (puis Affiner)
vars: [project.name, repo, base, branch, feature, previous, feedback, others, rules, labels, projects, linked, lang.app, lang.tickets]
allowedTools: [Read, Grep, Glob, Agent, Bash(git log *), Bash(git show *), Bash(git ls-files *), Bash(ls *)]
---

You are preparing one or more Linear tickets for a new feature of the project {project.name} ({repo}). The current directory is the project's local repository, on the branch {branch} (base branch: {base}).

The goal: a ticket so precise that a developer, or an AI agent that will plan it, has almost no research left to do. They must know where to work, what already exists, what to reuse and what not to reinvent.

## Feature requested by the user

{feature}

{previous}

{feedback}

## Sources

- The project repository: read its CLAUDE.md and README, then explore the code.
- Other team repositories, read-only, for what is shared (SDK, components, API):
{others}
- Team dev rules. The ticket does not copy them, but the approach you propose must follow them (for example no `useEffect` to load data, TanStack Query, UI kit components, i18n):

{rules}

{linked}

## Method

Really explore before writing. Launch subagents in parallel (Agent tool, in the foreground, not in the background) when several areas need digging, for example API, SDK, web and mobile. Wait for their results before writing.

1. Understand the feature. Identify the screens, flows and data involved.
2. Find what already exists:
   - neighboring features following the same pattern, to use as a model (specific files);
   - data models and migrations (e.g. `schema.prisma`), API modules and services, routes or endpoints;
   - shared SDK: types, query and mutation hooks, API clients, constants and enums already available. State what is reusable as is and what is missing;
   - reusable UI components, hooks and utilities, existing i18n keys, navigation and menus to touch;
   - existing tests or fixtures to extend.
3. Note every verified file path. Never cite a file, hook or type you haven't seen.
4. Split:
   - a single ticket if the feature fits in a reasonable PR;
   - otherwise several independent tickets, each deliverable on its own (e.g. API + SDK, then web, then mobile), in implementation order. Each ticket states which other one it depends on.

## Questions

If a point really changes the content of the ticket (scope, expected behavior, platforms involved, business rule), ask a question in questions, with 2 to 4 short and concrete options, the most likely first. No questions about assignee, status, priority or labels: The user picks them in the UI. No questions whose answer is in the code. Write the tickets anyway with your most likely assumption, and flag it in the ticket ("Hypothèse : …").

When the user's answers are provided, integrate them, remove the settled assumptions and don't ask the same questions again.

## Format of each ticket

Ticket titles and descriptions are written in {lang.tickets}.

title: short, in {lang.tickets}, starting with the area then the action (e.g. "Véhicules : créer un module véhicules, relié aux indemnités kilométriques").

description, in Markdown, in the team's style:

```
**Référent :** à définir

<Contexte et objectif en 2 à 4 phrases : ce que l’utilisateur peut faire après, et pourquoi.>

## À faire

- [ ] <tâche concrète et vérifiable>
- [ ] …

## Pistes

* <ce qui existe aujourd’hui et où, avec les chemins en `code`>
* <feature voisine à suivre comme modèle>
* <ce qui est réutilisable du SDK / des composants, et ce qui manque>

## Fichiers concernés

* `chemin/du/fichier` : ce qu’il faut y faire
* …

## Critères d’acceptation

- [ ] <comportement observable>
- [ ] …

## Hors périmètre

* <ce que ce ticket ne fait pas> (omets la section si rien)
```

Add "Dépend de : <titre de l’autre ticket>" under the Référent line when applicable.

- type: Feature, Bug or Improvement.
- labels: only from the team's existing labels below, those that really describe the ticket (domain, platform). The type label (Feature, Bug, Improvement) is added automatically: don't include it.
- priority: 3 (normal) by default, 2 if the request says it is urgent or blocking.
- project: the matching Linear project, from those below, otherwise null.
- branch: 2 to 4 English words in kebab-case that name the change, for the git branch (e.g. `bank-sync-retry`).

Existing labels: {labels}

Linear projects: {projects}

No mention of Claude, an AI or an assistant in the tickets. Do not write any file.

## Output

Write summary and questions in {lang.app} (keep technical terms in English), and the tickets' titles and descriptions in {lang.tickets}.

Call StructuredOutput once, at the end: summary, questions (empty if everything is clear), tickets.
