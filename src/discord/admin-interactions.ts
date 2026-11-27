import { editReply } from './replies';
import { ids, selectedValue } from './custom-ids';
import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, EmbedBuilder, ModalSubmitInteraction, StringSelectMenuBuilder, StringSelectMenuInteraction } from 'discord.js';
import { GameRuleError } from '../domain/types';
import { getMapsForMode, getMode, getVariantsForMode } from '../gamemodes/registry';
import * as adminService from '../services/admin';
import { programEnigma } from '../services/enigma';
import { invalidateBoardCache } from '../utils/canvas';
import { announce } from './channels';
import { clearAllPendingTimers, clearPendingTimer } from './pending-timers';
import config = require('../config');

const optional = (value: string) => (value.trim() ? value.trim() : null);

export async function handleProgrammerEnigmeModal(interaction: ModalSubmitInteraction): Promise<void> {
  const field = (id: string) => interaction.fields.getTextInputValue(id);
  const text = field('enigme_text');
  const answer = field('reponse');
  const hints: [string | null, string | null, string | null] = [optional(field('indice_1')), optional(field('indice_2')), optional(field('indice_3'))];
  const { nextPublicationLabel } = await programEnigma({ text, answer, hints });
  console.log(`[ADMIN] Énigme programmée par ${interaction.user.id} (${hints.filter(Boolean).length} indice(s)).`);
  await editReply(interaction, { content: `✅ **Énigme programmée avec succès !**\n\n📝 **Titre :** ${text.split('\n')[0] || 'Énigme du jour'}\n🔑 **Réponse :** ${answer.trim()}\n`
    + `💡 **Indices :** ${hints.filter(Boolean).length} indice(s) programmé(s)\n\n📣 L'énigme sera publiée automatiquement **${nextPublicationLabel}** dans le salon énigme.` });
}

async function startWizard(i: StringSelectMenuInteraction | ButtonInteraction): Promise<void> {
  const id = i.customId;
  if (i.isStringSelectMenu() && id === 'admin_start_mode') {
    const mode = getMode(selectedValue(i.values));
    if (!mode) throw new GameRuleError('MODE', 'Mode de jeu introuvable !');
    const variants = getVariantsForMode(mode.id);
    const embed = new EmbedBuilder().setTitle('🎮 Initialisation du Plateau - Étape 2/3').setColor('#5865F2').setFooter({ text: 'Étape 2 sur 3 — Sélection de la Variante' })
      .setDescription(`Vous avez choisi le mode **${mode.name}**.\n\nSélectionnez maintenant la **variante de règles** à appliquer.`)
      .addFields(variants.map(v => ({ name: `📜 ${v.name}`, value: `Variante de jeu disponible pour le mode ${mode.name}.` })));
    const select = new StringSelectMenuBuilder().setCustomId(`admin_start_variant_${mode.id}`).setPlaceholder('Sélectionnez la variante...')
      .addOptions(variants.map(v => ({ label: v.name, value: v.id, description: `Lancer la variante ${v.name}` })));
    await editReply(i, { embeds: [embed], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)] });
  } else if (i.isStringSelectMenu() && id.startsWith('admin_start_variant_')) {
    const mode = getMode(id.slice('admin_start_variant_'.length));
    const variant = mode && mode.variants[selectedValue(i.values)];
    if (!mode || !variant) throw new GameRuleError('VARIANT', 'Mode ou variante introuvable !');
    const maps = getMapsForMode(mode.id);
    const embed = new EmbedBuilder().setTitle('🎮 Initialisation du Plateau - Étape 3/3').setColor('#5865F2').setFooter({ text: 'Étape 3 sur 3 — Sélection de la Map' })
      .setDescription(`Mode : **${mode.name}** | Variante : **${variant.name}**\n\nSélectionnez maintenant la **map (plateau)** sur laquelle se déroulera la partie.`)
      .addFields(maps.map(m => ({ name: `🗺️ ${m.name}`, value: `Plateau de jeu "${m.name}" avec ses propres coordonnées de cases.` })));
    const select = new StringSelectMenuBuilder().setCustomId(ids.adminMap.encode({ modeId: mode.id, variantId: variant.id })).setPlaceholder('Sélectionnez la map...')
      .addOptions(maps.map(m => ({ label: m.name, value: m.id, description: `Charger la map ${m.name}` })));
    await editReply(i, { embeds: [embed], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)] });
  } else if (i.isStringSelectMenu() && id.startsWith('admin_start_map::')) {
    const { modeId, variantId } = ids.adminMap.decode(id);
    const mode = getMode(modeId);
    const variant = mode?.variants[variantId];
    const map = mode?.maps[selectedValue(i.values)];
    if (!mode || !variant || !map) throw new GameRuleError('PARAMS', "Paramètres d'initialisation invalides !");
    const embed = new EmbedBuilder().setTitle("⚠️ Confirmation de l'initialisation").setColor('#FF9900')
      .setDescription(`Veuillez confirmer le lancement de la saison avec les paramètres suivants :\n\n• **Mode de jeu :** ${mode.emoji} **${mode.name}**\n• **Variante :** 📜 **${variant.name}**\n• **Map / Plateau :** 🗺️ **${map.name}**\n\n🚨 **ATTENTION :** Confirmer lancera une réinitialisation complète de la base de données. Tous les joueurs inscrits seront supprimés et les scores remis à zéro !`);
    await editReply(i, { embeds: [embed], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(ids.adminConfirm.encode({ modeId, variantId, mapId: map.id })).setLabel('Confirmer et lancer').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('admin_start_cancel').setLabel('Annuler').setStyle(ButtonStyle.Danger))] });
  } else if (id.startsWith('admin_start_confirm::')) {
    const { modeId, variantId, mapId } = ids.adminConfirm.decode(id);
    const mode = getMode(modeId);
    if (!mode) throw new GameRuleError('MODE', 'Impossible de démarrer : mode introuvable !');
    const { star } = await adminService.startSeason(modeId, variantId, mapId);
    clearAllPendingTimers();
    invalidateBoardCache();
    console.log(`[ADMIN] Nouvelle saison initialisée (${modeId}/${variantId}/${mapId}) par ${i.user.id}.`);
    const starConfirm = mode.hasStars ? `\nL'étoile a été placée sur la case **${star}**.` : '';
    await editReply(i, { embeds: [], components: [], content: `🎉 **La saison a été initialisée avec succès !**\n\n• **Mode :** ${mode.emoji} **${mode.name}**\n• **Variante :** 📜 **${variantId}**\n• **Map :** 🗺️ **${mapId}**${starConfirm}\nLe plateau est prêt à accueillir les joueurs ! Utilisez \`/jouer\` pour rejoindre la partie.` });
    const ping = config.roleEnigmeId ? `<@&${config.roleEnigmeId}> ` : '';
    const starLine = mode.hasStars ? `\n🌟 L'étoile a atterri sur la case **${star}** !\n` : '';
    await announce(i.client, `🏁 ${ping}**UNE NOUVELLE SAISON COMMENCE !** 🏁\n\nLe plateau a été réinitialisé par un administrateur avec les configurations suivantes :\n• **Mode de jeu :** ${mode.emoji} **${mode.name}**\n• **Variante :** 📜 **${variantId}**\n• **Map / Plateau :** 🗺️ **${mapId}**\n${starLine}\nTous les scores sont remis à zéro. Utilisez la commande \`/jouer\` pour lancer votre dé et faire partie de l'aventure ! Bonne chance à tous ! 🎲✨`);
  } else if (id === 'admin_start_cancel') {
    await editReply(i, { content: "❌ **Initialisation annulée.** Le plateau actuel n'a pas été modifié.", embeds: [], components: [] });
  } else throw new GameRuleError('UNKNOWN', 'Action non disponible.');
}

export async function handleAdminComponent(i: StringSelectMenuInteraction | ButtonInteraction): Promise<void> {
  const id = i.customId;
  if (id.startsWith('admin_start_')) return startWizard(i);
  if (id.startsWith('admin_kick_confirm_')) {
    const userId = id.slice('admin_kick_confirm_'.length);
    await adminService.kickPlayer(userId);
    clearPendingTimer(userId);
    console.log(`[ADMIN] Joueur ${userId} exclu.`);
    await editReply(i, { content: `✅ Le joueur <@${userId}> a été définitivement supprimé de la base de données.`, components: [] });
  } else if (id === 'admin_kick_cancel') {
    await editReply(i, { content: "❌ L'exclusion a été annulée.", components: [] });
  } else if (i.isStringSelectMenu() && id.startsWith('admin_give_objet_')) {
    const userId = id.slice('admin_give_objet_'.length);
    const item = selectedValue(i.values);
    await adminService.giveItem(userId, item);
    console.log(`[ADMIN] Objet "${item}" donné à ${userId}.`);
    await editReply(i, { content: `✅ L'objet "${item}" a été donné à <@${userId}>.`, components: [] });
  } else if (i.isStringSelectMenu() && id.startsWith('admin_remove_objet_')) {
    const userId = id.slice('admin_remove_objet_'.length);
    const item = selectedValue(i.values);
    await adminService.removeItem(userId, item);
    console.log(`[ADMIN] Objet "${item}" retiré à ${userId}.`);
    await editReply(i, { content: `✅ L'objet "${item}" a été retiré à <@${userId}>.`, components: [] });
  } else throw new GameRuleError('UNKNOWN', 'Action non disponible.');
}
