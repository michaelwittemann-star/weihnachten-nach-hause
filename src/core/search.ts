import { efaTrips } from '../api/efa';
import { MODES_ALL, MODES_REGIONAL, plan } from '../api/motis';
import type { Candidate, Itin, Option, SearchParams } from '../types';

const MAX_PAGES = 3;

export function windowBounds(p: SearchParams): { start: number; end: number } {
  const start = new Date(`${p.date}T${p.t0}`).getTime();
  let end = new Date(`${p.date}T${p.t1}`).getTime();
  if (end <= start) end += 24 * 3600 * 1000; // Fenster über Mitternacht
  return { start, end };
}

export interface Task {
  o: Candidate;
  d: Candidate;
  regional: boolean;
}

export function buildTasks(p: SearchParams, from: Candidate[], to: Candidate[]): Task[] {
  const os = from.filter((c) => c.selected);
  const ds = to.filter((c) => c.selected);
  const tasks: Task[] = [];
  for (const o of os) for (const d of ds) tasks.push({ o, d, regional: p.dticket });
  return tasks;
}

const placeOf = (c: Candidate) => (c.door ? c.stopId ?? `${c.lat},${c.lon}` : c.id);

const MAX_EFA_PAGES = 8;

export type Source = 'efa' | 'transitous';

/**
 * Fragt ein Bahnhofspaar über das ganze Zeitfenster ab. Zuerst bei EFA-BW (genauere
 * Umstiegswege), bei einem Fehler dort automatisch bei Transitous.
 */
export async function runTask(task: Task, p: SearchParams, signal: AbortSignal): Promise<{ options: Option[]; source: Source }> {
  const { start, end } = windowBounds(p);
  const t0 = start + task.o.carSec * 1000;
  const t1 = end + task.o.carSec * 1000;
  try {
    const itins = await efaWindow(task, t0, t1, signal);
    const ok = itins.filter((it) => minGap(it) >= p.minTransfer);
    return { options: toOptions(task, ok, start, end, 'efa'), source: 'efa' };
  } catch (e) {
    if (signal.aborted) throw e;
    console.warn('EFA nicht verfügbar, nutze Transitous', e);
  }
  const itins = await transitousWindow(task, p, t0, (end - start) / 1000, signal);
  return { options: toOptions(task, itins, start, end, 'transitous'), source: 'transitous' };
}

async function efaWindow(task: Task, t0: number, t1: number, signal: AbortSignal): Promise<Itin[]> {
  const out: Itin[] = [];
  let time = t0;
  for (let page = 0; page < MAX_EFA_PAGES && time <= t1; page++) {
    const res = await efaTrips({ from: task.o, to: task.d, time, regional: task.regional, signal });
    const fresh = res.filter((it) => it.dep >= time);
    out.push(...fresh);
    if (fresh.length === 0) break;
    time = Math.max(...fresh.map((it) => it.dep)) + 60000; // nächste Seite ab der letzten Abfahrt
  }
  return out;
}

async function transitousWindow(task: Task, p: SearchParams, t0: number, windowSec: number, signal: AbortSignal): Promise<Itin[]> {
  const out: Itin[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await plan({
      from: placeOf(task.o),
      to: placeOf(task.d),
      time: new Date(t0),
      windowSec,
      modes: task.regional ? MODES_REGIONAL : MODES_ALL,
      minTransfer: p.minTransfer,
      cursor,
      signal,
    });
    out.push(...res.itins);
    const lastDep = res.itins.length ? res.itins[res.itins.length - 1].dep : Infinity;
    if (!res.next || lastDep >= t0 + windowSec * 1000 || res.itins.length === 0) break;
    cursor = res.next;
  }
  return out;
}

/** Kürzeste Zeit zwischen zwei Verkehrsmitteln (inkl. Fußweg dazwischen), in Minuten. */
function minGap(it: Itin): number {
  const tl = it.legs.filter((l) => l.mode !== 'WALK');
  let gap = Infinity;
  for (let i = 1; i < tl.length; i++) gap = Math.min(gap, (tl[i].dep - tl[i - 1].arr) / 60000);
  return gap;
}

/**
 * Fußwege direkt vor bzw. nach der Autofahrt entfallen: Abgeholt wird an der Haltestelle,
 * an der man tatsächlich aussteigt (die Autozeit des gewählten Halts gilt näherungsweise weiter).
 */
function trimWalksAtCar(it: Itin, carBefore: boolean, carAfter: boolean): Itin {
  let first = 0;
  let last = it.legs.length - 1;
  if (carBefore) while (first < last && it.legs[first].mode === 'WALK') first++;
  if (carAfter) while (last > first && it.legs[last].mode === 'WALK') last--;
  if (first === 0 && last === it.legs.length - 1) return it;
  const legs = it.legs.slice(first, last + 1);
  return { ...it, legs, dep: legs[0].dep, arr: legs[legs.length - 1].arr };
}

function toOptions(task: Task, itins: Itin[], start: number, end: number, source: Source): Option[] {
  const { o, d, regional } = task;
  const out: Option[] = [];
  for (const raw of itins) {
    if (!raw.legs.some((l) => l.mode !== 'WALK')) continue; // reine Fußwege
    const itin = trimWalksAtCar(raw, o.carSec > 0, d.carSec > 0);
    const doorDep = itin.dep - o.carSec * 1000;
    if (doorDep < start || doorDep > end) continue;
    out.push({
      key: `${o.id}|${d.id}|${itin.dep}|${itin.legs.map((l) => l.tripId ?? l.mode).join(',')}`,
      o,
      d,
      itin,
      carOutSec: o.carSec,
      carInSec: d.carSec,
      doorDep,
      doorArr: itin.arr + d.carSec * 1000,
      regionalOnly: regional || itin.legs.every((l) => !isLongDistance(l.mode)),
      source,
    });
  }
  return out;
}

export const isLongDistance = (mode: string) =>
  mode === 'HIGHSPEED_RAIL' || mode === 'LONG_DISTANCE' || mode === 'NIGHT_RAIL';

/** Ergebnisse mehrerer Abfragen zusammenführen, exakte Doppelungen entfernen. */
export function mergeOptions(all: Option[]): Option[] {
  const seen = new Map<string, Option>();
  for (const opt of all) if (!seen.has(opt.key)) seen.set(opt.key, opt);
  return [...seen.values()];
}
