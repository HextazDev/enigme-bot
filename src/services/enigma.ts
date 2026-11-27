import { Joueur, Plateau, sequelize } from '../db/models';
import { GameRuleError, JsonObject } from '../domain/types';
import { withGameLock } from '../game/transaction';
import { formatEnigmaPublication, nextEnigmaPublication, parisClock } from '../utils/time';

export const bonusDice = { '17h-18h': 'gold', '18h-19h': 'silver', '19h-20h': 'bronze', '20h-21h': 'chocolat' } as const;
function bonusFor(tranche: string): string {
  if (tranche !== '17h-18h' && tranche !== '18h-19h' && tranche !== '19h-20h' && tranche !== '20h-21h') throw new Error('Tranche de récompense invalide');
  return bonusDice[tranche];
}
const diceLabels: Record<string, string> = { gold: "Dé d'Or 🎲✨", silver: "Dé d'Argent 🥈", bronze: 'Dé de Bronze 🥉', chocolat: 'Dé en Chocolat 🍫' };
export function diceLabel(tranche: string): string { return diceLabels[bonusFor(tranche)] ?? 'aucun dé'; }

/** Reward bracket of an answer, from the Paris hour at which it was submitted. */
export function rewardBracket(submittedAt: Date): { tranche: string; pieces: number } {
  const { hour } = parisClock(submittedAt);
  if (hour < 18) return { tranche: '17h-18h', pieces: 10 };
  if (hour < 19) return { tranche: '18h-19h', pieces: 7 };
  if (hour < 20) return { tranche: '19h-20h', pieces: 4 };
  return { tranche: '20h-21h', pieces: 2 };
}

export async function finishEnigma() {
  return withGameLock('enigma', () => sequelize.transaction(async transaction => {
    const plateau = await Plateau.findByPk(1, { transaction });
    if (!plateau || plateau.enigme_status !== 'active') return null;
    if (plateau.game_mode === 'ile_defis') {
      for (const winner of plateau.enigme_gagnants) {
        if (typeof winner.discord_id !== 'string' || typeof winner.tranche !== 'string' || !bonusFor(winner.tranche)) throw new Error('Gagnant d’énigme invalide');
        const joueur = await Joueur.findByPk(winner.discord_id, { transaction });
        if (joueur) {
          joueur.mode_data = { ...joueur.mode_data, bonus_de: bonusFor(winner.tranche) };
          await joueur.save({ transaction });
        }
      }
    }
    plateau.enigme_status = 'finished';
    plateau.fin_enigme_timestamp = null;
    await plateau.save({ transaction });
    await Joueur.update({ a_le_droit_de_jouer: true }, { where: { est_fantome: false }, transaction });
    await Joueur.update({ a_le_droit_de_jouer: false }, { where: { est_fantome: true }, transaction });
    return plateau;
  }), true);
}

export interface EnigmaInput { text: string; answer: string; hints: [string | null, string | null, string | null] }

/** Program tomorrow's (or today's, before 17h) enigma. A running enigma or an ended season cannot be overwritten. */
export async function programEnigma(input: EnigmaInput): Promise<void> {
  if (!input.text.trim() || !input.answer.trim()) throw new GameRuleError('EMPTY', "L'énigme et sa réponse sont obligatoires.");
  return withGameLock('mj', () => sequelize.transaction(async transaction => {
    const plateau = await Plateau.findByPk(1, { transaction });
    if (!plateau || plateau.enigme_status === 'season_ended') throw new GameRuleError('CLOSED', 'Aucune saison en cours : lance-la avec `/admin start` avant de programmer une énigme.');
    if (plateau.enigme_status === 'active') throw new GameRuleError('ACTIVE', "Une énigme est en cours : attends sa clôture à 21h avant d'en programmer une nouvelle.");
    const nextModeData = { ...plateau.mode_data };
    delete nextModeData.propositions_jugees;
    Object.assign(plateau, {
      enigme_text: input.text, enigme_reponse: input.answer.trim(),
      enigme_indice1: input.hints[0], enigme_indice2: input.hints[1], enigme_indice3: input.hints[2],
      enigme_status: 'programmee', enigme_publiee: false, indice1_publie: false, indice2_publie: false, indice3_publie: false,
      enigme_gagnants: [], enigme_resolue: false, fin_enigme_timestamp: null, mode_data: nextModeData,
    });
    await plateau.save({ transaction });
    await Joueur.update({ a_trouve_enigme: false }, { where: {}, transaction });
  }));
}

export interface Validation { tranche: string; pieces: number; ileDice: string | null; late: boolean }

function judgedProposals(plateau: Plateau): string[] {
  const raw = plateau.mode_data.propositions_jugees;
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
}

/** MJ accepts an answer. A second validation of the same player or DM message is refused, so a double click never pays twice. */
export async function validateAnswer(userId: string, submittedAt: Date, proposalId?: string): Promise<Validation> {
  return withGameLock('mj', () => sequelize.transaction(async transaction => {
    const plateau = await Plateau.findByPk(1, { transaction });
    if (!plateau || (plateau.enigme_status !== 'active' && plateau.enigme_status !== 'finished')) throw new GameRuleError('INACTIVE', "L'énigme n'est pas active.");
    const judged = judgedProposals(plateau);
    if (proposalId && judged.includes(proposalId)) throw new GameRuleError('ALREADY', 'Cette proposition a déjà été traitée.');
    if (plateau.enigme_gagnants.some(g => g.discord_id === userId)) throw new GameRuleError('ALREADY', 'Cette réponse a déjà été validée.');
    const { tranche, pieces } = rewardBracket(submittedAt);
    const ile = plateau.game_mode === 'ile_defis';
    const winner: JsonObject = { discord_id: userId, pieces: ile ? 0 : pieces, tranche };
    plateau.enigme_gagnants = [...plateau.enigme_gagnants, winner];
    if (proposalId) plateau.mode_data = { ...plateau.mode_data, propositions_jugees: [...judged, proposalId] };
    await plateau.save({ transaction });
    const joueur = await Joueur.findByPk(userId, { transaction });
    if (joueur) {
      if (ile) joueur.mode_data = { ...joueur.mode_data, bonus_de: bonusFor(tranche) };
      else joueur.pieces += pieces;
      joueur.a_trouve_enigme = true;
      joueur.stat_enigmes_trouvees += 1;
      await joueur.save({ transaction });
    }
    return { tranche, pieces, ileDice: ile ? bonusFor(tranche) : null, late: plateau.enigme_status === 'finished' };
  }));
}

/** MJ rejects a proposal (and optionally removes 1 coin for spam). Idempotent per DM proposalId. */
export async function rejectProposal(userId: string, spam: boolean, proposalId?: string): Promise<void> {
  return withGameLock('mj', () => sequelize.transaction(async transaction => {
    const plateau = await Plateau.findByPk(1, { transaction });
    if (plateau && proposalId) {
      const judged = judgedProposals(plateau);
      if (judged.includes(proposalId)) throw new GameRuleError('ALREADY', 'Cette proposition a déjà été traitée.');
      plateau.mode_data = { ...plateau.mode_data, propositions_jugees: [...judged, proposalId] };
      await plateau.save({ transaction });
    }
    if (!spam) return;
    const joueur = await Joueur.findByPk(userId, { transaction });
    if (joueur && joueur.pieces > 0) {
      joueur.pieces -= 1;
      await joueur.save({ transaction });
    }
  }));
}

/** Non-compliant proposal: the participation coin is taken back (idempotent when proposalId is supplied). */
export async function penalizeProposal(userId: string, proposalId?: string): Promise<void> {
  return rejectProposal(userId, true, proposalId);
}

export interface Guess { coinGranted: boolean; autoRemind: boolean; previousLastGuess: Date | null }
const COOLDOWN_MS = 30 * 60_000;
export function guessCooldownRemaining(lastGuess: Date | null, now: Date): number {
  if (!lastGuess) return 0;
  return Math.max(0, Math.ceil((COOLDOWN_MS - (now.getTime() - new Date(lastGuess).getTime())) / 60_000));
}

/** Record a /deviner attempt: cooldown, max 3 participation coins per day. */
export async function recordGuess(userId: string, now: Date): Promise<Guess & { remainingMinutes: number }> {
  return withGameLock(userId, () => sequelize.transaction(async transaction => {
    const [joueur] = await Joueur.findOrCreate({ where: { discord_id: userId }, transaction });
    if (joueur.est_fantome) throw new GameRuleError('GHOST', '👻 Tu es en mode fantôme ! Utilise la commande `/jouer` pour te débloquer avant de pouvoir deviner.');
    const plateau = await Plateau.findByPk(1, { transaction });
    if (!plateau || plateau.enigme_status === 'season_ended') throw new GameRuleError('CLOSED', '🏆 La saison est terminée ! Le vainqueur a été couronné et les énigmes sont closes.');
    if (plateau.enigme_status === 'programmee') {
      const next = formatEnigmaPublication(nextEnigmaPublication(now), now);
      throw new GameRuleError('NOT_YET', `⏳ L'énigme n'est pas encore publiée ! Reviens **${next}** pour tenter ta chance.`);
    }
    if (plateau.enigme_status !== 'active') throw new GameRuleError('FINISHED', "L'énigme du jour est déjà terminée !");
    if (joueur.a_trouve_enigme) throw new GameRuleError('FOUND', "🎉 Tu as déjà trouvé la bonne réponse aujourd'hui ! Tu ne peux plus deviner.");
    const remainingMinutes = guessCooldownRemaining(joueur.last_deviner_time, now);
    if (remainingMinutes > 0) return { coinGranted: false, remainingMinutes, autoRemind: joueur.auto_remind_guess, previousLastGuess: joueur.last_deviner_time };
    const previousLastGuess = joueur.last_deviner_time;
    const coinGranted = joueur.guess_du_jour < 3;
    if (coinGranted) { joueur.pieces += 1; joueur.guess_du_jour += 1; }
    joueur.last_deviner_time = now;
    await joueur.save({ transaction });
    return { coinGranted, remainingMinutes: 0, autoRemind: joueur.auto_remind_guess, previousLastGuess };
  }));
}

/** Undo a committed guess if the DM to the MJ could not be delivered so the player is not locked out for 30 minutes. */
export async function rollbackFailedGuess(userId: string, coinGranted: boolean, previousLastGuess: Date | null): Promise<void> {
  return withGameLock(userId, () => sequelize.transaction(async transaction => {
    const joueur = await Joueur.findByPk(userId, { transaction });
    if (!joueur) return;
    joueur.last_deviner_time = previousLastGuess;
    if (coinGranted) {
      joueur.pieces = Math.max(0, joueur.pieces - 1);
      joueur.guess_du_jour = Math.max(0, joueur.guess_du_jour - 1);
    }
    await joueur.save({ transaction });
  }), true);
}
