import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Conn } from '../core/options';
import { TIER_LABEL } from '../core/stations';
import type { Candidate, SearchParams, SideKey } from '../types';
import { esc, fmtDur } from './format';

let map: L.Map | null = null;
let layer: L.LayerGroup | null = null;

function ensureMap(): L.Map {
  if (map) return map;
  map = L.map('map', { scrollWheelZoom: false });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  layer = L.layerGroup().addTo(map);
  return map;
}

export function drawMap(
  p: SearchParams,
  cands: Record<SideKey, Candidate[]>,
  best: Map<string, Conn>,
  onToggle: (side: SideKey, c: Candidate) => void,
): void {
  const m = ensureMap();
  layer!.clearLayers();
  const bounds = L.latLngBounds([]);
  for (const side of ['from', 'to'] as SideKey[]) {
    const s = p[side];
    const center = L.latLng(s.place.lat, s.place.lon);
    bounds.extend(center);
    if (s.car && s.radiusKm > 0) { // ohne Auto kein Umkreis
      const circle = L.circle(center, { radius: s.radiusKm * 1000, className: `ring ring-${side}`, interactive: false });
      circle.addTo(layer!);
      bounds.extend(center.toBounds(s.radiusKm * 2000));
    }
    L.circleMarker(center, { radius: 7, className: `home home-${side}` })
      .bindTooltip(`${side === 'from' ? 'Start' : 'Ziel'}: ${s.place.name}`)
      .addTo(layer!);

    for (const c of cands[side]) {
      if (c.door) continue;
      const b = best.get(`${side}:${c.id}`);
      const cls = ['stn', c.selected ? 'on' : 'off', b ? 'has' : '', `tier${c.tier}`].join(' ');
      const tip =
        `<b>${esc(c.name)}</b><br>${TIER_LABEL[c.tier]} · ${fmtDur(c.carSec / 60)} Auto` +
        (b ? `<br>beste: ${fmtDur(b.totalMin)} gesamt, ${b.itin.transfers} Umst.` : '') +
        `<br><i>Klick: ${c.selected ? 'abwählen' : 'auswählen'}</i>`;
      L.circleMarker([c.lat, c.lon], { radius: 4 + c.tier * 1.5, className: cls })
        .bindTooltip(tip)
        .on('click', () => onToggle(side, c))
        .addTo(layer!);
    }
  }
  m.invalidateSize();
  if (bounds.isValid()) m.fitBounds(bounds, { padding: [24, 24] });
}
