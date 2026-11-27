# 🎲 Règles de Jeu & Game Design — Enigme Bot

Référence des mécaniques **telles qu'implémentées** (source : `src/gamemodes/`, `src/services/`). Toute évolution de règle met à jour ce document, la commande `/documentation` et `docs/EDGE_CASES.md`.

---

## 🌟 Le concept

1. Une énigme quotidienne rapporte des pièces (ou un dé bonus sur l'Île aux défis).
2. Les joueurs lancent leur dé une fois par jour et avancent sur un plateau rendu en image.
3. Mario Party : le plus d'**Étoiles** (puis de pièces) au tour 30 l'emporte. Île aux défis : course jusqu'au Dragon.

Deux modes sont disponibles au lancement d'une saison (`/admin start`) : **Mario Party** (map Night Sky) et **L'Île aux défis** (map Board Game Island).

---

## ⏰ Cycle quotidien (heure de Paris)

| Heure | Événement |
| :--- | :--- |
| **17h** (lun-ven) | Publication de l'énigme programmée : le plateau se verrouille, le tour avance (+1). Sans énigme programmée, le tour avance et le plateau reste ouvert. Les joueurs n'ayant pas joué gagnent un jour d'inactivité. |
| **18h, 19h, 20h** | Indices 1, 2 et 3. |
| **21h** | Clôture : réponse et gagnants annoncés, les joueurs non fantômes peuvent jouer jusqu'au lendemain 17h. |
| **15h** | Rappel MP aux joueurs ayant activé `rappel_tour` (`/settings`) et n'ayant pas joué. |

### Énigme (`/deviner`)

- Une proposition toutes les **30 minutes**, envoyée au MJ en MP. Chacune rapporte **1 pièce** de participation (3 maximum par jour).
- Récompense selon l'heure de la proposition : **10 / 7 / 4 / 2 pièces** (17h-18h, 18h-19h, 19h-20h, 20h-21h). Sur l'île : **Dé d'Or / d'Argent / de Bronze / en Chocolat**.
- Une réponse validée l'est une seule fois. Une réponse non conforme coûte 1 pièce. Le MJ peut valider après 21h (récompense seule, pas de tour supplémentaire).

---

## 🎲 Mario Party

### Tour de jeu (`/jouer`)

- Avant de lancer, on peut utiliser **un objet** de l'inventaire (3 maximum).
- Dé normal : **1 à 10**. Le dé limité (Malchance) plafonne à 3 ; le Champignon ajoute +3 après le plafond.
- Le joueur avance case par case. Le déplacement **se met en pause** pour un choix (60 secondes, sinon choix par défaut ; le choix reste accessible via `/jouer`, même après un redémarrage) :
  - **Étoile** (passage ou arrêt) : achat pour **20 pièces** ; elle réapparaît ensuite sur une case libre de la boucle principale.
  - **Boutique** (passage ou arrêt) : 3 objets proposés, la même offre toute la journée. Fermée au dernier tour (tour 30).
  - **Boo** (passage ou arrêt) : voler **3 à 12 pièces** gratuitement ou **1 Étoile pour 50 pièces** à un joueur non fantôme.
  - **Intersection** : choix du chemin. Les zones bonus (cases 46 et 55) exigent une **Clé**, consommée à l'entrée. Par défaut : premier chemin.
- Après le choix, le déplacement reprend avec les pas restants. L'effet de la case d'arrivée s'applique ensuite.

### Cases

| Case | Effet à l'arrivée |
| :--- | :--- |
| Bleue | +3 pièces (+6 aux tours 26 à 30). |
| Rouge | -3 pièces (-6 aux tours 26 à 30), jamais sous 0. |
| Chance | Au hasard : +5/+10/+15 pièces, un objet, vol de 5 pièces à un joueur, ou inventaire rempli. |
| Malchance | Au hasard : -5/-10 pièces, perte d'un objet, dé limité à 3, ou roulette de Bowser. |
| Bowser | Au hasard : moitié des pièces perdue, -1 étoile, redistribution équitable de toutes les pièces, inventaire détruit, ou don de la moitié des pièces au dernier. |
| Coup du Sort | Au hasard : échange de position, loterie (+20 à un joueur), l'Étoile se déplace, roulette de vol, duel de dés, don de 20 pièces, échange de pièces ou d'étoiles. |
| Boo, Boutique, Étoile | Choix décrits ci-dessus. |
| Blocs cachés | 4 cases secrètes tirées au lancement : 1 Étoile, 20, 10 et 5 pièces, gagnés par le premier qui s'y arrête. |
| Pièges | Posés par objet : vol de 10 pièces ou d'1 Étoile au prochain joueur qui s'y arrête. |

### Objets

| Objet | Prix | Effet |
| :--- | :--- | :--- |
| 🍄 Champignon | 5 | +3 au prochain lancer. |
| 💰 Piège à pièces | 5 | Piège sur la case actuelle (vol de 10 pièces). |
| 🧪 Tuyau | 8 | Téléportation aléatoire sur la boucle principale. |
| 🎲 Dé pipé | 10 | Choix exact du prochain dé (1 à 10). |
| 🎲🎲 Double Dé | 12 | Prochain lancer de 2 à 20. |
| 🔑 Clé | 5 | Ouvre une zone bonus (utilisée automatiquement à l'intersection). |
| 🪞 Miroir | 15 | Échange de position avec un joueur non fantôme au hasard. |
| 🎺 Sifflet | 15 | Déplace l'Étoile. |
| **Marché Noir (dimanche)** | | |
| 🎲🎲🎲 Dé Triple | 20 | Prochain lancer de 3 à 30. |
| 🏆 Tuyau Doré | 25 | Téléportation juste avant l'Étoile. |
| 🌟 Piège à Étoile | 30 | Piège qui vole 1 Étoile. |
| 🎁 Packs Promo 1 / 2 | 15 / 25 | Champignon + Tuyau / Dé pipé + Miroir (2 places libres requises). |

Les joueurs de la moitié basse du classement voient plus souvent les objets rares en boutique.

### Week-end

- **Samedi** : pas de lancer de dé. De 10h à 21h, paris sur une course de 5 Yoshis (mise de 3 à 30 pièces, 3 offertes). À 21h, le pot est partagé entre les parieurs du gagnant au prorata de leur mise ; sinon il est perdu.
- **Dimanche 11h** : pas d'énigme, plateau ouvert, tour +1, la boutique devient le **Marché Noir**.

### Fin de saison (tour 30 ou `/admin stop`)

2 **étoiles bonus** sont tirées parmi 6 catégories (Chance, Malchance, Grand Voyageur, Paresseux, Génie, Acheteur Compulsif) et révélées **une par une** avec suspense avant le podium. Seuls les joueurs **actifs** (non fantômes) ayant un score strictement positif (`> 0`, y compris pour l'Étoile du Paresseux) sont éligibles ; les ex-æquo actifs partagent l'étoile (+1 ⭐ chacun). Podium des joueurs actifs par étoiles puis pièces ; le premier reçoit le rôle Vainqueur.

---

## 🏝️ L'Île aux défis

Course linéaire de 73 cases en 3 zones (Plage, Volcan, Sommet). Pas de pièces, d'étoiles, d'objets ni de week-end spécial.

- **Dé** : 1d6, plus le dé bonus gagné à l'énigme (Or 1-8, Argent 1-3, Bronze/Chocolat 1-2), consommé au lancer. Si le dé bonus égale le dé standard : **double**, un lancer standard gratuit immédiat.
- **Obstacles** (pause de 60 s, accessibles via `/jouer`) :
  - **Portail** (cases 20 et 48) : 4+ sur 1d6 pour l'ouvrir **pour tout le monde** ; sinon le tour s'arrête devant. Expiration = échec.
  - **Cascade** (case 38) : 3+ pour la désactiver pour tous ; sinon chute en case 31 et fin du tour. Expiration = arrêt.
  - **Liane** (cases 12 et 52) : le déplacement repart avec un nouveau jet de 1d6 (les pas restants sont remplacés).
  - **Intersection** (cases 14 et 44) : une chance sur deux de tomber à l'eau (case 10 ou 31, fin du tour). Expiration = chemin de gauche sans risque.
  - **Dragon** (case 73) : arrêt obligatoire ; 1d6 + dé bonus ≥ 6 pour le vaincre. Une attaque par tour ; en cas d'échec, nouvelle attaque au tour suivant.
- **Cases d'arrivée** : Élan (+2 ou +3 cases), Glissade (-2 ou -3), Rocher (tous les joueurs de la zone reculent de 5), Échange (1d6 : échange avec le joueur devant, derrière, le premier ou le dernier).
- **Fin** : la saison se clôture au 17h qui suit la première victoire contre le Dragon (ou au tour 30, ou par `/admin stop`). Les vainqueurs du Dragon et le classement par position sont annoncés.

---

## 👻 Inactivité & fantômes

- Trois tours consécutifs sans jouer : le joueur devient **fantôme** (bloqué, ne regagne plus le droit de jouer, ne peut ni deviner, ni parier, ni être ciblé par Boo ou le Miroir).
- Un déblocage unique par saison via `/jouer` ; le MJ peut aussi réinitialiser un joueur (`/admin reset_cooldown`).
