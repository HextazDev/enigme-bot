import { Image, loadImage } from 'canvas';

export const ALLOWED_IMAGE_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);
export const MAX_REMOTE_IMAGE_BYTES = 5 * 1024 * 1024;

interface LoadRemoteImageOptions {
  fetchFn?: typeof fetch;
  maxBytes?: number;
  allowedHosts?: ReadonlySet<string>;
}

export async function loadRemoteImage(url: string, options: LoadRemoteImageOptions = {}): Promise<Image> {
  const parsed = new URL(url);
  const allowedHosts = options.allowedHosts ?? ALLOWED_IMAGE_HOSTS;
  if (parsed.protocol !== 'https:' || !allowedHosts.has(parsed.hostname)) {
    throw new Error(`Hôte image non autorisé : ${parsed.hostname}`);
  }
  const maxBytes = options.maxBytes ?? MAX_REMOTE_IMAGE_BYTES;
  const response = await (options.fetchFn ?? fetch)(parsed.toString(), { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`Avatar HTTP ${response.status}`);
  const contentType = response.headers?.get('content-type') ?? '';
  if (contentType && !contentType.toLowerCase().startsWith('image/')) {
    throw new Error(`Type de contenu image invalide : ${contentType}`);
  }
  const declaredLength = Number(response.headers?.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`Image distante trop volumineuse (${declaredLength} octets)`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) throw new Error(`Image distante trop volumineuse (${buffer.length} octets)`);
  return loadImage(buffer);
}

export class BoundedCache<T> {
  private entries = new Map<string, { value: T; expires: number }>();
  constructor(private readonly limit = 200, private readonly ttlMs = 300_000, private readonly now = Date.now) {}
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expires <= this.now()) { this.entries.delete(key); return undefined; }
    this.entries.delete(key); this.entries.set(key, entry);
    return entry.value;
  }
  set(key: string, value: T, ttlMs = this.ttlMs): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expires: this.now() + ttlMs });
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!);
  }
}
