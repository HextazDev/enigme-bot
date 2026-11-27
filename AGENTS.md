# Enigme Bot - Directives pour Claude Code & Antigravity

## 📌 Vue d'ensemble du Projet

**Enigme Bot** est un bot Discord interactif combinant des énigmes quotidiennes avec un jeu de plateau style Mario Party. Les joueurs gagnent des pièces en répondant aux énigmes, puis lancent des dés pour se déplacer sur un plateau généré dynamiquement en image (Canvas), acheter des objets, déclencher des événements et récolter des Étoiles.

### Architecture du Projet
Tout le code applicatif est en **TypeScript strict** (`src/**/*.ts`, compilé dans `dist/`) ; les tests sont en JavaScript (`test/`, `node:test`). Détails : `docs/ARCHITECTURE.md`.
* **`src/commands/`** : Commandes slash (`/jouer`, `/stats`, `/plateau`, `/deviner`, `/documentation`, `/settings`, `/admin`, et `/dev` réservée au bot de dev) — présentation uniquement.
* **`src/discord/`** : `interaction.ts` (frontière : permissions MJ `config.mjUserId`, propriétaire du composant, accusé de réception, verrou, `GameRuleError` → message éphémère), `router.ts`, `admin-interactions.ts`, `channels.ts`, `pending-timers.ts`.
* **`src/gamemodes/`** : un dossier par mode (`mario_party/`, `ile_defis/`) avec `mode.ts`, `maps/<map>/board.ts`, `variants/`, `rules.ts` / `turn.ts` / `discord.ts` / `endgame.ts`, `mode-interface.ts` et `registry.ts`.
* **`src/services/`** : `enigma.ts`, `season.ts`, `admin.ts`, `player.ts`.
* **`src/game/`** : `transaction.ts` (verrou global `withGameLock` / `withScheduledLock`), `cron.ts`, `endgame.ts`, `enigma.ts`, `snapshot.ts`.
* **`src/db/`** : `database.ts`, `models.ts` (`Joueur`, `Plateau`, `TourSnapshot`), `migrations.ts` (versionnées, **jamais** de `sync({ alter: true })`), `backup.ts`.
* **`src/domain/`** : `types.ts` (`GameRuleError`, `PendingAction`, `Random`), `persisted.ts` (validation des champs JSON).
* **`src/utils/`** : `canvas.ts` (rendu du plateau), `remote-image.ts` (avatars sécurisés), `clock.ts` (`gameNow()`, simulable en dev), `time.ts` (heure de Paris), `health.ts`.
* **`docs/`** : `ARCHITECTURE.md`, `DATABASE.md`, `GAMEPLAY.md`, `OPERATIONS.md`, `TESTING.md`, `SETUP_DEV.md`, et **`EDGE_CASES.md`** (registre vivant des cas limites).
* **`deploy-commands.ts`** : enregistrement des commandes slash (`npm run deploy`).

---

## 🌐 Configuration propre à chaque instance

Les consignes publiques décrivent l'architecture et les commandes du projet. Les adresses d'administration, inventaires de services, chemins d'hébergement et procédures d'exploitation propres au mainteneur restent hors du dépôt Git.

- Utiliser uniquement les environnements et services explicitement autorisés pour la tâche. Une URL citée dans une documentation ne donne pas l'autorisation de contacter le service.
- Fournir les paramètres et secrets par l'environnement de l'instance. Ne jamais placer de token dans une URL, un exemple versionné, un log ou un message GitHub.
- Analyser les diagnostics localement par défaut. Avant tout partage de logs, stack traces, dumps ou données de joueurs, retirer les secrets et données personnelles ; ne transmettre que le minimum nécessaire, vers la destination expressément autorisée par l'utilisateur.
- Ne pas déployer ni contacter la production pour une simple tâche de développement. Toute opération de production doit être demandée et vérifiée séparément.

---

## 🛠️ Maintenance de cette Doc & des Skills (Source Unique)

* **`.agents/skills/*/SKILL.md` est la source unique** de chaque processus. Ce fichier (`AGENTS.md` / symlink `CLAUDE.md`), les symlinks `.claude/skills/*` et les commandes `.claude/commands/*.md` ne font que **pointer** vers les skills : ne jamais y recopier le contenu d'un skill (risque de divergence).
* Toute évolution d'un processus se fait dans le `SKILL.md` concerné, avec un **bump de `version`** dans son frontmatter.
* Les rapports d'audit préfixent leurs IDs d'anomalies par **`AUD-`** (`AUD-SEC-01`, `AUD-LOCK-01`…) pour éviter toute collision avec les IDs du registre `docs/EDGE_CASES.md` (`SEC-NN`, `DISC-NN`, `LOCK-NN`…).
* Pas de sections « prompts prêts à copier » dans les skills : les correctifs se décrivent directement dans le rapport par scope.
* `allowed-tools` dans le frontmatter d'un skill restreint les outils utilisables (ex : `issue-ritual` n'autorise aucun `git add` / `git commit` / `git push`).

---

## 🥋 Rituel Obligatoire pour Résoudre une Issue

> [!IMPORTANT]
> **Avant de toucher au code pour résoudre une issue, appliquer OBLIGATOIREMENT le Skill de rituel :**
> * **Skill complet (source unique)** : `.agents/skills/issue-ritual/SKILL.md` (accessible aussi via `.claude/skills/issue-ritual`)
> * **Commande rapide Claude Code** : `/resolve-issue <NUMERO>`

Le rituel en 5 phases — cadrage Git & issue → récapitulatif & plan avec **validation utilisateur obligatoire** → implémentation TDD strict (Verify RED, anti-bandaids, fiabilité Discord & sécurité) → porte de vérification « Evidence Before Claims » (`npm run check` + preuve cas limites + auto-contrôle sécurité) → bilan final **sans auto-commit** — est défini **uniquement** dans le `SKILL.md`. Ne pas recopier son contenu ici.

---

## 🧐 Code Reviewer Intransigeant

* **Skill complet** : `.agents/skills/code-reviewer/SKILL.md`
* **Commandes rapides** : `/code-review` (diff courant), `/code-review --full` (global), `/code-review <chemin/vers/fichier>`.

## 🧪 Test Auditor

* **Skill complet** : `.agents/skills/test-auditor/SKILL.md`
* **Commande rapide** : `/test-audit [--all | <module> | <fichier_test>]`.

## 🔒 Security Auditor

* **Skill complet** : `.agents/skills/security-auditor/SKILL.md`
* **Commande rapide** : `/security-audit [--full | <chemin>]`.

## 💡 Issue Crafter

* **Skill complet** : `.agents/skills/issue-crafter/SKILL.md`
* **Commande rapide** : `/create-issue [description ou idée]`.

---

## 🛠️ Commandes & Scripts Essentiels

### 1. Démarrage & Déploiement des Commandes Slash
```bash
npm start            # Compile (TypeScript -> dist/) puis lance le bot
npm run deploy       # Enregistre les commandes slash auprès de Discord
```

### 2. Vérification
```bash
npm run typecheck    # tsc --noEmit
npm run lint         # eslint .
npm test             # build puis tests (node:test, SQLite en mémoire)
npm run check        # les trois, comme la CI
```

### 3. Base de données & Docker
```bash
npm run db:migrate                      # applique les migrations
npm run db:backup -- /chemin/backup.sqlite
docker build -t enigme-bot .            # construit l'image de production
```
Voir `docs/OPERATIONS.md` avant toute migration ou restauration de base.

### 4. Test e2e sur le bot de dev (`/dev`)
```bash
# DEV_MODE=1 dans .env (bot de dev uniquement, jamais en prod)
npm run deploy
DATABASE_STORAGE=/tmp/enigme-e2e.sqlite npm start
```
* `/dev etape <publication_17h|indice_1..3|cloture_21h|ouverture_paris|resultat_paris|marche_noir|…>` exécute une étape planifiée immédiatement.
* `/dev horloge <jour> <heure> [minute]` / `/dev horloge_reset` simulent l'heure du jeu ; `/dev etat` résume l'état.
* Référence : `docs/SETUP_DEV.md` §5 ; scénario et résultats attendus : `docs/TESTING.md`.
* Toute nouvelle règle qui dépend de l'heure lit `gameNow()` (`src/utils/clock.ts`) ou un `now` injecté, **jamais** `new Date()` directement.

---

## 📐 Conventions de Code & Règles Non Négociables

### 1. Concurrence & Transactions (`src/game/transaction.ts`)
* Le verrou est **global** (plateau partagé) : une seule opération de jeu à la fois dans le processus. **Un seul conteneur / une seule instance** en production.
* Les interactions Discord sont déjà verrouillées par `src/discord/interaction.ts` ; un handler n'acquiert pas de verrou lui-même.
* Un service ou un cron utilise `withGameLock` / `withScheduledLock`, qui libèrent le verrou dans leur `finally` :
  ```typescript
  return withGameLock(userId, () => sequelize.transaction(async transaction => {
      // relire, valider (GameRuleError), écrire avec { transaction }
  }));
  ```
* Toute décision qui bloque un déplacement est persistée dans `joueurs.action_en_attente` ; un bouton ne doit agir que si le choix en attente correspond (sinon `GameRuleError('STALE')`).
* Une règle refusée lève `GameRuleError(code, message)` : la frontière l'affiche en éphémère sans log `[ERROR]`.
* Les envois Discord se font **après** la validation de la transaction SQL.

### 2. Délai d'Interaction Discord (Règle des 3 secondes)
* L'API Discord exige une réponse ou un accusé de réception sous 3000 ms.
* `src/discord/interaction.ts` accuse réception (`deferUpdate` / `deferReply` éphémère) avant tout handler et gère `10062` / `40060`.
* Exception : une interaction qui ouvre une modale doit être déclarée dans `opensModal` (`showModal` est sa réponse initiale).

### 3. Base de Données Sequelize & SQLite
* Les modifications liées entre plusieurs joueurs ou entre inventaire et pièces doivent utiliser `await sequelize.transaction(...)`.
* Pour les champs `DataTypes.JSON` (`inventaire`, `pieges_actifs`, `mode_data`), réassigner un nouvel objet/tableau ou appeler `joueur.changed('<champ>', true)`.
* Toute évolution de schéma passe par une migration versionnée dans `src/db/migrations.ts` (jamais `sync({ alter: true })`).

### 4. Journalisation Structurée & Observabilité
* **Horodatage géré par le runtime (Docker / systemd)** : ne pas concaténer d'horodatage ISO manuel (`new Date().toISOString()`) dans les messages de log.
* **Ségrégation Stderr vs Stdout** :
  * `stdout` (`console.log`) : flux standard (`[INTERACTION]`, `[LOCK]`, `[GAME]`, `[CRON]`, `[ADMIN]`, `[HEALTH]`, `[REGISTRY]`).
  * `stderr` (`console.warn`, `console.error`) : avertissements (`[WARN]`), timeouts Discord (`[TIMEOUT]`) et exceptions (`[ERROR]`).
* **Stack Traces** : toujours passer l'objet `Error` en second argument (`console.error('[ERROR] Échec lors de la transaction:', error)`).
* **Confidentialité & Diagnostics** : ne jamais dumper de gros JSON, buffers Canvas, tokens ou réponses d'énigmes dans les logs.

### 5. Registre Vivant des Cas Limites (`docs/EDGE_CASES.md`)
* Toute modification impactant des règles de bordure, transitions d'états (inactifs, fantômes, fin de saison), transactions économiques ou résiliences Discord DOIT maintenir [`docs/EDGE_CASES.md`](docs/EDGE_CASES.md) synchronisé (ajout des nouveaux cas avec test associé, purge ou mise à jour des cas obsolètes).

---

## 🐙 Conventions de Commits & PR

* Convention **Conventional Commits** :
  * `feat(scope): description`, `fix(scope): description`, `perf(canvas): description`, `refactor(scope): description`, `test(scope): description`, `chore(scope): description`.
* Scopes recommandés : `gameplay`, `canvas`, `admin`, `shop`, `items`, `cron`, `db`, `bot`.
* Mentionner le numéro de ticket GitHub associé si applicable (ex: `#18`).
* **Interdiction formelle d'exécuter `git commit` automatiquement** : l'agent prépare les changements et propose la commande de commit à l'utilisateur.
