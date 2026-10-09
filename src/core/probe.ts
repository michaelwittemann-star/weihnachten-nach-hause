import { efaTrips } from '../api/efa';
import type { Candidate, SearchParams, SideKey } from '../types';
import { windowBounds } from './search';
import { distKm, NEAR_KM, rankMin } from './stations';

/** So viele Bahnhöfe je Seite werden höchstens zur Probe abgefragt (plus alle nahen). */
const PROBE_MAX = 20;
const WORKERS = 3;
/** Mindestabstand zwischen per Probe gewählten Bahnhöfen. */
const PROBE_SPREAD_KM = 1.5;

/**
 * Wählt die Bahnhöfe nach tatsächlicher Fahrzeit statt nach Bahnhofsart: Für jeden Kandidaten
 * wird eine Seite Verbindungen ab Fensterbeginn (bei Ankunft: bis Fensterende) geholt (zur jeweils anderen Seite), daraus die
 * schnellste Tür-zu-Tür-Zeit. Gewählt werden alle nahen Bahnhöfe plus die `maxStations` schnellsten.
 * So passt sich die Auswahl der Anreiserichtung an. Schlägt die Probe fehl, bleibt die Vorauswahl.
 */
export async function probeSelect(
  p: SearchParams,
  cands: Record<SideKey, Candidate[]>,
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void,
): Promise<void> {
  const { start, end } = windowBounds(p);
  const ref = (side: SideKey) => cands[side].find((c) => c.selected && c.door) ?? cands[side].find((c) => c.selected);

  const jobs: { side: SideKey; c: Candidate; o: Candidate; d: Candidate }[] = [];
  for (const side of ['from', 'to'] as SideKey[]) {
    if (!p[side].car && !p[side].bike) continue;
    const other = ref(side === 'from' ? 'to' : 'from');
    if (!other) continue;
    const stations = cands[side].filter((c) => !c.door);
    // Probe-Kandidaten räumlich verteilt: nicht nur die nächsten 20 Halte derselben Innenstadt
    const pool: Candidate[] = [];
    for (const c of [...stations].sort((a, b) => rankMin(a) - rankMin(b))) {
      if (pool.length >= PROBE_MAX) break;
      if (pool.some((q) => q.access === c.access && q.tier >= c.tier && distKm(q, c) < PROBE_SPREAD_KM)) continue;
      pool.push(c);
    }
    if (p.nearAll) for (const c of stations) if (c.distKm < NEAR_KM && !pool.includes(c)) pool.push(c);
    for (const c of pool) jobs.push(side === 'from' ? { side, c, o: c, d: other } : { side, c, o: other, d: c });
  }
  if (!jobs.length) return;

  const score = new Map<Candidate, number>();
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < jobs.length && !signal.aborted) {
      const j = jobs[next++];
      try {
        const time = p.arrive ? end - j.d.accessSec * 1000 : start + j.o.accessSec * 1000;
        const itins = await efaTrips({ from: j.o, to: j.d, time, regional: p.dticket, arrive: p.arrive, signal });
        const car = (j.o.accessSec + j.d.accessSec) / 60;
        const best = Math.min(...itins.map((it) => (it.arr - it.dep) / 60000));
        if (Number.isFinite(best)) score.set(j.c, best + car);
      } catch (e) {
        if (signal.aborted) throw e;
      }
      onProgress(++done, jobs.length);
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, worker));
  signal.throwIfAborted();

  for (const side of ['from', 'to'] as SideKey[]) {
    const probed = jobs.filter((j) => j.side === side).map((j) => j.c);
    if (!probed.some((c) => score.has(c))) continue; // Probe fehlgeschlagen: Vorauswahl behalten
    const near = (c: Candidate) => p.nearAll && c.distKm < NEAR_KM;
    for (const c of cands[side]) if (!c.door) c.selected = near(c);
    // Die schnellsten zuerst; Halte direkt neben einem schon gewählten (gleiches Fahrzeug) überspringen –
    // in Städten führen sonst alle Plätze zu Haltestellen im selben Viertel.
    const picked: Candidate[] = [];
    for (const c of probed.filter((c) => score.has(c) && !near(c)).sort((a, b) => score.get(a)! - score.get(b)!)) {
      if (picked.length >= p[side].maxStations) break;
      if (picked.some((q) => q.access === c.access && distKm(q, c) < PROBE_SPREAD_KM)) continue;
      c.selected = true;
      picked.push(c);
    }
    for (const c of probed) c.probeMin = score.get(c);
  }
}
