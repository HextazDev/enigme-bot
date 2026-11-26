import { AttachmentBuilder, MessageCreateOptions } from 'discord.js';
import { Joueur, Plateau } from '../db/models';
import { BOARD_IMAGE_EXTENSION, BoardPlayer, generateBoardImage } from '../utils/canvas';
import config = require('../config');
import { afterGameAction } from '../game/transaction';

export interface Sendable { send(payload: string | MessageCreateOptions): Promise<unknown> }
/** Structural view of the Discord client: enough for crons and tests to provide a minimal fake. */
export interface ChannelHost {
  channels?: { fetch?(id: string): Promise<unknown>; cache?: { get(id: string): unknown } };
  users?: { fetch(id: string): Promise<{ username: string; send?(content: string): Promise<unknown> }> };
}
function isSendable(value: unknown): value is Sendable {
  return !!value && typeof value === 'object' && typeof Reflect.get(value, 'send') === 'function';
}

/** Fetch a channel (the cache can be cold after a restart), falling back to the cache. */
export async function getChannel(client: ChannelHost | null | undefined, channelId: string | undefined): Promise<Sendable | null> {
  if (!client?.channels || !channelId) return null;
  const { channels } = client;
  let channel: unknown = null;
  if (typeof channels.fetch === 'function') {
    try { channel = await channels.fetch(channelId); }
    catch (error) { console.warn(`[WARN] Salon ${channelId} non récupérable, repli sur le cache :`, error); }
  }
  if (!isSendable(channel) && channels.cache && typeof channels.cache.get === 'function') channel = channels.cache.get(channelId);
  return isSendable(channel) ? channel : null;
}
export const boardChannel = (client: ChannelHost | null | undefined) => getChannel(client, config.boardChannelId);
export const enigmaChannel = (client: ChannelHost | null | undefined) => getChannel(client, config.enigmaChannelId);

/** Send to the board channel; a missing channel is logged, never fatal once the game state is committed. */
export async function announce(client: ChannelHost | null | undefined, payload: string | MessageCreateOptions): Promise<void> {
  await afterGameAction(async () => {
    const channel = await boardChannel(client);
    if (!channel) { console.warn('[WARN] Salon du plateau indisponible pour une annonce.'); return; }
    await channel.send(payload);
  });
}

/** Public message with a fresh board image, the focused player drawn on top. */
export async function announceWithBoard(client: ChannelHost & { users: unknown } | null, content: string, focusUserId: string, zone: string | null = null): Promise<void> {
  const plateau = await Plateau.findByPk(1);
  if (!plateau) throw new Error('Plateau introuvable pour le rendu');
  const state = structuredClone(plateau.get({ plain: true }));
  const players: BoardPlayer[] = (await Joueur.findAll()).map(p => structuredClone(p.get({ plain: true })))
    .sort((a, b) => Number(a.discord_id === focusUserId) - Number(b.discord_id === focusUserId));
  await afterGameAction(async () => {
    const channel = await boardChannel(client);
    if (!channel) { console.warn('[WARN] Salon du plateau indisponible pour une annonce.'); return; }
    const buffer = await generateBoardImage(players, state, client as Parameters<typeof generateBoardImage>[2], zone);
    await channel.send({ content, files: [new AttachmentBuilder(buffer, { name: `board.${BOARD_IMAGE_EXTENSION}` })] });
  });
}
