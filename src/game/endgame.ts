import { Client } from 'discord.js';
import { Joueur, Plateau, sequelize } from '../db/models';
import { Random } from '../domain/types';
import { AnnounceOptions } from '../gamemodes/mode-interface';
import { getActiveMode } from '../gamemodes/registry';
import { clearAllPendingTimers } from '../discord/pending-timers';
import { invalidateBoardCache } from '../utils/canvas';
import { afterGameAction, withGameLock } from './transaction';

export interface SeasonClosing { success: boolean; alreadyEnded: boolean; playerCount: number }

const pendingDelays = new Set<{ timer: NodeJS.Timeout; flush: () => void }>();
let flushingDelays = false;
let customWait: ((ms: number) => Promise<void>) | null = null;

function managedWait(ms: number): Promise<void> {
  if (customWait) return customWait(ms);
  if (ms <= 0 || flushingDelays) return Promise.resolve();
  return new Promise<void>(resolve => {
    const entry = {
      timer: setTimeout(() => { pendingDelays.delete(entry); resolve(); }, ms),
      flush: resolve,
    };
    entry.timer.unref();
    pendingDelays.add(entry);
  });
}

/** Flush in-flight reveal pauses on shutdown so podium and winner role complete before client.destroy(). */
export function flushEndgameDelays(): void {
  flushingDelays = true;
  for (const entry of [...pendingDelays]) {
    clearTimeout(entry.timer);
    pendingDelays.delete(entry);
    entry.flush();
  }
}

/** Reset the shutdown flush flag (tests only). */
export function resetEndgameDelays(): void {
  flushingDelays = false;
}

/** Override or restore the endgame reveal delay function (tests covering indirect callers such as crons). */
export function setEndgameWait(wait: ((ms: number) => Promise<void>) | null): void {
  customWait = wait;
}

/** Close the season once: mode awards, final status and locked players commit together, then the mode announces. */
export async function endSeason(
  client: Client,
  random: Random = Math.random,
  options?: AnnounceOptions,
): Promise<SeasonClosing> {
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
    const wait = options?.wait ?? managedWait;
    // Unordered: multi-message suspense reveals must never stall /admin stop or other commands on the global publications queue.
    await afterGameAction(
      () => getActiveMode({ game_mode: closing.mode }).getEndgame().announce(client, closing.summary, closing.playerCount, { wait }),
      { ordered: false },
    );
  }
  return { success: closing.success, alreadyEnded: closing.alreadyEnded, playerCount: closing.playerCount };
}
