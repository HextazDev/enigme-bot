# Commande `/create-issue` - Atelier Interactif de Cadrage & Création d'Issue

Lance l'atelier pour : `$ARGUMENTS` (idée brute, besoin ou description sommaire, facultatif).

## Instructions pour Claude / Antigravity :

1. **Charge la source unique** : lis `.agents/skills/issue-crafter/SKILL.md` et suis ses 5 phases :
   interview & challenge produit (doublons via `gh issue list --state all`) → grounding technique (`src/db/`, `src/gamemodes/`, `src/services/`, `src/discord/`, `src/utils/canvas.ts`) → rédaction « Agent-Ready » + triage proposé → **validation explicite du brouillon** → publication `gh issue create`.
2. **Point d'arrêt obligatoire** : ne JAMAIS exécuter `gh issue create` sans la validation explicite de l'utilisateur.
3. **Restitution** : lien direct vers l'issue (`#<NUMERO>`), synthèse du cadrage et commande suggérée `/resolve-issue <NUMERO>`.
