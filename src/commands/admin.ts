import { editReply } from '../discord/replies';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction, EmbedBuilder, ModalBuilder, PermissionFlagsBits, SlashCommandBuilder, SlashCommandStringOption, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { Joueur, Plateau } from '../db/models';
import { GameRuleError } from '../domain/types';
import { endSeason } from '../game/endgame';
import { handleSunday11hBlackMarket } from '../game/cron';
import { getActiveMode, getAllModes } from '../gamemodes/registry';
import * as adminService from '../services/admin';
import { announce } from '../discord/channels';
import { clearPendingTimer } from '../discord/pending-timers';
import { parisClock } from '../utils/time';

const resourceOption = (option: SlashCommandStringOption) => option.setName('ressource').setDescription('Type de ressource').setRequired(true)
  .addChoices({ name: 'Pièces', value: 'pieces' }, { name: 'Étoiles', value: 'etoiles' }, { name: 'Objet', value: 'objet' });

export const data = new SlashCommandBuilder()
  .setName('admin')
  .setDescription("Commandes d'administration pour le Maître du Jeu.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand(s => s.setName('start').setDescription('Reset total et lance la saison.'))
  .addSubcommand(s => s.setName('stop').setDescription('Bloque le jeu et annonce le podium final.'))
  .addSubcommand(s => s.setName('programmer_enigme').setDescription("Programmer l'énigme du jour (publiée à 17h, indices à 18h/19h/20h, fin à 21h).")
    .addStringOption(o => o.setName('reponse').setDescription("La réponse attendue à l'énigme").setRequired(true)))
  .addSubcommand(s => s.setName('lancer_enigme').setDescription("Incrémente le tour sans programmer d'énigme (usage exceptionnel)."))
  .addSubcommand(s => s.setName('give').setDescription('Donner une ressource à un joueur.')
    .addUserOption(o => o.setName('joueur').setDescription('Le joueur cible').setRequired(true)).addStringOption(resourceOption)
    .addIntegerOption(o => o.setName('quantite').setDescription('Quantité (pour pièces/étoiles)').setMinValue(1)))
  .addSubcommand(s => s.setName('remove').setDescription('Retirer une ressource à un joueur.')
    .addUserOption(o => o.setName('joueur').setDescription('Le joueur cible').setRequired(true)).addStringOption(resourceOption)
    .addIntegerOption(o => o.setName('quantite').setDescription('Quantité (pour pièces/étoiles)').setMinValue(1)))
  .addSubcommand(s => s.setName('set_position').setDescription('Téléporter manuellement un joueur.')
    .addUserOption(o => o.setName('joueur').setDescription('Le joueur cible').setRequired(true))
    .addIntegerOption(o => o.setName('case').setDescription('Numéro de la case sur la map active').setRequired(true).setMinValue(1)))
  .addSubcommand(s => s.setName('kick').setDescription('Exclure un joueur et supprimer ses données.')
    .addUserOption(o => o.setName('joueur').setDescription('Le joueur cible').setRequired(true)))
  .addSubcommand(s => s.setName('reset_cooldown').setDescription("Remet à zéro le temps d'attente d'un joueur.")
    .addUserOption(o => o.setName('joueur').setDescription('Le joueur cible').setRequired(true)))
  .addSubcommand(s => s.setName('tour').setDescription('Définit le numéro du tour actuel.')
    .addIntegerOption(o => o.setName('numero').setDescription('Le numéro du tour (0 à 30)').setRequired(true).setMinValue(0).setMaxValue(30)))
  .addSubcommand(s => s.setName('open_black_market').setDescription("Force l'ouverture du Marché Noir (utile si le cron a planté le dimanche)."))
  .addSubcommand(s => s.setName('annuler_tour').setDescription("Annule le tour en cours d'un joueur et le remet à son état initial.")
    .addUserOption(o => o.setName('joueur').setDescription('Le joueur concerné').setRequired(true)));

function enigmaModal(answer: string): ModalBuilder {
  const input = (id: string, label: string, style: TextInputStyle, required: boolean, value?: string) => {
    const field = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required);
    if (value) field.setValue(value);
    return new ActionRowBuilder<TextInputBuilder>().addComponents(field);
  };
  // The answer travels in a field, not in the customId (limited to 100 characters).
  return new ModalBuilder().setCustomId('modal_programmer_enigme').setTitle("Programmer l'énigme du jour").addComponents(
    input('reponse', 'Réponse attendue', TextInputStyle.Short, true, answer.slice(0, 4000)),
    input('enigme_text', 'Énigme du jour', TextInputStyle.Paragraph, true),
    input('indice_1', 'Indice 18h (optionnel)', TextInputStyle.Paragraph, false),
    input('indice_2', 'Indice 19h (optionnel)', TextInputStyle.Paragraph, false),
    input('indice_3', 'Indice 20h (optionnel)', TextInputStyle.Paragraph, false));
}

async function startMenu(interaction: ChatInputCommandInteraction): Promise<void> {
  const modes = getAllModes();
  const embed = new EmbedBuilder().setTitle('🎮 Initialisation du Plateau - Étape 1/3').setColor('#5865F2').setFooter({ text: 'Étape 1 sur 3 — Sélection du Mode' })
    .setDescription("Sélectionnez le **mode de jeu** à lancer pour cette nouvelle partie. Chaque mode propose ses propres règles et sa propre logique d'événements.")
    .addFields(modes.map(mode => ({ name: `${mode.emoji} ${mode.name}`, value: `${mode.description}\n*(Nombre de tours max : ${mode.maxTours})*` })));
  const select = new StringSelectMenuBuilder().setCustomId('admin_start_mode').setPlaceholder('Sélectionnez le mode de jeu...')
    .addOptions(modes.map(mode => ({ label: mode.name, value: mode.id, description: mode.description.slice(0, 100), emoji: mode.emoji })));
  await editReply(interaction, { embeds: [embed], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)] });
}

async function resourceCommand(interaction: ChatInputCommandInteraction, give: boolean): Promise<void> {
  const target = interaction.options.getUser('joueur', true);
  const resource = interaction.options.getString('ressource', true);
  if (resource === 'pieces' || resource === 'etoiles') {
    const quantity = interaction.options.getInteger('quantite');
    if (!quantity || quantity <= 0) throw new GameRuleError('QUANTITY', 'Veuillez entrer une quantité valide et positive.');
    await adminService.adjustResource(target.id, resource, give ? quantity : -quantity);
    console.log(`[ADMIN] ${give ? 'Ajout' : 'Retrait'} de ${quantity} ${resource} pour ${target.id}.`);
    await editReply(interaction, `✅ ${give ? 'Ajout' : 'Retrait'} de ${quantity} ${resource} à <@${target.id}>.`);
    return;
  }
  const plateau = await Plateau.findByPk(1);
  if (!plateau) throw new GameRuleError('NO_BOARD', 'Plateau introuvable.');
  let options: { label: string; value: string }[];
  if (give) options = Object.values(getActiveMode(plateau).getItems(plateau.game_variant)).slice(0, 25).map(item => ({ label: item.name, value: item.name }));
  else {
    const joueur = await Joueur.findByPk(target.id);
    if (!joueur) throw new GameRuleError('PLAYER_MISSING', "Ce joueur n'existe pas dans la base de données.");
    options = [...new Set(joueur.inventaire)].slice(0, 25).map((name, index) => ({ label: `${index + 1}. ${name}`, value: name }));
  }
  if (!options.length) throw new GameRuleError('EMPTY', give ? "Ce mode de jeu n'a pas d'objets." : `<@${target.id}> n'a aucun objet dans son inventaire.`);
  const select = new StringSelectMenuBuilder().setCustomId(`admin_${give ? 'give' : 'remove'}_objet_${target.id}`)
    .setPlaceholder(give ? 'Choisis un objet à donner' : 'Choisis un objet à retirer').addOptions(options);
  await editReply(interaction, { content: `Quel objet veux-tu ${give ? 'donner à' : 'retirer à'} <@${target.id}> ?`, components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)] });
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand();
  const target = () => interaction.options.getUser('joueur', true);
  switch (subcommand) {
    case 'start': return startMenu(interaction);
    case 'programmer_enigme':
      await interaction.showModal(enigmaModal(interaction.options.getString('reponse', true)));
      return;
    case 'lancer_enigme': {
      const tour = await adminService.skipEnigma();
      const maxTours = getActiveMode(await Plateau.findByPk(1)).maxTours;
      console.log(`[ADMIN] Tour incrémenté sans énigme (${tour}/${maxTours}) par ${interaction.user.id}.`);
      await editReply(interaction, `📣 **Tour ${tour}/${maxTours}** : Le tour a été incrémenté exceptionnellement sans énigme. Le plateau est ouvert.`);
      return;
    }
    case 'stop': {
      const result = await endSeason(interaction.client);
      console.log(`[ADMIN] Clôture manuelle de la saison par ${interaction.user.id} (alreadyEnded=${result.alreadyEnded}).`);
      await editReply(interaction, result.alreadyEnded
        ? "ℹ️ Aucune saison n'est actuellement en cours (la saison était déjà terminée ou clôturée)."
        : result.playerCount === 0
          ? "🏁 La saison a été clôturée manuellement. Aucun joueur n'a participé, le plateau est désormais verrouillé."
          : "🏁 La saison a été arrêtée manuellement. L'annonce finale a été postée sur le canal du plateau.");
      return;
    }
    case 'give': return resourceCommand(interaction, true);
    case 'remove': return resourceCommand(interaction, false);
    case 'set_position': {
      const caseId = interaction.options.getInteger('case', true);
      const userId = target().id;
      await adminService.setPosition(userId, caseId);
      clearPendingTimer(userId);
      console.log(`[ADMIN] Joueur ${userId} téléporté case ${caseId} par ${interaction.user.id}.`);
      await editReply(interaction, `📍 <@${userId}> a été téléporté sur la case ${caseId}.`);
      return;
    }
    case 'kick':
      await editReply(interaction, {
        content: `⚠️ **Êtes-vous sûr de vouloir supprimer définitivement <@${target().id}> de cette saison ?** Toutes ses données seront perdues.`,
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`admin_kick_confirm_${target().id}`).setLabel('Oui, exclure définitivement').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('admin_kick_cancel').setLabel('Annuler').setStyle(ButtonStyle.Secondary))],
      });
      return;
    case 'reset_cooldown': {
      const userId = target().id;
      await adminService.resetCooldown(userId);
      console.log(`[ADMIN] Cooldown réinitialisé pour ${userId} par ${interaction.user.id}.`);
      await editReply(interaction, `⏳ Le cooldown de <@${userId}> a été réinitialisé. Il peut rejouer immédiatement.`);
      return;
    }
    case 'tour': {
      const numero = interaction.options.getInteger('numero', true);
      await adminService.setTour(numero);
      console.log(`[ADMIN] Tour défini à ${numero} par ${interaction.user.id}.`);
      await editReply(interaction, `Le tour a été défini sur **${numero}**.`);
      return;
    }
    case 'open_black_market':
      if (parisClock().weekday !== 0) throw new GameRuleError('NOT_SUNDAY', 'Cette commande ne peut être utilisée que le dimanche !');
      if (!await handleSunday11hBlackMarket(interaction.client, true)) throw new GameRuleError('CLOSED', "Le Marché Noir n'est pas disponible (déjà ouvert aujourd'hui, saison inactive ou mode sans boutique).");
      console.log(`[ADMIN] Marché Noir ouvert manuellement par ${interaction.user.id}.`);
      await editReply(interaction, '✅ Le Marché Noir a été ouvert manuellement avec succès et tous les joueurs ont été débloqués.');
      return;
    case 'annuler_tour': {
      const userId = target().id;
      const { tour } = await adminService.undoTurn(userId);
      clearPendingTimer(userId);
      console.log(`[ADMIN] Tour ${tour} annulé pour ${userId} par ${interaction.user.id}.`);
      await editReply(interaction, `🔄 **Tour annulé !** <@${userId}> a été remis dans son état initial du tour ${tour}. Il peut maintenant rejouer.`);
      await announce(interaction.client, `🔄 **ANNULATION DE TOUR** : Le tour de <@${userId}> a été annulé par un admin. Il a été remis dans son état initial.`);
      return;
    }
    default: throw new GameRuleError('UNKNOWN', `Sous-commande inconnue : ${subcommand}`);
  }
}
