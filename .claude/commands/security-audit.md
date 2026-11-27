# Commande `/security-audit` - Audit de Sécurité & Intégrité du Jeu

Déclenche l'audit sur : `$ARGUMENTS` (`--full`, ou un chemin ciblé comme `src/discord/`, `src/commands/`, `src/gamemodes/`).

## Instructions pour Claude / Antigravity :

1. **Périmètre** :
   * Vide ou `--full` : projet complet (frontière Discord, commandes MJ, verrous/transactions, customIds, secrets, `remote-image.ts`, gestion d'erreurs).
   * Un chemin ciblé : contrôle d'accès, concurrence et validation sur ce module.
2. **Charge la source unique** : lis `.agents/skills/security-auditor/SKILL.md` et évalue ses 5 piliers en regard de `docs/EDGE_CASES.md`.
3. **Restitution** : format du `SKILL.md` — scorecard /100, vulnérabilités préfixées `AUD-`, plan de remédiation P0/P1 direct (pas de « prompts à copier »).
