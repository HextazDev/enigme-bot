import { ids } from './custom-ids';
import { execute as showGameMenu } from '../commands/jouer';
import { editGameReply } from './game-view';
import { afterGameAction } from '../game/transaction';
import { AttachmentBuilder, ButtonInteraction, ChatInputCommandInteraction, Collection, Interaction, MessageFlags } from 'discord.js';
import { Joueur, Plateau } from '../db/models';
import { GameRuleError } from '../domain/types';
import { handleModalPari, handlePari } from '../game/cron';
import { getActiveBoardCases, getActiveInteractions } from '../gamemodes/registry';
import { guessCooldownRemaining, rejectProposal, validateAnswer, diceLabel } from '../services/enigma';
import { BOARD_IMAGE_EXTENSION, generateBoardImage } from '../utils/canvas';
import { enigmaChannel } from './channels';
import * as admin from './admin-interactions';
import { showZone } from '../commands/plateau';
import { gameNow, toGameTime } from '../utils/clock';
import { scheduleGuessReminder } from './pending-timers';
import config = require('../config');

export interface Command {
  data: { name: string; toJSON(): unknown };
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
  /** Dev bot tool: neither registered nor loaded without DEV_MODE=1. */
  devOnly?: boolean;
}

export function commandEnabled(command: Partial<Command>): boolean { return !command.devOnly || config.devMode; }
export type CommandRegistry = Collection<string, Command>;

async function showBoard(i: ButtonInteraction): Promise<void> {
  const plateau = await Plateau.findByPk(1);
  if (!plateau) throw new GameRuleError('CLOSED', 'Aucune partie en cours.');
  const state = structuredClone(plateau.get({ plain: true }));
  const players = (await Joueur.findAll()).map(p => structuredClone(p.get({ plain: true })))
    .sort((a, b) => Number(a.discord_id === i.user.id) - Number(b.discord_id === i.user.id));
  const requester = players.find(p => p.discord_id === i.user.id);
  const zone = state.game_mode === 'ile_defis'
    ? (requester ? getActiveBoardCases(state).find(c => c.id === requester.position)?.zone : undefined) ?? 'plage'
    : null;
  await afterGameAction(async () => {
    const buffer = await generateBoardImage(players, state, i.client, zone);
    await editGameReply(i, { content: '🗺️ Le plateau', files: [new AttachmentBuilder(buffer, { name: `board.${BOARD_IMAGE_EXTENSION}` })] });
  }, { ordered: false });
}
async function showInventory(i: ButtonInteraction): Promise<void> {
  const joueur = await Joueur.findByPk(i.user.id);
  const inventory = joueur?.inventaire.length ? joueur.inventaire.join(', ') : 'Vide';
  await editGameReply(i, { content: `🎒 **Ton inventaire :** ${inventory}\n⭐ Étoiles : **${joueur?.etoiles ?? 0}** | 🪙 Pièces : **${joueur?.pieces ?? 0}**` }, { ordered: false });
}

/** The MJ judges a proposal received in DM: reject, reject as spam (-1 coin) or accept (reward by time bracket). */
async function judgeProposal(i: ButtonInteraction): Promise<void> {
  const { action, userId } = ids.judge.decode(i.customId);
  const proposalId = i.message?.id;
  const embed = i.message.embeds[0];
  const base = embed ? embed.toJSON() : {};
  if (action === 'bad' || action === 'spam') {
    await rejectProposal(userId, action === 'spam', proposalId);
    const refused = { ...base, color: 0xe74c3c, title: action === 'spam' ? 'Proposition refusée (Non conforme)' : 'Proposition refusée' };
    await afterGameAction(async () => { await i.message.edit({ embeds: [refused], components: [] }); });
    await afterGameAction(async () => {
      const channel = await enigmaChannel(i.client);
      if (!channel) throw new Error('Salon énigme indisponible pour la validation');
      await channel.send({ embeds: [refused] });
    });
    await afterGameAction(async () => {
      await i.followUp({ content: action === 'spam'
        ? `Tu as refusé la proposition non conforme de <@${userId}> et 1 pièce de participation lui a été retirée.`
        : `Tu as refusé la proposition de <@${userId}>.`, flags: MessageFlags.Ephemeral });
    });
    return;
  }
  if (action !== 'good') throw new GameRuleError('ACTION', 'Action inconnue.');
  const result = await validateAnswer(userId, toGameTime(i.message.createdAt), proposalId);
  const reward = result.ileDice ? diceLabel(result.tranche) : `+${result.pieces} pièces`;
  await afterGameAction(async () => {
    await i.message.edit({ embeds: [{ ...base, color: 0x2ecc71, title: `Proposition validée (${reward} — ${result.tranche})${result.late ? ' (Retardataire)' : ''}` }], components: [] });
  });
  await afterGameAction(async () => {
    const channel = await enigmaChannel(i.client);
    if (!channel) throw new Error('Salon énigme indisponible pour la validation');
    await channel.send(result.late
      ? `🎉 **<@${userId}> a trouvé l'énigme !** (Validé avec retard par le MJ, ${reward} — tranche ${result.tranche})`
      : `🎉 **<@${userId}> a trouvé l'énigme !** (${reward} — tranche ${result.tranche})`);
  });
  await afterGameAction(async () => {
    await i.followUp({ content: `Tu as validé la proposition de <@${userId}>. ${reward} (tranche ${result.tranche}).${result.late ? '' : " L'énigme reste ouverte pour les autres."}`, flags: MessageFlags.Ephemeral });
  });
}

async function remindGuess(i: ButtonInteraction): Promise<void> {
  const joueur = await Joueur.findByPk(i.user.id);
  const remaining = guessCooldownRemaining(joueur?.last_deviner_time ?? null, gameNow());
  if (remaining <= 0) {
    await afterGameAction(() => i.followUp({ content: 'Ton cooldown est déjà terminé, tu peux jouer !', flags: MessageFlags.Ephemeral }));
    return;
  }
  await afterGameAction(async () => {
    await i.editReply({ components: [] }).catch(error => console.warn('[WARN] Désactivation bouton rappel impossible :', error));
    await i.followUp({ content: `D'accord ! Je t'enverrai un MP dans environ ${remaining} minute(s).`, flags: MessageFlags.Ephemeral });
  });
  scheduleGuessReminder(i.user.id, remaining * 60_000, async () => {
    const plateau = await Plateau.findByPk(1);
    if (plateau?.enigme_status !== 'active') return;
    await i.user.send('🔔 **Ding Dong !** Ton cooldown est terminé, tu peux à nouveau utiliser `/deviner` !');
  });
}

export function createDispatcher(commands: CommandRegistry) {
  return async function dispatchInteraction(interaction: Interaction): Promise<void> {
    if (interaction.isChatInputCommand()) {
      const command = commands.get(interaction.commandName);
      if (!command) throw new Error(`Commande inconnue : ${interaction.commandName}`);
      await command.execute(interaction);
      return;
    }
    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('modal_pari_')) await handleModalPari(interaction);
      else if (interaction.customId === 'modal_programmer_enigme') await admin.handleProgrammerEnigmeModal(interaction);
      else throw new GameRuleError('UNKNOWN', 'Action non disponible.');
      return;
    }
    if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
    const id = interaction.customId;
    if (id.startsWith('admin_')) {
      await admin.handleAdminComponent(interaction);
      return;
    }
    if (interaction.isButton()) {
      if (id === 'jouer_menu') return showGameMenu(interaction);
      if (id === 'voir_plateau') return showBoard(interaction);
      if (id === 'inventaire') return showInventory(interaction);
      if (id.startsWith('pari_')) return handlePari(interaction);
      if (id.startsWith('reponse_')) return judgeProposal(interaction);
      if (id.startsWith('rappel_deviner_')) return remindGuess(interaction);
      if (id.startsWith('plateau_zone_')) {
        await showZone(interaction, id.slice('plateau_zone_'.length));
        return;
      }
    }
    const plateau = await Plateau.findByPk(1);
    if (!await getActiveInteractions(plateau).handle(interaction)) {
      throw new GameRuleError('UNKNOWN', 'Action non disponible.');
    }
  };
}
