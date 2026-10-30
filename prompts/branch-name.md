---
name: Nom de branche
group: Worktree
when: Nouveau worktree › Depuis un ticket Linear
vars: [ticket.id, ticket.title, ticket.type]
model: haiku
allowedTools: []
---

Title of a Linear ticket: "{ticket.title}"

Suggest the descriptive part of a git branch name:
- translated into English;
- 2 to 4 words, in kebab-case, without stop words (the, a, of, when...);
- focused on what changes in the product, not on how the ticket is phrased.

Examples:
- "Envoyer un e-mail aux membres quand le statut d'un projet change" → status-email-notifications
- "Le tri par colonne du tableau des projets ne fonctionne plus après un filtre" → project-table-sorting
- "Connexion SSO Google pour les comptes entreprise" → google-sso

Reply only with StructuredOutput, field slug. Shipyard adds the {ticket.type}/{ticket.id}- prefix itself.
