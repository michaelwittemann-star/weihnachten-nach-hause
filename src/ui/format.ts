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
