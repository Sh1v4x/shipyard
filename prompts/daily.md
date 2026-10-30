---
name: Rapport Daily
group: Daily
when: Daily › Générer
vars: [period, since, activity, lang.app]
model: sonnet
allowedTools: []
---

Prepare the cheat sheet for the user's team stand-up: what the user did {period} ({since}), across all their projects. The user reads it just before speaking, to know what to mention and to have two or three technical details at hand.

GitHub activity for the period: their merged, closed or open PRs, with their commits and main files, then the colleagues' PRs the user reviewed, with their reviews (verdict and summary):

{activity}

## What to produce

A list, not paragraphs.
- sections: one per project with activity, in the order above. Project without activity: no section.
- items, one per topic actually worked on (usually one PR; group PRs about the same topic):
  - title: what was done, in one short and telling line, from the product or team point of view (e.g. "Notification à la création d'une todo"), not the raw PR title;
  - pr and url: the main PR;
  - status: mergée, ouverte or fermée; "reviewée" for a colleague's PR the user reviewed;
  - points: 1 to 3 technical details of at most 15 words each, the kind you mention out loud ("nouveau champ `notified_at` + migration", "envoi via Novu, en tâche de fond", "3 commentaires de review traités"). Taken from the commits, files and description: don't invent anything.
- reviews: at the end of each section, one item per colleague's PR reviewed (status "reviewée"). title: the PR topic and its author ("Review: SDK export, PR by alex"); points: the verdict and what the user pointed out, taken from their reviews ("changes requested: missing i18n keys", then "approved after the fix").
- next: 0 to 4 lines on what is still in progress or blocked (PR awaiting review, in conflict, to be tested...), only if the activity shows it.

Write the whole report in {lang.app}, telegraphic style, without "j'ai". No mention of Claude or an AI.

Call StructuredOutput only once.
