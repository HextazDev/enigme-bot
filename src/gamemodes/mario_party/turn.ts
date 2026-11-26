import { marioVariant } from './variant';
import { LandingEvent } from './events';
import { saveTurnSnapshot } from '../../game/snapshot';
import { at } from '../../domain/types';
import { marioPending } from '../../domain/persisted';
import { Op, Transaction } from 'sequelize';
import { Joueur, Plateau, sequelize } from '../../db/models';
import { BoardCase, GameRuleError, Item, MarioPending, Random, isTrap, newToken, pick, randomInt } from '../../domain/types';
import { withGameLock, withScheduledLock } from '../../game/transaction';
import { getActiveBoardCases } from '../registry';
import { gameNow } from '../../utils/clock';
import { parisClock } from '../../utils/time';
import { isSaturdayClosed } from '../../services/season';
import { applyLanding } from './landing';
import { ITEMS } from './items';
import { applyPurchase, prepareShop, Purchase } from './shop';
import { BOO_STAR_PRICE, KEY_ITEM_NAME, MarioStop, caseBefore, findCase, rollDice, starCandidates, teleportCandidates, walk } from './rules';

export interface Actor { id: string; username: string }
interface State { joueur: Joueur; plateau: Plateau; cases: BoardCase[] }
interface MoveBase { joueur: Joueur; plateau: Plateau; walked: number }
export type MoveOutcome =
  | MoveBase & { kind: 'stopped'; stop: MarioStop; caseId: number; shop: Item[]; pending: MarioPending }
  | MoveBase & { kind: 'landed'; caseArrivee: BoardCase; effects: LandingEvent[] };

export interface Options { random?: Random; now?: Date }

async function load(userId: string, transaction: Transaction): Promise<State> {
  const joueur = await Joueur.findByPk(userId, { transaction });
  if (!joueur) throw new GameRuleError('PLAYER_MISSING', "Tu n'as pas encore rejoint la partie. Utilise /jouer.");
  const plateau = await Plateau.findByPk(1, { transaction });
  if (!plateau || plateau.enigme_status === 'season_ended') throw new GameRuleError('CLOSED', '🏆 La saison est terminée !');
  return { joueur, plateau, cases: getActiveBoardCases(plateau) };
}
function requireAwake(joueur: Joueur): void {
  if (joueur.est_fantome) throw new GameRuleError('GHOST', '👻 Tu es en mode fantôme, tu ne peux pas jouer !');
}
function requireBoardOpen(plateau: Plateau, now: Date): void {
  if (plateau.enigme_status === 'active') throw new GameRuleError('LOCKED', "Le plateau est verrouillé ! Il faut d'abord résoudre l'énigme du jour.");
  if (isSaturdayClosed(plateau, now)) throw new GameRuleError('SATURDAY', "C'est samedi : pas de lancer de dé aujourd'hui.");
}
function requirePending(joueur: Joueur, type: MarioStop): MarioPending {
  const pending = marioPending(joueur.action_en_attente);
  if (!pending || pending.type !== type || pending.case !== joueur.position) throw new GameRuleError('STALE', 'Cette action a expiré.');
  return pending;
}
function run<T>(userId: string, action: (transaction: Transaction) => Promise<T>): Promise<T> {
  return withGameLock(userId, () => sequelize.transaction(action));
}

export async function randomStarPosition(cases: BoardCase[], current: number, transaction: Transaction, random: Random): Promise<number> {
  const occupied = (await Joueur.findAll({ attributes: ['position'], transaction })).map(j => j.position);
  return pick(random, starCandidates(cases, current, occupied));
}

/** Walk the remaining steps, then either record the decision to make or resolve the landing. */
async function move(state: State, actor: Actor, resume: MarioStop | null, transaction: Transaction, options: Required<Options>): Promise<MoveOutcome> {
  const { joueur, plateau, cases } = state;
  const result = walk({ cases, position: joueur.position, remaining: joueur.cases_restantes, star: plateau.position_etoile,
    resume, direction: joueur.temp_choix_direction, shopOpen: plateau.tour < 30 });
  const walked = joueur.cases_restantes - result.remaining;
  joueur.position = result.position;
  joueur.cases_restantes = result.remaining;
  if (resume === 'intersection') joueur.temp_choix_direction = null;
  if (result.stop) {
    const pending: MarioPending = { type: result.stop, case: result.position, token: newToken(options.random) };
    joueur.action_en_attente = pending;
    const shop = result.stop === 'boutique' ? await prepareShop(joueur, transaction, options.random, parisClock(options.now).weekday === 0) : [];
    await joueur.save({ transaction });
    return { kind: 'stopped', stop: result.stop, caseId: result.position, shop, pending, joueur, plateau, walked };
  }
  joueur.action_en_attente = null;
  const traps = plateau.pieges_actifs.filter(isTrap);
  const trap = traps.find(t => t.position === joueur.position) ?? null;
  if (trap) plateau.pieges_actifs = traps.filter(t => t !== trap);
  const caseArrivee = findCase(cases, joueur.position);
  const effects = await applyLanding({ joueur, plateau, caseArrivee, actor, trap, random: options.random,
    chooseStar: (current, t) => randomStarPosition(cases, current, t, options.random) }, transaction);
  return { kind: 'landed', caseArrivee, effects, joueur, plateau, walked };
}

function withDefaults(options: Options): Required<Options> {
  return { random: options.random ?? Math.random, now: options.now ?? gameNow() };
}

export async function startTurn(actor: Actor, options: Options = {}): Promise<{ de: number; move: MoveOutcome }> {
  const opts = withDefaults(options);
  return run(actor.id, async transaction => {
    const state = await load(actor.id, transaction);
    const { joueur, plateau } = state;
    if (!joueur.a_le_droit_de_jouer) throw new GameRuleError('NOT_ALLOWED', "Tu n'as pas le droit de jouer.");
    requireAwake(joueur);
    requireBoardOpen(plateau, opts.now);
    if (joueur.action_en_attente || joueur.cases_restantes > 0) throw new GameRuleError('IN_PROGRESS', "Termine d'abord ton déplacement en cours.");
    await saveTurnSnapshot(joueur, plateau, transaction);
    const roll = rollDice(joueur, opts.random);
    Object.assign(joueur, roll.state);
    joueur.a_le_droit_de_jouer = false;
    joueur.a_joue_ce_tour = true;
    joueur.jours_inactifs = 0;
    joueur.stat_cases_avancees += roll.value;
    joueur.cases_restantes = roll.value;
    return { de: roll.value, move: await move(state, actor, null, transaction, opts) };
  });
}

/** Choice a case asks for when a player stands on it with steps left; crossroads are asked again by walk(). */
function legacyStop({ joueur, plateau, cases }: State): MarioStop | null {
  const here = findCase(cases, joueur.position);
  if (here.next.length > 1) return null;
  if (here.id === plateau.position_etoile) return 'etoile';
  if (here.type === 'Boutique' && plateau.tour < 30) return 'boutique';
  if (here.type === 'Boo') return 'boo';
  return null;
}

/**
 * Versions before migration 003 kept pending choices in memory: a restart left the player on the
 * case that asked for it, with steps left. Restore that choice once, at startup. Returns the players.
 */
export async function recoverLegacyPending(options: Options = {}): Promise<string[]> {
  const opts = withDefaults(options);
  return withScheduledLock('restart', () => sequelize.transaction(async transaction => {
    const plateau = await Plateau.findByPk(1, { transaction });
    if (!plateau || plateau.enigme_status === 'season_ended') return [];
    const cases = getActiveBoardCases(plateau);
    const recovered: string[] = [];
    for (const joueur of await Joueur.findAll({ where: { action_en_attente: null, cases_restantes: { [Op.gt]: 0 } }, transaction })) {
      const stop = legacyStop({ joueur, plateau, cases });
      if (!stop) continue;
      joueur.action_en_attente = { type: stop, case: joueur.position, token: newToken(opts.random) };
      if (stop === 'boutique') await prepareShop(joueur, transaction, opts.random, parisClock(opts.now).weekday === 0);
      await joueur.save({ transaction });
      recovered.push(joueur.discord_id);
    }
    return recovered;
  }));
}

/** Resume a movement interrupted without a pending choice (closed shop on the last turn). */
export async function continueTurn(actor: Actor, options: Options = {}): Promise<MoveOutcome> {
  const opts = withDefaults(options);
  return run(actor.id, async transaction => {
    const state = await load(actor.id, transaction);
    requireBoardOpen(state.plateau, opts.now);
    if (state.joueur.action_en_attente) throw new GameRuleError('PENDING', 'Un choix t’attend encore sur ta case.');
    if (state.joueur.cases_restantes <= 0) throw new GameRuleError('NO_MOVE', "Tu n'as pas de déplacement en cours.");
    return move(state, actor, null, transaction, opts);
  });
}

async function resolve<T>(actor: Actor, type: MarioStop, options: Options,
  action: (state: State, transaction: Transaction, opts: Required<Options>) => Promise<T>): Promise<T & { move: MoveOutcome }> {
  const opts = withDefaults(options);
  return run(actor.id, async transaction => {
    const state = await load(actor.id, transaction);
    requireBoardOpen(state.plateau, opts.now);
    requirePending(state.joueur, type);
    const result = await action(state, transaction, opts);
    state.joueur.action_en_attente = null;
    return { ...result, move: await move(state, actor, type, transaction, opts) };
  });
}

export function resolveStar(actor: Actor, buy: boolean, options: Options = {}) {
  return resolve(actor, 'etoile', options, async ({ joueur, plateau, cases }, transaction, opts) => {
    if (!buy) return { bought: false as const };
    const price = marioVariant(plateau.game_variant).settings.starPrice;
    if (joueur.pieces < price) throw new GameRuleError('FUNDS', 'Pièces insuffisantes.');
    joueur.pieces -= price;
    joueur.etoiles += 1;
    plateau.position_etoile = await randomStarPosition(cases, plateau.position_etoile, transaction, opts.random);
    await plateau.save({ transaction });
    return { bought: true as const, newStar: plateau.position_etoile };
  });
}

/** Buy in the shop the player stands in. A full inventory asks which item to drop before anything changes. */
export async function buyFromShop(actor: Actor, itemId: string, replaceIndex: number | undefined, options: Options = {}): Promise<{ purchase: Purchase; move: MoveOutcome | null }> {
  const opts = withDefaults(options);
  return run(actor.id, async transaction => {
    const state = await load(actor.id, transaction);
    requireBoardOpen(state.plateau, opts.now);
    requirePending(state.joueur, 'boutique');
    const purchase = applyPurchase(state.joueur, itemId, replaceIndex);
    if (purchase.kind === 'needs_replacement') return { purchase, move: null };
    state.joueur.action_en_attente = null;
    return { purchase, move: await move(state, actor, 'boutique', transaction, opts) };
  });
}
export function leaveShop(actor: Actor, options: Options = {}) {
  return resolve(actor, 'boutique', options, async () => ({}));
}

export async function booTargets(actor: Actor, type: 'pieces' | 'etoile', options: Options = {}): Promise<Joueur[]> {
  const opts = withDefaults(options);
  return run(actor.id, async transaction => {
    const { joueur, plateau } = await load(actor.id, transaction);
    requireBoardOpen(plateau, opts.now);
    requirePending(joueur, 'boo');
    if (type === 'etoile' && joueur.pieces < BOO_STAR_PRICE) throw new GameRuleError('FUNDS', "Tu n'as pas assez de pièces pour voler une étoile.");
    const players = await Joueur.findAll({ transaction });
    return players.filter(j => j.discord_id !== joueur.discord_id && !j.est_fantome && (type === 'pieces' ? j.pieces > 0 : j.etoiles > 0));
  });
}
export function booSteal(actor: Actor, targetId: string, type: string, options: Options = {}) {
  return resolve(actor, 'boo', options, async ({ joueur }, transaction, opts) => {
    if (targetId === joueur.discord_id) throw new GameRuleError('SELF_TARGET', 'Tu ne peux pas te voler toi-même.');
    const cible = await Joueur.findByPk(targetId, { transaction });
    if (!cible || cible.est_fantome) throw new GameRuleError('TARGET', 'Cible introuvable.');
    let amount = 0;
    if (type === 'pieces') {
      amount = Math.min(randomInt(opts.random, 3, 12), cible.pieces);
      cible.pieces -= amount;
      joueur.pieces += amount;
    } else if (type === 'etoile') {
      if (joueur.pieces < BOO_STAR_PRICE || cible.etoiles < 1) throw new GameRuleError('FUNDS', 'Pièces ou étoiles insuffisantes.');
      joueur.pieces -= BOO_STAR_PRICE;
      cible.etoiles -= 1;
      joueur.etoiles += 1;
    } else throw new GameRuleError('BOO_TYPE', 'Type de vol inconnu.');
    await cible.save({ transaction });
    return { cible, amount, type };
  });
}
export function booPass(actor: Actor, options: Options = {}) {
  return resolve(actor, 'boo', options, async () => ({}));
}

export function chooseDirection(actor: Actor, path: number, options: Options = {}) {
  return resolve(actor, 'intersection', options, async ({ joueur, cases }) => {
    if (!findCase(cases, joueur.position).next.includes(path)) throw new GameRuleError('DIRECTION', 'Ce chemin ne part pas de ta case.');
    if (findCase(cases, path).requiresKey) {
      const keyIndex = joueur.inventaire.indexOf(KEY_ITEM_NAME);
      if (keyIndex === -1) throw new GameRuleError('NO_KEY', "Tu n'as pas la clé pour entrer dans cette zone !");
      joueur.inventaire = joueur.inventaire.filter((_, index) => index !== keyIndex);
    }
    joueur.temp_choix_direction = path;
    return { path };
  });
}

/** Timer expiry: apply the default decision if the same choice is still pending. */
export async function expirePending(actor: Actor, token: string, options: Options = {}): Promise<{ type: MarioStop; move: MoveOutcome } | null> {
  const opts = withDefaults(options);
  return run(actor.id, async transaction => {
    const joueur = await Joueur.findByPk(actor.id, { transaction });
    const pending = joueur ? marioPending(joueur.action_en_attente) : null;
    if (!pending || pending.token !== token) return null;
    const state = await load(actor.id, transaction);
    const type = pending.type;
    if (type === 'intersection') state.joueur.temp_choix_direction = at(findCase(state.cases, state.joueur.position).next, 0);
    state.joueur.action_en_attente = null;
    return { type, move: await move(state, actor, type, transaction, opts) };
  });
}

export async function unblockGhost(userId: string, options: Options = {}): Promise<boolean> {
  const opts = withDefaults(options);
  return run(userId, async transaction => {
    const plateau = await Plateau.findByPk(1, { transaction });
    if (!plateau || plateau.enigme_status === 'season_ended') return false;
    const joueur = await Joueur.findByPk(userId, { transaction });
    if (!joueur || !joueur.est_fantome || joueur.fantome_unblock_used) return false;
    joueur.est_fantome = false;
    joueur.fantome_unblock_used = true;
    joueur.jours_inactifs = 0;
    if (plateau.enigme_status === 'finished' && !joueur.a_joue_ce_tour && !isSaturdayClosed(plateau, opts.now)) {
      joueur.a_le_droit_de_jouer = true;
    }
    await joueur.save({ transaction });
    return true;
  });
}

export type ItemEffect =
  | { kind: 'modifier'; modifier: 'champignon' | 'double_de' | 'de_triple' }
  | { kind: 'trap'; resource: 'pieces' | 'etoile'; position: number }
  | { kind: 'loaded_die'; value: number }
  | { kind: 'teleport'; golden: boolean; position: number }
  | { kind: 'mirror'; targetId: string | null }
  | { kind: 'star_moved'; position: number };
export interface ItemUse { item: Item; actorId: string; effect: ItemEffect }

/** Use an inventory item before rolling. The button carries the slot: it must still hold that item. */
export async function useItem(actor: Actor, itemKey: string, index: number, pipeValue: number | null, options: Options = {}): Promise<ItemUse> {
  const opts = withDefaults(options);
  return run(actor.id, async transaction => {
    const { joueur, plateau, cases } = await load(actor.id, transaction);
    requireAwake(joueur);
    requireBoardOpen(plateau, opts.now);
    if (!joueur.a_le_droit_de_jouer || joueur.action_en_attente || joueur.cases_restantes > 0) {
      throw new GameRuleError('NOT_ALLOWED', "Tu ne peux pas utiliser d'objet pour le moment (tu as déjà joué ou c'est bloqué).");
    }
    const item = ITEMS[itemKey];
    if (!item || joueur.inventaire[index] !== item.name) throw new GameRuleError('STALE', "Cet objet n'est plus dans ton inventaire.");
    if (item.passive) throw new GameRuleError('PASSIVE', `${item.name} s'utilise automatiquement.`);
    if (item.id === 'de_pipe' && (pipeValue === null || !Number.isInteger(pipeValue) || pipeValue < 1 || pipeValue > 10)) {
      throw new GameRuleError('PIPE_VALUE', 'Choisis une valeur de 1 à 10.');
    }
    joueur.inventaire = joueur.inventaire.filter((_, slot) => slot !== index);
    joueur.stat_objets_utilises += 1;
    let effect: ItemEffect;
    const addTrap = async (type: 'pieces' | 'etoile') => {
      plateau.pieges_actifs = [...plateau.pieges_actifs, { position: joueur.position, type, poseur: joueur.discord_id }];
      await plateau.save({ transaction });
    };
    switch (item.id) {
      case 'champignon': joueur.bonus_prochain_lancer = 3; effect = { kind: 'modifier', modifier: 'champignon' }; break;
      case 'piege_pieces': await addTrap('pieces'); effect = { kind: 'trap', resource: 'pieces', position: joueur.position }; break;
      case 'piege_etoile': await addTrap('etoile'); effect = { kind: 'trap', resource: 'etoile', position: joueur.position }; break;
      case 'double_de': joueur.type_de = 'double'; effect = { kind: 'modifier', modifier: 'double_de' }; break;
      case 'de_triple': joueur.type_de = 'triple'; effect = { kind: 'modifier', modifier: 'de_triple' }; break;
      case 'de_pipe':
        if (pipeValue === null) throw new GameRuleError('PIPE_VALUE', 'Choisis une valeur de 1 à 10.');
        joueur.type_de = 'pipe'; joueur.de_pipe_valeur = pipeValue; effect = { kind: 'loaded_die', value: pipeValue }; break;
      case 'tuyau':
        joueur.position = pick(opts.random, teleportCandidates(cases));
        effect = { kind: 'teleport', golden: false, position: joueur.position };
        break;
      case 'tuyau_dore':
        joueur.position = caseBefore(cases, plateau.position_etoile);
        effect = { kind: 'teleport', golden: true, position: joueur.position };
        break;
      case 'miroir': {
        const others = (await Joueur.findAll({ transaction })).filter(j => j.discord_id !== joueur.discord_id && !j.est_fantome);
        if (!others.length) { effect = { kind: 'mirror', targetId: null }; break; }
        const cible = pick(opts.random, others);
        [joueur.position, cible.position] = [cible.position, joueur.position];
        await cible.save({ transaction });
        effect = { kind: 'mirror', targetId: cible.discord_id };
        break;
      }
      case 'sifflet':
        plateau.position_etoile = await randomStarPosition(cases, plateau.position_etoile, transaction, opts.random);
        await plateau.save({ transaction });
        effect = { kind: 'star_moved', position: plateau.position_etoile };
        break;
      default: throw new GameRuleError('UNSUPPORTED', `${item.name} ne peut pas être utilisé.`);
    }
    await joueur.save({ transaction });
    return { item, actorId: actor.id, effect };
  });
}
