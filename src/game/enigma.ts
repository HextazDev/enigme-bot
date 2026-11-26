import { afterGameAction } from './transaction';
import { finishEnigma, diceLabel } from '../services/enigma';
import { ChannelHost, enigmaChannel } from '../discord/channels';
import config = require('../config');

/** 21h: close the enigma (committed first), then announce the answer and the winners. */
export async function triggerEnigmaEnd(client: ChannelHost): Promise<void> {
  const plateau = await finishEnigma();
  if (!plateau) return;
  await afterGameAction(async () => {
  const channel = await enigmaChannel(client);
  if (!channel) {
    console.warn('[WARN] Énigme clôturée, salon indisponible pour l’annonce.');
    return;
  }
  const ile = plateau.game_mode === 'ile_defis';
  let message = `⏰ **FIN DE L'ÉNIGME !** La bonne réponse était : **${plateau.enigme_reponse}**\n\n`;
  if (plateau.enigme_gagnants.length) {
    message += '🏆 **Gagnants :**\n';
    for (const g of plateau.enigme_gagnants) {
      const tranche = String(g.tranche);
      message += ile ? `• <@${g.discord_id}> — **${diceLabel(tranche)}** (${tranche})\n` : `• <@${g.discord_id}> — **+${g.pieces} pièces** (${tranche})\n`;
    }
  } else message += "😢 *Personne n'a trouvé la réponse aujourd'hui...*\n";
  message += "\n🎲 **Le plateau est maintenant ouvert !** Vous pouvez utiliser `/jouer` jusqu'à 17h demain.";
  if (config.roleEnigmeId) message = `<@&${config.roleEnigmeId}>\n${message}`;
  await channel.send(message);
  console.log('[CRON] Énigme terminée à 21h, plateau ouvert.');
  });
}
