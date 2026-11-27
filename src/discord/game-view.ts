import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, InteractionEditReplyOptions, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags, TextDisplayBuilder } from 'discord.js';
import { afterGameAction } from '../game/transaction';
import { PromptRow } from '../gamemodes/mode-interface';

interface ReplyTarget { editReply(options: InteractionEditReplyOptions): Promise<unknown> }
export interface GameView { content?: string; components?: PromptRow[]; files?: AttachmentBuilder[] }

/** All game screens edit the original private message, including legacy buttons. */
export function gameView(view: GameView): InteractionEditReplyOptions {
  const container = new ContainerBuilder().setAccentColor(0x5865f2)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(view.content || '🎲 Ton espace de jeu'));
  for (const file of view.files ?? []) {
    if (!file.name) throw new Error('Une image de jeu doit avoir un nom');
    container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder().setURL(`attachment://${file.name}`)));
  }
  for (const row of view.components ?? []) container.addActionRowComponents(row.toJSON());
  container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('jouer_menu').setLabel('Actualiser mon menu').setStyle(ButtonStyle.Secondary)));
  return { content: null, embeds: [], attachments: [], files: view.files ?? [], flags: MessageFlags.IsComponentsV2,
    components: [container], allowedMentions: { parse: [] } };
}

export async function editGameReply(target: ReplyTarget | null, view: GameView, options: { ordered?: boolean } = {}): Promise<void> {
  if (!target) return;
  const payload = gameView(view);
  await afterGameAction(() => target.editReply(payload), options);
}
