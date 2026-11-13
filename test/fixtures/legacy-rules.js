// Frozen excerpts from main a7405cac0fc53dc1ff7764be51d4fda92eccca9c,
// src/gamemodes/mario_party/events.js. Only dependencies are injected.
// Do not update this oracle to match a new implementation.
exports.dice = function (joueur, random) {
  const Math = { floor: globalThis.Math.floor, min: globalThis.Math.min, random };
        let de;
        if (joueur.type_de === 'double') {
            de = Math.floor(Math.random() * 19) + 2; // 2 à 20
            joueur.type_de = 'normal';
        } else if (joueur.type_de === 'triple') {
            de = Math.floor(Math.random() * 28) + 3; // 3 à 30
            joueur.type_de = 'normal';
        } else if (joueur.type_de === 'pipe') {
            de = joueur.de_pipe_valeur;
            joueur.type_de = 'normal';
        } else {
            de = Math.floor(Math.random() * 10) + 1; // 1 à 10
        }

        if (joueur.de_limite) {
            de = Math.min(de, 3);
            joueur.de_limite = false;
        }

        if (joueur.bonus_prochain_lancer > 0) {
            de += joueur.bonus_prochain_lancer;
            joueur.bonus_prochain_lancer = 0;
        }

  return { value: de, state: joueur };
};
exports.star = function (BOARD_CASES, players, random) {
  const Math = { floor: globalThis.Math.floor, random };
  const Joueur = { findAll: async () => players };
  const require = () => ({ BOARD_CASES });
async function getRandomStarPosition(currentStarPosition) {
    const tousLesJoueurs = await Joueur.findAll();
    const positionsOccupees = tousLesJoueurs.map(j => j.position);
    
    const { BOARD_CASES } = require('../../game/board');
    let casesValides = BOARD_CASES.filter(ca => 
        ca.id <= 45 && 
        ca.type !== 'Boutique' && 
        ca.type !== 'Boo' && 
        ca.id !== 1 &&
        ca.id !== currentStarPosition &&
        !positionsOccupees.includes(ca.id)
    ).map(ca => ca.id);

    if (casesValides.length === 0) {
        casesValides = BOARD_CASES.filter(ca => 
            ca.id <= 45 && 
            ca.type !== 'Boutique' && 
            ca.type !== 'Boo' && 
            ca.id !== 1 &&
            ca.id !== currentStarPosition
        ).map(ca => ca.id);
    }
    
    return casesValides[Math.floor(Math.random() * casesValides.length)];
}

  return getRandomStarPosition;
};

// Frozen excerpt from the same commit, src/gamemodes/mario_party/events.js lines 219-253
// (step-by-step movement of processMovement). Copied verbatim; dependencies injected.
exports.walk = function ({ joueur, plateau, getCase, alreadyHandledOnStart }) {
    let interruption = null;

    while (joueur.cases_restantes > 0) {
        const currentCase = getCase(joueur.position);
        
        if (currentCase.next.length > 1 && !alreadyHandledOnStart.includes('choix_direction')) {
             interruption = { type: 'intersection', case: currentCase };
             break;
        }
        
        let pathChoisi = currentCase.next[0];
        if (currentCase.next.length > 1 && alreadyHandledOnStart.includes('choix_direction')) {
             if (joueur.temp_choix_direction) pathChoisi = Array.isArray(joueur.temp_choix_direction) ? joueur.temp_choix_direction[0] : joueur.temp_choix_direction;
             const idx = alreadyHandledOnStart.indexOf('choix_direction');
             if (idx > -1) alreadyHandledOnStart.splice(idx, 1);
        }
        
        joueur.position = pathChoisi;
        joueur.cases_restantes -= 1;
        
        const c = getCase(joueur.position);
        
        if (c.id === plateau.position_etoile && !alreadyHandledOnStart.includes('etoile')) {     
            interruption = { type: 'etoile', case: c };
            break;
        } else if (c.type === 'Boutique' && !alreadyHandledOnStart.includes('boutique')) {
            interruption = { type: 'boutique', case: c };
            break;
        } else if (c.type === 'Boo' && !alreadyHandledOnStart.includes('boo')) { // Add Boo passthrough support!
            interruption = { type: 'boo', case: c };
            break;
        }
        
        alreadyHandledOnStart = [];
    }
  return { interruption, position: joueur.position, remaining: joueur.cases_restantes };
};

// Frozen excerpt from the same commit, src/gamemodes/mario_party/endgame.js lines 34-43
// (bonus star categories, getWinners omitted, and their random selection). Do not update.
exports.bonusPick = function (random) {
  const Math = { random };
        const bonusStars = [
            { id: 'chance', name: 'Étoile de la Chance 🍀' },
            { id: 'malchance', name: 'Étoile de la Malchance 🌩️' },
            { id: 'avancee_max', name: 'Étoile du Grand Voyageur 🏃' },
            { id: 'avancee_min', name: 'Étoile du Paresseux 🐢' },
            { id: 'enigme', name: 'Étoile du Génie 🧠' },
            { id: 'objet', name: 'Étoile de l\'Acheteur Compulsif 🎒' }
        ];

        const shuffled = bonusStars.sort(() => 0.5 - Math.random());
        const pickedStars = shuffled.slice(0, 2);
  return pickedStars.map(star => star.name);
};
