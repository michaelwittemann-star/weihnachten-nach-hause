export function fmtDur(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} h`;
}

export function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

const MODE_LABEL: Record<string, string> = {
  HIGHSPEED_RAIL: 'Fernzug',
  LONG_DISTANCE: 'Fernzug',
  NIGHT_RAIL: 'Nachtzug',
  REGIONAL_RAIL: 'Regionalzug',
  REGIONAL_FAST_RAIL: 'Regionalzug',
  SUBURBAN: 'S-Bahn',
  SUBWAY: 'U-Bahn',
  TRAM: 'Straßenbahn',
  BUS: 'Bus',
  COACH: 'Fernbus',
  FERRY: 'Fähre',
  WALK: 'Fußweg',
};

export const modeLabel = (m: string) => MODE_LABEL[m] ?? m;

/** Zubringer: Beschriftung und CSS-Klasse (Farbe). */
export const ACCESS_LABEL = { car: 'Auto', bike: 'Fahrrad', walk: 'zu Fuß' } as const;

/** "Bahn/ÖPNV 1:10 h · Auto 12 min · Fahrrad 8 min" – nur vorhandene Teile. */
export function splitText(transitMin: number, carMin: number, bikeMin: number): string {
  const parts = [`Bahn/ÖPNV ${fmtDur(transitMin)}`];
  if (carMin > 0) parts.push(`Auto ${fmtDur(carMin)}`);
  if (bikeMin > 0) parts.push(`Fahrrad ${fmtDur(bikeMin)}`);
  return parts.join(' · ');
}
