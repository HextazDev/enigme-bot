import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { afterGameAction } from '../game/transaction';
import { getLeaderboard } from '../services/player';
import { mapConcurrent } from '../utils/concurrency';

export const data = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('Affiche le classement et les statistiques des joueurs.');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const { mode, players } = await getLeaderboard();
  if (!players.length) {
    await afterGameAction(() => interaction.editReply({ content: "Aucun joueur n'a encore participé." }), { ordered: false });
    return;
  }
  const hasStars = mode ? mode.hasStars : true;
  // Discord limits an embed to 25 fields.
  const top = players.slice(0, 25).map(p => structuredClone(p.get({ plain: true })));
  await afterGameAction(async () => {
    const names = await mapConcurrent(top, 4, async joueur => {
      const cached = interaction.client.users.cache.get(joueur.discord_id);
      if (cached) return cached.username;
      try { return (await interaction.client.users.fetch(joueur.discord_id)).username; }
      catch { return `Joueur Inconnu (${joueur.discord_id})`; }
    });
    const embed = new EmbedBuilder().setTitle('🏆 Classement de la Saison').setColor('#FFD700')
      .setDescription('Voici les statistiques actuelles des joueurs :')
      .addFields(top.map((joueur, index) => ({
        name: `#${index + 1} - ${names[index]}`,
        value: hasStars
          ? `⭐ Étoiles : ${joueur.etoiles} | 💰 Pièces : ${joueur.pieces} | 📍 Position : ${joueur.position}\n🎒 Inventaire : ${joueur.inventaire.length ? joueur.inventaire.join(', ') : 'Vide'}`
          : `📍 Position : Case ${joueur.position}${joueur.mode_data.bonus_de && joueur.mode_data.bonus_de !== 'none' ? ` | ✨ Dé bonus : ${String(joueur.mode_data.bonus_de)}` : ''}${joueur.est_fantome ? ' | 👻 Fantôme' : ''}`,
      })));
    await interaction.editReply({ embeds: [embed] });
  }, { ordered: false });
}
