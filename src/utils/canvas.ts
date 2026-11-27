import { mapConcurrent } from './concurrency';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Canvas, CanvasRenderingContext2D, Image, createCanvas, loadImage } from 'canvas';
import { Client, User } from 'discord.js';
import { BoardCase } from '../domain/types';
import { getActiveBoardCases, getActiveMode } from '../gamemodes/registry';
import { BoundedCache, loadRemoteImage } from './remote-image';

const BOARD_WIDTH = 1920;
const BOARD_HEIGHT = 1080;
const HALF_CASE = 45;
const USER_FETCH_TIMEOUT_MS = 3000;
const USER_MISSING_TTL_MS = 60_000;
const USER_MISSING = Symbol('user_missing');

export interface BoardPlayer { discord_id: string; position: number; etoiles: number; pieces: number; inventaire: string[] }
export interface BoardState { game_mode: string; game_map: string; tour: number; position_etoile: number; pieges_actifs?: { position?: unknown }[] }
type UserLookup = Pick<Client, 'users'> | null;

const backgrounds = new Map<string, Image>();
const backgroundLoads = new Map<string, Promise<Image>>();
const avatarCache = new BoundedCache<Image>();
const userCache = new BoundedCache<User | typeof USER_MISSING>();
const avatarLoads = new Map<string, Promise<{ user: User | null; avatar: Image | null }>>();

async function avatarFor(client: UserLookup, id: string) {
  const running = avatarLoads.get(id);
  if (running) return running;
  const task = (async () => {
    const user = await fetchUser(client, id);
    return { user, avatar: await fetchAvatar(user) };
  })();
  avatarLoads.set(id, task);
  try { return await task; }
  finally { avatarLoads.delete(id); }
}

/** Attachment names must use this extension so Discord displays the image. */
export const BOARD_IMAGE_EXTENSION = 'jpg';

/**
 * Native asynchronous encoding leaves the event loop available for acknowledgments.
 * Measured on a 12-player Night Sky board: PNG took ~200 ms for 2.2 MB, JPEG q90 ~10 ms for ~450 KB
 * with no visible difference, so uploads are faster too.
 */
function encodeBoard(canvas: Canvas): Promise<Buffer> {
  return new Promise((resolve, reject) => canvas.toBuffer((error, buffer) => {
    if (error) reject(error); else resolve(buffer);
  }, 'image/jpeg', { quality: 0.9 }));
}

/** Called after a new season changes the map. */
export function invalidateBoardCache(): void {
  backgrounds.clear();
  backgroundLoads.clear();
}

function drawCircleImage(ctx: CanvasRenderingContext2D, img: Image, x: number, y: number, radius: number, borderColor = '#FFFFFF'): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2, true);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(img, x - radius, y - radius, radius * 2, radius * 2);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2, true);
  ctx.lineWidth = 3;
  ctx.strokeStyle = borderColor;
  ctx.stroke();
}

function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, spikes: number, outer: number, inner: number, fill: string, stroke: string): void {
  let rot = Math.PI / 2 * 3;
  const step = Math.PI / spikes;
  ctx.beginPath();
  ctx.moveTo(cx, cy - outer);
  for (let i = 0; i < spikes; i++) {
    ctx.lineTo(cx + Math.cos(rot) * outer, cy + Math.sin(rot) * outer);
    rot += step;
    ctx.lineTo(cx + Math.cos(rot) * inner, cy + Math.sin(rot) * inner);
    rot += step;
  }
  ctx.lineTo(cx, cy - outer);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

/** Unit vector pointing outside the track at a case, from its neighbours. */
function outward(cases: BoardCase[], c: BoardCase): { x: number; y: number } {
  const prev = cases.find(other => other.next.includes(c.id)) ?? c;
  const next = cases.find(other => other.id === c.next[0]) ?? c;
  const tx = next.x - prev.x;
  const ty = next.y - prev.y;
  const length = Math.hypot(tx, ty);
  return length > 0 ? { x: -ty / length, y: tx / length } : { x: 0, y: -1 };
}

async function fetchUser(client: UserLookup, id: string): Promise<User | null> {
  const cached = userCache.get(id);
  if (cached === USER_MISSING) return null;
  if (cached || !client) return cached ?? null;
  let timer: NodeJS.Timeout | undefined;
  try {
    const user = await Promise.race([
      client.users.fetch(id),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timeout utilisateur Discord ${id} (${USER_FETCH_TIMEOUT_MS}ms)`)), USER_FETCH_TIMEOUT_MS);
        timer.unref();
      }),
    ]);
    userCache.set(id, user);
    return user;
  } catch (error) {
    userCache.set(id, USER_MISSING, USER_MISSING_TTL_MS);
    console.warn(`[WARN] Utilisateur Discord ${id} introuvable pour le plateau :`, error);
    return null;
  } finally { clearTimeout(timer); }
}
async function fetchAvatar(user: User | null): Promise<Image | null> {
  if (!user) return null;
  const key = `${user.id}:${user.avatar ?? 'default'}`;
  const cached = avatarCache.get(key);
  if (cached) return cached;
  try {
    const image = await loadRemoteImage(user.displayAvatarURL({ extension: 'png', size: 128 }));
    avatarCache.set(key, image);
    return image;
  } catch (error) {
    // A missing avatar falls back to initials; the board must still be rendered.
    console.warn(`[WARN] Avatar indisponible pour ${user.id} :`, error);
    return null;
  }
}
function drawInitials(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, text: string, font: string): void {
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#FFD700';
  ctx.stroke();
  ctx.fillStyle = '#000000';
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

async function fileExists(filePath: string): Promise<boolean> {
  try { await fs.access(filePath); return true; }
  catch { return false; }
}

async function background(plateau: BoardState, zone: string | null): Promise<Image> {
  const key = `${plateau.game_mode}_${plateau.game_map}_${zone ?? 'full'}`;
  const cached = backgrounds.get(key);
  if (cached) return cached;
  const inflight = backgroundLoads.get(key);
  if (inflight) return inflight;
  const task = (async () => {
    const mode = getActiveMode(plateau);
    const fullImage = mode.getBoardImagePath(plateau.game_map);
    const zoneImage = zone ? path.join(path.dirname(fullImage), `${zone}.png`) : null;
    const chosen = zoneImage && await fileExists(zoneImage) ? zoneImage : fullImage;
    const image = await loadImage(chosen);
    backgrounds.set(key, image);
    return image;
  })();
  backgroundLoads.set(key, task);
  try { return await task; }
  finally { backgroundLoads.delete(key); }
}

/** Follow board topology around a case: up to 2 predecessors, current case, and up to 6 successors. */
export function zoomedCaseWindow(cases: BoardCase[], position: number): { cases: BoardCase[]; aheadIds: Set<number> } {
  const byId = new Map(cases.map(c => [c.id, c]));
  const current = byId.get(position);
  if (!current) return { cases: [], aheadIds: new Set() };
  const visited = new Set<number>([current.id]);
  const prev: BoardCase[] = [];
  let cursor = current.id;
  for (let step = 0; step < 2; step++) {
    const parent = cases.find(c => c.next.includes(cursor) && !visited.has(c.id));
    if (!parent) break;
    visited.add(parent.id);
    prev.unshift(parent);
    cursor = parent.id;
  }
  const ahead: BoardCase[] = [];
  const aheadIds = new Set<number>();
  cursor = current.id;
  for (let step = 0; step < 6; step++) {
    const cell = byId.get(cursor);
    const nextId = cell?.next[0];
    if (nextId === undefined || visited.has(nextId)) break;
    const nextCell = byId.get(nextId);
    if (!nextCell) break;
    visited.add(nextCell.id);
    ahead.push(nextCell);
    aheadIds.add(nextCell.id);
    cursor = nextCell.id;
  }
  return { cases: [...prev, current, ...ahead], aheadIds };
}

/**
 * Render the board. `players` is drawn in order, so the active player goes last (on top).
 * Island boards are split in zones: only `zone` (or the zone of the focused/last player) is drawn.
 */
export async function generateBoardImage(players: BoardPlayer[], plateau: BoardState, client: UserLookup, zoneId: string | null = null): Promise<Buffer> {
  const cases = getActiveBoardCases(plateau);
  const mode = getActiveMode(plateau);
  const caseOf = (id: number) => cases.find(c => c.id === id);
  const isIle = plateau.game_mode === 'ile_defis';
  const focus = players[players.length - 1];
  const zone = isIle ? zoneId ?? (focus ? caseOf(focus.position)?.zone : undefined) ?? 'plage' : null;
  const canvas = createCanvas(BOARD_WIDTH, BOARD_HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(await background(plateau, zone), 0, 0, BOARD_WIDTH, BOARD_HEIGHT);

  if (plateau.tour) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(BOARD_WIDTH - 250, 20, 230, 60);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 30px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Tour ${plateau.tour}/${mode.maxTours}`, BOARD_WIDTH - 135, 50);
  }
  const starCase = isIle ? undefined : caseOf(plateau.position_etoile);
  if (starCase) {
    const dir = outward(cases, starCase);
    drawStar(ctx, starCase.x + HALF_CASE + dir.x * 70, starCase.y + HALF_CASE + dir.y * 70, 5, 25, 12, '#FFD700', '#000000');
  }

  const leaders = [...players].sort((a, b) => isIle ? b.position - a.position : b.etoiles - a.etoiles || b.pieces - a.pieces).slice(0, 5);
  const visible = players.filter(p => { const cell = caseOf(p.position); return cell && (!zone || cell.zone === zone); });
  const idsToLoad = [...new Set([...visible, ...leaders].map(p => p.discord_id))];
  const assets = new Map(await mapConcurrent(idsToLoad, 4, async id => [id, await avatarFor(client, id)] as const));
  const byCase = new Map<number, BoardPlayer[]>();
  for (const p of players) byCase.set(p.position, [...(byCase.get(p.position) ?? []), p]);
  for (const [position, here] of byCase) {
    const c = caseOf(position);
    if (!c || (zone && c.zone !== zone)) continue;
    const dir = outward(cases, c);
    for (const [i, player] of here.entries()) {
      let px = c.x + HALF_CASE + dir.x * 65;
      let py = c.y + HALF_CASE + dir.y * 65;
      // Spread players sharing a case along the track, then around the case.
      if (here.length >= 2 && i < 2) {
        const spread = here.length === 2 ? 20 : 15;
        const sign = i === 0 ? -1 : 1;
        px += sign * dir.y * spread;
        py -= sign * dir.x * spread;
      } else if (i === 2) {
        px += dir.x * 25;
        py += dir.y * 25;
      } else if (i > 2) {
        const angle = i / here.length * Math.PI * 2;
        px += Math.cos(angle) * 25;
        py += Math.sin(angle) * 25;
      }
      const asset = assets.get(player.discord_id);
      if (!asset) throw new Error('Avatar non préparé pour un pion visible');
      const { user, avatar } = asset;
      if (avatar) drawCircleImage(ctx, avatar, px, py, 30, '#FFD700');
      else drawInitials(ctx, px, py, 30, user ? user.username.substring(0, 2).toUpperCase() : '?', '20px Arial');
    }
  }

  let x = 20;
  for (const [rank, p] of leaders.entries()) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(x, 20, 250, 60);
    const asset = assets.get(p.discord_id);
    const name = asset?.user?.username ?? 'Joueur';
    const avatar = asset?.avatar ?? null;
    if (avatar) drawCircleImage(ctx, avatar, x + 30, 50, 20, '#FFFFFF');
    else drawInitials(ctx, x + 30, 50, 20, name.substring(0, 2).toUpperCase(), '14px Arial');
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${rank + 1}.`, x + 5, 50);
    ctx.fillText(name.length > 10 ? `${name.substring(0, 9)}...` : name, x + 60, 38);
    ctx.font = 'bold 15px Arial';
    ctx.fillStyle = '#FFD700';
    if (isIle) ctx.fillText(`Case: ${p.position}`, x + 60, 65);
    else {
      ctx.fillText(`★ ${p.etoiles}`, x + 60, 65);
      ctx.fillStyle = '#F1C40F';
      ctx.fillText(`P: ${p.pieces}`, x + 105, 65);
      ctx.fillStyle = '#AAB7B8';
      ctx.font = '13px Arial';
      ctx.fillText(`Obj: ${p.inventaire.length}`, x + 180, 65);
    }
    x += 265;
  }
  return encodeBoard(canvas);
}

const CASE_COLORS: Record<string, string> = {
  Bleue: '#3498db', Rouge: '#e74c3c', Chance: '#2ecc71', Verte: '#27ae60', Départ: '#27ae60', Malchance: '#9b59b6',
  Bowser: '#c0392b', 'Coup du Sort': '#f1c40f', Boo: '#ecf0f1', Boutique: '#e67e22',
};

/** Strip of the cases around the player following board topology, used by /jouer. */
export async function generateZoomedBoardImage(joueur: BoardPlayer, players: BoardPlayer[], plateau: BoardState, client: UserLookup): Promise<Buffer> {
  const cases = getActiveBoardCases(plateau);
  const canvas = createCanvas(800, 200);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#2C2F33';
  ctx.fillRect(0, 0, 800, 200);
  const traps = (plateau.pieges_actifs ?? []).map(t => t.position);
  const { cases: strip, aheadIds } = zoomedCaseWindow(cases, joueur.position);
  // 9 circles max: startX=56, step=86, radius=36 keeps [20..780] strictly inside the 800px canvas.
  let drawX = 56;
  for (const c of strip) {
    ctx.fillStyle = CASE_COLORS[c.type] ?? '#4F545C';
    ctx.beginPath();
    ctx.arc(drawX, 100, 36, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = c.id === joueur.position ? '#FFD700' : '#000000';
    ctx.stroke();
    ctx.fillStyle = c.type === 'Boo' || c.type === 'Coup du Sort' ? '#000000' : '#FFFFFF';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(c.id), drawX, 82);
    ctx.font = '10px Arial';
    ctx.fillText(c.type.substring(0, 6), drawX, 100);
    if (plateau.game_mode !== 'ile_defis' && plateau.position_etoile === c.id) drawStar(ctx, drawX, 48, 5, 15, 7, '#FFD700', '#000000');
    if (traps.includes(c.id) && aheadIds.has(c.id)) {
      ctx.font = '24px Arial';
      ctx.fillText('⚠️', drawX, 132);
    }
    const here = players.filter(p => p.position === c.id);
    if (here.length && c.id === joueur.position) {
      const { user, avatar } = await avatarFor(client, joueur.discord_id);
      if (avatar) drawCircleImage(ctx, avatar, drawX, 114, 18, '#FFD700');
      else drawInitials(ctx, drawX, 114, 18, user ? user.username.substring(0, 2).toUpperCase() : '?', '12px Arial');
    } else if (here.length) drawInitials(ctx, drawX, 114, 14, String(here.length), '13px Arial');
    drawX += 86;
  }
  return encodeBoard(canvas);
}
