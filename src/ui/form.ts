import { geocode } from '../api/motis';
import type { Place, SearchParams, SideKey, SideParams } from '../types';

/** So viele weiter entfernte Bahnhöfe werden je Seite vorausgewählt (nahe kommen dazu). */
const MAX_STATIONS = 10;

const form = document.getElementById('form') as HTMLFormElement;
const el = <T extends HTMLElement = HTMLInputElement>(name: string) => form.elements.namedItem(name) as unknown as T;

/** Gewählte Orte; der Text im Eingabefeld allein reicht nicht. */
const chosen: Record<SideKey, Place | null> = { from: null, to: null };

export function initForm(onChange: () => void): void {
  const today = new Date();
  today.setDate(today.getDate() + 1);
  el('date').value = isoDate(today);
  (['from', 'to'] as SideKey[]).forEach((side) => {
    initAutocomplete(side, onChange);
    for (const m of ['walk', 'car']) el(`${side}-${m}`).addEventListener('change', () => syncAccess(side));
    syncAccess(side);
  });
  form.addEventListener('input', onChange);
}

function initAutocomplete(side: SideKey, onChange: () => void): void {
  const input = el(`${side}-q`);
  const list = input.parentElement!.querySelector('.suggest') as HTMLUListElement;
  let timer = 0;
  let ctrl: AbortController | null = null;
  let items: Place[] = [];
  let active = -1;

  const close = () => {
    list.hidden = true;
    active = -1;
  };
  const pick = (p: Place) => {
    chosen[side] = p;
    input.value = p.name;
    input.setCustomValidity('');
    close();
    onChange();
  };
  const render = () => {
    list.innerHTML = '';
    items.forEach((p, i) => {
      const li = document.createElement('li');
      li.textContent = p.name;
      li.className = i === active ? 'active' : '';
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        pick(p);
      });
      list.append(li);
    });
    list.hidden = items.length === 0;
  };

  input.addEventListener('input', () => {
    chosen[side] = null;
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 3) return close();
    timer = window.setTimeout(async () => {
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        items = await geocode(q, ctrl.signal);
        active = -1;
        render();
      } catch {
        /* Tippfehler oder Abbruch – ignorieren */
      }
    }, 350);
  });
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      render();
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      pick(items[active]);
    } else if (e.key === 'Escape') close();
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
}

/** Umkreis-Felder nur mit Auto aktiv; mindestens ein Zugangsweg muss gewählt sein. */
function syncAccess(side: SideKey): void {
  const walk = el(`${side}-walk`);
  const car = el(`${side}-car`);
  el(`${side}-r`).disabled = !car.checked;
  walk.closest('.side')!.classList.toggle('no-car', !car.checked);
  walk.setCustomValidity(walk.checked || car.checked ? '' : 'Bitte „zu Fuß“ oder „Auto“ wählen');
}

/** Falls der Nutzer nichts aus der Liste gewählt hat: ersten Treffer nehmen. */
export async function resolvePlaces(): Promise<void> {
  for (const side of ['from', 'to'] as SideKey[]) {
    if (chosen[side]) continue;
    const input = el(`${side}-q`);
    const res = await geocode(input.value.trim());
    if (!res.length) {
      input.setCustomValidity('Adresse nicht gefunden');
      input.reportValidity();
      throw new Error(`${side === 'from' ? 'Start' : 'Ziel'}: Adresse nicht gefunden`);
    }
    chosen[side] = res[0];
    input.value = res[0].name;
  }
}

function readSide(side: SideKey): SideParams {
  return {
    place: chosen[side]!,
    radiusKm: Number(el(`${side}-r`).value) || 0,
    maxStations: MAX_STATIONS,
    walk: el(`${side}-walk`).checked,
    car: el(`${side}-car`).checked,
  };
}

export function readParams(): SearchParams {
  return {
    from: readSide('from'),
    to: readSide('to'),
    date: el('date').value,
    t0: el('t0').value,
    t1: el('t1').value,
    dticket: el('dt').checked,
    minTransfer: Number(el('mt').value) || 0,
  };
}

function writeSide(side: SideKey, s: SideParams): void {
  chosen[side] = s.place;
  el(`${side}-q`).value = s.place.name;
  el(`${side}-r`).value = String(s.radiusKm);
  el(`${side}-walk`).checked = s.walk;
  el(`${side}-car`).checked = s.car;
  syncAccess(side);
}

export function writeParams(p: SearchParams): void {
  writeSide('from', p.from);
  writeSide('to', p.to);
  el('date').value = p.date;
  el('t0').value = p.t0;
  el('t1').value = p.t1;
  el('dt').checked = p.dticket;
  el('mt').value = String(p.minTransfer);
}

/** Start und Ziel samt Umkreis-Einstellungen tauschen. */
export function swapSides(): void {
  if (!chosen.from || !chosen.to) return;
  const p = readParams();
  writeParams({ ...p, from: p.to, to: p.from });
}

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
