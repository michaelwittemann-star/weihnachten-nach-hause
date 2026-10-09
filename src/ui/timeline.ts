import type { Conn } from '../core/options';
import { esc, fmtDur, fmtTime, splitText } from './format';

const ROW_H = 12;
const ROW_GAP = 6;
const AXIS_H = 22;
const RIGHT_PAD = 64;
const MAX_ROWS = 60;

/**
 * Tages-Zeitstrahl: jede Verbindung als Zeile, Abschnitte nach Verkehrsmittel gefärbt.
 * Wartezeiten bleiben als dünne Linie sichtbar.
 */
export function drawTimeline(host: HTMLElement, list: Conn[], winStart: number, onPick: (key: string) => void): void {
  host.innerHTML = '';
  if (!list.length) return;
  const rows = [...list].sort((a, b) => a.doorDep - b.doorDep).slice(0, MAX_ROWS);
  const t0 = Math.min(winStart, ...rows.map((r) => r.doorDep));
  const t1 = Math.max(...rows.map((r) => r.doorArr));
  const h0 = Math.floor(t0 / 3600e3) * 3600e3;
  const h1 = Math.ceil(t1 / 3600e3) * 3600e3;

  const width = Math.max(320, host.clientWidth || 800);
  const plotW = width - RIGHT_PAD;
  const height = AXIS_H + rows.length * (ROW_H + ROW_GAP);
  const x = (t: number) => ((t - h0) / (h1 - h0)) * plotW;

  const parts: string[] = [];
  const hours = (h1 - h0) / 3600e3;
  const step = hours > 16 ? 3 : hours > 8 ? 2 : 1;
  for (let t = h0; t <= h1; t += 3600e3) {
    const hr = new Date(t).getHours();
    if (hr % step) continue;
    parts.push(`<line class="grid" x1="${x(t)}" x2="${x(t)}" y1="${AXIS_H - 4}" y2="${height}"/>`);
    parts.push(`<text class="axis" x="${x(t)}" y="12" text-anchor="middle">${hr}:00</text>`);
  }

  rows.forEach((r, i) => {
    const y = AXIS_H + i * (ROW_H + ROW_GAP);
    const mid = y + ROW_H / 2;
    const segs: string[] = [`<line class="wait" x1="${x(r.doorDep)}" x2="${x(r.doorArr)}" y1="${mid}" y2="${mid}"/>`];
    const seg = (a: number, b: number, cls: string) => {
      const w = Math.max(2, x(b) - x(a) - 2); // 2px Abstand zwischen Abschnitten
      segs.push(`<rect class="${cls}" x="${x(a) + 1}" y="${y}" width="${w}" height="${ROW_H}" rx="3"/>`);
    };
    if (r.accessOutSec > 0) seg(r.doorDep, r.itin.dep, r.o.access);
    for (const l of r.itin.legs) seg(l.dep, l.arr, l.mode === 'WALK' ? 'walk' : 'rail');
    if (r.accessInSec > 0) seg(r.itin.arr, r.doorArr, r.d.access);
    const tip = esc(
      `${fmtTime(r.doorDep)}–${fmtTime(r.doorArr)} · ${fmtDur(r.totalMin)} · ${r.itin.transfers} Umst.\n` +
        `${r.o.name} → ${r.d.name}\n${splitText(r.transitMin, r.carMin, r.bikeMin)}`,
    );
    parts.push(
      `<g class="row" data-key="${esc(r.key)}" data-tip="${tip}">` +
        `<rect class="hit" x="0" y="${y - ROW_GAP / 2}" width="${width}" height="${ROW_H + ROW_GAP}"/>` +
        segs.join('') +
        `<text class="dur" x="${x(r.doorArr) + 6}" y="${mid + 4}">${fmtDur(r.totalMin)}</text></g>`,
    );
  });

  host.innerHTML =
    `<div class="legend"><span><i class="sw car"></i>Auto</span><span><i class="sw bike"></i>Fahrrad</span><span><i class="sw rail"></i>Bahn/ÖPNV</span>` +
    `<span><i class="sw walk"></i>Fußweg</span><span><i class="sw waitsw"></i>Warten</span>` +
    (list.length > MAX_ROWS ? `<span class="muted">erste ${MAX_ROWS} von ${list.length}</span>` : '') +
    `</div><svg class="tl" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" ` +
    `aria-label="Zeitstrahl der Verbindungen">${parts.join('')}</svg><div class="tip" hidden></div>`;

  const svg = host.querySelector('svg')!;
  const tipEl = host.querySelector('.tip') as HTMLDivElement;
  svg.addEventListener('mousemove', (e) => {
    const g = (e.target as Element).closest('.row') as SVGGElement | null;
    svg.querySelectorAll('.row.hover').forEach((n) => n !== g && n.classList.remove('hover'));
    if (!g) return void (tipEl.hidden = true);
    g.classList.add('hover');
    tipEl.textContent = g.dataset.tip ?? '';
    tipEl.hidden = false;
    const box = host.getBoundingClientRect();
    const left = Math.min(e.clientX - box.left + 12, box.width - 240);
    tipEl.style.left = `${Math.max(0, left)}px`;
    tipEl.style.top = `${e.clientY - box.top + 14}px`;
  });
  svg.addEventListener('mouseleave', () => {
    tipEl.hidden = true;
    svg.querySelectorAll('.row.hover').forEach((n) => n.classList.remove('hover'));
  });
  svg.addEventListener('click', (e) => {
    const g = (e.target as Element).closest('.row') as SVGGElement | null;
    if (g?.dataset.key) onPick(g.dataset.key);
  });
}
