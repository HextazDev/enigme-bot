import { marioVariant } from './variant';
import { Client } from 'discord.js';
import { Joueur, Plateau } from '../../db/models';
import { Random } from '../../domain/types';
import { announce } from '../../discord/channels';
import { SeasonEnd } from '../mode-interface';
import config = require('../../config');
import { record, strings, integer } from '../../domain/persisted';

export const BONUS_REVEAL_DELAY_MS = 2500;
const defaultWait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

type Stat = 'stat_cases_chance' | 'stat_cases_malchance' | 'stat_cases_avancees' | 'stat_enigmes_trouvees' | 'stat_objets_utilises';
export interface BonusStar { name: string; desc: string; stat: Stat; lowest?: boolean }
export const BONUS_STARS: readonly BonusStar[] = [
  { name: 'Étoile de la Chance 🍀', desc: 'pour avoir atterri sur le plus de cases Chance ou Bleues', stat: 'stat_cases_chance' },
  { name: 'Étoile de la Malchance 🌩️', desc: 'pour avoir atterri sur le plus de cases Malchance, Rouges ou Bowser', stat: 'stat_cases_malchance' },
  { name: 'Étoile du Grand Voyageur 🏃', desc: 'pour avoir le plus avancé sur le plateau', stat: 'stat_cases_avancees' },
  { name: 'Étoile du Paresseux 🐢', desc: 'pour avoir le moins avancé sur le plateau', stat: 'stat_cases_avancees', lowest: true },
  { name: 'Étoile du Génie 🧠', desc: "pour avoir résolu le plus d'énigmes", stat: 'stat_enigmes_trouvees' },
  { name: "Étoile de l'Acheteur Compulsif 🎒", desc: "pour avoir utilisé le plus d'objets", stat: 'stat_objets_utilises' },
];

/**
 * Only non-ghost players with a strictly positive score (> 0) are eligible,
 * preventing ghosts (SEC-01) and inert 0-step accounts from winning bonus stars.
 * Every tied eligible player shares the star.
 */
export function bonusWinners(players: Joueur[], star: BonusStar): Joueur[] {
  const candidates = players.filter(p => !p.est_fantome && p[star.stat] > 0);
  if (!candidates.length) return [];
  const values = candidates.map(p => p[star.stat]);
  const target = star.lowest ? Math.min(...values) : Math.max(...values);
  return candidates.filter(p => p[star.stat] === target);
}

function formatMentions(ids: string[]): string {
  const mentions = ids.map(id => `<@${id}>`);
  if (mentions.length <= 1) return mentions[0] ?? '';
  return `${mentions.slice(0, -1).join(', ')} et ${mentions.at(-1)}`;
}

interface Summary { bonus: { name: string; desc: string; winners: string[] }[]; podium: { discord_id: string; etoiles: number; pieces: number }[] }

export const endgame: SeasonEnd<Summary> = {
  parseSummary(value) {
    const data = record(value, 'résumé Mario');
    if (!Array.isArray(data.bonus) || !Array.isArray(data.podium)) throw new TypeError('Résumé Mario invalide');
    return {
      bonus: data.bonus.map(raw => {
        const star = record(raw, 'étoile bonus');
        if (typeof star.name !== 'string' || typeof star.desc !== 'string') throw new TypeError('Étoile bonus invalide');
        return { name: star.name, desc: star.desc, winners: strings(star.winners, 'vainqueurs bonus') };
      }),
      podium: data.podium.map(raw => {
        const p = record(raw, 'podium');
        if (typeof p.discord_id !== 'string') throw new TypeError('Joueur du podium invalide');
        return { discord_id: p.discord_id, etoiles: integer(p.etoiles, 'étoiles'), pieces: integer(p.pieces, 'pièces') };
      }),
    };
  },
  async close(players, plateau, transaction, random: Random): Promise<Summary> {
    const activePlayers = players.filter(p => !p.est_fantome);
    // Historical draw, kept as is: a comparator shuffle (not uniform) then the first categories.
    const picked = [...BONUS_STARS].sort(() => 0.5 - random()).slice(0, marioVariant(plateau.game_variant).settings.bonusStarsCount);
    const bonus: Summary['bonus'] = [];
    for (const star of picked) {
      const winners = bonusWinners(activePlayers, star);
      for (const w of winners) w.etoiles += 1;
      bonus.push({ name: star.name, desc: star.desc, winners: winners.map(w => w.discord_id) });
    }
    for (const p of activePlayers) await p.save({ transaction });
    const podium = [...activePlayers].sort((a, b) => b.etoiles - a.etoiles || b.pieces - a.pieces).slice(0, 3)
      .map(p => ({ discord_id: p.discord_id, etoiles: p.etoiles, pieces: p.pieces }));
    if (podium[0] && plateau.mode_data && typeof plateau.mode_data === 'object') {
      plateau.mode_data = { ...plateau.mode_data, last_winner_id: podium[0].discord_id };
    }
    return { bonus, podium };
  },

  async announce(client: Client, raw: unknown, playerCount: number, wait: (ms: number) => Promise<void> = defaultWait) {
    if (playerCount === 0) {
      await announce(client, "🏁 **FIN DE SAISON !** La saison a été clôturée. Aucun joueur n'a participé à cette session.");
      return;
    }
    const summary = endgame.parseSummary(raw);
    if (summary.bonus.length > 0) {
      await announce(client, `✨ **LE MOMENT DES ÉTOILES BONUS !** ✨\n\n${summary.bonus.length} étoiles aléatoires vont être distribuées parmi plusieurs catégories…`);
      for (const star of summary.bonus) {
        await wait(BONUS_REVEAL_DELAY_MS);
        const award = star.winners.length
          ? `🏆 Décernée à : ${formatMentions(star.winners)} ! (+1 ⭐)`
          : '😔 Personne ne remporte cette étoile pour cette partie !';
        await announce(client, `**${star.name}** (*${star.desc}*)\n${award}`);
      }
      await wait(BONUS_REVEAL_DELAY_MS);
    }
    if (!summary.podium.length) {
      await announce(client, "🏆 **FIN DU PLATEAU 30 TOURS !** 🏆\n\nAucun joueur actif n'a terminé cette saison : pas de podium ni de vainqueur.");
      return;
    }
    const medals = ['🥇', '🥈', '🥉'];
    let podium = '🏆 **FIN DU PLATEAU 30 TOURS ! Voici le podium :** 🏆\n\n';
    summary.podium.forEach((p, index) => { podium += `${medals[index]} <@${p.discord_id}> avec ${p.etoiles} ⭐ et ${p.pieces} 🪙\n`; });
    const winner = summary.podium[0];
    if (winner && await giveWinnerRole(client, winner.discord_id)) {
      podium += `\n\n👑 Le titre exclusif de **Vainqueur d'une partie** a été attribué à <@${winner.discord_id}> !\nFélicitations pour cette victoire ! 🎉`;
    }
    await announce(client, podium);
  },
};

/** The role moves to the new winner. Failures are logged: the season is already closed. */
async function giveWinnerRole(client: Client, winnerId: string): Promise<boolean> {
  if (!config.guildId || !config.winnerRoleId) return false;
  try {
    const guild = await client.guilds.fetch(config.guildId);
    const role = await guild.roles.fetch(config.winnerRoleId);
    if (!role) { console.warn(`[WARN] Rôle vainqueur ${config.winnerRoleId} introuvable.`); return false; }
    const removed = new Set<string>();
    for (const member of role.members.values()) {
      if (member.id === winnerId) continue;
      await member.roles.remove(role);
      removed.add(member.id);
    }
    const previousWinner = await Plateau.findByPk(1).then(p => typeof p?.mode_data.last_winner_id === 'string' ? p.mode_data.last_winner_id : null).catch(() => null);
    if (previousWinner && previousWinner !== winnerId && !removed.has(previousWinner)) {
      const prevMember = await guild.members.fetch(previousWinner).catch(() => null);
      if (prevMember?.roles.cache.has(role.id)) await prevMember.roles.remove(role);
    }
    const member = await guild.members.fetch(winnerId);
    await member.roles.add(role);
    return true;
  } catch (error) {
    console.warn('[WARN] Attribution du rôle vainqueur impossible :', error);
    return false;
  }
}
