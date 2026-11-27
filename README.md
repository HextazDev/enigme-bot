# 🧩 Enigme Bot (Mario Party Discord)

[![Node.js](https://img.shields.io/badge/Node.js-22.13%2B%20%7C%2024-green.svg)](https://nodejs.org/)
[![Discord.js](https://img.shields.io/badge/Discord.js-v14-blue.svg)](https://discord.js.org/)
[![Database](https://img.shields.io/badge/SQLite-Sequelize-orange.svg)](https://sequelize.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](tsconfig.json)

Un bot Discord interactif combinant des **énigmes quotidiennes** avec un **jeu de plateau style Mario Party**. Les joueurs gagnent des pièces en résolvant les énigmes, puis lancent des dés pour progresser sur un plateau généré dynamiquement en image (Canvas), acheter des objets stratégiques, déclencher des événements chaotiques et récolter des Étoiles !

---

## 🌟 Fonctionnalités Clés

- 🎨 **Plateau Dynamique en Temps Réel** : Rendu graphique 2D généré par Node-Canvas avec avatars, pions, pièges et étoiles.
- 🎲 **Système de Déplacement & "Passer Devant"** : 1 lancer par jour (déverrouillé à 21h après l'énigme). Pause automatique en franchissant l'Étoile, la Boutique, Boo ou une intersection, puis continuation du mouvement restant ; le choix reste disponible via `/jouer` même après un redémarrage.
- 🟦 **Cases Interactives & Événements** :
  - 🟦 Cases Bleues (+3 pièces) / 🟥 Cases Rouges (-3 pièces)
  - 🍀 Roulette Chance / 🌩️ Roulette Malchance
  - 👻 Case Boo (Vol de pièces gratuit ou vol d'Étoile pour 50 pièces)
  - 🔥 Case Bowser (Événements catastrophiques et impôts)
  - 🎭 Coup du Sort (Échanges aléatoires de places ou de trésors)
- 🎒 **Boutique & Inventaire** : Champignon (+3), Dé pipé (1-10), Double Dé, Tuyau, Miroir, Sifflet, Clé des zones bonus et Pièges (3 objets max).
- 📅 **Week-End Spéciaux** : Paris du samedi sur une course de Yoshis & Marché Noir du dimanche aux objets légendaires.
- 👻 **Gestion de l'Inactivité** : Transformation automatique en fantôme après 3 jours d'inactivité.
- 🧩 **Architecture Multi-Modes** : Support du mode standard Mario Party (`mario_party`) et du mode alternatif Île aux Défis (`ile_defis`).

---

## 📚 Documentation Complète

Pour tout savoir sur le fonctionnement, les règles et le code :

| Document | Description |
| :--- | :--- |
| 🛠️ [**Guide d'Installation Développeur**](docs/SETUP_DEV.md) | Guide pas-à-pas pour configurer son bot de test local et son serveur dédié. |
| 🏗️ [**Architecture Technique**](docs/ARCHITECTURE.md) | Fonctionnement interne, verrous atomiques, modèle de données et Canvas. |
| 🎲 [**Manuel de Gameplay & Règles**](docs/GAMEPLAY.md) | Règles exhaustives, cycles journaliers, économie et probabilités. |
| 🗄️ [**Schéma de données**](docs/DATABASE.md) | Tables, colonnes, formats JSON et migrations. |
| 🚀 [**Exploitation**](docs/OPERATIONS.md) | Déploiement, sauvegarde, restauration et diagnostic. |
| 🧪 [**Tests**](docs/TESTING.md) | Ce que prouve chaque suite de tests. |
| 🛡️ [**Registre des Cas Limites**](docs/EDGE_CASES.md) | Invariants de sécurité, timeouts Discord 3s et tests de non-régression. |

---

## ⚡ Démarrage Rapide (En 3 Étapes)

### 1. Cloner et installer les dépendances
```bash
git clone git@github.com:HextazDev/enigme-bot.git
cd enigme-bot
npm install
```

### 2. Configurer votre environnement de test
```bash
cp .env.example .env
# Remplissez votre DISCORD_TOKEN, CLIENT_ID, GUILD_ID de test dans .env
```
*(Consultez [docs/SETUP_DEV.md](docs/SETUP_DEV.md) pour créer gratuitement votre bot de dev sur le portail Discord).*

### 3. Déployer les commandes et lancer
```bash
# Déployer les commandes slash sur votre serveur de test
npm run deploy

# Typage, lint et tests (comme la CI)
npm run check

# Compiler et démarrer le bot localement
npm start
```

---

## 📜 Commandes Slash Principales

| Commande | Description |
| :--- | :--- |
| `/jouer` | Ouvre l'interface de tour (utiliser un objet, lancer le dé, voir l'inventaire). |
| `/plateau` | Affiche l'image Canvas du plateau (navigation par zone sur l'Île aux défis). |
| `/stats` | Affiche le classement général de la saison (Étoiles et Pièces). |
| `/deviner` | Permet de soumettre une réponse secrète à l'énigme du jour (entre 17h et 21h). |
| `/documentation` | Ouvre le livret de règles interactif directement dans Discord. |
| `/settings` | Active ou désactive les rappels automatiques en MP (énigme, fin de tour). |
| `/admin` | Outils du Maître du Jeu (don de pièces, avancement de tour, arrêt de saison). |
| `/dev` | **Bot de dev uniquement** (`DEV_MODE=1`) : déclencher les étapes planifiées, simuler l'heure, voir l'état. Voir [SETUP_DEV §5](docs/SETUP_DEV.md#-5-tester-en-conditions-réelles-sur-le-bot-de-dev-dev). |

---

## 🤝 Collaboration & Contribution

Le projet est développé en équipe selon les standards suivants :
- **Git Flow** : Interdiction de commit direct sur `main` (publication automatique de l'image Docker de production sur GHCR). Branches de features (`feat/...`, `fix/...`) avec Pull Requests.
- **TDD Strict & Anti-Band-Aids** : Tout ajout de règle ou correction de bug est validé par un test automatisé (`npm run check`).
- **Concurrence & Fiabilité** : Verrou global (`withGameLock`), transactions SQL atomiques pour l'économie, migrations versionnées et accusé de réception Discord centralisé (`src/discord/interaction.ts`).
