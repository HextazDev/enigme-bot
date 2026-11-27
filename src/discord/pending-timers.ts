import { afterGameAction, withScheduledLock } from '../game/transaction';

export const PENDING_TIMEOUT_MS = 60_000;
const timers = new Map<string, NodeJS.Timeout>();
const reservations = new Map<string, symbol>();
const guessReminders = new Map<string, NodeJS.Timeout>();

/** One expiry per player: a newer choice replaces the previous timer. The callback runs under the game lock. */
export async function armPendingTimer(userId: string, onExpire: () => Promise<void>, delayMs = PENDING_TIMEOUT_MS): Promise<void> {
  clearPendingTimer(userId);
  const reservation = Symbol(userId);
  reservations.set(userId, reservation);
  await afterGameAction(async () => {
    if (reservations.get(userId) !== reservation) return;
    const timer = setTimeout(() => {
      timers.delete(userId);
      reservations.delete(userId);
      withScheduledLock(userId, onExpire).catch(error => console.error('[ERROR] Expiration du choix :', error));
    }, delayMs);
    timer.unref();
    timers.set(userId, timer);
  });
}
export function clearPendingTimer(userId: string): void {
  const timer = timers.get(userId);
  if (timer) clearTimeout(timer);
  timers.delete(userId);
  reservations.delete(userId);
}

/** One active /deviner cooldown reminder per player; cleared on shutdown. */
export function scheduleGuessReminder(userId: string, delayMs: number, send: () => Promise<void>): void {
  const existing = guessReminders.get(userId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    guessReminders.delete(userId);
    send().catch(error => console.warn(`[WARN] MP de rappel impossible pour ${userId} :`, error));
  }, Math.max(0, delayMs));
  timer.unref();
  guessReminders.set(userId, timer);
}

export function clearGuessReminder(userId: string): void {
  const timer = guessReminders.get(userId);
  if (timer) clearTimeout(timer);
  guessReminders.delete(userId);
}

export function clearAllPendingTimers(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  reservations.clear();
  for (const timer of guessReminders.values()) clearTimeout(timer);
  guessReminders.clear();
}
