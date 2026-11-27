import { Client } from 'discord.js';
import { announce } from '../../discord/channels';
import { SeasonEnd } from '../mode-interface';
import { boardData } from './turn';
import { record, strings, integer } from '../../domain/persisted';

interface Summary { dragonWinners: string[]; leaders: { discord_id: string; position: number }[] }

export const endgame: SeasonEnd<Summary> = {
  parseSummary(value) {
    const data = record(value, 'résumé île');
    if (!Array.isArray(data.leaders)) throw new TypeError('Classement île invalide');
    return { dragonWinners: strings(data.dragonWinners, 'vainqueurs dragon'), leaders: data.leaders.map(raw => {
      const p = record(raw, 'classement île');
      if (typeof p.discord_id !== 'string') throw new TypeError('Joueur du classement invalide');
      return { discord_id: p.discord_id, position: integer(p.position, 'position', 1) };
    }) };
  },
  async close(players, plateau): Promise<Summary> {
    const activePlayers = players.filter(p => !p.est_fantome);
    return {
      dragonWinners: boardData(plateau).gagnants_dragon,
      leaders: [...activePlayers].sort((a, b) => b.position - a.position).slice(0, 3).map(p => ({ discord_id: p.discord_id, position: p.position })),
    };
  },
  async announce(client: Client, raw: unknown, playerCount: number) {
    const summary = endgame.parseSummary(raw);
    let message = "🏁 **FIN DE L'ÎLE AUX DÉFIS !** La saison est clôturée et le plateau est désormais verrouillé.";
    if (summary.dragonWinners.length) message += `\n\n🐉👑 **Vainqueur(s) du Dragon :** ${summary.dragonWinners.map(id => `<@${id}>`).join(', ')} !`;
    if (playerCount === 0) message += "\nAucun joueur n'a participé à cette session.";
    else if (summary.leaders.length) {
      const medals = ['🥇', '🥈', '🥉'];
      message += `\n\n**Classement de la course :**\n${summary.leaders.map((p, i) => `${medals[i]} <@${p.discord_id}> — case ${p.position}`).join('\n')}`;
    }
    await announce(client, message);
  },
};
