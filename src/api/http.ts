export const TRANSITOUS = 'https://api.transitous.org';
const MIN_GAP_MS = 1000; // je Server höchstens eine neue Anfrage pro Sekunde
const CACHE_TTL_MS = 6 * 3600 * 1000;
const CACHE_PREFIX = 'bu1:';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Getrennte Warteschlangen je Server, damit sich Transitous und EFA nicht ausbremsen. */
const gates = new Map<string, { gate: Promise<void>; last: number }>();
let requestCount = 0;

export const stats = { get requests() { return requestCount; } };

/** Reiht Anfragen so ein, dass zwischen zwei Starts mindestens MIN_GAP_MS liegen. */
function slot(base: string): Promise<void> {
  const g = gates.get(base) ?? { gate: Promise.resolve(), last: 0 };
  gates.set(base, g);
  const next = g.gate.then(async () => {
    const wait = g.last + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    g.last = Date.now();
  });
  g.gate = next.catch(() => undefined);
  return next;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function getJson<T>(
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal,
  opts: { base?: string; attempts?: number } = {},
): Promise<T> {
  const base = opts.base ?? TRANSITOUS;
  const url = `${base}${path}?${new URLSearchParams(params)}`;
  let lastErr: unknown;
  for (let attempt = 0; attempt < (opts.attempts ?? 4); attempt++) {
    await slot(base);
    signal?.throwIfAborted();
    try {
      requestCount++;
      const res = await fetch(url, { signal });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new HttpError(res.status, `Server antwortet ${res.status}`);
        await sleep(1500 * 2 ** attempt);
        continue;
      }
      if (!res.ok) {
        const body = await res.text();
        throw new HttpError(res.status, body.slice(0, 200) || `Fehler ${res.status}`);
      }
      return (await res.json()) as T;
    } catch (e) {
      if (signal?.aborted || e instanceof HttpError) throw e;
      lastErr = e; // Netzwerkfehler: erneut versuchen
      await sleep(1500 * 2 ** attempt);
    }
  }
  throw lastErr;
}

/** Kleiner Zwischenspeicher im Browser; alle Zugriffe abgesichert (privater Modus usw.). */
const mem = new Map<string, unknown>();

export function cacheGet<T>(key: string): T | undefined {
  if (mem.has(key)) return mem.get(key) as T;
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return undefined;
    const { t, v } = JSON.parse(raw);
    if (Date.now() - t > CACHE_TTL_MS) {
      localStorage.removeItem(CACHE_PREFIX + key);
      return undefined;
    }
    mem.set(key, v);
    return v as T;
  } catch {
    return undefined;
  }
}

export function cacheSet(key: string, v: unknown): void {
  mem.set(key, v);
  const raw = JSON.stringify({ t: Date.now(), v });
  try {
    localStorage.setItem(CACHE_PREFIX + key, raw);
  } catch {
    // Speicher voll: alte Einträge verwerfen und einmal neu versuchen
    try {
      pruneCache();
      localStorage.setItem(CACHE_PREFIX + key, raw);
    } catch {
      /* dann eben nur im Arbeitsspeicher */
    }
  }
}

function pruneCache(): void {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(CACHE_PREFIX)) keys.push(k);
  }
  keys.forEach((k) => localStorage.removeItem(k));
}
