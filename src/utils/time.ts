import { gameNow } from './clock';

const ZONE = 'Europe/Paris';
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const clockFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
});

export interface ParisClock { weekday: number; hour: number; minute: number }

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
