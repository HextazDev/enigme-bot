---
name: "🐛 Signalement de Bug"
about: "Signaler un comportement anormal, un crash, un timeout Discord ou une incohérence de plateau"
title: "fix(scope): Description courte du bug"
labels: ["bug"]
assignees: ""
---

## 📌 Description du Problème
<!-- Description claire et concise de l'anomalie constatée. -->

## 🔁 Étapes pour Reproduire
1. Lancer la commande `/...` ou cliquer sur le bouton `...`
2. Sélectionner `...`
3. Constater l'erreur ou l'état inattendu

## 🛑 Comportement Observé
<!-- Ce qui se passe actuellement (ex: message d'interaction expirée, pion qui disparaît, solde négatif). -->

## ✅ Comportement Attendu
<!-- Ce qui aurait dû se passer selon les règles du jeu et docs/GAMEPLAY.md. -->

## 📋 Logs & Diagnostic
<!-- Coller ici l'extrait de log pertinent (sans tokens ou données sensibles). -->
```text
[ERROR] ...
```

## 🛡️ Cas Limites & Concurrence
- [ ] Code d'erreur Discord identifié (ex: `10062 Unknown interaction`, permissions manquantes)
- [ ] Conflit de verrou suspecté (`withGameLock` / `withScheduledLock`, `GameBusyError`)
- [ ] Cas déjà répertorié dans [docs/EDGE_CASES.md](docs/EDGE_CASES.md) ? Si oui, indiquer l'ID (ex: `DISC-01`, `LOCK-02`).

---

### Triage Proposé :
* **Priorité** : [P0: Critique/Crash/Blocage | P1: Bug de Gameplay | P2: Bug Mineur/Visuel]
* **Taille estimée** : [XS | S | M]
