import { Client } from 'discord.js';
import { Joueur, Plateau, sequelize } from '../db/models';
import { Random } from '../domain/types';
import { getActiveMode } from '../gamemodes/registry';
import { clearAllPendingTimers } from '../discord/pending-timers';
import { invalidateBoardCache } from '../utils/canvas';
import { afterGameAction, withGameLock } from './transaction';

export interface SeasonClosing { success: boolean; alreadyEnded: boolean; playerCount: number }

/** Close the season once: mode awards, final status and locked players commit together, then the mode announces. */
export async function endSeason(client: Client, random: Random = Math.random): Promise<SeasonClosing> {
  const closing = await withGameLock('season', () => sequelize.transaction(async transaction => {
    const plateau = await Plateau.findByPk(1, { transaction });
    if (!plateau) return { success: false, alreadyEnded: true, playerCount: 0, summary: null, mode: '' };
    if (plateau.enigme_status === 'season_ended') return { success: true, alreadyEnded: true, playerCount: 0, summary: null, mode: plateau.game_mode };
    const players = await Joueur.findAll({ transaction });
    const summary = await getActiveMode(plateau).getEndgame().close(players, plateau, transaction, random);
    plateau.enigme_resolue = true;
    plateau.enigme_status = 'season_ended';
    await plateau.save({ transaction });
    await Joueur.update({ a_le_droit_de_jouer: false, action_en_attente: null, cases_restantes: 0 }, { where: {}, transaction });
    return { success: true, alreadyEnded: false, playerCount: players.length, summary, mode: plateau.game_mode };
  }), true);
  if (!closing.alreadyEnded && closing.summary) {
    clearAllPendingTimers();
    invalidateBoardCache();
    await afterGameAction(() => getActiveMode({ game_mode: closing.mode }).getEndgame().announce(client, closing.summary, closing.playerCount));
  }
  return { success: closing.success, alreadyEnded: closing.alreadyEnded, playerCount: closing.playerCount };
}
