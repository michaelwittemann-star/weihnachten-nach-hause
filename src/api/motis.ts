import type { Itin, Leg, Place } from '../types';
import { cacheGet, cacheSet, getJson } from './http';

/* ---------- Adresssuche ---------- */

interface GeoArea { name: string; adminLevel?: number; default?: boolean }
interface GeoMatch {
  id?: string;
  type: string;
  name: string;
  lat: number;
  lon: number;
  zip?: string;
  areas?: GeoArea[];
}

export async function geocode(text: string, signal?: AbortSignal): Promise<Place[]> {
  const res = await getJson<GeoMatch[]>('/api/v1/geocode', { text, language: 'de' }, signal);
  return res.slice(0, 8).map((m) => {
    const city = m.areas?.find((a) => a.default)?.name;
    const label = [m.name, [m.zip, city && city !== m.name ? city : ''].filter(Boolean).join(' ')]
      .filter(Boolean)
      .join(', ');
    return { name: label, lat: m.lat, lon: m.lon, ...(m.type === 'STOP' && m.id ? { stopId: m.id } : {}) };
  });
}

/* ---------- Haltestellen im Gebiet ---------- */

export interface RawStop {
  stopId: string;
  name: string;
  lat: number;
  lon: number;
  modes?: string[];
}

export async function stopsInBox(
  minLat: number, minLon: number, maxLat: number, maxLon: number, signal?: AbortSignal,
): Promise<RawStop[]> {
  const key = `stops:${[minLat, minLon, maxLat, maxLon].map((x) => x.toFixed(3)).join(',')}`;
  const hit = cacheGet<RawStop[]>(key);
  if (hit) return hit;
  const res = await getJson<RawStop[]>('/api/v6/map/stops', {
    min: `${minLat},${minLon}`,
    max: `${maxLat},${maxLon}`,
    grouped: 'true',
    modes: 'RAIL',
  }, signal);
  const slim = res.map(({ stopId, name, lat, lon, modes }) => ({ stopId, name, lat, lon, modes }));
  cacheSet(key, slim);
  return slim;
}

/* ---------- Autozeiten ---------- */

/**
 * Autozeit in Sekunden zwischen `one` und jedem Punkt aus `many`.
 * `toOne=true`: Fahrt von den Punkten zu `one` (Abholung am Ziel).
 * Nicht erreichbare Punkte liefern null.
 */
export async function carTimes(
  one: Place, many: { lat: number; lon: number }[], toOne: boolean, signal?: AbortSignal,
): Promise<(number | null)[]> {
  const out: (number | null)[] = [];
  for (let i = 0; i < many.length; i += 50) {
    const chunk = many.slice(i, i + 50);
    const key = `car:${toOne ? 1 : 0}:${one.lat.toFixed(5)},${one.lon.toFixed(5)}:` +
      chunk.map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join(';');
    let res = cacheGet<(number | null)[]>(key);
    if (!res) {
      const raw = await getJson<{ duration?: number }[]>('/api/v1/one-to-many', {
        one: `${one.lat};${one.lon}`,
        many: chunk.map((p) => `${p.lat};${p.lon}`).join(','),
        mode: 'CAR',
        max: '7200',
        maxMatchingDistance: '400',
        arriveBy: String(toOne),
      }, signal);
      res = raw.map((r) => (typeof r.duration === 'number' ? r.duration : null));
      cacheSet(key, res);
    }
    out.push(...res);
  }
  return out;
}

/* ---------- Verbindungen ---------- */

export const MODES_ALL = 'RAIL,TRAM,BUS,FERRY,FUNICULAR,AERIAL_LIFT';
export const MODES_REGIONAL = 'REGIONAL_RAIL,SUBURBAN,SUBWAY,TRAM,BUS,FERRY,FUNICULAR,AERIAL_LIFT';

interface RawPlace {
  name: string;
  track?: string;
  scheduledTrack?: string;
}
interface RawLeg {
  mode: string;
  displayName?: string;
  routeShortName?: string;
  tripShortName?: string;
  headsign?: string;
  tripId?: string;
  from: RawPlace;
  to: RawPlace;
  startTime: string;
  endTime: string;
  scheduledStartTime?: string;
  realTime?: boolean;
  cancelled?: boolean;
}
interface RawItin {
  startTime: string;
  endTime: string;
  transfers: number;
  legs: RawLeg[];
}
interface RawPlan {
  itineraries: RawItin[];
  nextPageCursor?: string;
  previousPageCursor?: string;
}

export interface PlanPage {
  itins: Itin[];
  next?: string;
  prev?: string;
}

const t = (s: string) => new Date(s).getTime();

function slimLeg(l: RawLeg): Leg {
  const dep = t(l.startTime);
  const sched = l.scheduledStartTime ? t(l.scheduledStartTime) : dep;
  return {
    mode: l.mode,
    line: l.displayName || l.routeShortName || l.tripShortName || '',
    from: l.from.name,
    to: l.to.name,
    dep,
    arr: t(l.endTime),
    delayMin: Math.round((dep - sched) / 60000),
    realTime: !!l.realTime,
    cancelled: !!l.cancelled,
    tripId: l.tripId,
    headsign: l.headsign,
    track: l.from.track || l.from.scheduledTrack,
  };
}

/** Ort für die Anfrage: Haltestellen-ID oder "lat,lon". */
export type PlanPlace = string;

export async function plan(opts: {
  from: PlanPlace;
  to: PlanPlace;
  time: Date;
  windowSec: number;
  modes: string;
  minTransfer: number;
  arriveBy?: boolean;
  cursor?: string;
  signal?: AbortSignal;
}): Promise<PlanPage> {
  const params: Record<string, string> = {
    fromPlace: opts.from,
    toPlace: opts.to,
    time: opts.time.toISOString(),
    searchWindow: String(Math.round(opts.windowSec)),
    transitModes: opts.modes,
    maxPreTransitTime: '1200',
    maxPostTransitTime: '1200',
    directModes: 'WALK',
    maxDirectTime: '0',
  };
  if (opts.minTransfer > 0) params.minTransferTime = String(opts.minTransfer);
  if (opts.arriveBy) params.arriveBy = 'true';
  if (opts.cursor) params.pageCursor = opts.cursor;
  const key = 'plan:' + new URLSearchParams(params).toString();
  const hit = cacheGet<PlanPage>(key);
  if (hit) return hit;
  const raw = await getJson<RawPlan>('/api/v6/plan', params, opts.signal);
  const page: PlanPage = {
    itins: raw.itineraries.map((it) => ({
      dep: t(it.startTime),
      arr: t(it.endTime),
      transfers: it.transfers,
      legs: it.legs.map(slimLeg),
    })),
    next: raw.nextPageCursor,
    prev: raw.previousPageCursor,
  };
  cacheSet(key, page);
  return page;
}
