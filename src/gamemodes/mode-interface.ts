import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, Client, StringSelectMenuBuilder, StringSelectMenuInteraction } from 'discord.js';
import { Transaction } from 'sequelize';
import type { Joueur, Plateau } from '../db/models';
import { BoardCase, ItemCatalog, JsonObject, Random } from '../domain/types';

export type GameComponent = ButtonInteraction | StringSelectMenuInteraction;
export type PromptRow = ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>;
export interface Prompt { content: string; components: PromptRow[] }

export interface ModeInteractions {
  /** Handle a game component already acknowledged by the boundary. False when the customId is unknown to this mode. */
  handle(interaction: GameComponent): Promise<boolean>;
  /** Private prompt of the pending choice, so /jouer can show it again (after a restart for example). */
  renderPending(joueur: Joueur, plateau: Plateau): Prompt | null;
  /** Re-arm the expiry of pending choices after a restart. */
  rearmTimers(client: Client): Promise<void>;
}

export interface SeasonEnd<Summary extends object = object> {
  /** Mode-specific awards, inside the season-closing transaction. */
  close(players: Joueur[], plateau: Plateau, transaction: Transaction, random: Random): Promise<Summary>;
  parseSummary(value: unknown): Summary;
  /** Public announcement once the transaction is committed. */
  announce(client: Client, summary: unknown, playerCount: number, wait?: (ms: number) => Promise<void>): Promise<void>;
}

export interface ModeDefinition {
  name: string;
  emoji: string;
  description: string;
  maxTours: number;
  hasStars: boolean;
  hasShop: boolean;
  hasBoo: boolean;
  isLinear: boolean;
  getInteractions(): ModeInteractions;
  getItems(variantId: string): ItemCatalog;
  getEndgame(): SeasonEnd;
  getBoardCases(mapId: string): BoardCase[];
  getBoardImagePath(mapId: string): string;
  getVariantConfig(variantId: string): object;
  getInitialPlayerData(variantId: string): JsonObject;
}
const required = ['getInteractions', 'getItems', 'getEndgame', 'getBoardCases', 'getBoardImagePath', 'getVariantConfig', 'getInitialPlayerData'] as const;
export function validateMode(value: unknown): asserts value is ModeDefinition {
  if (!value || typeof value !== 'object') throw new TypeError('Mode invalide');
  for (const method of required) {
    if (!(method in value) || typeof Reflect.get(value, method) !== 'function') throw new TypeError(`Méthode de mode absente : ${method}`);
  }
  for (const key of ['name', 'emoji', 'description']) if (typeof Reflect.get(value, key) !== 'string') throw new TypeError(`Métadonnée de mode invalide : ${key}`);
  for (const key of ['hasStars', 'hasShop', 'hasBoo', 'isLinear']) if (typeof Reflect.get(value, key) !== 'boolean') throw new TypeError(`Capacité de mode invalide : ${key}`);
  if (!Number.isInteger(Reflect.get(value, 'maxTours')) || Reflect.get(value, 'maxTours') < 1) throw new TypeError('Durée de mode invalide');
}
export function validateBoard(cases: BoardCase[]): void {
  if (!Array.isArray(cases) || !cases.length) throw new TypeError('Plateau vide');
  const ids = new Set(cases.map(c => c.id));
  if (ids.size !== cases.length) throw new TypeError('Identifiants de cases dupliqués');
  for (const cell of cases) {
    if (!Number.isInteger(cell.id) || cell.id < 1 || !Number.isFinite(cell.x) || !Number.isFinite(cell.y)
      || typeof cell.type !== 'string' || !Array.isArray(cell.next) || cell.next.some(id => !ids.has(id))) throw new TypeError(`Case invalide : ${cell.id}`);
  }
}
