import type { SearchParams, SideParams } from '../types';

const sideOut = (s: SideParams) =>
  [s.place.lat.toFixed(5), s.place.lon.toFixed(5), s.radiusKm, s.maxStations, (s.walk ? 'f' : '') + (s.car ? 'a' : ''), s.place.stopId ?? '', s.place.name].join('~');

function sideIn(v: string | null): SideParams | null {
  if (!v) return null;
  const [lat, lon, r, n, access, stopId, ...name] = v.split('~');
  const p = { lat: Number(lat), lon: Number(lon) };
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return null;
  return {
    place: { ...p, name: name.join('~'), ...(stopId ? { stopId } : {}) },
    radiusKm: Number(r) || 0,
    maxStations: Number(n) || 10,
    walk: access.includes('f'),
    car: access.includes('a') || !access.includes('f'),
  };
}

export function paramsToUrl(p: SearchParams): string {
  const q = new URLSearchParams({
    von: sideOut(p.from),
    nach: sideOut(p.to),
    tag: p.date,
    ab: p.t0,
    bis: p.t1,
  });
  if (p.dticket) q.set('dt', '1');
  if (p.minTransfer) q.set('mt', String(p.minTransfer));
  return `${location.origin}${location.pathname}?${q}`;
}

export function paramsFromUrl(): SearchParams | null {
  const q = new URLSearchParams(location.search);
  const from = sideIn(q.get('von'));
  const to = sideIn(q.get('nach'));
  if (!from || !to) return null;
  return {
    from,
    to,
    date: q.get('tag') ?? '',
    t0: q.get('ab') ?? '06:00',
    t1: q.get('bis') ?? '20:00',
    dticket: q.get('dt') === '1',
    minTransfer: Number(q.get('mt')) || 0,
  };
}
