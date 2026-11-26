import { LandingEvent } from './events';
import { pick, at } from '../../domain/types';
import { FindOptions, Transaction } from 'sequelize';
import { Joueur, Plateau } from '../../db/models';
import { BoardCase, Random, Trap } from '../../domain/types';
import { ITEMS } from './items';

export interface LandingInput {
  joueur: Joueur; plateau: Plateau; caseArrivee: BoardCase; actor: { id: string; username: string };
  trap: Trap | null; chooseStar: (current: number, transaction: Transaction) => Promise<number>; random: Random;
}

/** Apply every landing effect inside the caller's transaction and return the public description. */
export async function applyLanding(input: LandingInput, transaction: Transaction): Promise<LandingEvent[]> {
    const { joueur, plateau, caseArrivee, actor, chooseStar, random } = input;
    const piegeDeclenche = input.trap;
    const events: LandingEvent[] = [];
    // Reuse the active player's instance when an event affects everyone, so unsaved rewards are included.
    const loadPlayers = async (options: FindOptions = {}) => (await Joueur.findAll({ ...options, transaction }))
      .map(player => player.discord_id === joueur.discord_id ? joueur : player);
    if (piegeDeclenche) await plateau.save({ transaction });
    if (plateau.blocs_caches) {
        const bc = { ...plateau.blocs_caches };
        let foundHiddenBlock = null;
        if (bc.etoile === joueur.position) {
            foundHiddenBlock = "etoile";
            bc.etoile = -1;
        } else if (bc.pieces_20 === joueur.position) {
            foundHiddenBlock = "pieces_20";
            bc.pieces_20 = -1;
        } else if (bc.pieces_10 === joueur.position) {
            foundHiddenBlock = "pieces_10";
            bc.pieces_10 = -1;
        } else if (bc.pieces_5 === joueur.position) {
            foundHiddenBlock = "pieces_5";
            bc.pieces_5 = -1;
        }
        
        if (foundHiddenBlock) {
            plateau.blocs_caches = bc;
            await plateau.save({ transaction });
            
            if (foundHiddenBlock === 'etoile') {
                joueur.etoiles += 1;
                events.push({ kind: 'hidden_star', actorId: actor.id });
            } else if (foundHiddenBlock === 'pieces_20') {
                joueur.pieces += 20;
                events.push({ kind: 'hidden_twenty', actorId: actor.id });
            } else if (foundHiddenBlock === 'pieces_10') {
                joueur.pieces += 10;
                events.push({ kind: 'hidden_ten', actorId: actor.id });
            } else if (foundHiddenBlock === 'pieces_5') {
                joueur.pieces += 5;
                events.push({ kind: 'hidden_five', actorId: actor.id });
            }
        }
    }

    if (piegeDeclenche) {
        if (piegeDeclenche.type === 'pieces') {
            const poseur = (piegeDeclenche.poseur === joueur.discord_id ? joueur : await Joueur.findByPk(piegeDeclenche.poseur, { transaction }));
            const montantVole = Math.min(10, joueur.pieces);
            joueur.pieces -= montantVole;
            if (poseur) {
                poseur.pieces += montantVole;
                await poseur.save({ transaction });
                events.push({ kind: 'coin_trap_transfer', actorName: actor.username, amount: montantVole, playerCoins: joueur.pieces, ownerId: poseur.discord_id, ownerCoins: poseur.pieces });
            } else {
                events.push({ kind: 'coin_trap_loss', actorName: actor.username, amount: montantVole, playerCoins: joueur.pieces });
            }
        } else if (piegeDeclenche.type === 'etoile') {
            const poseur = (piegeDeclenche.poseur === joueur.discord_id ? joueur : await Joueur.findByPk(piegeDeclenche.poseur, { transaction }));
            if (joueur.etoiles > 0) {
                joueur.etoiles -= 1;
                if (poseur) {
                    poseur.etoiles += 1;
                    await poseur.save({ transaction });
                    events.push({ kind: 'star_trap_transfer', actorName: actor.username, playerStars: joueur.etoiles, ownerId: poseur.discord_id, ownerStars: poseur.etoiles });
                } else {
                    events.push({ kind: 'star_trap_loss', actorName: actor.username, playerStars: joueur.etoiles });
                }
            } else {
                events.push({ kind: 'star_trap_empty', actorName: actor.username });
            }
        }
    }

    const applyBowserRoulette = async () => {
        const bowserEvents = [
            { type: 'moitie_pieces', msg: 'Perte de la moitié des pièces' },
            { type: 'moins_etoile', msg: 'Perte d\'une étoile' },
            { type: 'revolution', msg: 'Révolution communiste des pièces du serveur' },
            { type: 'destruction_inv', msg: 'Destruction de l\'inventaire' },
            { type: 'don_dernier', msg: 'Don forcé au dernier' }
        ] as const;
        const bEvt = pick(random, bowserEvents);

        if (bEvt.type === 'moitie_pieces') {
            joueur.pieces = Math.floor(joueur.pieces / 2);
            events.push({ kind: 'bowser_half', actorName: actor.username, playerCoins: joueur.pieces });
        } else if (bEvt.type === 'moins_etoile') {
            joueur.etoiles = Math.max(0, joueur.etoiles - 1);
            events.push({ kind: 'bowser_star', actorName: actor.username, playerStars: joueur.etoiles });
        } else if (bEvt.type === 'revolution') {
            const tousLesJoueurs = await loadPlayers();
            let totalPieces = 0;
            tousLesJoueurs.forEach(j => totalPieces += j.pieces);
            const part = Math.floor(totalPieces / tousLesJoueurs.length);
            for (const j of tousLesJoueurs) {
                j.pieces = part;
                await j.save({ transaction });
            }
            events.push({ kind: 'bowser_redistribute', share: part });
        } else if (bEvt.type === 'destruction_inv') {
            joueur.inventaire = [];
            events.push({ kind: 'bowser_inventory' });
        } else if (bEvt.type === 'don_dernier') {
            const tousLesJoueurs = (await loadPlayers()).sort((a, b) => a.etoiles - b.etoiles || a.pieces - b.pieces);
            const dernier = tousLesJoueurs[0];
            if (dernier && dernier.discord_id !== joueur.discord_id) {
                const don = Math.floor(joueur.pieces / 2);
                joueur.pieces -= don;
                dernier.pieces += don;
                await dernier.save({ transaction });
                events.push({ kind: 'bowser_gift', actorName: actor.username, amount: don, targetId: dernier.discord_id, playerCoins: joueur.pieces, targetCoins: dernier.pieces });
            } else {
                events.push({ kind: 'bowser_last', actorName: actor.username });
            }
        }
    };

    // Multiplicateur fin de partie (tours 26 à 30 = x2)
    const isLastTurns = plateau && plateau.tour >= 26;
    const gainPiece = isLastTurns ? 6 : 3;

    if (caseArrivee.type === 'Bleue') {
            joueur.pieces += gainPiece;
            joueur.stat_cases_chance = (joueur.stat_cases_chance || 0) + 1;
            events.push({ kind: 'blue_coins', actorName: actor.username, amount: gainPiece, playerCoins: joueur.pieces });
        } else if (caseArrivee.type === 'Rouge') {
            joueur.pieces = Math.max(0, joueur.pieces - gainPiece);
            joueur.stat_cases_malchance = (joueur.stat_cases_malchance || 0) + 1;
            events.push({ kind: 'red_coins', actorName: actor.username, amount: gainPiece, playerCoins: joueur.pieces });
        } else if (caseArrivee.type === 'Chance') {
            joueur.stat_cases_chance = (joueur.stat_cases_chance || 0) + 1;
            const gains = [
                { type: 'pieces', val: 5, msg: '+5 pièces' },
                { type: 'pieces', val: 10, msg: '+10 pièces' },
                { type: 'pieces', val: 15, msg: '+15 pièces' },
                { type: 'objet', msg: '1 objet standard aléatoire' },
                { type: 'vol', val: 5, msg: 'Vol de 5 pièces à un joueur au hasard' },
                { type: 'sac', msg: 'Sac à objets (remplit l\'inventaire)' }
            ] as const;
            const gain = pick(random, gains);
            
            if (gain.type === 'pieces') {
                joueur.pieces += gain.val;
                events.push({ kind: 'chance_coins', actorName: actor.username, amount: gain.val, playerCoins: joueur.pieces });
            } else if (gain.type === 'objet') {
                
                const standardItems = Object.values(ITEMS).filter(i => !i.sundayOnly);
                const randomItem = pick(random, standardItems);
                if (joueur.inventaire.length < 3) {
                    joueur.inventaire = [...joueur.inventaire, randomItem.name];
                    events.push({ kind: 'chance_item', actorName: actor.username, item: randomItem.name });
                } else {
                    events.push({ kind: 'chance_full', actorName: actor.username });
                }
            } else if (gain.type === 'vol') {
                const tousLesJoueurs = await loadPlayers();
                const autresJoueurs = tousLesJoueurs.filter(j => j.discord_id !== joueur.discord_id && j.pieces > 0 && !j.est_fantome);
                if (autresJoueurs.length > 0) {
                    const cible = pick(random, autresJoueurs);
                    const montantVole = Math.min(gain.val, cible.pieces);
                    cible.pieces -= montantVole;
                    joueur.pieces += montantVole;
                    await cible.save({ transaction });
                    events.push({ kind: 'chance_steal', actorName: actor.username, amount: montantVole, targetId: cible.discord_id, playerCoins: joueur.pieces, targetCoins: cible.pieces });
                } else {
                    events.push({ kind: 'chance_no_target', actorName: actor.username });
                }
            } else if (gain.type === 'sac') {
                
                const standardItems = Object.values(ITEMS).filter(i => !i.sundayOnly);
                const newInv = [...joueur.inventaire];
                while (newInv.length < 3) {
                    const randomItem = pick(random, standardItems);
                    newInv.push(randomItem.name);
                }
                joueur.inventaire = newInv;
                events.push({ kind: 'chance_fill' });
            }
        } else if (caseArrivee.type === 'Malchance') {
            joueur.stat_cases_malchance = (joueur.stat_cases_malchance || 0) + 1;
            const pertes = [
                { type: 'pieces', val: -5, msg: '-5 pièces' },
                { type: 'pieces', val: -10, msg: '-10 pièces' },
                { type: 'objet', msg: 'Perte d\'un objet au hasard' },
                { type: 'de_limite', msg: 'Dé limité à 3 au prochain tour' },
                { type: 'tp_bowser', msg: 'Téléportation sur Bowser' }
            ] as const;
            const perte = pick(random, pertes);
            
            if (perte.type === 'pieces') {
                joueur.pieces = Math.max(0, joueur.pieces + perte.val);
                events.push({ kind: 'unlucky_coins', actorName: actor.username, amount: Math.abs(perte.val), playerCoins: joueur.pieces });
            } else if (perte.type === 'objet') {
                if (joueur.inventaire.length > 0) {
                    const inv = [...joueur.inventaire];
                    const indexToRemove = Math.floor(random() * inv.length);
                    const removedItem = at(inv.splice(indexToRemove, 1), 0);
                    joueur.inventaire = inv;
                    events.push({ kind: 'unlucky_item', actorName: actor.username, item: removedItem });
                } else {
                    events.push({ kind: 'unlucky_empty', actorName: actor.username });
                }
            } else if (perte.type === 'de_limite') {
                joueur.de_limite = true;
                events.push({ kind: 'unlucky_die' });
            } else if (perte.type === 'tp_bowser') {
                joueur.stat_cases_malchance = (joueur.stat_cases_malchance || 0) + 1;
                events.push({ kind: 'unlucky_bowser', actorName: actor.username });
                await applyBowserRoulette();
            }
        } else if (caseArrivee.type === 'Coup du Sort') {
            const fateEvents = [
                { type: 'echange_pos', msg: 'Échange de position avec un joueur aléatoire' },
                { type: 'loterie', msg: 'Un joueur tiré au sort gagne 20 pièces' },
                { type: 'etoile_filante', msg: 'L\'Étoile change immédiatement de case' },
                { type: 'roulette_vol', msg: 'Roulette de vol entre 2 joueurs' },
                { type: 'duel_des', msg: 'Duel de dés' },
                { type: 'don_pieces', msg: 'Don de 20 pièces à un joueur aléatoire' },
                { type: 'echange_pieces', msg: 'Échange de pièces avec un joueur aléatoire' },
                { type: 'echange_etoiles', msg: 'Échange d\'étoiles avec un joueur aléatoire' }
            ] as const;
            const evt = pick(random, fateEvents);
            
            if (evt.type === 'echange_pos') {
                const tousLesJoueurs = await loadPlayers();
                const autresJoueurs = tousLesJoueurs.filter(j => j.discord_id !== joueur.discord_id && !j.est_fantome);
                if (autresJoueurs.length > 0) {
                    const cible = pick(random, autresJoueurs);
                    const tempPos = joueur.position;
                    joueur.position = cible.position;
                    cible.position = tempPos;
                    await cible.save({ transaction });
                    events.push({ kind: 'fate_positions', actorName: actor.username, targetId: cible.discord_id });
                } else {
                    events.push({ kind: 'fate_no_positions', actorName: actor.username });
                }
            } else if (evt.type === 'loterie') {
                const tousLesJoueurs = await loadPlayers();
                const cible = pick(random, tousLesJoueurs);
                cible.pieces += 20;
                await cible.save({ transaction });
                events.push({ kind: 'fate_lottery', targetId: cible.discord_id, targetCoins: cible.pieces });
            } else if (evt.type === 'etoile_filante') {
                const nouvellePositionEtoile = await chooseStar(plateau.position_etoile, transaction);
                plateau.position_etoile = nouvellePositionEtoile;
                await plateau.save({ transaction });
                events.push({ kind: 'fate_star', position: nouvellePositionEtoile });
            } else if (evt.type === 'roulette_vol') {
                const tousLesJoueurs = await loadPlayers();
                const autresJoueurs = tousLesJoueurs.filter(j => j.discord_id !== joueur.discord_id && !j.est_fantome);
                if (autresJoueurs.length > 0) {
                    const cible = pick(random, autresJoueurs);
                    const montant = Math.floor(random() * 15) + 5;
                    const voleur = random() > 0.5 ? joueur : cible;
                    const victime = voleur === joueur ? cible : joueur;
                    const volReel = Math.min(montant, victime.pieces);
                    victime.pieces -= volReel;
                    voleur.pieces += volReel;
                    await victime.save({ transaction });
                    if (voleur.discord_id !== joueur.discord_id) await voleur.save({ transaction });
                    events.push({ kind: 'fate_steal', thiefId: voleur.discord_id, amount: volReel, victimId: victime.discord_id, thiefCoins: voleur.pieces, victimCoins: victime.pieces });
                } else {
                    events.push({ kind: 'fate_no_steal' });
                }
            } else if (evt.type === 'duel_des') {
                const tousLesJoueurs = await loadPlayers();
                const autresJoueurs = tousLesJoueurs.filter(j => j.discord_id !== joueur.discord_id && !j.est_fantome);
                if (autresJoueurs.length > 0) {
                    const cible = pick(random, autresJoueurs);
                    const deJoueur = Math.floor(random() * 6) + 1;
                    const deCible = Math.floor(random() * 6) + 1;
                    events.push({ kind: 'fate_duel', targetId: cible.discord_id, actorName: actor.username, playerRoll: deJoueur, targetRoll: deCible });
                    if (deJoueur > deCible) {
                        const gain = Math.min(10, cible.pieces);
                        cible.pieces -= gain;
                        joueur.pieces += gain;
                        await cible.save({ transaction });
                        events.push({ kind: 'duel_win', actorName: actor.username, amount: gain, playerCoins: joueur.pieces, targetId: cible.discord_id, targetCoins: cible.pieces });
                    } else if (deCible > deJoueur) {
                        const gain = Math.min(10, joueur.pieces);
                        joueur.pieces -= gain;
                        cible.pieces += gain;
                        await cible.save({ transaction });
                        events.push({ kind: 'duel_loss', targetId: cible.discord_id, amount: gain, targetCoins: cible.pieces, actorName: actor.username, playerCoins: joueur.pieces });
                    } else {
                        events.push({ kind: 'duel_tie' });
                    }
                } else {
                    events.push({ kind: 'duel_no_target' });
                }
            } else if (evt.type === 'don_pieces') {
                const tousLesJoueurs = await loadPlayers();
                const autresJoueurs = tousLesJoueurs.filter(j => j.discord_id !== joueur.discord_id && !j.est_fantome);
                if (autresJoueurs.length > 0) {
                    const cible = pick(random, autresJoueurs);
                    const don = Math.min(20, joueur.pieces);
                    joueur.pieces -= don;
                    cible.pieces += don;
                    await cible.save({ transaction });
                    events.push({ kind: 'fate_gift', actorName: actor.username, amount: don, targetId: cible.discord_id, playerCoins: joueur.pieces, targetCoins: cible.pieces });
                } else {
                    events.push({ kind: 'fate_no_gift' });
                }
            } else if (evt.type === 'echange_pieces') {
                const tousLesJoueurs = await loadPlayers();
                const autresJoueurs = tousLesJoueurs.filter(j => j.discord_id !== joueur.discord_id && !j.est_fantome);
                if (autresJoueurs.length > 0) {
                    const cible = pick(random, autresJoueurs);
                    const tempPieces = joueur.pieces;
                    joueur.pieces = cible.pieces;
                    cible.pieces = tempPieces;
                    await cible.save({ transaction });
                    events.push({ kind: 'fate_coins', actorName: actor.username, targetId: cible.discord_id, playerCoins: joueur.pieces, targetCoins: cible.pieces });
                } else {
                    events.push({ kind: 'fate_no_coins' });
                }
            } else if (evt.type === 'echange_etoiles') {
                const tousLesJoueurs = await loadPlayers();
                const autresJoueurs = tousLesJoueurs.filter(j => j.discord_id !== joueur.discord_id && !j.est_fantome);
                if (autresJoueurs.length > 0) {
                    const cible = pick(random, autresJoueurs);
                    const tempEtoiles = joueur.etoiles;
                    joueur.etoiles = cible.etoiles;
                    cible.etoiles = tempEtoiles;
                    await cible.save({ transaction });
                    events.push({ kind: 'fate_stars', actorName: actor.username, targetId: cible.discord_id, playerStars: joueur.etoiles, targetStars: cible.etoiles });
                } else {
                    events.push({ kind: 'fate_no_stars' });
                }
            }
        } else if (caseArrivee.type === 'Bowser') {
            joueur.stat_cases_malchance = (joueur.stat_cases_malchance || 0) + 1;
            await applyBowserRoulette();
        }

    await joueur.save({ transaction });

    return events;
}
