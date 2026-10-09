import type { Leg, Option } from '../types';
import { NEAR_KM } from './stations';

/** Umstiege unter dieser Zeit werden als knapp markiert. */
export const TIGHT_TRANSFER_MIN = 6;

export interface Conn extends Option {
  totalMin: number; // echte Tür-zu-Tür-Zeit
  transitMin: number; // ÖPNV-Teil inkl. Fußwegen und Umstiegen
  carMin: number; // Autominuten (beide Seiten)
  tight: number; // Anzahl knapper Umstiege
  minGapMin: number | null; // kürzester Umstieg
}

export const transitLegs = (legs: Leg[]) => legs.filter((l) => l.mode !== 'WALK');

export function describeOptions(opts: Option[]): Conn[] {
  return opts.map((o) => {
    const tl = transitLegs(o.itin.legs);
    let tight = 0;
    let minGap: number | null = null;
    for (let i = 1; i < tl.length; i++) {
      const gap = (tl[i].dep - tl[i - 1].arr) / 60000;
      minGap = minGap === null ? gap : Math.min(minGap, gap);
      if (gap < TIGHT_TRANSFER_MIN) tight++;
    }
    return {
      ...o,
      totalMin: (o.doorArr - o.doorDep) / 60000,
      transitMin: (o.itin.arr - o.itin.dep) / 60000,
      carMin: (o.carOutSec + o.carInSec) / 60,
      tight,
      minGapMin: minGap,
    };
  });
}

/** Vergleich "besser": kürzer, dann weniger Umstiege, dann weniger Auto. */
export const byTotal = (a: Conn, b: Conn) =>
  a.totalMin - b.totalMin || a.itin.transfers - b.itin.transfers || a.carMin - b.carMin;

/**
 * Fasst Verbindungen zusammen, die mit demselben Hauptzug fahren (z. B. ein RE, der mehrere
 * Zielbahnhöfe anfährt). Nur die schnellste Variante bleibt.
 */
export function groupByMainTrip(list: Conn[]): Conn[] {
  const groups = new Map<string, Conn[]>();
  for (const s of list) {
    const tl = transitLegs(s.itin.legs);
    const main = tl.reduce((a, b) => (b.arr - b.dep > a.arr - a.dep ? b : a), tl[0]);
    // Nahe Verbindungen nie unter einer anderen verstecken
    const k = main && !isNear(s) ? `${main.tripId ?? main.line}@${main.dep}` : s.key;
    const g = groups.get(k);
    if (g) g.push(s);
    else groups.set(k, [s]);
  }
  return [...groups.values()].map((g) => {
    g.sort(byTotal);
    return g[0];
  });
}

/** Start- und Zielbahnhof zusammen weniger als NEAR_KM von den Adressen entfernt: immer zeigen. */
export const isNear = (c: Conn) => c.o.distKm + c.d.distKm < NEAR_KM;

export type SortKey = 'total' | 'transfers' | 'dep' | 'car';

export function sortConns(list: Conn[], key: SortKey): Conn[] {
  const cmp: Record<SortKey, (a: Conn, b: Conn) => number> = {
    total: byTotal,
    transfers: (a, b) => a.itin.transfers - b.itin.transfers || byTotal(a, b),
    dep: (a, b) => a.doorDep - b.doorDep,
    car: (a, b) => a.carMin - b.carMin || byTotal(a, b),
  };
  return [...list].sort(cmp[key]);
}
