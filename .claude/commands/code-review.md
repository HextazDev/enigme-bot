# Commande `/code-review` - Revue de Code Intransigeante (Staff Engineer)

Déclenche l'audit sur : `$ARGUMENTS`.

## Instructions pour Claude / Antigravity :

1. **Périmètre** :
   * `--full` : audit architectural global du bot.
   * Un chemin de fichier (ex: `src/gamemodes/mario_party/turn.ts`) : ce fichier et ses dépendances directes.
   * Vide ou `--diff` : modifications courantes (diff de la branche vs `main`).
2. **Charge la source unique** : lis `.agents/skills/code-reviewer/SKILL.md`, exécute son diagnostic préalable (`npm run check`, scans `rg` des anti-patterns) et évalue les 6 piliers.
3. **Restitution** : suis exactement le format de rapport du `SKILL.md` — scorecard /100, anomalies préfixées `AUD-`, matrice effort/impact, plan de remédiation par scope (pas de « prompts à copier »).
