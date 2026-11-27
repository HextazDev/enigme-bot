---
name: issue-ritual
version: "2.0.0"
description: Rituel d'exécution obligatoire pour Claude Code et Antigravity lors de la résolution de toute issue sur Enigme Bot. Comprend le cadrage Git initial, la présentation d'un plan d'implémentation à valider avant de coder, le TDD strict avec Verify RED, la couverture des cas limites via docs/EDGE_CASES.md, la checklist sécurité/fiabilité Discord (timeouts 3s, verrous transaction.ts, permissions MJ), la loi d'airain anti-bandaids, le protocole Evidence Before Claims (npm run check), et un bilan final sans commit automatique.
allowed-tools: "Read Write Edit Grep Glob Bash(git status:*) Bash(git diff:*) Bash(git log:*) Bash(git branch:*) Bash(git checkout:*) Bash(gh issue view:*) Bash(gh issue list:*) Bash(gh pr view:*) Bash(npm run check:*) Bash(npm run typecheck:*) Bash(npm run lint:*) Bash(npm test:*) Bash(npm run build:*) Bash(rg:*)"
metadata:
  no-auto-commit: true
---

# 🥋 Rituel de Résolution d'Issue - Enigme Bot

Ce rituel structure le travail de l'agent en **5 phases rigoureuses**. Il impose un **point d'arrêt obligatoire (Gate d'approbation)** après la récolte d'informations pour valider le plan avec l'utilisateur, applique une **discipline d'ingénierie d'élite (TDD, Anti-Band-Aids, Evidence Before Claims)**, et **interdit formellement tout commit automatique**.

---

## 🧭 Vue d'ensemble du Déroulement

```
┌─────────────────────────────────────────┐
│ PHASE 1 : Cadrage & Récolte d'Infos    │ ➜ Git context, gh issue view, DB, game logic, EDGE_CASES
└────────────────────┬────────────────────┘
                     ▼
┌─────────────────────────────────────────┐
│ PHASE 2 : 🛑 RÉCAPITULATIF & PLAN       │ ➜ Présenter le plan et attendre le feu vert explicite !
└────────────────────┬────────────────────┘
                     ▼ (Validation utilisateur)
┌─────────────────────────────────────────┐
│ PHASE 3 : Implémentation & TDD Strict   │ ➜ TDD Verify RED ➜ Sécurité ➜ Anti-Band-Aids ➜ DB ➜ Game ➜ Discord ➜ Canvas
└────────────────────┬────────────────────┘
                     ▼
┌─────────────────────────────────────────┐
│ PHASE 4 : 🧪 Porte de Vérification      │ ➜ npm run check + preuve cas limites + auto-contrôle sécurité
└────────────────────┬────────────────────┘
                     ▼
┌─────────────────────────────────────────┐
│ PHASE 5 : Bilan Final (Zéro Auto-Commit)│ ➜ Diff propre, mini-rapport 5 lignes, commande commit prête
└─────────────────────────────────────────┘
```

---

## 📍 PHASE 1 : Cadrage & Collecte d'Informations (Ne jamais coder à l'aveugle)

### 1.1 Contexte Git & État de la Branche (CRUCIAL)
Avant toute analyse, vérifier où l'on se trouve pour ne pas écraser de travail ou polluer l'historique :
```bash
git branch --show-current
git log main..HEAD --oneline
git status --short
git diff
```
* **Vérifications clés** :
  * Si la branche est `main` ou `master`, alerter l'utilisateur et recommander la création d'une branche dédiée : `git checkout -b feat/issue-<NUMERO>` (ou `fix/issue-<NUMERO>`).
  * Si des commits existent déjà sur la branche (`git log main..HEAD`), en prendre connaissance pour **ne pas réécrire ou réinventer ce qui a déjà été fait**.
  * Si des fichiers sont déjà modifiés/non commités (`git status`), les analyser pour distinguer ce qui relève du ticket en cours d'éventuels résidus d'une autre session.

### 1.2 Lire le ticket complet
```bash
gh issue view <NUMERO> --json number,title,body,labels
```
* Extraire les spécifications fonctionnelles, les fichiers cibles et les critères d'acceptation.
* Identifier la complexité et la priorité (`P0`, `P1`, `P2`).

### 1.3 Inspecter l'état réel du codebase
1. **Recherche de symboles existants** :
   ```bash
   rg "nomDuSymboleOuFonction" src/
   ```
2. **Vérité Base de Données Sequelize (`src/db/models.ts` & `src/db/migrations.ts`)** :
   * Inspecter les modèles `Joueur`, `Plateau`, `TourSnapshot` et les migrations existantes.
   * Vérifier les colonnes, types et validations JSON (`src/domain/persisted.ts`).
3. **Vérité Logique de Jeu (`src/gamemodes/`, `src/services/`, `src/game/`)** :
   * Vérifier comment les déplacements, achats, énigmes et crons interagissent avec le plateau.
   * Vérifier les verrous dans `src/game/transaction.ts` et la frontière Discord dans `src/discord/interaction.ts`.
4. **Registre des Cas Limites (`docs/EDGE_CASES.md`)** :
   * Consulter systématiquement `docs/EDGE_CASES.md` pour vérifier les invariants et cas limites existants relatifs au domaine touché.

---

## 🛑 PHASE 2 : Récapitulatif & Validation du Plan (POINT D'ARRÊT OBLIGATOIRE)

> [!IMPORTANT]
> **Ne modifier AUCUN fichier de code avant d'avoir présenté ce récapitulatif et obtenu la confirmation explicite de l'utilisateur.**

Produire un bilan clair structuré comme suit :
1. **🌿 Contexte Git** : Branche active, commits déjà existants pris en compte, statut des modifications locales en cours.
2. **🎯 Objectif & Périmètre** : Résumé en 2-3 phrases de ce que le ticket accomplit.
3. **📂 Fichiers impactés** : Liste ordonnée des fichiers à modifier ou créer.
4. **🗄️ Impact Base de Données** : Colonnes Sequelize (`src/db/models.ts`) et nouvelle migration versionnée (`src/db/migrations.ts`), ou « Aucun ».
5. **⚠️ Cas limites, Concurrence & Sécurité** :
   - Gestion du timeout Discord 3s (`src/discord/interaction.ts`, déclaration dans `opensModal` si modale).
   - Verrouillage (`withGameLock` / `withScheduledLock`) et atomicité transactionnelle (`sequelize.transaction`).
   - Contrôle d'accès (`config.mjUserId`, propriétaire du composant, `action_en_attente`).
   - Cas limites de gameplay (soldes négatifs impossibles, inventaire plein, joueur fantôme, égalités, horloge `gameNow()`).
   - Impact sur `docs/EDGE_CASES.md` (IDs existants impactés, nouveaux cas à consigner, ou cas obsolètes à purger).
6. **🧪 Stratégie de tests & validation** : Tests unitaires/intégration à ajouter dans `test/` (`node:test`) et validation `npm run check`.
7. **❓ Questions / Arbitrages éventuels** (si ambiguïté subsistante).
8. **Demande explicite** : *« Ce plan te convient-il ? Dois-je commencer l'implémentation ? »*

---

## 💻 PHASE 3 : Implémentation Rigoureuse & Discipline d'Ingénierie

Appliquer les modifications dans l'ordre strict des dépendances du projet :

```
1. src/db/models.ts + migrations.ts ➜ Schéma Joueur / Plateau / TourSnapshot (jamais sync({ alter: true }))
2. src/gamemodes/*/rules.ts, turn.ts ➜ Règles pures (Random / now injectables) & services transactionnels
3. src/services/ & src/game/         ➜ Énigme, saison, admin ; verrous, crons, fin de saison
4. src/discord/, src/commands/, src/gamemodes/*/discord.ts ➜ Routage, boutons, modales, annonces
5. src/utils/canvas.ts               ➜ Rendu visuel du plateau
6. test/                             ➜ Tests automatisés (node:test + SQLite :memory:)
7. docs/EDGE_CASES.md (+ docs/)      ➜ Synchronisation du registre des cas limites (ajout ou purge)
```

### 3.0 — Discipline d'Ingénierie & TDD Strict

- **TDD strict pour la logique métier et les calculs de règles** (déplacements, effets d'objets, boutique, paris, planning, permissions) :
  1. *RED* : Écrire le test décrivant le comportement attendu avant le code métier.
  2. *VERIFY RED (Obligatoire)* : Exécuter le test et **constater l'échec pour la raison attendue**. Un test qui passe immédiatement ne prouve rien.
  3. *GREEN* : Écrire le code minimal strict pour satisfaire le test.
  4. *VERIFY GREEN* : Ré-exécuter et vérifier que le test passe au vert.
  5. *REFACTOR* : Factoriser et nettoyer en restant vert.
  - Pour tout contrôle d'accès ajouté : tester le chemin **refusé** (non-MJ, mauvais propriétaire, bouton périmé `STALE`) autant que le chemin accepté.

- **Loi d'Airain Anti-Symptôme (Anti-Band-Aids & Anti-`any`)** :
  - **Aucune modification de code sans avoir formellement identifié et prouvé la cause racine.**
  - **Interdiction formelle de poser une rustine pour faire taire TypeScript ou masquer une erreur console** : pas de `?.` sauvage, pas de `try/catch` vide qui étouffe une exception sans rollback, pas de fallback magique (`?? 0` ou `|| []`) camouflant une corruption de données, pas de `as any` abusif.

- **Synchronisation Obligatoire du Registre des Cas Limites (`docs/EDGE_CASES.md`)** :
  - **Compléter** : consigner tout nouveau cas limite, comportement aux frontières ou correctif critique avec son ID, son comportement attendu et le test de non-régression associé.
  - **Purger / Mettre à jour** : si une règle change ou devient obsolète, mettre à jour ou supprimer immédiatement les entrées concernées.

### 3.1 — Checklist Sécurité & Fiabilité Discord (Non Négociable)

- **Délai Discord 3 secondes** : assuré centralement par `src/discord/interaction.ts` (`deferUpdate` / `deferReply` avant le handler). Ne jamais le contourner ; toute interaction ouvrant une modale doit être déclarée dans `opensModal`.
- **Verrouillage global (`src/game/transaction.ts`)** :
  - Les interactions sont déjà verrouillées par `src/discord/interaction.ts` : un handler n'acquiert pas de verrou lui-même.
  - Toute écriture hors interaction (cron, timer, service autonome) passe par `withGameLock` / `withScheduledLock` (libération garantie en `finally`).
- **Atomisme SQLite & Sequelize** :
  - Toute mutation liée (économie, inventaire, vol, échange, annulation de tour) s'exécute dans `sequelize.transaction(...)`.
  - Pour les champs JSON mutés en place, appeler `model.changed('<champ>', true)` ou réassigner un nouvel objet/tableau.
  - Les envois Discord (annonces, MP) se font **après** la validation de la transaction SQL.
- **Permissions & Propriété** :
  - Toute commande/composant MJ passe par `isPrivileged` (`config.mjUserId`) dans `src/discord/interaction.ts`.
  - Tout choix bloquant un déplacement est persisté dans `joueurs.action_en_attente` et vérifié avant résolution (`GameRuleError('STALE', ...)`).
  - Réponses privées en éphémère (`MessageFlags.Ephemeral`).
- **Horloge testable** : toute nouvelle règle dépendant de l'heure lit `gameNow()` (`src/utils/clock.ts`) ou un `now` injecté — **jamais** `new Date()` directement.
- **Confidentialité** : zéro secret, zéro solution d'énigme (`enigme_reponse`) et zéro indice non publié dans les logs ou messages publics.

---

## 🧪 PHASE 4 : Porte de Vérification (« Evidence Before Claims »)

> [!CAUTION]
> **Interdiction formelle d'affirmer qu'une tâche est terminée, qu'un bug est résolu ou que le code compile sans en apporter la preuve terminale fraîche.**

1. **Suite complète (typage, lint, build et tests)** :
   ```bash
   npm run check
   ```
   *(0 erreur tolérée, code de sortie 0 ; si échec, corriger à la racine avant de continuer.)*
2. **Preuve des cas limites** : pour chaque cas limite annoncé en Phase 2, citer le test qui le couvre et vérifier qu'il figure dans la sortie de `npm run check`.
3. **Auto-contrôle sécurité** : si le diff touche `src/discord/`, `src/commands/admin.ts`, `src/game/transaction.ts`, `src/services/` ou `src/db/`, relire le diff avec la checklist du skill `security-auditor` (ou lancer `/security-audit <chemin>`) et reporter le résultat dans le bilan. Toute faille 🔴 bloque la clôture.

---

## 📦 PHASE 5 : Bilan Final & Clôture (PAS D'AUTO-COMMIT)

> [!CAUTION]
> **Interdiction formelle d'exécuter `git commit` automatiquement.**
> Le commit appartient à l'utilisateur. L'agent prépare le terrain, audite la propreté du diff, et fournit la commande de commit prête à copier.

### 5.1 Audit de propreté du Diff
```bash
git status
git diff
```
* **Nettoyage strict** : Aucun `console.log("DEBUG", ...)` résiduel, aucun fichier temporaire, aucun code mort, aucun `any` introduit, et **`docs/EDGE_CASES.md` synchronisé**.

### 5.2 Mini-Rapport de Clôture (5 lignes max)
Terminer systématiquement par un rapport dense et percutant :
1. **Fichiers modifiés** : Liste synthétique des fichiers code, migrations, tests et documentation touchés (`docs/EDGE_CASES.md`).
2. **Preuves terminales validées** : `npm run check` (`typecheck` 0 erreur, `lint` 0 erreur, `test` X/X passés).
3. **Cas limites & sécurité** : IDs `docs/EDGE_CASES.md` couverts et résultat de l'auto-contrôle sécurité (ou « aucun impact »).
4. **Test local** : Commande pour tester localement (`npm start` ; ou `/dev` si `DEV_MODE=1` sur le bot de dev).
5. **Commande de commit suggérée** :
   ```bash
   git add <fichiers concernés>
   git commit -m "<type>(<scope>): <description claire> (#<NUMERO>)"
   git push origin HEAD # Ouvrir une PR, sans déploiement implicite.
   ```
