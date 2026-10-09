import { TIGHT_TRANSFER_MIN, transitLegs, type Conn } from '../core/options';
import type { Leg } from '../types';
import { ACCESS_LABEL, esc, fmtDur, fmtTime, modeLabel, splitText } from './format';

export const domId = (key: string) => 'opt-' + key.replace(/[^a-zA-Z0-9]/g, '_');

/** Aufgeklappte Verbindungen; bleiben beim Neuzeichnen (laufende Suche, Sortieren) offen. */
const openKeys = new Set<string>();

export function renderResults(host: HTMLOListElement, list: Conn[]): void {
  if (!host.dataset.bound) {
    host.dataset.bound = '1';
    // "toggle" steigt nicht auf, daher in der Einfangphase lauschen
    host.addEventListener('toggle', (e) => {
      const d = e.target as HTMLDetailsElement;
      const key = d.closest('li')?.dataset.key;
      if (!key) return;
      if (d.open) openKeys.add(key);
      else openKeys.delete(key);
    }, true);
  }
  if (!list.length) {
    host.innerHTML = '<li class="empty">Keine Verbindungen im Zeitfenster gefunden.</li>';
    return;
  }
  host.innerHTML = list.map(item).join('');
}

function item(s: Conn): string {
  const tl = transitLegs(s.itin.legs);
  const lines = tl.map((l) => esc(l.line || modeLabel(l.mode))).join(' → ');
  const pct = (m: number) => `${Math.max(0, (m / s.totalMin) * 100)}%`;
  const outMin = s.accessOutSec / 60;
  const inMin = s.accessInSec / 60;
  const warn: string[] = [];
  if (s.tight) warn.push(`<span class="badge warn" title="Umstieg kürzer als ${TIGHT_TRANSFER_MIN} min">⚠ knapper Umstieg${s.minGapMin !== null ? ` (${Math.round(s.minGapMin)} min)` : ''}</span>`);
  if (s.itin.legs.some((l) => l.cancelled)) warn.push('<span class="badge bad">✕ Fahrt fällt aus</span>');
  const delay = Math.max(0, ...tl.map((l) => l.delayMin));
  if (delay >= 3) warn.push(`<span class="badge warn">+${delay} min Verspätung</span>`);
  if (s.regionalOnly) warn.push('<span class="badge ok" title="nur Nahverkehr">D-Ticket</span>');

  const where = [
    s.o.door ? `<b>${esc(s.o.name)}</b>` : `<b>${esc(s.o.name)}</b>${outMin ? ` <span class="muted">(${fmtDur(outMin)} ${ACCESS_LABEL[s.o.access]})</span>` : ''}`,
    s.d.door ? `<b>${esc(s.d.name)}</b>` : `<b>${esc(s.d.name)}</b>${inMin ? ` <span class="muted">(${fmtDur(inMin)} ${ACCESS_LABEL[s.d.access]})</span>` : ''}`,
  ].join(' → ');

  return `<li id="${domId(s.key)}" class="opt" data-key="${esc(s.key)}">
  <details${openKeys.has(s.key) ? ' open' : ''}>
    <summary>
      <div class="opt-main">
        <div class="times"><span class="big">${fmtTime(s.doorDep)} – ${fmtTime(s.doorArr)}</span>
          <span class="muted">${fmtDur(s.totalMin)} · ${s.itin.transfers} Umst.</span></div>
        <div class="where">${where}</div>
        <div class="split" aria-label="Aufteilung Zubringer/Bahn">
          ${outMin ? `<span class="${s.o.access}" style="width:${pct(outMin)}"></span>` : ''}
          <span class="rail" style="width:${pct(s.transitMin)}"></span>
          ${inMin ? `<span class="${s.d.access}" style="width:${pct(inMin)}"></span>` : ''}
        </div>
        <div class="split-legend muted small">${splitText(s.transitMin, s.carMin, s.bikeMin)}</div>
        <div class="lines">${lines} ${warn.join(' ')}</div>
      </div>
    </summary>
    <div class="legs">${legsHtml(s)}</div>
  </details>
</li>`;
}

function legsHtml(s: Conn): string {
  const rows: string[] = [];
  if (s.accessOutSec > 0)
    rows.push(row(s.doorDep, s.itin.dep, s.o.access, ACCESS_LABEL[s.o.access], `von ${s.o.placeName} zu ${s.itin.legs[0].from}`, ''));
  for (const l of s.itin.legs) rows.push(legRow(l));
  if (s.accessInSec > 0) rows.push(row(s.itin.arr, s.doorArr, s.d.access, ACCESS_LABEL[s.d.access], `von ${s.itin.legs[s.itin.legs.length - 1].to} nach ${s.d.placeName}`, ''));
  const src = s.source === 'efa' ? 'EFA-BW (Landesauskunft Baden-Württemberg)' : 'Transitous (Ersatzquelle, Umstiegswege evtl. zu knapp)';
  return `<table class="legtable"><tbody>${rows.join('')}</tbody></table><p class="muted small src">Quelle: ${src}</p>`;
}

function legRow(l: Leg): string {
  const what = l.mode === 'WALK' ? 'Fußweg' : `${l.line || modeLabel(l.mode)}`;
  const detail =
    l.mode === 'WALK'
      ? `${esc(l.from)} → ${esc(l.to)}`
      : `${esc(l.from)}${l.track ? ` (Gl. ${esc(l.track)})` : ''} → ${esc(l.to)}${l.headsign ? ` <span class="muted">Ri. ${esc(l.headsign)}</span>` : ''}`;
  const rt = l.realTime ? (l.delayMin > 0 ? `<span class="late">+${l.delayMin}</span>` : '<span class="ontime">pünktlich</span>') : '';
  return row(l.dep, l.arr, l.mode === 'WALK' ? 'walk' : 'rail', what, detail, rt, true);
}

function row(a: number, b: number, cls: string, what: string, detail: string, extra: string, detailIsHtml = false): string {
  return `<tr><td class="t">${fmtTime(a)}–${fmtTime(b)}</td><td><i class="sw ${cls}"></i>${esc(what)}</td>` +
    `<td>${detailIsHtml ? detail : esc(detail)} ${extra}</td><td class="muted">${fmtDur((b - a) / 60000)}</td></tr>`;
}
