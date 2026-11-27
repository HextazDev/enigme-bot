import { afterGameAction } from '../game/transaction';
import { editGameReply, GameView } from '../discord/game-view';
import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ButtonInteraction, ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { PromptRow } from '../gamemodes/mode-interface';
import { loadGameMenu } from '../services/player';
import { isSaturdayClosed } from '../services/season';
import { BOARD_IMAGE_EXTENSION, generateZoomedBoardImage } from '../utils/canvas';

export const data = new SlashCommandBuilder()
  .setName('jouer')
  .setDescription('Affiche le menu privé pour jouer sur le plateau.');

const button = (id: string, label: string, style: ButtonStyle, disabled = false) =>
  new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);

export async function execute(interaction: ChatInputCommandInteraction | ButtonInteraction): Promise<void> {
  const { plateau, mode, joueur, players } = await loadGameMenu(interaction.user.id);
  const viewRow = () => new ActionRowBuilder<ButtonBuilder>().addComponents(button('voir_plateau', '🗺️ Voir le plateau', ButtonStyle.Success));
  const header = `**Tour ${plateau.tour}/${mode.maxTours}**`;

  if (plateau.enigme_status === 'season_ended') {
    await editGameReply(interaction, {
      components: [viewRow()],
      content: '🏆 **LA SAISON EST TERMINÉE !** 🏆\n\nLe podium final a été annoncé et les vainqueurs ont été récompensés. Merci à tous pour votre participation ! 🎉',
    }, { ordered: false });
    return;
  }
  if (!joueur) throw new Error('Joueur introuvable après chargement du menu');

  const sorted = [...players].sort((a, b) => mode.hasStars ? b.etoiles - a.etoiles || b.pieces - a.pieces : b.position - a.position);
  const rank = sorted.findIndex(j => j.discord_id === joueur.discord_id) + 1;
  const playerSnapshot = structuredClone(joueur.get({ plain: true }));
  const boardSnapshot = structuredClone(plateau.get({ plain: true }));
  const playerSnapshots = players.map(p => structuredClone(p.get({ plain: true })));
  const render = (view: GameView) => afterGameAction(async () => {
    const image = new AttachmentBuilder(await generateZoomedBoardImage(playerSnapshot, playerSnapshots, boardSnapshot, interaction.client), { name: `zoomed_board.${BOARD_IMAGE_EXTENSION}` });
    await editGameReply(interaction, { ...view, files: [image] });
  }, { ordered: false });

  if (joueur.est_fantome) {
    let content = `${header}\n\n👻 **MODE FANTÔME ACTIVÉ** 👻\nTu n'as pas joué pendant 3 jours. Tu es en mode fantôme et ton personnage est bloqué.\n`;
    const components: ActionRowBuilder<ButtonBuilder>[] = [];
    if (!joueur.fantome_unblock_used) {
      content += '\nTu peux te débloquer **UNE SEULE FOIS** pour cette partie. Veux-tu revenir dans la partie ?';
      components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(button('unblock_fantome', '🔓 Me débloquer (Unique)', ButtonStyle.Success)));
    } else content += `\n💥 Tu as déjà utilisé ton déblocage unique pour cette partie. Tu es donc définitivement éliminé(e) jusqu'à la prochaine partie de ${mode.maxTours} tours.`;
    await render({ content, components });
    return;
  }

  const statsLine = mode.hasStars
    ? `⭐ Étoiles : **${joueur.etoiles}** | 🪙 Pièces : **${joueur.pieces}** | 🏆 Classement : **${rank}/${players.length}**`
    : `📍 Case : **${joueur.position}** | 🏆 Classement : **${rank}/${players.length}**`;
  let content = `${header}\n**Tes statistiques :**\n${statsLine}\n\nTu es sur la case **${joueur.position}**. Que veux-tu faire ?`;
  const saturday = mode.hasShop && isSaturdayClosed(plateau);
  const locked = plateau.enigme_status === 'active';
  const canPlay = joueur.a_le_droit_de_jouer && !saturday && !locked;
  const components: PromptRow[] = [];
  const pending = mode.getInteractions().renderPending(joueur, plateau);
  const actions = new ActionRowBuilder<ButtonBuilder>();
  if (pending) {
    content += `\n\n⏸️ **Un choix t'attend :** ${pending.content}`;
    components.push(...pending.components);
  } else if (joueur.cases_restantes > 0) actions.addComponents(button('continuer_deplacement', `🚶 Continuer (${joueur.cases_restantes} cases)`, ButtonStyle.Success, saturday || locked));
  else actions.addComponents(button('lancer_de', '🎲 Lancer le dé', ButtonStyle.Primary, !canPlay));
  if (mode.hasShop) actions.addComponents(button('inventaire', '🎒 Inventaire', ButtonStyle.Secondary));
  actions.addComponents(button('voir_plateau', '🗺️ Voir le plateau', ButtonStyle.Success));
  if (mode.hasShop && joueur.inventaire.length) actions.addComponents(button('utiliser_objet', '🪄 Utiliser un objet', ButtonStyle.Danger, !canPlay || !!pending));
  components.push(actions);
  if (saturday) content += "\n\n🎰 *C'est samedi ! Il n'y a pas de lancer de dé aujourd'hui. Place aux paris sur la course de Yoshis !*";
  else if (!joueur.a_le_droit_de_jouer && joueur.cases_restantes <= 0 && !pending) content += "\n\n⏳ *Tu as déjà joué aujourd'hui ! Reviens demain après la nouvelle énigme.*";
  await render({ content, components });
}
