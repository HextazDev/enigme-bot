import { AsyncLocalStorage } from 'node:async_hooks';

type Presentation = () => Promise<unknown>;
interface Lease { owner: string; started: number; presentations: Presentation[]; unordered: Presentation[] }
const context = new AsyncLocalStorage<Lease>();
let active: Lease | null = null;
const waiters: Array<() => void> = [];
let publications: Promise<void> = Promise.resolve();
const inflightUnordered = new Set<Promise<unknown>>();

/** A committed action must never be reported as a failed game mutation. */
export class PresentationError extends Error {
  constructor(cause: unknown) {
    super('Action enregistrée, mais affichage Discord incomplet. Utilise /jouer pour retrouver ton état.', { cause });
  }
}

/** Capture all data before calling this: callbacks only render/send, never read or write game state. */
export async function afterGameAction(present: Presentation, options: { ordered?: boolean } = {}): Promise<void> {
  const lease = context.getStore();
  if (lease && lease === active) {
    if (options.ordered === false) lease.unordered.push(present);
    else lease.presentations.push(present);
    return;
  }
  await present();
}

async function runEffects(effects: Presentation[]): Promise<void> {
  const failures: unknown[] = [];
  // A failed public announcement must not prevent the private prompt or its timer.
  for (const effect of effects) {
    try { await effect(); }
    catch (error) { failures.push(error); }
  }
  if (failures.length) throw new PresentationError(failures.length === 1 ? failures[0] : new AggregateError(failures));
}

function publishInOrder(effects: Presentation[]): Promise<void> {
  if (!effects.length) return Promise.resolve();
  const batch = publications.then(() => runEffects(effects));
  publications = batch.catch(() => { /* The caller receives the error; subsequent batches still run. */ });
  return batch;
}

function publishUnordered(effects: Presentation[]): Promise<void> {
  if (!effects.length) return Promise.resolve();
  const task = runEffects(effects);
  const tracked = task.catch(() => {});
  inflightUnordered.add(tracked);
  void tracked.finally(() => inflightUnordered.delete(tracked));
  return task;
}

/** The board is shared: one game operation at a time in the process (players, crons and MJ alike). */
function tryAcquire(owner: string): Lease | null {
  if (active) return null;
  active = { owner, started: Date.now(), presentations: [], unordered: [] };
  return active;
}
function release(lease: Lease): void {
  if (active !== lease) return;
  active = null;
  for (const wake of waiters.splice(0)) wake();
}

export function getLockedUser(): string | null { return active?.owner ?? null; }
/** Test helper: release a lease left by an aborted test. Refused from inside an operation. */
export function forceUnlock(): void {
  if (context.getStore() === active) throw new Error('Impossible de libérer une opération en cours');
  if (active) release(active);
}

/** Wait for any active lock and pending Discord publications to settle before shutdown. */
export async function drainGameQueue(timeoutMs = 4000): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const drain = (async () => {
    while (active) await new Promise<void>(resolve => waiters.push(resolve));
    await publications;
    await Promise.allSettled([...inflightUnordered]);
  })();
  try {
    await Promise.race([drain, new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs); timer.unref(); })]);
  } finally { clearTimeout(timer); }
}

export class GameBusyError extends Error {
  constructor() { super('Une action est déjà en cours. Réessaie dans un instant.'); }
}

/**
 * Run `action` while holding the game lock. Nested calls inside the same operation reuse it.
 * Interactive callers fail fast (`wait = false`); crons and timers queue up.
 */
export async function withGameLock<T>(owner: string, action: () => Promise<T>, wait = false): Promise<T> {
  const inherited = context.getStore();
  if (inherited && inherited === active) return action();
  let lease = tryAcquire(owner);
  while (!lease) {
    if (!wait) throw new GameBusyError();
    await new Promise<void>(resolve => waiters.push(resolve));
    lease = tryAcquire(owner);
  }
  const held = lease;
  // A slow operation is diagnosed, never unlocked while it can still write.
  const watchdog = setTimeout(() => console.warn(`[WARN] Opération lente pour ${owner} (> 50s)`), 50_000);
  watchdog.unref();
  let result: T;
  let presentation: Promise<void>;
  try {
    result = await context.run(held, action);
    // Register ordered batches before releasing the lock; unordered read-only renders run concurrently.
    const orderedBatch = context.exit(() => publishInOrder(held.presentations));
    const unorderedBatch = context.exit(() => publishUnordered(held.unordered));
    presentation = Promise.all([orderedBatch, unorderedBatch]).then(() => undefined);
  } finally { clearTimeout(watchdog); release(held); }
  await presentation;
  return result;
}

/** Timers must not inherit the lease of the operation which scheduled them. */
export function withScheduledLock<T>(owner: string, action: () => Promise<T>): Promise<T> {
  return context.exit(() => withGameLock(owner, action, true));
}
