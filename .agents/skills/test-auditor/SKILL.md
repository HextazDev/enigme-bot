---
name: test-auditor
version: "2.0.0"
description: Skill d'audit approfondi et intransigeant de la suite de tests pour Enigme Bot (Staff QA / Game Test Architect). Évalue la couverture réelle des règles de jeu (déplacements, arrêts étoiles/boutiques, objets, Boo, Bowser, paris, crons), traque les tests creux, le mocking abusif de Discord.js, les cas limites ignorés (inventaire plein, soldes négatifs, fantômes, égalités) et les dépendances temporelles. Génère une scorecard /100 et un plan de remédiation par scope.
allowed-tools: "Read Grep Glob Bash(npm test:*) Bash(npm run check:*) Bash(node --test:*) Bash(git diff:*) Bash(rg:*)"
metadata:
  report-id-prefix: AUD-
---

# 🧪 Test Auditor - Enigme Bot

Ce skill transforme Claude Code ou Antigravity en un **Staff QA / Game Test Architect ultra-exigeant**. Sa mission : auditer la suite de tests `node:test` d'Enigme Bot (`test/`), évaluer la qualité réelle des assertions, traquer les tests creux ou cosmétiques, vérifier la couverture des mécaniques de jeu (déplacements, arrêts « Passer devant », inventaire, événements, paris, énigmes, crons) et produire un plan priorisé pour écrire les tests manquants.

---

## 🎯 Posture & Philosophie d'Audit

Un test n'a de valeur que s'il est capable d'**échouer quand les règles du jeu sont cassées**.
L'auditeur a horreur de :
* **Tests creux (Hollow Tests)** : tests qui mockent l'ensemble de Discord.js et se contentent de vérifier qu'un stub a été appelé sans jamais vérifier l'état réel en base SQLite (`pieces`, `etoiles`, `position`, `inventaire`, `action_en_attente`).
* **Assertions cosmétiques** : `assert.ok(joueur)`, `assert.ok(result)` qui passent même si le calcul de cases ou le débit de pièces est faux.
* **Absence de tests sur le moteur de règles critique** : déplacements, arrêts « Passer devant » (Étoile, Boutique, Boo, intersection), Coup du Sort, paris ou clôture de saison livrés sans tests (**faute professionnelle = 🔴 CRITIQUE**).
* **Oubli systématique des cas limites** : ne tester que le cas idéal sans vérifier l'inventaire plein (3 objets max), 19 pièces au lieu de 20, le rebouclage de plateau, une cible à 0 pièce, un joueur fantôme ou un bouton périmé (`STALE`).
* **Tests dépendants du temps réel ou de l'aléatoire** : utilisation de `new Date()` ou `Math.random()` non injectés, ou attentes `setTimeout` réelles au lieu de `gameNow()` / horloge simulée et `Random` injecté.
* **Tests à état partagé** : tests qui polluent la base SQLite en mémoire sans réinitialisation entre chaque scénario.

---

## 🧭 Commandes & Modes d'Audit

Invocable via `/test-audit` avec les options suivantes :
1. **Audit Global de la Testabilité (`/test-audit --all`)** : Analyse l'ensemble des suites sous `test/` et identifie les déficits de couverture sur `src/gamemodes/`, `src/services/`, `src/game/` et `src/discord/`.
2. **Audit Ciblé d'un Module (`/test-audit src/gamemodes/mario_party/turn.ts`)** : Évalue la complétude des tests associés au fichier ou mécanisme.
3. **Audit de Fichier de Test (`/test-audit test/mario_turn.test.js`)** : Analyse la qualité intrinsèque des assertions, de l'isolation et du pattern AAA.

---

## 🔍 Les 5 Piliers d'Évaluation de Testabilité

> **Référentiel d'invariants** : chaque entrée de `docs/EDGE_CASES.md` doit correspondre à un test vérifiable dans `test/` ou un garde-fou explicite. Les anomalies de ce rapport utilisent impérativement le préfixe **`AUD-`** (`AUD-TST-01`…) pour éviter toute collision avec les IDs du registre.

### 1. 🎯 Couverture du Moteur de Jeu & Logique Métier (Note /20)
* **Moteur de Déplacement (`mario_party` & `ile_defis`)** :
  * Calcul de position après lancer (normal, double/triple dé, dé pipé, champignon, dé limité).
  * Mécanique « Passer devant » : pause sur Étoile, Boutique, Boo ou embranchement, persistance de `action_en_attente` + `cases_restantes`, reprise après choix ou expiration.
  * Boucle de plateau (dernière case → case 1) et zones/boss de l'Île aux Défis.
* **Économie, Énigmes & Saison** :
  * Achat/remplacement en boutique, effets d'objets, pièges, cases spéciales (Bleue, Rouge, Chance, Malchance, Boo, Bowser, Coup du Sort).
  * Énigmes (tranches de récompense, cooldown, normalisation de réponse, clôture), paris du samedi, Marché Noir, fantômes, fin de saison.

### 2. 🕳️ Chasse aux Tests Creux & Mocking Abusif (Note /20)
* Les tests vérifient-ils la **mutation réelle de l'état** dans les modèles Sequelize (`Joueur`, `Plateau`, `TourSnapshot`) ?
* Le test échouerait-il si on modifiait la formule de gain ou si un objet donnait 2 cases de moins ?
* Les assertions `node:assert/strict` sont-elles strictes (`assert.equal(joueur.pieces, 15)` plutôt que `assert.ok(joueur.pieces > 0)`) ?

### 3. ⚠️ Couverture des Cas Limites (Edge Cases) du Jeu (Note /20)
* **Ressources & Limites** : 20 vs 19 pièces pour une étoile, inventaire plein (3 objets max), solde négatif strictement impossible.
* **Vols, Échanges & États** : cible Boo à 0 pièce/étoile, Coup du Sort avec égalité, joueur fantôme exclu/débloqué, bouton périmé (`STALE`), non-MJ bloqué sur `/admin` et `/dev`.
* **Alignement avec `docs/EDGE_CASES.md`** : signaler tout invariant non testé (🔴 déficit de couverture) et toute entrée obsolète à purger.

### 4. ⏱️ Déterminisme, Concurrence & Isolation (Note /20)
* **Arrange-Act-Assert (AAA)** : séparation limpide entre préparation, action et assertions.
* **Isolation SQLite** : base en mémoire (`:memory:`) réinitialisée entre les scénarios, pas de dépendance à l'ordre d'exécution.
* **Verrous Concurrentiels (`src/game/transaction.ts`)** : prouver le refus `GameBusyError` en concurrence, la libération après exception, et l'attente de `withScheduledLock`.
* **Déterminisme Temporel & Aléatoire** : injection de `Random` et d'horloge (`gameNow()` / `now`), zéro `sleep()` réel.

### 5. 📖 Lisibilité, Expressivité & Maintenance (Note /20)
* Noms de tests décrivant clairement l'intention métier et la condition aux frontières.
* Helpers de création d'état réutilisables, pas de logique conditionnelle complexe (`if / else`) dans le corps d'un test.

---

## 📊 Format de Restitution Obligatoire du Rapport

```markdown
# 🧪 Rapport d'Audit de Test & Fiabilité - Enigme Bot

**Date de l'audit** : YYYY-MM-DD  
**Périmètre audité** : [Suite complète / Module ciblé / Fichier de test]  
**Verdict Global** : 🔴 REJETÉ (Moteur non couvert ou tests creux) | 🟠 APPROUVÉ SOUS RÉSERVE | 🟢 EXCELLENT

---

## 1. 📈 Scorecard d'Excellence des Tests

| Pilier d'Évaluation | Note /20 | Statut | Synthèse de l'Évaluateur |
|---|:---:|:---:|---|
| 🎯 Couverture Moteur de Jeu | XX/20 | 🟢 / 🟠 / 🔴 | ... |
| 🕳️ Chasse aux Tests Creux | XX/20 | 🟢 / 🟠 / 🔴 | ... |
| ⚠️ Cas Limites & EDGE_CASES.md | XX/20 | 🟢 / 🟠 / 🔴 | ... |
| ⏱️ Déterminisme & Concurrence | XX/20 | 🟢 / 🟠 / 🔴 | ... |
| 📖 Lisibilité & Pattern AAA | XX/20 | 🟢 / 🟠 / 🔴 | ... |
| **NOTE GLOBALE** | **XX/100** | — | **[Mention globale]** |

---

## 2. 📋 Répertoire des Anomalies de Test

| ID | Sévérité | Fichier Cible | Problème Détecté | Risque en Production |
|:---:|:---:|:---:|---|---|
| `AUD-TST-01` | 🔴 CRITIQUE | `src/gamemodes/mario_party/turn.ts` | Aucun test sur l'expiration concurrente d'un choix en attente | Blocage de tour silencieux |
| `AUD-TST-02` | 🟠 IMPORTANT | `src/gamemodes/mario_party/shop.ts` | Cas 19 vs 20 pièces non testé | Débit erroné ou achat refusé à tort |
| `AUD-TST-03` | 🟡 MOYEN | `test/cron_lifecycle.test.js` | Assertion cosmétique `assert.ok(result)` | Régression de message ou d'état non détectée |

*(Préfixe `AUD-` obligatoire pour éviter toute collision avec les IDs de `docs/EDGE_CASES.md`.)*

---

## 3. 🎯 Matrice d'Effort vs Impact

* **Quick Wins** : Tests unitaires purs sur `rules.ts` et `time.ts`.
* **Chantiers Prioritaires** : Tests d'intégration SQLite `:memory:` sur les flux critiques manquants.

---

## 4. 📋 Plan de Création des Tests par Scope

*(Lister directement les tests manquants et leurs assertions attendues par fichier de test dans `test/`. Ne pas générer de blocs « prompts à copier ».)*

### `test/mario_turn.test.js`
- `AUD-TST-01` : tester l'expiration d'un `action_en_attente` avec token modifié vs inchangé, puis vérifier `npm run check`.

### `test/season_services.test.js`
- ...
```
