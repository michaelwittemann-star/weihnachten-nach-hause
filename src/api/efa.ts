import type { Candidate, Itin, Leg } from '../types';
import { cacheGet, cacheSet, getJson } from './http';

/**
 * Landesauskunft Baden-Württemberg (EFA-BW, NVBW). Deutschlandweite Fahrpläne, aber mit
 * genaueren Umstiegswegen (z. B. Stuttgart Hbf während der S21-Baustelle) als Transitous.
 */
const EFA = 'https://www.efa-bw.de/nvbw';
const TRIPS_PER_REQUEST = 10;

interface EfaPoint {
  name: string;
  disassembledName?: string;
  departureTimePlanned?: string;
  departureTimeEstimated?: string;
  arrivalTimePlanned?: string;
  arrivalTimeEstimated?: string;
  parent?: { name?: string };
  properties?: { platform?: string; platformName?: string };
}
interface EfaLeg {
  origin: EfaPoint;
  destination: EfaPoint;
  realtimeStatus?: string[];
  isRealtimeControlled?: boolean;
  transportation?: {
    id?: string | null;
    name?: string | null;
    disassembledName?: string | null;
    number?: string | null;
    product?: { class?: number; name?: string };
    destination?: { name?: string } | null;
    properties?: { trainType?: string; trainNumber?: string; tripCode?: number; attributes?: string[]; lineDisplay?: string };
  };
}
interface EfaResponse {
  journeys?: { legs: EfaLeg[] }[];
  systemMessages?: { type?: string; code?: number; text?: string }[];
}

export class EfaUnsupported extends Error {}

/** Haltestelle → deutsche Haltestellen-ID (DHID, steckt in der Transitous-ID); Adresse → Koordinate. */
function efaPlace(c: Candidate): { type: string; name: string } {
  const id = c.door ? c.stopId : c.id;
  const dhid = id && /(de:\d{5}:\d+)/.exec(id)?.[1];
  if (dhid) return { type: 'stop', name: dhid };
  if (c.door) return { type: 'coord', name: `${c.lon.toFixed(6)}:${c.lat.toFixed(6)}:WGS84[dd.ddddd]` };
  throw new EfaUnsupported(`keine deutsche Haltestellen-ID: ${c.id}`);
}

const LONG_DISTANCE_TYPES = new Set(['ICE', 'IC', 'EC', 'ECE', 'RJ', 'RJX', 'NJ', 'EN', 'TGV', 'FLX', 'D', 'THA']);

function modeOf(l: EfaLeg): string {
  const t = l.transportation;
  const cls = t?.product?.class;
  const attrs = t?.properties?.attributes ?? [];
  const type = t?.properties?.trainType ?? '';
  if (cls === 99 || cls === 100 || cls === 98 || t?.product?.name === 'footpath') return 'WALK';
  if (cls === 16 || type === 'ICE') return 'HIGHSPEED_RAIL';
  if (cls === 14 || cls === 15 || attrs.includes('LONG_DISTANCE_TRAINS') || LONG_DISTANCE_TYPES.has(type)) return 'LONG_DISTANCE';
  switch (cls) {
    case 1: return 'SUBURBAN';
    case 2: return 'SUBWAY';
    case 3: case 4: return 'TRAM';
    case 5: case 6: case 7: case 10: case 17: case 19: return 'BUS';
    case 8: return 'AERIAL_LIFT';
    case 9: return 'FERRY';
    default: return 'REGIONAL_RAIL'; // 0, 13, 18: Züge des Nahverkehrs
  }
}

function lineOf(l: EfaLeg, mode: string): string {
  const t = l.transportation;
  if (!t || mode === 'WALK') return '';
  const p = t.properties ?? {};
  if (p.lineDisplay === 'TRAIN' && p.trainType) return `${p.trainType} ${p.trainNumber ?? t.number ?? ''}`.trim();
  return t.disassembledName || t.number || t.name || '';
}

const ms = (s?: string) => (s ? new Date(s).getTime() : NaN);

function toLeg(l: EfaLeg): Leg {
  const mode = modeOf(l);
  const depPlan = ms(l.origin.departureTimePlanned);
  const dep = ms(l.origin.departureTimeEstimated) || depPlan;
  const arr = ms(l.destination.arrivalTimeEstimated) || ms(l.destination.arrivalTimePlanned);
  const p = l.transportation?.properties;
  const status = l.realtimeStatus ?? [];
  return {
    mode,
    line: lineOf(l, mode),
    from: l.origin.parent?.name && l.origin.name.startsWith(l.origin.parent.name) ? l.origin.parent.name : l.origin.name,
    to: l.destination.parent?.name && l.destination.name.startsWith(l.destination.parent.name) ? l.destination.parent.name : l.destination.name,
    dep,
    arr,
    delayMin: Number.isFinite(depPlan) ? Math.round((dep - depPlan) / 60000) : 0,
    realTime: !!l.isRealtimeControlled || status.includes('MONITORED'),
    cancelled: status.some((s) => s.includes('CANCEL')),
    tripId: mode === 'WALK' ? undefined : `${l.transportation?.id ?? ''}#${p?.tripCode ?? ''}#${p?.trainNumber ?? ''}`,
    headsign: l.transportation?.destination?.name,
    track: l.origin.properties?.platformName || l.origin.properties?.platform,
  };
}

/** Datum und Uhrzeit in deutscher Ortszeit, wie EFA sie erwartet. */
function berlinParts(t: number): { date: string; time: string } {
  const f = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { date: `${p.year}${p.month}${p.day}`, time: `${p.hour === '24' ? '00' : p.hour}${p.minute}` };
}

/** Eine Seite Verbindungen ab Zeitpunkt `time` (bis zu TRIPS_PER_REQUEST Stück). */
export async function efaTrips(opts: {
  from: Candidate;
  to: Candidate;
  time: number;
  regional: boolean;
  signal?: AbortSignal;
}): Promise<Itin[]> {
  const o = efaPlace(opts.from);
  const d = efaPlace(opts.to);
  const { date, time } = berlinParts(opts.time);
  const params: Record<string, string> = {
    outputFormat: 'rapidJSON',
    type_origin: o.type,
    name_origin: o.name,
    type_destination: d.type,
    name_destination: d.name,
    itdDate: date,
    itdTime: time,
    itdTripDateTimeDepArr: 'dep',
    calcNumberOfTrips: String(TRIPS_PER_REQUEST),
    useRealtime: '1',
    coordOutputFormat: 'WGS84[dd.ddddd]',
    locationServerActive: '1',
    useProxFootSearch: '1',
  };
  if (opts.regional) params.lineRestriction = '403'; // nur Nahverkehr
  const key = 'efa:' + new URLSearchParams(params).toString();
  const hit = cacheGet<Itin[]>(key);
  if (hit) return hit;

  const res = await getJson<EfaResponse>('/XML_TRIP_REQUEST2', params, opts.signal, { base: EFA, attempts: 2 });
  if (!res.journeys) {
    const msg = res.systemMessages?.map((m) => m.text).filter(Boolean).join(', ');
    // "keine Verbindung" ist ein gültiges Ergebnis, alles andere ein Fehler → Rückfall auf Transitous
    if (res.systemMessages?.some((m) => m.code === -4000)) return [];
    throw new Error(`EFA: ${msg || 'keine Antwort'}`);
  }
  const itins: Itin[] = res.journeys.map((j) => {
    const legs = j.legs.map(toLeg).filter((l) => Number.isFinite(l.dep) && Number.isFinite(l.arr));
    const transit = legs.filter((l) => l.mode !== 'WALK');
    return { dep: legs[0]?.dep, arr: legs[legs.length - 1]?.arr, transfers: Math.max(0, transit.length - 1), legs };
  }).filter((it) => it.legs.length > 0);
  cacheSet(key, itins);
  return itins;
}
