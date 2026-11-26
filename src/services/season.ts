import { at } from '../domain/types';
import { Op, Transaction } from 'sequelize';
import { Joueur, Plateau, TourSnapshot, sequelize } from '../db/models';
import { GameRuleError, Random, pick } from '../domain/types';
import { withGameLock } from '../game/transaction';
import { getActiveMode } from '../gamemodes/registry';
import { gameNow } from '../utils/clock';
import { parisClock, parisDateKey, parisTodayAt } from '../utils/time';

export const MAX_TOURS = 30;
export const BET_RUNNERS = ['Yoshi Vert', 'Yoshi Rouge', 'Yoshi Bleu', 'Yoshi Jaune', 'Yoshi Noir'];
const FREE_BET = 3;
const MAX_BET = 30;

export function isSeasonActive(plateau: Pick<Plateau, 'tour' | 'enigme_status'> | null | undefined): boolean {
  if (!plateau || plateau.enigme_status === 'season_ended') return false;
  return plateau.tour > 0 && plateau.tour < MAX_TOURS;
}
/** Saturday board closes once bets open (10h Paris) or explicitly via mode_data.paris_ouverts; Friday's turn stays playable until 10h. */
export function isSaturdayClosed(plateau: Pick<Plateau, 'mode_data'>, now: Date = gameNow()): boolean {
  if (plateau.mode_data.paris_ouverts === true) return true;
  const { weekday, hour } = parisClock(now);
  return weekday === 6 && hour >= 10;
}
function hasBets(plateau: Plateau): boolean {
  return getActiveMode(plateau).hasShop && plateau.game_mode !== 'ile_defis';
}
function run<T>(action: (transaction: Transaction) => Promise<T>): Promise<T> {
  return withGameLock('season', () => sequelize.transaction(action), true);
}

/** Players who did not play this turn get one inactive day; the third makes them a ghost. Returns the new ghosts. */
export function applyGhostRules(players: Joueur[]): string[] {
  const ghosts: string[] = [];
  for (const j of players) {
    if (!j.a_joue_ce_tour) {
      j.jours_inactifs += 1;
      if (j.jours_inactifs >= 3 && !j.est_fantome) { j.est_fantome = true; ghosts.push(j.discord_id); }
    } else j.jours_inactifs = 0;
    j.a_joue_ce_tour = false;
  }
  return ghosts;
}
function resetDaily(j: Joueur): void {
  j.guess_du_jour = 0;
  j.boutique_du_jour = [];
  j.last_deviner_time = null;
}

export type Transition =
  | { kind: 'skip' }
  | { kind: 'end_season' }
  | { kind: 'enigma'; tour: number; text: string; forgotten: string[]; ghosts: string[] }
  | { kind: 'no_enigma'; tour: number; ghosts: string[]; seasonOver: boolean };

/** 17h on weekdays: publish the programmed enigma and lock the board, or keep it open for another turn. */
export async function dailyTransition(now: Date = gameNow()): Promise<Transition> {
  return run(async transaction => {
    const plateau = await Plateau.findByPk(1, { transaction });
    if (!plateau || plateau.enigme_status === 'season_ended') return { kind: 'skip' };
    if (plateau.tour >= MAX_TOURS) return { kind: 'end_season' };
    if (plateau.game_mode === 'ile_defis' && Array.isArray(plateau.mode_data.gagnants_dragon) && plateau.mode_data.gagnants_dragon.length) return { kind: 'end_season' };
    const programmed = plateau.enigme_status === 'programmee' && !!plateau.enigme_text;
    if (plateau.tour === 0 && !programmed) return { kind: 'skip' };
    const players = await Joueur.findAll({ transaction });
    if (programmed) {
      const forgotten = players.filter(j => j.a_le_droit_de_jouer).map(j => j.discord_id);
      const ghosts = applyGhostRules(players);
      for (const j of players) {
        j.a_le_droit_de_jouer = false;
        j.a_trouve_enigme = false;
        resetDaily(j);
        await j.save({ transaction });
      }
      const nextModeData = { ...plateau.mode_data };
      delete nextModeData.propositions_jugees;
      Object.assign(plateau, {
        enigme_status: 'active', enigme_publiee: true, enigme_resolue: false, enigme_gagnants: [],
        fin_enigme_timestamp: parisTodayAt(21, now), mode_data: nextModeData,
      });
      plateau.tour += 1;
      await plateau.save({ transaction });
      return { kind: 'enigma', tour: plateau.tour, text: plateau.enigme_text ?? '', forgotten, ghosts };
    }
    if (!players.length) return { kind: 'skip' };
    const ghosts = applyGhostRules(players);
    for (const j of players) {
      if (!j.est_fantome) j.a_le_droit_de_jouer = true;
      j.a_trouve_enigme = false;
      resetDaily(j);
      await j.save({ transaction });
    }
    plateau.tour += 1;
    plateau.enigme_resolue = true;
    plateau.enigme_status = 'finished';
    await plateau.save({ transaction });
    return { kind: 'no_enigma', tour: plateau.tour, ghosts, seasonOver: plateau.tour >= MAX_TOURS };
  });
}

/** Sunday 11h (or MJ): no enigma, the board opens with the black market. Idempotent per Paris calendar day. */
export async function openBlackMarket(now: Date = gameNow()): Promise<{ opened: boolean; tour: number; seasonOver: boolean }> {
  const today = parisDateKey(now);
  return run(async transaction => {
    const plateau = await Plateau.findByPk(1, { transaction });
    if (!plateau || !isSeasonActive(plateau) || !hasBets(plateau)) return { opened: false, tour: plateau?.tour ?? 0, seasonOver: false };
    if (plateau.mode_data.marche_noir_date === today) return { opened: false, tour: plateau.tour, seasonOver: false };
    for (const j of await Joueur.findAll({ transaction })) {
      j.a_le_droit_de_jouer = !j.est_fantome;
      resetDaily(j);
      await j.save({ transaction });
    }
    plateau.tour += 1;
    plateau.enigme_resolue = true;
    plateau.mode_data = { ...plateau.mode_data, marche_noir_date: today };
    await plateau.save({ transaction });
    return { opened: true, tour: plateau.tour, seasonOver: plateau.tour >= MAX_TOURS };
  });
}

/** Saturday 10h: the board closes and the Yoshi race bets open. Persisted & idempotent so a re-run never wipes bets. */
export async function openBets(): Promise<{ opened: boolean; ghosts: string[] }> {
  return run(async transaction => {
    const plateau = await Plateau.findByPk(1, { transaction });
    if (!plateau || !isSeasonActive(plateau) || !hasBets(plateau)) return { opened: false, ghosts: [] };
    if (plateau.mode_data.paris_ouverts === true) return { opened: false, ghosts: [] };
    const players = await Joueur.findAll({ transaction });
    const ghosts = applyGhostRules(players);
    for (const j of players) {
      j.a_le_droit_de_jouer = false;
      j.pari_coureurId = null;
      j.pari_montant = 0;
      await j.save({ transaction });
    }
    plateau.mode_data = { ...plateau.mode_data, paris_ouverts: true };
    await plateau.save({ transaction });
    return { opened: true, ghosts };
  });
}

export async function betsOpen(): Promise<boolean> {
  const plateau = await Plateau.findByPk(1);
  return plateau?.mode_data.paris_ouverts === true;
}

export async function placeBet(userId: string, runner: number, amount: number): Promise<{ cost: number; balance: number }> {
  if (!Number.isInteger(amount) || amount < FREE_BET || amount > MAX_BET) throw new GameRuleError('AMOUNT', `Montant invalide. Doit être entre ${FREE_BET} et ${MAX_BET} (${FREE_BET} pièces sont offertes).`);
  if (!BET_RUNNERS[runner]) throw new GameRuleError('RUNNER', 'Coureur inconnu.');
  return withGameLock(userId, () => sequelize.transaction(async transaction => {
    const plateau = await Plateau.findByPk(1, { transaction });
    if (plateau?.mode_data.paris_ouverts !== true) throw new GameRuleError('CLOSED', 'Les paris sont fermés !');
    const joueur = await Joueur.findByPk(userId, { transaction });
    if (!joueur) throw new GameRuleError('PLAYER_MISSING', "Tu n'es pas inscrit au jeu.");
    if (joueur.est_fantome) throw new GameRuleError('GHOST', 'Tu es en mode fantôme, tu ne peux pas parier.');
    if (joueur.pari_coureurId !== null) throw new GameRuleError('ALREADY', 'Tu as déjà parié !');
    const cost = amount - FREE_BET;
    if (joueur.pieces < cost) throw new GameRuleError('FUNDS', `Tu n'as pas assez de pièces. Il te faut ${cost} pièces (${FREE_BET} sont offertes).`);
    joueur.pieces -= cost;
    joueur.pari_coureurId = runner;
    joueur.pari_montant = amount;
    await joueur.save({ transaction });
    return { cost, balance: joueur.pieces };
  }));
}

export interface BetResult { winner: string; pot: number; payouts: { discord_id: string; gain: number; stake: number; balance: number }[] }

/** Saturday 21h: draw the winner and share the pot proportionally, all in one transaction. */
export async function settleBets(random: Random = Math.random): Promise<BetResult | null> {
  return run(async transaction => {
    const plateau = await Plateau.findByPk(1, { transaction });
    if (plateau?.mode_data.paris_ouverts !== true) return null;
    plateau.mode_data = { ...plateau.mode_data, paris_ouverts: false };
    await plateau.save({ transaction });
    const winnerIndex = BET_RUNNERS.indexOf(pick(random, BET_RUNNERS));
    const bettors = await Joueur.findAll({ where: { pari_coureurId: { [Op.ne]: null } }, transaction });
    const pot = bettors.reduce((sum, j) => sum + j.pari_montant, 0);
    const winningStake = bettors.filter(j => j.pari_coureurId === winnerIndex).reduce((sum, j) => sum + j.pari_montant, 0);
    const payouts: BetResult['payouts'] = [];
    for (const j of bettors) {
      if (winningStake > 0 && j.pari_coureurId === winnerIndex) {
        const gain = Math.floor(j.pari_montant / winningStake * pot);
        j.pieces += gain;
        payouts.push({ discord_id: j.discord_id, gain, stake: j.pari_montant, balance: j.pieces });
      }
      j.pari_coureurId = null;
      j.pari_montant = 0;
      await j.save({ transaction });
    }
    return { winner: at(BET_RUNNERS, winnerIndex), pot, payouts };
  });
}

/** Atomically claim an unpublished hint before sending it outside the game lock. */
export async function claimHint(index: 1 | 2 | 3): Promise<string | null> {
  return run(async transaction => {
    const plateau = await Plateau.findByPk(1, { transaction });
    if (!plateau || plateau.enigme_status !== 'active') return null;
    const text = plateau[`enigme_indice${index}`];
    if (!text || plateau[`indice${index}_publie`]) return null;
    plateau[`indice${index}_publie`] = true;
    await plateau.save({ transaction });
    return text;
  });
}

/** Release a claimed hint if Discord delivery failed so a subsequent retry/restart can publish it. */
export async function unclaimHint(index: 1 | 2 | 3): Promise<void> {
  await run(async transaction => {
    await Plateau.update({ [`indice${index}_publie`]: false }, { where: { id: 1, enigme_status: 'active' }, transaction });
  });
}

export async function markHintPublished(index: 1 | 2 | 3): Promise<void> {
  await run(async transaction => {
    await Plateau.update({ [`indice${index}_publie`]: true }, { where: { id: 1 }, transaction });
  });
}

export async function purgeOldSnapshots(now: Date = gameNow()): Promise<number> {
  return run(async transaction => TourSnapshot.destroy({
    where: { timestamp: { [Op.lt]: new Date(now.getTime() - 7 * 86_400_000) } },
    transaction,
  }));
}
