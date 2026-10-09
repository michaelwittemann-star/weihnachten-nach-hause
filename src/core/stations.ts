import { carTimes, stopsInBox, type RawStop } from '../api/motis';
import type { Candidate, Place, SideKey, SideParams } from '../types';

export function distKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function tierOf(modes: string[] = []): number {
  if (modes.includes('HIGHSPEED_RAIL') || modes.includes('LONG_DISTANCE') || modes.includes('NIGHT_RAIL')) return 3;
  if (modes.includes('REGIONAL_RAIL') || modes.includes('REGIONAL_FAST_RAIL')) return 2;
  if (modes.includes('SUBURBAN') || modes.includes('SUBWAY') || modes.includes('METRO')) return 1;
  return -1;
}

export const TIER_LABEL: Record<number, string> = { 3: 'Fernverkehr', 2: 'Regionalverkehr', 1: 'S-/U-Bahn', 0: 'Adresse' };

/** Je Fernverkehrs-Stufe gilt ein Bahnhof als so viele Autominuten "näher". */
const TIER_BONUS_MIN = 8;
/** Mindestabstand zwischen vorausgewählten Bahnhöfen derselben oder niedrigeren Stufe. */
const SPREAD_KM = 3;
/** Bahnhöfe näher als das (Luftlinie zur Adresse) gelten als „um die Ecke“. */
export const NEAR_KM = 3;

export function doorCandidate(place: Place): Candidate {
  return {
    id: 'door',
    name: place.name,
    lat: place.lat,
    lon: place.lon,
    tier: 0,
    distKm: 0,
    carSec: 0,
    door: true,
    selected: true,
    stopId: place.stopId,
    placeName: place.name,
  };
}

/**
 * Alle Bahnhöfe im Umkreis mit Autozeit. Die besten `maxStations` (Autozeit minus
 * Bonus für Fern-/Regionalverkehr) sind vorausgewählt, der Rest kann zugeschaltet werden.
 */
export async function findCandidates(side: SideKey, p: SideParams, signal?: AbortSignal): Promise<Candidate[]> {
  const door = doorCandidate(p.place);
  const base = p.walk ? [door] : [];
  if (!p.car || p.radiusKm <= 0) return base;

  const r = p.radiusKm;
  const dLat = r / 111;
  const dLon = r / (111 * Math.cos((p.place.lat * Math.PI) / 180));
  const raw = await stopsInBox(p.place.lat - dLat, p.place.lon - dLon, p.place.lat + dLat, p.place.lon + dLon, signal);

  const inCircle = raw
    .map((s) => ({ s, tier: tierOf(s.modes), d: distKm(p.place, s) }))
    .filter((x) => x.tier > 0 && x.d <= r && !/sonderb/i.test(x.s.name)); // Sonderbahnsteige nur bei Veranstaltungen

  // Doppelte (gleicher Name oder < 200 m) zusammenfassen, höhere Stufe gewinnt
  inCircle.sort((a, b) => b.tier - a.tier || a.d - b.d);
  const kept: { s: RawStop; tier: number; d: number }[] = [];
  for (const x of inCircle) {
    const dup = kept.some((k) => normName(k.s.name) === normName(x.s.name) || distKm(k.s, x.s) < 0.2);
    if (!dup) kept.push(x);
  }
  kept.sort((a, b) => a.d - b.d);
  const pool = kept.slice(0, 60);
  if (pool.length === 0) return base;

  const times = await carTimes(p.place, pool.map((x) => x.s), side === 'to', signal);
  const cands: Candidate[] = [];
  pool.forEach((x, i) => {
    const sec = times[i];
    if (sec == null) return;
    cands.push({
      id: x.s.stopId,
      name: x.s.name,
      lat: x.s.lat,
      lon: x.s.lon,
      tier: x.tier,
      distKm: x.d,
      carSec: sec,
      door: false,
      selected: false,
      placeName: p.place.name,
    });
  });
  cands.sort((a, b) => rankMin(a) - rankMin(b));
  // Vorauswahl räumlich streuen: kein Halt direkt neben einem schon gewählten, gleichwertigen.
  // Nahe Bahnhöfe (< NEAR_KM) kommen immer dazu und zählen nicht gegen maxStations.
  const picked: Candidate[] = [];
  const pick = (c: Candidate) => {
    if (c.selected || picked.some((q) => q.tier >= c.tier && distKm(q, c) < SPREAD_KM)) return false;
    c.selected = true;
    picked.push(c);
    return true;
  };
  cands.filter((c) => c.distKm < NEAR_KM).forEach(pick);
  let far = 0;
  for (const c of cands) {
    if (far >= p.maxStations) break;
    if (c.distKm >= NEAR_KM && pick(c)) far++;
  }
  return [...base, ...cands];
}

/** Grobe Rangfolge ohne Fahrplan: Autozeit minus Bonus je Verkehrsstufe. */
export const rankMin = (c: Candidate) => c.carSec / 60 - TIER_BONUS_MIN * c.tier;

function normName(n: string): string {
  return n.toLowerCase().replace(/\(.*?\)|bahnhof|bf\.?|hbf\.?|hauptbahnhof|[^a-zäöüß]/g, '');
}
