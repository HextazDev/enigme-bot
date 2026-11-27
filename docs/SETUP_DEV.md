# 🛠️ Guide d'Installation & Environnement de Développement (Dev Onboarding)

Ce guide s'adresse aux développeurs rejoignant le projet **Enigme Bot**. Suivez scrupuleusement ces étapes pour configurer votre environnement de travail local sans interférer avec la production ou avec les autres membres de l'équipe.

---

## ⚠️ Règle Fondamentale : Pas de Bot Discord Partagé en Local !

> [!CAUTION]
> **Ne JAMAIS partager un token de bot Discord en local entre plusieurs développeurs.**
> Si deux développeurs démarrent `npm start` avec le même `DISCORD_TOKEN`, Discord ouvrira deux connexions WebSocket concurrentes et déconnectera vos sessions à tour de rôle en boucle (erreur de heartbeat / 4004 / 4000).
> **Chaque développeur doit avoir sa propre application Discord de test et son propre serveur Discord.**

---

## 📋 1. Prérequis Système

* **Node.js** : 22.13 minimum, 24 recommandé (comme la CI et Docker) (`node -v`).
* **npm** : version 9+ (`npm -v`).
* **Git** (`git --version`) configuré avec votre compte GitHub.
* **GitHub CLI** (`gh`) authentifié (`gh auth status`).
* **Compte Discord** avec le mode développeur activé (*Paramètres Discord -> Avancés -> Mode développeur*).

---

## 🤖 2. Création de Votre Bot Discord de Test (5 min)

1. Rendez-vous sur le **[Discord Developer Portal](https://discord.com/developers/applications)**.
2. Cliquez sur **New Application**, nommez-la (ex: `EnigmeBot-Dev-<VotrePrenom>`).
3. Allez dans l'onglet **Bot** :
   - Cliquez sur **Reset Token** et copiez immédiatement le token (ce sera votre `DISCORD_TOKEN`).
   - Descendez à la section **Privileged Gateway Intents** et activez impérativement :
     - ✅ **Server Members Intent**
     - ✅ **Message Content Intent**
   - Sauvegardez les modifications.
4. Allez dans l'onglet **OAuth2 ➔ URL Generator** :
   - Cochez les scopes : `bot` et `applications.commands`.
   - Cochez les permissions bot : `Administrator` (pour vos tests locaux sur votre serveur dédié).
   - Copiez l'URL générée en bas et ouvrez-la dans votre navigateur pour inviter votre bot sur votre propre serveur Discord de test.

---

## 💻 3. Installation Locale du Projet

### A. Cloner le dépôt
```bash
git clone git@github.com:Hextaz/enigme-bot.git
cd enigme-bot
```

### B. Installer les dépendances
```bash
npm install
```
*(Le paquet `canvas` compile des bindings C++ ; sur Linux, vous pouvez avoir besoin de `build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev` si npm échoue).*

### C. Configurer vos variables d'environnement
Copiez le modèle `.env.example` en `.env.local` (recommandé) ou `.env` :
```bash
cp .env.example .env.local
```
Les deux fichiers sont ignorés par Git. `.env.local` est chargé en premier : ses valeurs priment sur celles de `.env`. Éditez-le avec vos identifiants de test :
* `DISCORD_TOKEN` : Le token copié depuis le Developer Portal.
* `CLIENT_ID` : L'Application ID trouvé dans l'onglet *General Information* de votre application Discord.
* `GUILD_ID` : L'identifiant de votre serveur Discord de test (*Clic droit sur le serveur -> Copier l'identifiant du serveur*).
* `ENIGMA_CHANNEL_ID` : L'identifiant d'un salon texte de test pour les énigmes (*Clic droit sur le salon -> Copier l'identifiant du salon*).
* `BOARD_CHANNEL_ID` : L'identifiant d'un salon texte de test pour le plateau.
* `MJ_USER_ID` : Votre propre ID Discord (*Clic droit sur votre profil -> Copier l'identifiant d'utilisateur*) afin d'avoir accès aux commandes `/admin`.
* `DEV_MODE=1` : active les outils de test `/dev` (voir la [section 5](#-5-tester-en-conditions-réelles-sur-le-bot-de-dev-dev)). **Bot de dev uniquement**, jamais en production.

---

## 🚀 4. Déploiement des Commandes & Lancement

### A. Enregistrer les commandes slash auprès de Discord
Cette commande publie les définitions de `/jouer`, `/plateau`, `/stats`, `/admin`, etc. sur votre serveur de test (et `/dev` si `DEV_MODE=1`) :
```bash
npm run deploy
```
À relancer après chaque ajout ou modification d'une commande dans `src/commands/`, ou après avoir changé `DEV_MODE`. Si une commande n'apparaît pas, rechargez Discord (`Ctrl+R`).

### B. Démarrer le bot localement
```bash
npm start
```
Vous devriez voir les logs de démarrage :
```
[REGISTRY] 2 mode(s) de jeu détecté(s) : ile_defis, mario_party
[HEALTH] Prêt ! Connecté en tant que EnigmeBot-Dev#0000
```
Par défaut, le bot utilise `database.sqlite` à la racine du projet. Pour une session de test que l'on peut jeter, pointez vers une autre base :
```bash
DATABASE_STORAGE=/tmp/enigme-e2e.sqlite npm start
```

---

## 🎮 5. Tester en Conditions Réelles sur le Bot de Dev (`/dev`)

Le jeu suit l'heure de Paris : énigme publiée à 17h en semaine, indices à 18h, 19h et 20h, clôture à 21h, paris le samedi, Marché Noir le dimanche. Sans outil, il faudrait attendre ces horaires pour tester. Avec `DEV_MODE=1`, la commande `/dev` permet de rejouer une journée complète en quelques minutes.

### A. Activation
1. Ajoutez `DEV_MODE=1` dans votre `.env.local`.
2. `npm run deploy` (enregistre `/dev` sur votre serveur de test), puis `npm start`.
3. `/dev` est réservé au compte `MJ_USER_ID`. Elle n'est ni enregistrée ni chargée, et elle est refusée à l'exécution sans `DEV_MODE=1` : elle ne peut pas exister en production.

### B. Référence des commandes

| Commande | Effet |
| :--- | :--- |
| `/dev etape <étape>` | Exécute **maintenant** une étape planifiée, avec le même code que le cron. Répond avec l'état du jeu après l'étape. |
| `/dev horloge <jour> <heure> [minute]` | Simule l'heure du jeu : prochain `<jour>` (aujourd'hui inclus) à `<heure>:<minute>`, heure de Paris. |
| `/dev horloge_reset` | Revient à l'heure réelle. |
| `/dev etat` | Résumé privé : horloge (réelle ou simulée), plateau, énigme, indices publiés, paris, ton joueur. |

Étapes disponibles pour `/dev etape` :

| Étape | Cron réel | Effet |
| :--- | :--- | :--- |
| `rappel_15h` | Lun-ven 15h | MP de rappel aux joueurs qui n'ont pas joué (`/settings rappel_tour`). |
| `publication_17h` | Lun-ven 17h | Publie l'énigme programmée, verrouille le plateau, tour + 1, fantômes. Sans énigme programmée : le plateau reste ouvert. |
| `indice_1` / `indice_2` / `indice_3` | Lun-ven 18h / 19h / 20h | Publie l'indice s'il existe et n'a pas déjà été publié. |
| `cloture_21h` | Lun-ven 21h | Clôt l'énigme, annonce la réponse et les gagnants, rouvre le plateau. |
| `rappel_samedi` | Samedi 8h | Rappel avant la fermeture du plateau. |
| `ouverture_paris` | Samedi 10h | Ferme le plateau et ouvre les paris de la course de Yoshi (boutons). |
| `resultat_paris` | Samedi 21h | Tire le gagnant, paie les parieurs, commente la course. |
| `marche_noir` | Dimanche 11h | Ouvre le plateau avec le Marché Noir. |

Relancer une étape déjà faite est sans effet : indice déjà publié, paris déjà ouverts, etc.

### C. Ce que change l'horloge simulée
Toutes les règles qui lisent l'heure passent par `gameNow()` (`src/utils/clock.ts`) :
- **samedi** simulé : dé interdit ; **dimanche** simulé : Marché Noir ;
- **tranche de récompense** d'une bonne réponse : calculée sur l'heure simulée du message `/deviner` (par exemple 18h30 simulées → 7 pièces) ;
- **délai de 30 min** entre deux `/deviner`, et heure de fin d'énigme.

Limites, à connaître :
- les crons automatiques continuent de tourner à l'**heure réelle** : utilisez `/dev etape` pour les déclencher ;
- l'horloge simulée est **perdue au redémarrage** du bot ;
- après avoir reculé l'horloge, un `/deviner` fait « dans le futur » peut prolonger le délai : `/admin reset_cooldown`.

### D. Astuces Discord
- Si un autre bot du serveur a une commande homonyme (par exemple `/stats`), vérifiez que la ligne sélectionnée indique bien votre bot (colonne de droite). Naviguez avec `↓` puis `Tab`.
- Pour une option facultative (comme `minute`), choisissez-la dans la liste « + 1 en plus » avant de taper sa valeur : `Entrée` envoie la commande immédiatement.
- Les réponses de `/dev` sont privées (« Toi seul(e) peux voir ceci »). Les annonces des étapes, elles, sont publiques dans les salons configurés, et pingent `ROLE_ENIGME_ID` si défini.
- La validation d'une réponse arrive en MP au MJ (boutons « Bonne réponse », « Mauvaise réponse », « Réponse non conforme »). En solo, le MJ peut proposer et valider sa propre réponse.

Scénario complet de test avec les résultats attendus : [`docs/TESTING.md`](TESTING.md#test-de-bout-en-bout-sur-le-bot-de-dev-dev).

---

## 🧪 6. Exécution des Tests Automatisés

Suite de tests (Node.js Test Runner natif, SQLite en mémoire). `npm run check` lance typage, lint et tests comme la CI ; voir `docs/TESTING.md` :
```bash
npm test
```
Tous les tests doivent être au vert (`pass`).

---

## 🌿 7. Workflow Git pour Collaborer à 3

1. **Ne jamais commiter directement sur `main`** : tout push sur `main` publie automatiquement l'image Docker de production (`ghcr.io/hextazdev/enigme-bot:prod`) !
2. **Créer une branche par fonctionnalité / bugfix** :
   ```bash
   git checkout -b feat/nom-de-la-feature
   # ou
   git checkout -b fix/nom-du-bug
   ```
3. **Respecter la convention Conventional Commits** :
   - `feat(scope): message` (ex: `feat(shop): ajouter l objet tuyau dore`)
   - `fix(scope): message` (ex: `fix(canvas): corriger l alignement des avatars`)
   - `test(scope): message` (ex: `test(cron): couvrir la transition de 17h`)
4. **Pousser votre branche et ouvrir une Pull Request** :
   ```bash
   git push -u origin feat/nom-de-la-feature
   ```
   Remplissez la checklist du template de PR avant de demander une relecture à l'un de vos pairs.
