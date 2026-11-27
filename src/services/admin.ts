import { parsePlayerSnapshots, strings, validatePlayerModeData, record } from '../domain/persisted';
import { at, JsonObject } from '../domain/types';
import { Transaction } from 'sequelize';
import { Joueur, Plateau, TourSnapshot, sequelize } from '../db/models';
import { GameRuleError, Random, isTrap } from '../domain/types';
import { withGameLock } from '../game/transaction';
import { getActiveBoardCases, getActiveMode, getMode } from '../gamemodes/registry';

function run<T>(action: (transaction: Transaction) => Promise<T>): Promise<T> {
  return withGameLock('mj', () => sequelize.transaction(action));
}
async function requirePlayer(userId: string, transaction: Transaction): Promise<Joueur> {
  const joueur = await Joueur.findByPk(userId, { transaction });
  if (!joueur) throw new GameRuleError('PLAYER_MISSING', "Ce joueur n'existe pas dans la base de données.");
  return joueur;
}
async function requireBoard(transaction: Transaction): Promise<Plateau> {
  const plateau = await Plateau.findByPk(1, { transaction });
  if (!plateau) throw new GameRuleError('NO_BOARD', 'Plateau introuvable.');
  return plateau;
}

/** Full reset: players, snapshots and every per-season board field, in one transaction. */
export async function startSeason(modeId: string, variantId: string, mapId: string, random: Random = Math.random): Promise<{ star: number }> {
  const mode = getMode(modeId);
  if (!mode || !mode.variants[variantId] || !mode.maps[mapId]) throw new GameRuleError('PARAMS', "Paramètres d'initialisation invalides !");
  const cases = mode.getBoardCases(mapId);
  const hasStarFlags = cases.some(c => c.starEligible !== undefined);
  const candidates = cases.filter(c => (hasStarFlags ? c.starEligible === true : c.type !== 'Boutique' && c.type !== 'Boo' && c.id !== 1)).map(c => c.id);
  if (candidates.length < 5) throw new GameRuleError('BOARD', 'Plateau trop petit pour placer l’étoile et les blocs cachés.');
  const pool = [...candidates];
  // Fisher-Yates: the star and the four hidden blocks never share a case.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [at(pool, j), at(pool, i)];
  }
  const star = at(pool, 0), etoile = at(pool, 1), pieces_20 = at(pool, 2), pieces_10 = at(pool, 3), pieces_5 = at(pool, 4);
  return run(async transaction => {
    await Joueur.destroy({ where: {}, transaction });
    await TourSnapshot.destroy({ where: {}, transaction });
    const values = {
      position_etoile: star, pieges_actifs: [], tour: 0, enigme_resolue: true, enigme_status: 'finished',
      enigme_reponse: null, enigme_text: null, enigme_indice1: null, enigme_indice2: null, enigme_indice3: null,
      enigme_publiee: false, indice1_publie: false, indice2_publie: false, indice3_publie: false,
      enigme_gagnants: [], fin_enigme_timestamp: null, blocs_caches: { etoile, pieces_20, pieces_10, pieces_5 },
      game_mode: modeId, game_variant: variantId, game_map: mapId, mode_data: {},
    };
    const plateau = await Plateau.findByPk(1, { transaction });
    if (plateau) await plateau.update(values, { transaction });
    else await Plateau.create({ id: 1, ...values }, { transaction });
    return { star };
  });
}

/** Restore the player (and the board/other players it affected) to the snapshot taken before this turn's roll. */
export async function undoTurn(userId: string): Promise<{ tour: number }> {
  return run(async transaction => {
    const joueur = await requirePlayer(userId, transaction);
    const plateau = await requireBoard(transaction);
    const snapshot = await TourSnapshot.findOne({ where: { discord_id: userId, tour: plateau.tour }, order: [['timestamp', 'DESC'], ['id', 'DESC']], transaction });
    if (!snapshot) throw new GameRuleError('NO_SNAPSHOT', `Aucun snapshot trouvé pour <@${userId}> au tour ${plateau.tour}.`);
    const otherSnapshots = parsePlayerSnapshots(snapshot.autres_joueurs_snapshot);
    if (snapshot.inventaire !== null) strings(snapshot.inventaire, 'inventaire snapshot');
    if (snapshot.boutique_du_jour !== null && snapshot.boutique_du_jour !== undefined) strings(snapshot.boutique_du_jour, 'boutique snapshot');
    if (snapshot.mode_data !== null && snapshot.mode_data !== undefined) validatePlayerModeData(snapshot.mode_data);
    if (snapshot.plateau_mode_data !== null && snapshot.plateau_mode_data !== undefined) record(snapshot.plateau_mode_data, 'plateau mode_data snapshot');
    Object.assign(joueur, {
      position: snapshot.position ?? joueur.position, temp_choix_direction: snapshot.temp_choix_direction ?? null,
      pieces: snapshot.pieces ?? joueur.pieces, etoiles: snapshot.etoiles ?? joueur.etoiles, inventaire: snapshot.inventaire ?? [],
      a_le_droit_de_jouer: true, a_joue_ce_tour: false, cases_restantes: 0, action_en_attente: null,
      jours_inactifs: snapshot.jours_inactifs ?? 0, est_fantome: snapshot.est_fantome ?? false,
      fantome_unblock_used: snapshot.fantome_unblock_used ?? false, bonus_prochain_lancer: snapshot.bonus_prochain_lancer ?? 0,
      de_limite: snapshot.de_limite ?? false, type_de: snapshot.type_de ?? 'normal', de_pipe_valeur: snapshot.de_pipe_valeur ?? 0,
      mode_data: snapshot.mode_data !== null && snapshot.mode_data !== undefined ? structuredClone(snapshot.mode_data) : joueur.mode_data,
      boutique_du_jour: snapshot.boutique_du_jour !== null && snapshot.boutique_du_jour !== undefined ? [...snapshot.boutique_du_jour] : joueur.boutique_du_jour,
      stat_cases_chance: snapshot.stat_cases_chance ?? joueur.stat_cases_chance,
      stat_cases_malchance: snapshot.stat_cases_malchance ?? joueur.stat_cases_malchance,
      stat_cases_avancees: snapshot.stat_cases_avancees ?? joueur.stat_cases_avancees,
      stat_objets_utilises: snapshot.stat_objets_utilises ?? joueur.stat_objets_utilises,
    });
    await joueur.save({ transaction });
    if (snapshot.plateau_position_etoile !== null) plateau.position_etoile = snapshot.plateau_position_etoile;
    plateau.pieges_actifs = (snapshot.plateau_pieges_actifs ?? []).filter(isTrap);
    plateau.blocs_caches = snapshot.plateau_blocs_caches ?? {};
    if (snapshot.plateau_mode_data !== null && snapshot.plateau_mode_data !== undefined) {
      plateau.mode_data = structuredClone(snapshot.plateau_mode_data) as JsonObject;
    }
    await plateau.save({ transaction });
    for (const other of otherSnapshots) {
      const player = await Joueur.findByPk(other.discord_id, { transaction });
      if (!player) continue;
      Object.assign(player, {
        pieces: typeof other.pieces === 'number' ? other.pieces : player.pieces,
        etoiles: typeof other.etoiles === 'number' ? other.etoiles : player.etoiles,
        inventaire: other.inventaire ?? player.inventaire,
        position: typeof other.position === 'number' ? other.position : player.position,
        mode_data: other.mode_data !== undefined ? structuredClone(other.mode_data) : player.mode_data,
      });
      await player.save({ transaction });
    }
    await snapshot.destroy({ transaction });
    return { tour: plateau.tour };
  });
}

export type Resource = 'pieces' | 'etoiles';
export async function adjustResource(userId: string, resource: Resource, delta: number): Promise<number> {
  if (!Number.isInteger(delta) || delta === 0) throw new GameRuleError('QUANTITY', 'Veuillez entrer une quantité valide et positive.');
  return run(async transaction => {
    const joueur = delta > 0
      ? (await Joueur.findOrCreate({ where: { discord_id: userId }, transaction }))[0]
      : await requirePlayer(userId, transaction);
    joueur[resource] = Math.max(0, joueur[resource] + delta);
    await joueur.save({ transaction });
    return joueur[resource];
  });
}

export async function giveItem(userId: string, itemName: string): Promise<void> {
  return run(async transaction => {
    const plateau = await requireBoard(transaction);
    const catalog = Object.values(getActiveMode(plateau).getItems(plateau.game_variant));
    if (!catalog.some(item => item.name === itemName)) throw new GameRuleError('ITEM', `Objet inconnu : ${itemName}`);
    const [joueur] = await Joueur.findOrCreate({ where: { discord_id: userId }, transaction });
    if (joueur.inventaire.length >= 3) throw new GameRuleError('FULL', `L'inventaire de <@${userId}> est plein (max 3).`);
    joueur.inventaire = [...joueur.inventaire, itemName];
    await joueur.save({ transaction });
  });
}

export async function removeItem(userId: string, itemName: string): Promise<void> {
  return run(async transaction => {
    const joueur = await requirePlayer(userId, transaction);
    const index = joueur.inventaire.indexOf(itemName);
    if (index === -1) throw new GameRuleError('ITEM', `L'objet "${itemName}" n'est pas dans l'inventaire.`);
    joueur.inventaire = joueur.inventaire.filter((_, i) => i !== index);
    await joueur.save({ transaction });
  });
}

/** Teleport: the target case must exist on the active map; any choice in progress is cancelled. */
export async function setPosition(userId: string, caseId: number): Promise<void> {
  return run(async transaction => {
    const plateau = await requireBoard(transaction);
    if (!getActiveBoardCases(plateau).some(c => c.id === caseId)) throw new GameRuleError('CASE', `La case ${caseId} n'existe pas sur la map ${plateau.game_map}.`);
    const joueur = await requirePlayer(userId, transaction);
    Object.assign(joueur, { position: caseId, cases_restantes: 0, action_en_attente: null, temp_choix_direction: null });
    await joueur.save({ transaction });
  });
}

export async function resetCooldown(userId: string): Promise<void> {
  return run(async transaction => {
    const joueur = await requirePlayer(userId, transaction);
    Object.assign(joueur, { a_le_droit_de_jouer: true, last_deviner_time: null, est_fantome: false, jours_inactifs: 0 });
    await joueur.save({ transaction });
  });
}

export async function setTour(tour: number): Promise<void> {
  if (!Number.isInteger(tour) || tour < 0 || tour > 30) throw new GameRuleError('TOUR', 'Le tour doit être compris entre 0 et 30.');
  return run(async transaction => {
    const plateau = await requireBoard(transaction);
    plateau.tour = tour;
    await plateau.save({ transaction });
  });
}

/** Exceptional MJ action: start a turn without enigma. */
export async function skipEnigma(): Promise<number> {
  return run(async transaction => {
    const plateau = await requireBoard(transaction);
    if (plateau.enigme_status === 'season_ended') throw new GameRuleError('CLOSED', 'Aucune saison en cours.');
    if (plateau.enigme_status === 'active') throw new GameRuleError('ACTIVE', "Une énigme est en cours : attends sa clôture à 21h.");
    plateau.tour += 1;
    plateau.enigme_resolue = true;
    plateau.enigme_status = 'finished';
    await plateau.save({ transaction });
    return plateau.tour;
  });
}

export async function kickPlayer(userId: string): Promise<void> {
  return run(async transaction => {
    await TourSnapshot.destroy({ where: { discord_id: userId }, transaction });
    await Joueur.destroy({ where: { discord_id: userId }, transaction });
  });
}
