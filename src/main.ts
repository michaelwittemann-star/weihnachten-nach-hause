import './style.css';
import { carTimes } from './api/motis';
import { buildTasks, mergeOptions, runTask, windowBounds, type Task } from './core/search';
import { byTotal, describeOptions, groupByMainTrip, sortConns, type Conn, type SortKey } from './core/options';
import { probeSelect } from './core/probe';
import { findCandidates, TIER_LABEL } from './core/stations';
import type { Candidate, Option, SearchParams, SideKey } from './types';
import { esc, fmtDur } from './ui/format';
import { initForm, readParams, resolvePlaces, swapSides, writeParams } from './ui/form';
import { drawMap } from './ui/map';
import { domId, renderResults } from './ui/results';
import { drawTimeline } from './ui/timeline';
import { paramsFromUrl, paramsToUrl } from './ui/url';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('form');
const statusBox = $('status');
const statusText = $('status-text');
const bar = statusBox.querySelector('.bar') as HTMLDivElement;
const out = $('out');

let params: SearchParams | null = null;
let cands: Record<SideKey, Candidate[]> = { from: [], to: [] };
let candKey = '';
let options: Option[] = [];
let carDirectMin: number | null = null;
let ctrl: AbortController | null = null;
let failed = 0;
const sources = { efa: 0, transitous: 0 };

/* ---------- Suche ---------- */

/** Schlüssel der Einstellungen, die die Bahnhofsauswahl bestimmen. */
const sideKey = (p: SearchParams) =>
  JSON.stringify([p.from.place, p.from.radiusKm, p.from.maxStations, p.from.walk, p.from.car, p.to.place, p.to.radiusKm, p.to.maxStations, p.to.walk, p.to.car]);

async function search(opts: { keepCandidates?: boolean } = {}): Promise<void> {
  ctrl?.abort();
  const my = (ctrl = new AbortController());
  const signal = my.signal;
  showStatus('Adressen werden gesucht …', 0);
  try {
    await resolvePlaces();
    const p = readParams();
    params = p;
    history.replaceState(null, '', paramsToUrl(p));

    if (!opts.keepCandidates || sideKey(p) !== candKey) {
      showStatus('Bahnhöfe im Umkreis und Autozeiten werden ermittelt …', 0.02);
      const [f, t] = await Promise.all([findCandidates('from', p.from, signal), findCandidates('to', p.to, signal)]);
      cands = { from: f, to: t };
      candKey = sideKey(p);
      out.hidden = false;
      options = [];
      render();
      showStatus('Bahnhöfe werden nach Fahrzeit verglichen …', 0.05);
      await probeSelect(p, cands, signal, (done, total) =>
        showStatus(`Bahnhöfe werden nach Fahrzeit verglichen: ${done} von ${total}`, 0.05 + 0.25 * (done / total)),
      );
      carDirectMin = null;
      carTimes(p.from.place, [p.to.place], false, signal)
        .then(([sec]) => {
          carDirectMin = sec == null ? null : sec / 60;
          render();
        })
        .catch(() => undefined);
    }
    out.hidden = false;
    options = [];
    failed = 0;
    sources.efa = sources.transitous = 0;
    render();

    const tasks = buildTasks(p, cands.from, cands.to);
    if (!tasks.length) {
      showStatus('Keine Bahnhöfe ausgewählt.', 1, true);
      return;
    }
    await runPool(tasks, p, signal);
    if (signal.aborted) return;
    if (p.dticket) {
      // Vergleich mit Fernverkehr nur für die drei schnellsten Bahnhofspaare – spart Abfragen
      const pairs = new Map<string, Task>();
      for (const s of describeOptions(options).sort(byTotal)) {
        if (pairs.size >= 3) break;
        const k = `${s.o.id}|${s.d.id}`;
        if (!pairs.has(k)) pairs.set(k, { o: s.o, d: s.d, regional: false });
      }
      await runPool([...pairs.values()], p, signal, 'Vergleich mit Fernverkehr');
      if (signal.aborted) return;
    }
    const failNote = failed ? ` · ${failed} Abfragen fehlgeschlagen` : '';
    const srcNote = sources.transitous
      ? ` · Daten: EFA-BW für ${sources.efa}, Transitous (Ersatz) für ${sources.transitous} Paare`
      : ' · Daten: EFA-BW';
    showStatus(`Fertig: ${tasks.length} Bahnhofspaare abgefragt${srcNote}${failNote}.`, 1, true);
  } catch (e) {
    if (signal.aborted) return;
    showStatus(`Fehler: ${(e as Error).message}`, 1, true);
  }
}

async function runPool(tasks: Task[], p: SearchParams, signal: AbortSignal, what = 'Bahnhofspaare'): Promise<void> {
  let next = 0;
  let done = 0;
  const label = (t: Task) => `${t.o.name} → ${t.d.name}`;
  const worker = async () => {
    while (next < tasks.length && !signal.aborted) {
      const t = tasks[next++];
      try {
        const res = await runTask(t, p, signal);
        sources[res.source]++;
        options = mergeOptions([...options, ...res.options]);
      } catch (e) {
        if (signal.aborted) return;
        failed++;
        console.warn('Abfrage fehlgeschlagen', label(t), e);
      }
      done++;
      showStatus(`${what}: ${done} von ${tasks.length} · zuletzt ${label(t)}`, done / tasks.length);
      scheduleRender();
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

/* ---------- Darstellung ---------- */

let renderPending = false;
function scheduleRender(): void {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    render();
  });
}

function render(): void {
  if (!params) return;
  const p = params;
  const selected = new Set([
    ...cands.from.filter((c) => c.selected).map((c) => 'o:' + c.id),
    ...cands.to.filter((c) => c.selected).map((c) => 'd:' + c.id),
  ]);
  const visible = options.filter((o) => selected.has('o:' + o.o.id) && selected.has('d:' + o.d.id));
  const all = describeOptions(visible);
  const pool = p.dticket ? all.filter((s) => s.regionalOnly) : all;

  // bestes Ergebnis je Bahnhof für die Karte
  const best = new Map<string, Conn>();
  for (const s of pool) {
    for (const [k, c] of [[`from:${s.o.id}`, s.o], [`to:${s.d.id}`, s.d]] as const) {
      if (c.door) continue;
      const b = best.get(k);
      if (!b || byTotal(s, b) < 0) best.set(k, s);
    }
  }

  let list = pool;
  list = groupByMainTrip(list);
  list = sortConns(list, ($<HTMLSelectElement>('sort')).value as SortKey);

  drawMap(p, cands, best, toggleCandidate);
  renderStationTables(best);
  renderSummary(p, all, pool, list);
  drawTimeline($('timeline'), list, windowBounds(p).start, focusOption);
  renderResults($<HTMLOListElement>('results'), list);
}

function renderSummary(p: SearchParams, all: Conn[], pool: Conn[], list: Conn[]): void {
  const parts: string[] = [];
  if (!pool.length) {
    $('summary').innerHTML = carDirectMin && p.from.car ? `<span>Ganz mit dem Auto: <b>${fmtDur(carDirectMin)}</b></span>` : '';
    return;
  }
  const fastest = pool.reduce((a, b) => (b.totalMin < a.totalMin ? b : a));
  const fewest = Math.min(...pool.map((s) => s.itin.transfers));
  parts.push(`<span><b>${list.length}</b> Verbindungen</span>`);
  parts.push(`<span>schnellste: <b>${fmtDur(fastest.totalMin)}</b></span>`);
  parts.push(`<span>min. Umstiege: <b>${fewest}</b></span>`);
  if (p.dticket && all.length) {
    const fastAll = all.reduce((a, b) => (b.totalMin < a.totalMin ? b : a));
    const diff = fastest.totalMin - fastAll.totalMin;
    parts.push(
      diff > 0.5
        ? `<span>D-Ticket kostet <b>+${fmtDur(diff)}</b> ggü. schnellster mit Fernverkehr (${fmtDur(fastAll.totalMin)})</span>`
        : '<span>D-Ticket ohne Zeitverlust</span>',
    );
  }
  if (carDirectMin && p.from.car) parts.push(`<span>ganz mit dem Auto: <b>${fmtDur(carDirectMin)}</b></span>`);
  $('summary').innerHTML = parts.join('');
}

/** Bahnhofstabellen je Seite, sortiert nach Autozeit; der eingegebene Ort steht immer oben. */
function renderStationTables(best: Map<string, Conn>): void {
  const counts: string[] = [];
  for (const side of ['from', 'to'] as SideKey[]) {
    const list = cands[side];
    const rows = list
      .map((c, i) => ({ c, i }))
      .sort((a, b) => Number(b.c.door) - Number(a.c.door) || a.c.carSec - b.c.carSec);
    const body = rows
      .map(({ c, i }) => {
        const b = best.get(`${side}:${c.id}`);
        return (
          `<tr class="${c.selected ? 'on' : ''}"><td><input type="checkbox" class="st-check" data-side="${side}" data-i="${i}"` +
          `${c.selected ? ' checked' : ''} aria-label="${esc(c.name)} verwenden"></td>` +
          `<td>${esc(c.name)}</td><td class="muted">${c.door ? 'zu Fuß/Bus' : TIER_LABEL[c.tier]}</td>` +
          `<td class="num">${c.door ? '–' : fmtDur(c.carSec / 60)}</td>` +
          `<td class="num muted">${c.door ? '–' : `${c.distKm.toFixed(1).replace('.', ',')} km`}</td>` +
          `<td class="num">${
            b
              ? fmtDur(b.totalMin)
              : c.probeMin !== undefined
                ? `<span class="muted" title="Schätzung aus der Probeabfrage ab Fensterbeginn">≈${fmtDur(c.probeMin)}</span>`
                : ''
          }</td></tr>`
        );
      })
      .join('');
    $(`st-${side}`).innerHTML =
      '<thead><tr><th></th><th>Bahnhof</th><th>Art</th><th class="num">Auto</th><th class="num">Luftlinie</th>' +
      `<th class="num">beste</th></tr></thead><tbody>${body}</tbody>`;
    const n = list.filter((c) => !c.door).length;
    const sel = list.filter((c) => !c.door && c.selected).length;
    const label = side === 'from' ? 'Start' : 'Ziel';
    counts.push(params?.[side].car ? `${label}: ${sel} von ${n} gewählt` : `${label}: nur zu Fuß`);
  }
  $('st-count').textContent = `· ${counts.join(' · ')}`;
}

function toggleCandidate(_side: SideKey, c: Candidate): void {
  c.selected = !c.selected;
  search({ keepCandidates: true });
}

function focusOption(key: string): void {
  const li = document.getElementById(domId(key));
  if (!li) return;
  li.querySelector('details')!.open = true;
  li.scrollIntoView({ behavior: 'smooth', block: 'center' });
  li.classList.add('flash');
  setTimeout(() => li.classList.remove('flash'), 1200);
}

function showStatus(text: string, frac: number, finished = false): void {
  statusBox.hidden = false;
  statusText.textContent = text;
  bar.style.width = `${Math.round(frac * 100)}%`;
  $('cancel').hidden = finished;
}

/* ---------- Ereignisse ---------- */

initForm(() => undefined);

form.addEventListener('submit', (e) => {
  e.preventDefault();
  search({ keepCandidates: true });
});

$('swap').addEventListener('click', () => swapSides());

$('cancel').addEventListener('click', () => {
  ctrl?.abort();
  showStatus('Abgebrochen.', 1, true);
});

document.addEventListener('change', (e) => {
  const box = e.target as HTMLInputElement;
  if (!box.classList?.contains('st-check')) return;
  const side = box.dataset.side as SideKey;
  toggleCandidate(side, cands[side][Number(box.dataset.i)]);
});

$('sort').addEventListener('change', render);
let resizeTimer = 0;
let lastWidth = window.innerWidth;
window.addEventListener('resize', () => {
  // Handy: Ein-/Ausblenden der Adressleiste ändert nur die Höhe – dann nichts neu zeichnen
  if (window.innerWidth === lastWidth) return;
  lastWidth = window.innerWidth;
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(render, 200);
});

const fromUrl = paramsFromUrl();
if (fromUrl) {
  if (!fromUrl.date) fromUrl.date = readParams().date;
  writeParams(fromUrl);
  search();
}
