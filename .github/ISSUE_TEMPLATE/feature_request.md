---
name: "🚀 Nouvelle Fonctionnalité / Règle de Jeu"
about: "Proposer un nouvel objet, événement de plateau, commande MJ ou amélioration de gameplay (Format Agent-Ready)"
title: "feat(scope): Description courte"
labels: ["enhancement"]
assignees: ""
---

## 📌 Contexte & Problème
<!-- Description claire du besoin de gameplay, du problème constaté ou de l'opportunité. Pourquoi ce changement est-il nécessaire ? -->

## 🎯 Spécifications Fonctionnelles
- **User Story** : En tant que [Joueur / Maître du Jeu / Développeur], je veux [action] afin de [bénéfice de gameplay].
- **Parcours joueur / Déroulement** :
  1. Le joueur déclenche...
  2. Le bot répond par...
  3. L'effet appliqué est...

## 🛠️ Spécifications Techniques (Grounding Codebase)
- **Base de Données (`src/db/models.ts`, `src/db/migrations.ts`)** : <!-- Colonnes Sequelize et migration versionnée à ajouter sur Joueur, Plateau ou TourSnapshot -->
- **Logique Métier (`src/gamemodes/`, `src/services/`, `src/game/`)** : <!-- Règles pures, coûts, probabilités, horloge gameNow() -->
- **Interactions Discord (`src/commands/`, `src/discord/`, `src/gamemodes/*/discord.ts`)** : <!-- Commandes slash, customId, modales (opensModal), MessageFlags.Ephemeral -->
- **Rendu Visuel (`src/utils/canvas.ts`)** : <!-- Nouvelles icônes, coordonnées, impact sur l'image du plateau -->

## 📂 Fichiers Cibles Identifiés
- `src/db/models.ts` / `src/db/migrations.ts`
- `src/gamemodes/...`
- `src/services/...` / `src/game/...`
- `src/commands/...` / `src/discord/...`
- `src/utils/canvas.ts`
- `test/...`
- `docs/EDGE_CASES.md`

## ⚠️ Cas Limites, Concurrence & Sécurité
- **Frontière Discord (`src/discord/interaction.ts`)** : Modale à déclarer dans `opensModal` ? Action MJ dans `isPrivileged` ?
- **Verrous & Transactions** : Écriture hors interaction nécessitant `withScheduledLock` ? Mutations liées dans `sequelize.transaction` ?
- **Cas limites de gameplay** : Solde insuffisant, inventaire plein (3 objets max), joueur inactif/fantôme, boutons périmés (`STALE`), redémarrage.
- **Sécurité** : Si commande d'administration, restriction stricte à `config.mjUserId`.

## ✅ Critères d'Acceptation (Definition of Done)
- [ ] La mécanique fonctionne comme décrit sans erreur d'interaction Discord (zéro code `10062` / `40060`)
- [ ] Les verrous (`withGameLock` / `withScheduledLock`) et transactions SQLite sont respectés
- [ ] Les cas limites sont consignés dans `docs/EDGE_CASES.md` et validés par des tests (`npm run check` au vert)

---

### Triage Proposé :
* **Priorité** : [P0: Critique | P1: Gameplay Cœur | P2: Polissage]
* **Taille estimée** : [XS (< 1h) | S (demi-journée) | M (1-2 jours) | L (3-4 jours)]
