import { saveTurnSnapshot } from '../../game/snapshot';
import { at } from '../../domain/types';
import { islandPending, parseIslandBoardData } from '../../domain/persisted';
import { Op, Transaction } from 'sequelize';
import { Joueur, Plateau, sequelize } from '../../db/models';
import { BoardCase, GameRuleError, JsonObject, IlePending, Random, newToken, randomInt } from '../../domain/types';
import { withGameLock, withScheduledLock } from '../../game/transaction';
import { BOARD_CASES } from './maps/board_game_island/board';

export type IleStop = 'intersection' | 'portail' | 'liane' | 'cascade' | 'dragon';
export interface Actor { id: string; username: string }
export interface Options { random?: Random }
type Bonus = 'gold' | 'silver' | 'bronze' | 'chocolat' | 'none';
interface IleBoardData { portails_ouverts: number[]; cascade_desactivee: boolean; gagnants_dragon: string[] }

const GATE_TARGET = 4;
const CASCADE_TARGET = 3;
const DRAGON_TARGET = 6;

export function findCase(id: number, cases: BoardCase[] = BOARD_CASES): BoardCase {
  const found = cases.find(c => c.id === id);
  if (!found) throw new GameRuleError('BOARD', `Case ${id} absente du plateau.`);
  return found;
}
function waterLanding(cell: BoardCase): number {
  if (cell.waterLanding === undefined) throw new Error(`Chute non définie sur la case ${cell.id}`);
  return cell.waterLanding;
}
export function boardData(plateau: Plateau): IleBoardData {
  return parseIslandBoardData(plateau.mode_data);
}
/** JSON columns are only persisted when reassigned with a new object. */
function saveBoardData(plateau: Plateau, data: IleBoardData): void {
  plateau.mode_data = { ...plateau.mode_data, ...data };
}
function bonusOf(joueur: Joueur): Bonus {
  const value = joueur.mode_data.bonus_de;
  return value === 'gold' || value === 'silver' || value === 'bronze' || value === 'chocolat' ? value : 'none';
}
export function bonusRoll(bonus: Bonus, random: Random): number {
  if (bonus === 'gold') return randomInt(random, 1, 8);
  if (bonus === 'silver') return randomInt(random, 1, 3);
  if (bonus === 'bronze' || bonus === 'chocolat') return randomInt(random, 1, 2);
  return 0;
}

export interface WalkInput { position: number; remaining: number; resume: IleStop | null; direction: number | null; data: IleBoardData; cases?: BoardCase[] }
export interface WalkResult { position: number; remaining: number; stop: IleStop | null; target?: number }

export function walk(input: WalkInput): WalkResult {
  const cases = input.cases ?? BOARD_CASES;
  let { position, remaining } = input;
  let resume = input.resume;
  while (remaining > 0) {
    const current = findCase(position, cases);
    if (current.type === 'Dragon') return { position, remaining: 0, stop: 'dragon' };
    let next = at(current.next, 0);
    if (current.type === 'Intersection') {
      // A gate right after a crossroads keeps the direction already chosen.
      if (resume !== 'intersection' && !(resume === 'portail' && input.direction !== null)) return { position, remaining, stop: 'intersection' };
      next = input.direction ?? at(current.next, 0);
      if (!current.next.includes(next)) throw new GameRuleError('DIRECTION', 'Ce chemin ne part pas de ta case.');
    }
    if (findCase(next, cases).type === 'Portail' && !input.data.portails_ouverts.includes(next) && resume !== 'portail') {
      return { position, remaining, stop: 'portail', target: next };
    }
    resume = null;
    position = next;
    remaining -= 1;
    const reached = findCase(position, cases);
    if (reached.type === 'Liane') return { position, remaining, stop: 'liane' };
    if (reached.type === 'Cascade' && !input.data.cascade_desactivee) return { position, remaining, stop: 'cascade' };
    if (reached.type === 'Dragon') return { position, remaining: 0, stop: 'dragon' };
  }
  return { position, remaining, stop: null };
}

interface State { joueur: Joueur; plateau: Plateau }
interface MoveBase { joueur: Joueur; plateau: Plateau }
export type MoveOutcome =
  | MoveBase & { kind: 'stopped'; stop: IleStop; pending: IlePending }
  | MoveBase & { kind: 'landed'; caseArrivee: BoardCase; effects: IslandEffect[]; double: boolean };

function run<T>(userId: string, action: (transaction: Transaction) => Promise<T>): Promise<T> {
  return withGameLock(userId, () => sequelize.transaction(action));
}
async function load(userId: string, transaction: Transaction): Promise<State> {
  const joueur = await Joueur.findByPk(userId, { transaction });
  if (!joueur) throw new GameRuleError('PLAYER_MISSING', "Tu n'as pas encore rejoint la partie. Utilise /jouer.");
  const plateau = await Plateau.findByPk(1, { transaction });
  if (!plateau || plateau.enigme_status === 'season_ended') throw new GameRuleError('CLOSED', '🏆 La saison est terminée !');
  return { joueur, plateau };
}
function requirePending(joueur: Joueur, type: IleStop): IlePending {
  const pending = islandPending(joueur.action_en_attente);
  if (!pending || pending.type !== type || pending.case !== joueur.position) throw new GameRuleError('STALE', 'Cette action a expiré.');
  return pending;
}

export type IslandEffect =
  | { kind: 'boost' | 'slide'; amount: number; position: number }
  | { kind: 'rock'; zone: string; players: string[] }
  | { kind: 'exchange_empty'; roll: number }
  | { kind: 'exchange'; roll: number; actorId: string; targetId: string; targetKind: 'ahead' | 'behind' | 'first' | 'last' };

async function landingEffects(joueur: Joueur, transaction: Transaction, random: Random): Promise<IslandEffect[]> {
  const landed = findCase(joueur.position);
  if (landed.type === 'Elan') {
    const bonus = random() > 0.5 ? 3 : 2;
    joueur.position += bonus;
    return [{ kind: 'boost', amount: bonus, position: joueur.position }];
  }
  if (landed.type === 'Glissade') {
    const malus = random() > 0.5 ? 3 : 2;
    joueur.position = Math.max(1, joueur.position - malus);
    return [{ kind: 'slide', amount: malus, position: joueur.position }];
  }
  const players = (await Joueur.findAll({ transaction })).map(j => j.discord_id === joueur.discord_id ? joueur : j);
  if (landed.type === 'Rocher') {
    const hit = players.filter(j => findCase(j.position).zone === landed.zone);
    for (const j of hit) {
      j.position = Math.max(1, j.position - 5);
      if (j !== joueur) await j.save({ transaction });
    }
    return [{ kind: 'rock', zone: landed.zone ?? '', players: hit.map(j => j.discord_id) }];
  }
  if (landed.type === 'Echange') {
    const roll = randomInt(random, 1, 6);
    const others = players.filter(j => j !== joueur);
    let target: Joueur | undefined;
    let targetKind: 'ahead' | 'behind' | 'first' | 'last';
    if (roll <= 2) { target = others.filter(j => j.position > joueur.position).sort((a, b) => a.position - b.position)[0]; targetKind = 'ahead'; }
    else if (roll <= 4) { target = others.filter(j => j.position < joueur.position).sort((a, b) => b.position - a.position)[0]; targetKind = 'behind'; }
    else if (roll === 5) { target = [...players].sort((a, b) => b.position - a.position)[0]; targetKind = 'first'; }
    else { target = [...players].sort((a, b) => a.position - b.position)[0]; targetKind = 'last'; }
    if (!target || target === joueur) return [{ kind: 'exchange_empty', roll }];
    [joueur.position, target.position] = [target.position, joueur.position];
    await target.save({ transaction });
    return [{ kind: 'exchange', roll, actorId: joueur.discord_id, targetId: target.discord_id, targetKind }];
  }
  return [];
}

async function move(state: State, resume: IleStop | null, transaction: Transaction, random: Random): Promise<MoveOutcome> {
  const { joueur, plateau } = state;
  const result = walk({ position: joueur.position, remaining: joueur.cases_restantes, resume, direction: joueur.temp_choix_direction, data: boardData(plateau) });
  joueur.position = result.position;
  joueur.cases_restantes = result.remaining;
  if (result.stop) {
    const pending: IlePending = { type: result.stop, case: result.position, token: newToken(random), ...(result.target ? { target: result.target } : {}) };
    joueur.action_en_attente = pending;
    await joueur.save({ transaction });
    return { kind: 'stopped', stop: result.stop, pending, joueur, plateau };
  }
  joueur.action_en_attente = null;
  joueur.temp_choix_direction = null;
  const caseArrivee = findCase(joueur.position);
  const effects = await landingEffects(joueur, transaction, random);
  const double = joueur.mode_data.double_lancer === true;
  await joueur.save({ transaction });
  return { kind: 'landed', caseArrivee, effects, double, joueur, plateau };
}

export async function startTurn(actor: Actor, options: Options = {}): Promise<{ standard: number; bonus: number; bonusType: Bonus; double: boolean; move: MoveOutcome }> {
  const random = options.random ?? Math.random;
  return run(actor.id, async transaction => {
    const state = await load(actor.id, transaction);
    const { joueur, plateau } = state;
    if (!joueur.a_le_droit_de_jouer) throw new GameRuleError('NOT_ALLOWED', "Tu n'as pas le droit de jouer.");
    if (joueur.est_fantome) throw new GameRuleError('GHOST', '👻 Tu es en mode fantôme, tu ne peux pas lancer les dés !');
    if (plateau.enigme_status === 'active') throw new GameRuleError('LOCKED', "Le plateau est verrouillé ! Il faut d'abord résoudre l'énigme du jour.");
    if (joueur.action_en_attente || joueur.cases_restantes > 0) throw new GameRuleError('IN_PROGRESS', "Termine d'abord ton déplacement en cours.");
    await saveTurnSnapshot(joueur, plateau, transaction);
    const bonusType = bonusOf(joueur);
    const standard = randomInt(random, 1, 6);
    const bonus = bonusRoll(bonusType, random);
    const double = bonus > 0 && standard === bonus;
    const modeData: JsonObject = { ...joueur.mode_data, bonus_de: 'none', double_lancer: double };
    joueur.mode_data = modeData;
    joueur.stat_cases_avancees += standard + bonus;
    // A double grants an immediate free standard roll.
    joueur.a_le_droit_de_jouer = double;
    joueur.a_joue_ce_tour = true;
    joueur.jours_inactifs = 0;
    joueur.cases_restantes = standard + bonus;
    return { standard, bonus, bonusType, double, move: await move(state, null, transaction, random) };
  });
}

export interface ChallengeResult { stop: IleStop; roll: number; success: boolean; fellTo?: number; target?: number; move: MoveOutcome | null }

/** Resolve the pending obstacle (gate, cascade, dragon, vine) or crossroads choice. */
export async function resolveChallenge(actor: Actor, stop: IleStop, choice: number | null, options: Options = {}): Promise<ChallengeResult> {
  const random = options.random ?? Math.random;
  return run(actor.id, async transaction => {
    const state = await load(actor.id, transaction);
    const { joueur, plateau } = state;
    if (plateau.enigme_status === 'active') throw new GameRuleError('LOCKED', "Le plateau est verrouillé ! Il faut d'abord résoudre l'énigme du jour.");
    const pending = requirePending(joueur, stop);
    joueur.action_en_attente = null;
    const endTurn = async (result: Omit<ChallengeResult, 'move'>) => {
      joueur.cases_restantes = 0;
      joueur.temp_choix_direction = null;
      await joueur.save({ transaction });
      return { ...result, move: null };
    };
    const data = boardData(plateau);
    if (stop === 'intersection') {
      const current = findCase(joueur.position);
      const path = current.next[choice ?? -1];
      if (path === undefined) throw new GameRuleError('DIRECTION', 'Ce chemin ne part pas de ta case.');
      if (random() < 0.5) {
        joueur.position = waterLanding(current);
        return endTurn({ stop, roll: 0, success: false, fellTo: joueur.position });
      }
      joueur.temp_choix_direction = path;
      return { stop, roll: 0, success: true, target: path, move: await move(state, 'intersection', transaction, random) };
    }
    if (stop === 'liane') {
      const roll = randomInt(random, 1, 6);
      joueur.cases_restantes = roll;
      return { stop, roll, success: true, move: await move(state, 'liane', transaction, random) };
    }
    if (stop === 'portail') {
      const roll = randomInt(random, 1, 6);
      const target = pending.type === 'portail' && typeof pending.target === 'number' ? pending.target : at(findCase(joueur.position).next, 0);
      if (roll < GATE_TARGET) return endTurn({ stop, roll, success: false, target });
      saveBoardData(plateau, { ...data, portails_ouverts: [...new Set([...data.portails_ouverts, target])] });
      await plateau.save({ transaction });
      return { stop, roll, success: true, target, move: await move(state, 'portail', transaction, random) };
    }
    if (stop === 'cascade') {
      const roll = randomInt(random, 1, 6);
      if (roll < CASCADE_TARGET) {
        joueur.position = waterLanding(findCase(joueur.position));
        return endTurn({ stop, roll, success: false, fellTo: joueur.position });
      }
      saveBoardData(plateau, { ...data, cascade_desactivee: true });
      await plateau.save({ transaction });
      return { stop, roll, success: true, move: await move(state, 'cascade', transaction, random) };
    }
    const roll = randomInt(random, 1, 6) + bonusRoll(bonusOf(joueur), random);
    const success = roll >= DRAGON_TARGET;
    if (success && !data.gagnants_dragon.includes(joueur.discord_id)) {
      saveBoardData(plateau, { ...data, gagnants_dragon: [...data.gagnants_dragon, joueur.discord_id] });
      await plateau.save({ transaction });
    }
    return endTurn({ stop, roll, success });
  });
}

/** Timer expiry: gates and cascades fail, vines jump automatically, crossroads take the first path with the same 50% fall risk. */
export async function expirePending(actor: Actor, token: string, options: Options = {}): Promise<{ type: IleStop; roll: number; fellTo?: number; move: MoveOutcome | null } | null> {
  const random = options.random ?? Math.random;
  return run(actor.id, async transaction => {
    const state = await load(actor.id, transaction);
    const { joueur } = state;
    const pending = islandPending(joueur.action_en_attente);
    if (!pending || pending.token !== token) return null;
    const type = pending.type;
    joueur.action_en_attente = null;
    if (type === 'liane') {
      const roll = randomInt(random, 1, 6);
      joueur.cases_restantes = roll;
      return { type, roll, move: await move(state, 'liane', transaction, random) };
    }
    if (type === 'intersection') {
      const current = findCase(joueur.position);
      if (random() < 0.5) {
        joueur.position = waterLanding(current);
        joueur.cases_restantes = 0;
        joueur.temp_choix_direction = null;
        await joueur.save({ transaction });
        return { type, roll: 0, fellTo: joueur.position, move: null };
      }
      joueur.temp_choix_direction = at(current.next, 0);
      return { type, roll: 0, move: await move(state, 'intersection', transaction, random) };
    }
    joueur.cases_restantes = 0;
    joueur.temp_choix_direction = null;
    await joueur.save({ transaction });
    return { type, roll: 0, move: null };
  });
}

/** Obstacle a case asks for when a player stands on it with steps left. */
function legacyStop(position: number, data: IleBoardData): { stop: IleStop; target?: number } | null {
  const here = findCase(position);
  if (here.type === 'Intersection') return { stop: 'intersection' };
  if (here.type === 'Liane') return { stop: 'liane' };
  if (here.type === 'Cascade' && !data.cascade_desactivee) return { stop: 'cascade' };
  const ahead = here.next[0];
  if (ahead !== undefined && findCase(ahead).type === 'Portail' && !data.portails_ouverts.includes(ahead)) return { stop: 'portail', target: ahead };
  return null;
}

/**
 * Versions before migration 003 kept pending obstacles in memory: a restart left the player on the
 * obstacle with steps left. Restore it once, at startup; without an obstacle the move ends, as
 * the island has no "continue" action. Returns the players.
 */
export async function recoverLegacyPending(options: Options = {}): Promise<string[]> {
  const random = options.random ?? Math.random;
  return withScheduledLock('restart', () => sequelize.transaction(async transaction => {
    const plateau = await Plateau.findByPk(1, { transaction });
    if (!plateau || plateau.enigme_status === 'season_ended') return [];
    const data = boardData(plateau);
    const recovered: string[] = [];
    for (const joueur of await Joueur.findAll({ where: { action_en_attente: null, cases_restantes: { [Op.gt]: 0 } }, transaction })) {
      const found = legacyStop(joueur.position, data);
      if (found) joueur.action_en_attente = { type: found.stop, case: joueur.position, token: newToken(random), ...(found.target ? { target: found.target } : {}) };
      else joueur.cases_restantes = 0;
      await joueur.save({ transaction });
      recovered.push(joueur.discord_id);
    }
    return recovered;
  }));
}

export async function unblockGhost(userId: string): Promise<boolean> {
  return run(userId, async transaction => {
    const plateau = await Plateau.findByPk(1, { transaction });
    if (!plateau || plateau.enigme_status === 'season_ended') return false;
    const joueur = await Joueur.findByPk(userId, { transaction });
    if (!joueur || !joueur.est_fantome || joueur.fantome_unblock_used) return false;
    joueur.est_fantome = false;
    joueur.fantome_unblock_used = true;
    joueur.jours_inactifs = 0;
    if (plateau.enigme_status === 'finished' && !joueur.a_joue_ce_tour) {
      joueur.a_le_droit_de_jouer = true;
    }
    await joueur.save({ transaction });
    return true;
  });
}
