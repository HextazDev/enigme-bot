import { gameNow } from './clock';

const ZONE = 'Europe/Paris';
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const frenchWeekdays = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const clockFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
});

export interface ParisClock { weekday: number; hour: number; minute: number }
export interface PublicationSchedule { readonly days: readonly number[]; readonly hour: number; readonly minute?: number }

/** Default enigma cron schedule: Monday to Friday at 17:00 Paris time. */
export const DEFAULT_ENIGMA_SCHEDULE: PublicationSchedule = Object.freeze({
  days: Object.freeze([1, 2, 3, 4, 5]),
  hour: 17,
  minute: 0,
});

function parisParts(now: Date) {
  const parts = clockFormatter.formatToParts(now);
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return {
    weekday: weekdays.indexOf(value('weekday')),
    year: Number(value('year')),
    month: Number(value('month')),
    day: Number(value('day')),
    hour: Number(value('hour')),
    minute: Number(value('minute')),
  };
}

/** Resolve a Paris wall-clock date/time to its exact UTC epoch, including across DST boundaries. */
function parisWallToEpoch(year: number, month: number, day: number, hour: number, minute: number): number {
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const offsetAt = (epoch: number) => {
    const p = parisParts(new Date(epoch));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - epoch;
  };
  const firstGuess = targetAsUtc - offsetAt(targetAsUtc);
  return targetAsUtc - offsetAt(firstGuess);
}

/** Game days follow Paris time, whatever the host time zone. weekday: 0 = Sunday. */
export function parisClock(now: Date = gameNow()): ParisClock {
  const { weekday, hour, minute } = parisParts(now);
  return { weekday, hour, minute };
}

/** Calendar date string (YYYY-MM-DD) in Paris time. */
export function parisDateKey(now: Date = gameNow()): string {
  const { year, month, day } = parisParts(now);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Epoch milliseconds of today's `hour`:00 in Paris. */
export function parisTodayAt(hour: number, now: Date = gameNow()): number {
  const { year, month, day } = parisParts(now);
  return parisWallToEpoch(year, month, day, hour, 0);
}

/** Next `weekday` (today included) at `hour`:`minute` in Paris. */
export function parisDayAt(weekday: number, hour: number, minute: number, from: Date = gameNow()): Date {
  const p = parisParts(from);
  const days = (weekday - p.weekday + 7) % 7;
  const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return new Date(parisWallToEpoch(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate(), hour, minute));
}

function validatePublicationSchedule(schedule: PublicationSchedule): { days: readonly number[]; hour: number; minute: number } {
  const minute = schedule.minute ?? 0;
  if (!schedule.days.length || schedule.days.some(d => !Number.isInteger(d) || d < 0 || d > 6)) {
    throw new Error('Planning de publication invalide : jours hors [0..6].');
  }
  if (!Number.isInteger(schedule.hour) || schedule.hour < 0 || schedule.hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new Error('Planning de publication invalide : heure ou minute hors bornes.');
  }
  return { days: schedule.days, hour: schedule.hour, minute };
}

/** Standard 5-field cron expression (`m h * * d,...`) derived from a validated publication schedule. */
export function publicationCronExpression(schedule: PublicationSchedule = DEFAULT_ENIGMA_SCHEDULE): string {
  const { days, hour, minute } = validatePublicationSchedule(schedule);
  const uniqueDays = [...new Set(days)].sort((a, b) => a - b);
  return `${minute} ${hour} * * ${uniqueDays.join(',')}`;
}

/** Next scheduled enigma publication strictly after `now` in Paris time. */
export function nextEnigmaPublication(now: Date = gameNow(), schedule: PublicationSchedule = DEFAULT_ENIGMA_SCHEDULE): Date {
  const { days, hour, minute } = validatePublicationSchedule(schedule);
  const p = parisParts(now);
  for (let offset = 0; offset <= 7; offset += 1) {
    const weekday = (p.weekday + offset) % 7;
    if (!days.includes(weekday)) continue;
    const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day + offset));
    const epoch = parisWallToEpoch(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate(), hour, minute);
    if (epoch > now.getTime()) return new Date(epoch);
  }
  throw new Error('Planning de publication invalide : aucune occurrence trouvée.');
}

/** Human-readable French publication label relative to `now` in Paris time (e.g. "aujourd'hui à 17h" or "lundi 12/10 à 17h"). */
export function formatEnigmaPublication(target: Date, now: Date = gameNow()): string {
  const p = parisParts(target);
  const ref = parisParts(now);
  const time = `${p.hour}h${p.minute ? String(p.minute).padStart(2, '0') : ''}`;
  if (p.year === ref.year && p.month === ref.month && p.day === ref.day) return `aujourd'hui à ${time}`;
  const day = String(p.day).padStart(2, '0');
  const month = String(p.month).padStart(2, '0');
  return `${frenchWeekdays[p.weekday]} ${day}/${month} à ${time}`;
}
