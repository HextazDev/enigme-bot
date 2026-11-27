# Commande `/test-audit` - Audit Approfondi des Tests & Fiabilité

Déclenche l'audit sur : `$ARGUMENTS` (`--all`, un module métier, ou un fichier de test dans `test/`).

## Instructions pour Claude / Antigravity :

1. **Périmètre** :
   * Vide ou `--all` : toute la suite `node:test` sous `test/`.
   * Un module (ex: `src/gamemodes/mario_party/turn.ts`) : complétude des tests associés.
   * Un fichier de test : qualité des assertions `node:assert/strict`, isolation SQLite `:memory:` et pattern AAA.
2. **Charge la source unique** : lis `.agents/skills/test-auditor/SKILL.md` et évalue ses 5 piliers en regard de `docs/EDGE_CASES.md`.
3. **Restitution** : format du `SKILL.md` — scorecard /100, anomalies préfixées `AUD-`, plan de création des tests par scope direct (pas de « prompts à copier »).
