---
name: "🗺️ Conception de Map / Plateau"
about: "Proposer ou spécifier un nouveau plateau de jeu (Île des Défis, variante Mario Party, thème graphique)"
title: "feat(map): Nom de la nouvelle map"
labels: ["map", "game-design", "canvas"]
assignees: ""
---

## 🎨 Thème & Ambiance de la Map
<!-- Ex: Île Tropicale des Défis, Volcan de Bowser, Manoir Hanté de Boo, Galaxie Nintendo... -->
- **Nom du plateau** : 
- **Mode de jeu ciblé** : [ ] Mario Party standard (boucle) | [ ] Île des Défis (linéaire / embranchements)
- **Description de l'univers visuel** : 

---

## 📐 Tracé & Structure des Cases
- **Nombre total de cases** : <!-- Ex: 25 cases, 40 cases -->
- **Type de cheminement** : 
  - [ ] Boucle continue (façon Mario Party classique)
  - [ ] Parcours linéaire étape par étape (façon Île des Défis)
  - [ ] Embranchements avec choix de direction (`choix_direction_*`)
- **Répartition indicative des cases** :
  - Cases Bleues (+3) : ...
  - Cases Rouges (-3) : ...
  - Cases Chance / Malchance : ...
  - Cases Spéciales (Boo, Bowser, Coup du Sort) : ...
  - Emplacements Boutique / Étoile : ...

---

## 🖼️ Assets Graphiques & Coordonnées Canvas
<!-- Si vous avez une maquette, un croquis ou une illustration de fond, glissez-la ici ! -->
- [ ] Image de fond prête (`plateau.png` au ratio standard)
- [ ] Croquis / Schéma de disposition fourni
- [ ] Coordonnées des cases $(X, Y)$ pour le fichier `board.ts` :
  <!-- Vous pouvez lister les coordonnées approximatives ou demander de l'aide à un dev -->

---

## ⚙️ Mécaniques Spéciales / Gimmick de la Map
<!-- Y a-t-il une règle unique sur cette map ? Ex: une marée qui monte, un raccourci payant, un canon... -->

---

## ✅ Checklist de Validation
- [ ] Le visuel s'intègre harmonieusement avec les avatars des joueurs (pas de superposition illisible).
- [ ] Le nombre de cases permet une durée de partie équilibrée (30 tours).
- [ ] Les coordonnées Canvas ont été intégrées et testées avec la commande `/plateau`.
