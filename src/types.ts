export type SideKey = 'from' | 'to';

export interface Place {
  name: string;
  lat: number;
  lon: number;
  stopId?: string; // gesetzt, wenn der Ort selbst eine Haltestelle ist
}

export interface SideParams {
  place: Place;
  radiusKm: number;
  maxStations: number;
  walk: boolean; // Weg ab/bis Adresse zu Fuß (+ Bus/Tram)
  bike: boolean; // Bahnhöfe im Umkreis per Fahrrad
  car: boolean; // Bahnhöfe im Umkreis per Auto
}

/** Wie man zwischen Adresse und Bahnhof kommt. */
export type Access = 'walk' | 'bike' | 'car';

export interface SearchParams {
  from: SideParams;
  to: SideParams;
  date: string; // YYYY-MM-DD
  t0: string; // HH:MM
  t1: string;
  dticket: boolean;
  arrive: boolean; // Zeitfenster gilt für die Ankunft statt die Abfahrt
  minTransfer: number;
  bikeKmh: number; // angenommenes Fahrradtempo
}

/** Ein Bahnhof im Umkreis (oder die Adresse selbst, `door`). */
export interface Candidate {
  id: string; // eindeutig: 'door' oder '<access>:<stopId>'
  name: string;
  lat: number;
  lon: number;
  tier: number; // 3 Fernverkehr, 2 Regional, 1 S-Bahn, 0 Adresse
  distKm: number;
  access: Access; // Zubringer: Auto, Fahrrad oder (bei door) zu Fuß
  accessSec: number; // Zubringerzeit Adresse <-> Bahnhof
  door: boolean;
  selected: boolean;
  stopId?: string; // Haltestellen-ID (bei door nur, wenn der eingegebene Ort eine Haltestelle ist)
  placeName: string; // oben eingegebener Start/Ziel-Name
  probeMin?: number; // schnellste Gesamtzeit aus der Probeabfrage
}

export interface Leg {
  mode: string;
  line: string;
  from: string;
  to: string;
  dep: number; // ms epoch (Prognose, falls Echtzeit)
  arr: number;
  delayMin: number;
  realTime: boolean;
  cancelled: boolean;
  tripId?: string;
  headsign?: string;
  track?: string;
}

export interface Itin {
  dep: number;
  arr: number;
  transfers: number;
  legs: Leg[];
}

/** Eine Tür-zu-Tür-Option: Zubringer + ÖPNV-Verbindung + Zubringer. */
export interface Option {
  key: string;
  o: Candidate;
  d: Candidate;
  itin: Itin;
  accessOutSec: number;
  accessInSec: number;
  doorDep: number;
  doorArr: number;
  regionalOnly: boolean;
  source: 'efa' | 'transitous'; // Herkunft der Verbindung
}
