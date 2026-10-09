# Weihnachten-nach-Hause-App

Statische Website: Bahnverbindungen von/zu **allen Bahnhöfen im Umkreis** einer Adresse über ein ganzes
Zeitfenster, inklusive Autozeit zum Bahnhof (Abholung, Carsharing). Aufteilung Bahn-/Autozeit,
D-Ticket-Modus, Karte, Tages-Zeitstrahl, teilbarer Link.

Live: https://michaelwittemann-star.github.io/weihnachten-nach-hause/

## Entwicklung

```
npm install
npm run dev      # lokal
npm run build    # Typprüfung + Build nach dist/
npm run deploy   # Build + Veröffentlichung auf GitHub Pages (gh-pages-Branch, ohne Jekyll)
```

## Datenquellen

Alle Abfragen gehen direkt aus dem Browser (CORS offen), ohne eigenen Server:

- **Verbindungen: EFA-BW** (`www.efa-bw.de/nvbw/XML_TRIP_REQUEST2`, Landesauskunft Baden-Württemberg/NVBW).
  Deutschlandweite Fahrpläne, aber genauere Umstiegswege (Stuttgart Hbf Klett-Platz → Fernbahn 10 min statt 4
  bei Transitous wegen S21-Baustelle). Haltestellen-ID = DHID aus der Transitous-ID (`de-DELFI_de:09561:11000:…`
  → `de:09561:11000`), Adressen als Koordinate. 10 Verbindungen je Abfrage, weitergeblättert ab letzter Abfahrt.
  D-Ticket: `lineRestriction=403`. Keine offizielle Freigabe – kann jederzeit gesperrt werden.
- **Ersatz für Verbindungen + Adresssuche, Bahnhöfe im Umkreis, Autozeiten: Transitous/MOTIS**
  (`api.transitous.org`). Schlägt eine EFA-Abfrage fehl, wird das Bahnhofspaar automatisch bei Transitous gerechnet
  (Hinweis in Statuszeile und je Verbindung).
  Nutzungsbedingungen: nur nicht-kommerziell, sparsam; Pflicht-Hinweis auf https://transitous.org/sources/.
- Gedrosselt auf ≤ 1 neue Anfrage/s je Server, Ergebnisse 6 h im `localStorage` zwischengespeichert.
- Keine Preise. db-rest / DB direkt (db-vendo-client) sind seit Mai 2026 gesperrt – auch von Privatanschlüssen
  getestet (OPS_BLOCKED/403).

## Aufbau

- `src/api/` – HTTP mit Drosselung/Retry/Cache je Server, `efa.ts` (Verbindungen), `motis.ts` (Transitous)
- `src/core/stations.ts` – Bahnhöfe im Umkreis, Rangfolge (Autozeit − 8 min je Verkehrsstufe), gestreute Vorauswahl
- `src/core/search.ts` – Abfragen je Bahnhofspaar, Zeitfenster, Seitenweise
- `src/core/options.ts` – Kennzahlen je Verbindung, knappe Umstiege (< 6 min), Pareto-Filter („nur sinnvolle“), Zusammenfassen gleicher Hauptzüge
- `src/ui/` – Formular, Karte (Leaflet/OSM), Zeitstrahl (SVG), Ergebnisliste, URL-Zustand
