import { Interaction, MessageFlags } from 'discord.js';
import { GameBusyError, PresentationError, withGameLock } from '../game/transaction';
import { GameRuleError } from '../domain/types';
import config = require('../config');

const PUBLIC_ADMIN_SUBCOMMANDS = ['start', 'lancer_enigme', 'stop', 'tour', 'give', 'remove', 'set_position'];

/** Replies visible by the whole channel; everything else is private to the user. */
export function isPublicReply(interaction: Interaction): boolean {
  if (!interaction.isChatInputCommand()) return false;
  if (interaction.commandName === 'plateau') return true;
  const sub = interaction.options.getSubcommand(false);
  return interaction.commandName === 'admin' && !!sub && PUBLIC_ADMIN_SUBCOMMANDS.includes(sub);
}
/** `showModal` must be the first response, so these interactions are not acknowledged in advance. */
export function opensModal(interaction: Interaction): boolean {
  if (interaction.isChatInputCommand()) return interaction.commandName === 'admin' && interaction.options.getSubcommand(false) === 'programmer_enigme';
  return interaction.isButton() && interaction.customId.startsWith('pari_');
}
// Slash commands reserved to the MJ, whatever the Discord permissions.
const MJ_COMMANDS = ['dev', 'admin'];
const PUBLIC_COMPONENT_PREFIXES = ['pari_', 'plateau_zone_'];
function isPrivileged(interaction: Interaction, customId: string): boolean {
  if (interaction.isChatInputCommand() && MJ_COMMANDS.includes(interaction.commandName)) return true;
  return customId.startsWith('admin_') || customId.startsWith('reponse_') || customId.startsWith('modal_programmer_enigme');
}

function discordErrorCode(error: unknown): unknown {
  const root = error instanceof PresentationError ? error.cause : error;
  if (root instanceof AggregateError) {
    for (const item of root.errors) {
      const nested = discordErrorCode(item);
      if (nested === 10062 || nested === 40060) return nested;
    }
    return null;
  }
  return root && typeof root === 'object' && 'code' in root ? root.code : null;
}

export async function handleInteraction(interaction: Interaction, dispatch: (value: Interaction) => Promise<unknown>): Promise<void> {
  if (!interaction.isRepliable()) return;
  const id = 'customId' in interaction ? interaction.customId : '';
  const privileged = isPrivileged(interaction, id);
  try {
    if (privileged && interaction.user.id !== config.mjUserId) {
      await interaction.reply({ content: 'Cette action est réservée au Maître du Jeu.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (interaction.isMessageComponent() && !privileged && !PUBLIC_COMPONENT_PREFIXES.some(prefix => id.startsWith(prefix))) {
      const owner = interaction.message.interactionMetadata?.user.id ?? interaction.message.interaction?.user.id;
      if (!owner || owner !== interaction.user.id) {
        await interaction.reply({ content: "Ce bouton n'est pas pour toi.", flags: MessageFlags.Ephemeral });
        return;
      }
    }
    // Lock acquisition never waits for interactive traffic, so modal responses stay immediate.
    if (!opensModal(interaction)) {
      if (interaction.isMessageComponent()) await interaction.deferUpdate();
      else if (isPublicReply(interaction)) await interaction.deferReply();
      else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }
    await withGameLock(interaction.user.id, () => dispatch(interaction));
  } catch (error) {
    const code = discordErrorCode(error);
    if (code === 10062 || code === 40060) {
      console.warn('[TIMEOUT] Interaction non acquittable :', code);
      return;
    }
    const expected = error instanceof GameBusyError || error instanceof GameRuleError || error instanceof PresentationError;
    if (error instanceof PresentationError) console.error('[ERROR] Publication après validation :', error);
    if (!expected) console.error('[ERROR] Interaction échouée :', error);
    const content = expected ? (error as Error).message : 'Une erreur est survenue. Réessaie dans un instant.';
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    } catch (responseError) { console.warn('[WARN] Réponse Discord impossible :', responseError); }
  }
}
