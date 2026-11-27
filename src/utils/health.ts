import config = require('../config');
interface HealthClient { isReady(): boolean; ws: { status: number; ping: number } }
interface HealthDatabase { authenticate(): Promise<unknown> }
interface Health { ok: boolean; discord: { up: boolean; ping: number }; database: { up: boolean; error?: string } }
type Fetch = (url: string, options?: RequestInit) => Promise<{ ok: boolean; status?: number }>;
export async function checkHealth(client: HealthClient, customSequelize?: HealthDatabase | null): Promise<Health> {
  const db: HealthDatabase = customSequelize ?? require('../db/models').sequelize;
  const up = client.isReady() && client.ws.status === 0;
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([db.authenticate(), new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Timeout de la vérification SQLite (5s)')), 5000);
    })]);
    return { ok: up, discord: { up, ping: Math.max(0, client.ws.ping) }, database: { up: true } };
  } catch (error) {
    return { ok: false, discord: { up, ping: Math.max(0, client.ws.ping) }, database: { up: false, error: error instanceof Error ? error.message : String(error) } };
  } finally { clearTimeout(timeout); }
}
export async function sendHeartbeatPing(pushBaseUrl: string, health: Health, options: { fetchFn?: Fetch } = {}): Promise<boolean> {
  if (!pushBaseUrl) return false;
  try {
    const url = new URL(pushBaseUrl);
    url.searchParams.set('status', health.ok ? 'up' : 'down');
    url.searchParams.set('msg', health.ok ? 'OK' : [!health.discord.up && 'Discord_down', !health.database.up && 'SQLite_down'].filter(Boolean).join('+'));
    if (health.ok) url.searchParams.set('ping', String(health.discord.ping));
    const response = await (options.fetchFn ?? fetch)(url.toString(), { method: 'GET', signal: AbortSignal.timeout(5000) });
    const ok = response.ok || response.status === 200;
    if (!ok) console.warn(`[WARN] Heartbeat Uptime Kuma refusé (HTTP ${response.status ?? 'inconnu'}).`);
    return ok;
  } catch {
    // Do not log fetch errors containing the secret push URL.
    console.warn('[WARN] Envoi du heartbeat Uptime Kuma impossible.');
    return false;
  }
}
interface HeartbeatOptions {
  pushUrl?: string | null; intervalMs?: number; maxFailures?: number;
  onExit?: (code: number) => void; sequelizeInstance?: HealthDatabase; fetchFn?: Fetch;
}
interface HeartbeatHandle { timer: NodeJS.Timeout; stop(): void }
let current: NodeJS.Timeout | null = null;
export function stopKumaHeartbeat(handle?: HeartbeatHandle | NodeJS.Timeout | null): void {
  const timer = handle && 'timer' in handle ? handle.timer : handle ?? current;
  if (timer) clearInterval(timer);
  if (timer === current) current = null;
}
export function startKumaHeartbeat(client: HealthClient, options: HeartbeatOptions = {}): HeartbeatHandle | null {
  stopKumaHeartbeat();
  const pushUrl = options.pushUrl !== undefined ? options.pushUrl : config.kumaPushUrl;
  if (!pushUrl) return null;
  const interval = options.intervalMs ?? config.kumaPushIntervalSec * 1000;
  const threshold = options.maxFailures ?? config.kumaMaxFailures;
  if (!Number.isFinite(interval) || interval <= 0 || !Number.isInteger(threshold) || threshold < 1) throw new Error('Configuration heartbeat invalide');
  let checking = false;
  let failures = 0;
  const timer = setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      const health = await checkHealth(client, options.sequelizeInstance);
      failures = health.ok ? 0 : failures + 1;
      if (!health.ok) {
        console.warn(`[WARN] Santé dégradée (${failures}/${threshold}) : discord=${health.discord.up}, db=${health.database.up}${health.database.error ? ` (${health.database.error})` : ''}`);
      }
      await sendHeartbeatPing(pushUrl, health, { fetchFn: options.fetchFn });
      if (failures >= threshold) {
        console.error(`[ERROR] Seuil d'échecs santé atteint (${failures}/${threshold}), arrêt du processus.`);
        stopKumaHeartbeat(timer);
        (options.onExit ?? ((code: number) => process.exit(code)))(1);
      }
    } catch (error) { console.error('[ERROR] Surveillance de santé :', error); }
    finally { checking = false; }
  }, interval);
  current = timer;
  return { timer, stop: () => stopKumaHeartbeat(timer) };
}
