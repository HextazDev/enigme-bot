---
name: issue-crafter
version: "2.0.0"
description: Skill d'interview interactive et de cadrage de tickets pour Enigme Bot (Lead Product Manager & Staff Engineer). Dialogue avec l'utilisateur pour challenger le besoin d'un nouveau mécanisme de jeu, d'une commande ou d'une correction, vérifier l'architecture TypeScript (DB, migrations, gamemodes, services, discord, canvas), traquer les doublons, et rédiger une spécification Agent-Ready complète publiable via gh issue create.
allowed-tools: "Read Grep Glob Bash(gh issue list:*) Bash(gh issue view:*) Bash(gh issue create:*) Bash(rg:*)"
---

# 💡 Skill Issue Crafter - Enigme Bot

Ce skill transforme n'importe quelle idée brute (nouveau mode de jeu, mini-jeu de plateau, objet de boutique, commande MJ, amélioration Canvas) en une **spécification technique de niveau Staff Engineer (« Agent-Ready »)**, prête à être validée puis publiée sur GitHub.

---

## 🎭 Posture : Lead Product Manager & Staff Engineer

L'agent ne doit **pas** être un simple secrétaire passif. Il doit **challenger l'idée avec bienveillance et rigueur** :
1. **Tester la valeur ludique & l'équilibre du jeu** : Cet ajout enrichit-il l'expérience sans casser l'équilibre économique (pièces/étoiles) ? Pour quel persona :
   - **Joueur** (plaisir de jeu, clarté des règles, fluidité mobile, temps de réponse) ?
   - **Maître du Jeu (MJ)** (facilité d'animation, arbitrage `/admin`, configuration) ?
   - **Développeur** (modularité des modes, maintenabilité, perf Canvas, résilience Discord) ?
2. **Éviter la dispersion & les doublons** : Le besoin n'est-il pas déjà couvert ou amorcé dans un ticket ou fichier existant ?
3. **Cadrer le MVP vs Nice-to-Have** : L'idée est-elle trop vaste ? Faut-il la découper (ex: règles métier d'abord, rendu Canvas ensuite) ?
4. **Respecter l'arbre de dépendances** : Cette feature nécessite-t-elle une évolution DB (`src/db/models.ts` + migration dans `src/db/migrations.ts`) ou un prérequis déjà ouvert ?

---

## 🧭 Le Processus en 5 Phases

```
┌─────────────────────────────────────────────────────────┐
│ PHASE 1 : 🎙️ Interview & Challenge Produit              │ ➜ Questionner, challenger, chercher doublons
└────────────────────────────┬────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────┐
│ PHASE 2 : 🔍 Grounding Technique dans le Codebase       │ ➜ DB/migrations, Gamemodes, Services, Discord, Canvas
└────────────────────────────┬────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────┐
│ PHASE 3 : 📝 Rédaction Haute Définition ("Agent-Ready") │ ➜ Spécification complète + Triage proposé
└────────────────────────────┬────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────┐
│ PHASE 4 : 🛑 Validation & Accord Utilisateur (Point Stop)│ ➜ Revue du brouillon avant publication
└────────────────────────────┬────────────────────────────┘
                             ▼ (Accord utilisateur)
┌─────────────────────────────────────────────────────────┐
│ PHASE 5 : 🚀 Publication GitHub CLI (`gh`)              │ ➜ gh issue create avec labels et priorité
└─────────────────────────────────────────────────────────┘
```

---

## 🎙️ PHASE 1 : Interview & Challenge Produit

### 1. Recherche de doublons ou recoupements
```bash
gh issue list --state all --search "<mots-clés>" --limit 20
```
* Si un ticket similaire existe déjà : alerter immédiatement l'utilisateur et proposer d'enrichir le ticket existant plutôt que d'en créer un nouveau.

### 2. Le Questionnement Constructif (2 à 3 questions max, précises)
* **Persona & Cas d'usage** : Qui déclenche l'action ? À quel moment de la boucle de jeu (avant lancer, en passant devant une case, énigme, week-end, commande MJ) ?
* **Équilibre & Règles** : Coût en pièces ? Fréquence ? Comportement si solde insuffisant, inventaire plein ou joueur fantôme ?
* **Périmètre & MVP** : Quelle est la version minimale viable ?

---

## 🔍 PHASE 2 : Grounding Technique dans le Codebase

Inspecter le code réel avant de rédiger la spec :
1. **Base de données Sequelize (`src/db/models.ts` & `src/db/migrations.ts`)** :
   - Nouvelles colonnes sur `Joueur`, `Plateau` ou `TourSnapshot` + migration versionnée ?
   - Validation JSON dans `src/domain/persisted.ts` ?
2. **Modes de Jeu (`src/gamemodes/`)** :
   - Spécifique à `mario_party`, `ile_defis`, ou générique via `src/gamemodes/mode-interface.ts` ?
   - Règles pures (`rules.ts`, `landing.ts`, `shop.ts`) vs services transactionnels (`turn.ts`).
3. **Services & Moteur (`src/services/`, `src/game/`)** :
   - `services/enigma.ts`, `services/season.ts`, `services/admin.ts`, `game/cron.ts`, `game/endgame.ts`, `game/transaction.ts`.
   - Dépendance à l'heure ? Utiliser `gameNow()` (`src/utils/clock.ts`) ou un `now` injecté.
4. **Couche Discord (`src/commands/`, `src/discord/`, `src/gamemodes/*/discord.ts`)** :
   - Nouvelle commande slash, sous-commande `/admin`, bouton, select menu ou modale (`opensModal` si modale, `isPrivileged` si MJ) ?
5. **Rendu Visuel Canvas (`src/utils/canvas.ts`)** :
   - Impact sur l'image du plateau ou nouveau rendu ?
6. **Agnosticisme d'hébergement** :
   - Ne jamais lier un ticket à un serveur privé, un nom de machine, un domaine ou un reverse proxy spécifique. Rester 100 % configurable par variables d'environnement et compatible conteneur Docker.

---

## 📝 PHASE 3 : Rédaction Haute Définition (« Agent-Ready »)

```markdown
## 📌 Contexte & Problème
Description claire du besoin de gameplay, du problème constaté ou de la dette technique.

## 🎯 Spécifications Fonctionnelles
- **User Story** : En tant que [Joueur / Maître du Jeu / Développeur], je veux [Action] afin de [Bénéfice].
- **Parcours / Déroulement** : Description pas à pas du flux d'interaction (boutons, réponses éphémères, annonces publiques).

## 🛠️ Spécifications Techniques (Grounding Codebase)
- **Base de Données (`src/db/models.ts`, `src/db/migrations.ts`)** : Colonnes et migration éventuelle.
- **Logique Métier (`src/gamemodes/`, `src/services/`, `src/game/`)** : Règles pures, transactions, coûts, probabilités, horloge `gameNow()`.
- **Interactions Discord (`src/commands/`, `src/discord/`, `src/gamemodes/*/discord.ts`)** : Commandes, `customId`, modales, `MessageFlags.Ephemeral`.
- **Rendu Visuel (`src/utils/canvas.ts`)** : Nouvelles cases, icônes, ou « Aucun impact ».

## 📂 Fichiers Cibles Identifiés
- `src/...`
- `test/...`
- `docs/EDGE_CASES.md`

## ⚠️ Cas Limites, Concurrence & Sécurité
- **Frontière Discord (`src/discord/interaction.ts`)** : Modale à déclarer dans `opensModal` ? Action MJ à protéger dans `isPrivileged` ?
- **Verrous & Transactions** : Écriture hors interaction nécessitant `withScheduledLock` ? Mutations liées dans `sequelize.transaction` ?
- **Cas limites de gameplay** : Solde nul/insuffisant, inventaire plein (3 objets max), joueur fantôme, boutons périmés (`STALE`), redémarrage.

## ✅ Critères d'Acceptation (Definition of Done)
- [ ] Comportement conforme sans erreur Discord (`10062` / `40060`)
- [ ] Transactions atomiques et verrous respectés
- [ ] Cas limites consignés dans `docs/EDGE_CASES.md` et couverts par des tests (`npm run check` au vert)
```

### Métadonnées & Triage proposés :
* **Titre standardisé** : `feat(scope): <description courte>` ou `fix(...)` / `refactor(...)`
  - Scopes recommandés : `gameplay`, `canvas`, `admin`, `shop`, `items`, `cron`, `db`, `bot`.
* **Labels** : `enhancement`, `bug`, `gameplay`, `canvas`, `admin`, `game-design`, `infra`, `refactor`.
* **Priorité** : `P0` (Critique/Sécu/Blocage), `P1` (Gameplay Cœur), `P2` (Polissage/Backlog).
* **Taille** : `XS` (< 1h), `S` (demi-journée), `M` (1-2 jours), `L` (3-4 jours).

---

## 🛑 PHASE 4 : Validation & Accord Utilisateur (Point d'arrêt obligatoire)

> [!IMPORTANT]
> **Ne JAMAIS exécuter `gh issue create` sans avoir présenté le brouillon complet et obtenu la validation explicite de l'utilisateur.**

Afficher le brouillon complet avec le cadrage proposé (Priorité, Taille, Labels) et demander :
> *« Voici la spécification complète proposée pour ce ticket. Le contenu, la priorité (**P...**) et la taille (**...**) te conviennent-ils, ou souhaites-tu ajuster certains points avant publication ? »*

---

## 🚀 PHASE 5 : Publication GitHub CLI

Dès validation explicite :
```bash
gh issue create \
  --title "feat(scope): Description claire" \
  --body "Contenu markdown rédigé en Phase 3" \
  --label "enhancement,gameplay"
```
*(Capturer l'URL et le numéro retournés, ex: `https://github.com/HextazDev/enigme-bot/issues/26`.)*

Restituer un récapitulatif clair :
* 🔗 Lien direct vers l'issue créée (`#<NUMERO>`)
* 📋 Synthèse du cadrage (Priorité, Taille, Périmètre)
* 💡 Commande suggérée : `/resolve-issue <NUMERO>`
