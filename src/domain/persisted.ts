import { IlePending, JsonObject, MarioPending, PendingAction } from './types';

export function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`Données invalides : ${label}`);
  return value as Record<string, unknown>;
}
export function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every(v => typeof v === 'string')) throw new TypeError(`Données invalides : ${label}`);
  return [...value];
}
export function integer(value: unknown, label: string, min = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) throw new TypeError(`Données invalides : ${label}`);
  return value;
}
export function parsePending(value: unknown, mode: string): PendingAction | null {
  if (value === null) return null;
  const data = record(value, 'choix en attente');
  const base = { case: integer(data.case, 'case en attente', 1), token: data.token };
  if (typeof base.token !== 'string' || !base.token) throw new TypeError('Jeton du choix en attente invalide');
  const fields = { case: base.case, token: base.token };
  const type = data.type;
  if (mode === 'mario_party' && (type === 'etoile' || type === 'boutique' || type === 'boo' || type === 'intersection')) return { ...fields, type };
  if (mode === 'ile_defis') {
    if (type === 'portail') return data.target === undefined ? { ...fields, type }
      : { ...fields, type, target: integer(data.target, 'cible en attente', 1) };
    if (type === 'liane' || type === 'cascade' || type === 'dragon' || type === 'intersection') return { ...fields, type };
  }
  throw new TypeError('Type de choix en attente incompatible avec le mode');
}
export function marioPending(value: unknown): MarioPending | null {
  const pending = parsePending(value, 'mario_party');
  if (pending === null || pending.type === 'etoile' || pending.type === 'boutique' || pending.type === 'boo' || pending.type === 'intersection') return pending;
  throw new TypeError('Choix Mario incompatible');
}
export function islandPending(value: unknown): IlePending | null {
  const pending = parsePending(value, 'ile_defis');
  if (pending === null || pending.type === 'portail' || pending.type === 'liane' || pending.type === 'cascade' || pending.type === 'dragon' || pending.type === 'intersection') return pending;
  throw new TypeError('Choix Île incompatible');
}
export interface IslandBoardData { portails_ouverts: number[]; cascade_desactivee: boolean; gagnants_dragon: string[] }
export function parseIslandBoardData(value: unknown): IslandBoardData {
  const data = record(value, 'plateau île');
  const portals = data.portails_ouverts ?? [];
  if (!Array.isArray(portals)) throw new TypeError('Données invalides : portails');
  const cascade = data.cascade_desactivee ?? false;
  if (typeof cascade !== 'boolean') throw new TypeError('Données invalides : cascade');
  return { portails_ouverts: portals.map(id => integer(id, 'portails', 1)), cascade_desactivee: cascade,
    gagnants_dragon: strings(data.gagnants_dragon ?? [], 'vainqueurs dragon') };
}

export function validatePlayerModeData(value: unknown): void {
  const data = record(value, 'données joueur');
  const bonus = data.bonus_de;
  if (bonus !== undefined && bonus !== 'none' && bonus !== 'gold' && bonus !== 'silver' && bonus !== 'bronze' && bonus !== 'chocolat') throw new TypeError('Dé bonus invalide');
  if (data.double_lancer !== undefined && typeof data.double_lancer !== 'boolean') throw new TypeError('Double lancer invalide');
}

export interface PlayerSnapshot { discord_id: string; pieces?: number; etoiles?: number; position?: number; inventaire?: string[]; mode_data?: JsonObject }
/** Older snapshots may omit fields; a present but malformed field must never be silently discarded. */
export function parsePlayerSnapshots(value: unknown): PlayerSnapshot[] {
  if (value === null) return [];
  if (!Array.isArray(value)) throw new TypeError('Snapshots joueurs invalides');
  return value.map(raw => {
    const data = record(raw, 'snapshot joueur');
    if (typeof data.discord_id !== 'string' || !data.discord_id) throw new TypeError('Identifiant du snapshot invalide');
    const result: PlayerSnapshot = { discord_id: data.discord_id };
    if (data.pieces !== undefined) result.pieces = integer(data.pieces, 'pièces snapshot');
    if (data.etoiles !== undefined) result.etoiles = integer(data.etoiles, 'étoiles snapshot');
    if (data.position !== undefined) result.position = integer(data.position, 'position snapshot', 1);
    if (data.inventaire !== undefined) result.inventaire = strings(data.inventaire, 'inventaire snapshot');
    if (data.mode_data !== undefined) {
      validatePlayerModeData(data.mode_data);
      result.mode_data = data.mode_data as JsonObject;
    }
    return result;
  });
}
