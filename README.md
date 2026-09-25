# Forno Amici

Eine selbst gehostete Pizza-Party-App: Gäste stellen einzelne Pizzen zusammen, der Bäcker sieht die Warteschlange live und meldet fertige Pizzen zurück. Die Oberfläche ist deutsch, für Smartphones und Tablets gestaltet und benötigt keine Gastkonten.

## Lokal starten

Voraussetzung: Node.js 22.12 oder neuer (empfohlen: aktuelles Node 22 LTS), npm und PostgreSQL. Dieses Repository enthält außerdem eine optionale lokale PostgreSQL-Instanz für Entwicklung ohne Docker.

```sh
npm ci
cp .env.example .env
```

In `.env` `BAKER_PASSWORD` (mindestens 16 Zeichen) und `SESSION_SECRET` (mindestens 32 Zeichen) setzen. Zufällige Werte erzeugen:

```sh
openssl rand -hex 24
openssl rand -hex 32
```

Für die mitgelieferte lokale Datenbank in einem eigenen Terminal:

```sh
npm run db:local
```

Dabei läuft PostgreSQL ausschließlich auf `127.0.0.1:55432`. Die Entwicklungsdaten liegen unter `.local/postgres`, bleiben nach dem Stoppen erhalten und sind von Git ausgeschlossen. Das feste Passwort dieser **lokalen** Hilfsdatenbank ist kein Produktionspasswort. Konfiguration:

```dotenv
DATABASE_URL=postgresql://forno:local-development-only@127.0.0.1:55432/forno
APP_ORIGIN=http://localhost:3000
```

Anschließend:

```sh
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Öffne `http://localhost:3000` für Gäste und `http://localhost:3000/baecker` für den Bäcker. Das Bäckerpasswort steht in deiner lokalen `.env`. Gast und Bäcker auf demselben Gerät in getrennten Browserprofilen bzw. einem privaten Fenster öffnen: Ein Browserprofil hat jeweils eine aktive Rolle.

Für Tests mit dem Smartphone im eigenen WLAN `APP_ORIGIN` auf die tatsächlich verwendete Adresse ändern (z. B. `http://192.168.1.20:3000`). Alle Clients müssen diese Adresse verwenden. Für den regulären Betrieb HTTPS verwenden.

## Funktionen

- Party erstellen, sechsstelligen Gruppencode teilen, aktive und beendete Partys wieder öffnen.
- Gastname und Party bleiben mit signiertem HttpOnly-Cookie 30 Tage erhalten.
- Beläge frei auswählen; je Belag genau eine Position: ganze Pizza, linke oder rechte Hälfte.
- Für jeden gewählten Käse: wenig, mittel oder viel. Auch eine Pizza ohne Belag ist möglich.
- Vor dem Absenden die nach Positionen gruppierte Zusammenfassung prüfen.
- Eigene Bestellungen mit Nummer und Status verfolgen; weitere einzelne Pizzen bestellen.
- Bäcker sieht offene Pizzen strikt nach Bestellnummer/Eingang; ein Tap auf „Fertig“, Rückgängig über „Erledigt → Wieder öffnen“.
- Zutaten pro Party umschalten. Bereits bestellte Beläge bleiben unverändert.
- Partyende sperrt Beitritt und neue Bestellungen. Offene Pizzen können weiter abgearbeitet werden.
- Visuelle Fertigmeldung; optional nach einem Nutzertap Ton und Browser-Benachrichtigung.

## Architektur und Entscheidungen

**Next.js 16.3.6 App Router, React 19.3, TypeScript strict, Tailwind CSS 4, Prisma 7.10 und PostgreSQL.** Exakte aufgelöste Paketversionen stehen im Lockfile. Prisma 7 ist bewusst stabil gewählt; die zum Implementierungszeitpunkt als `latest` markierte Prisma-8-Vorabversion wird nicht verwendet. Produktionsbuilds verwenden den von Next.js unterstützten Webpack-Bundler, da Turbopack in der lokalen Build-Umgebung beim CSS-Hilfsprozess blockiert wurde. Keine externen Laufzeitdienste, keine Analytics, keine kostenpflichtige Echtzeitplattform.

- `src/app`: Seiten, HTTP-API, Healthcheck und SSE-Endpunkt.
- `src/components`: gemeinsame Oberflächenelemente und Bestellkarten.
- `src/lib/domain.ts`: zentrale Zod-Schemas und fachliche Validierung.
- `src/lib/service.ts`: Transaktionen, Bestellungen, Snapshots und datenbankgestütztes Rate Limiting.
- `src/lib/auth.ts`: signierte Sessions, Bäckeranmeldung und Origin-Prüfung.
- `src/lib/client.ts`: API-Client und Live-Synchronisierung.
- `prisma`: Schema, versionierte Initialmigration und wiederholbar ausführbarer Seed.
- `tests`: Fachtests, echte PostgreSQL-Integrationstests und Browser-End-to-End-Tests.

Produktname und Slogan werden zentral in `src/lib/config.ts` geändert. Standardzutaten/Kategorien stehen in `prisma/seed.ts`. Stabile Zutaten-IDs nicht für andere Zutaten wiederverwenden. Ein erneuter Seed aktualisiert den Katalog für neue Partys; bestehende Partys behalten ihre Zutatenzuordnung. Historische Bestellungen enthalten eigene Namens- und Kategorie-Snapshots.

### Echtzeit

Server-Sent Events unter `/api/events` übertragen ausschließlich die Revision der autorisierten Party. Der Server prüft diese alle 1,5 Sekunden in PostgreSQL; nach einer Änderung lädt der Client einen konsistenten Snapshot. Dadurch funktionieren auch mehrere App-Prozesse ohne Redis oder prozesslokalen Event-Bus. `EventSource` verbindet sich automatisch neu. Zusätzlich lädt der Client alle acht Sekunden, beim Wiederherstellen der Verbindung und beim Zurückkehren zum Tab den aktuellen Datenstand. Eine Live-Verbindungsanzeige macht Unterbrechungen sichtbar. PostgreSQL ist immer die Source of Truth.

Dieses Verfahren ist auf private Runden ausgelegt. Die Datenbankabfragen wachsen mit der Zahl offener Browser-Tabs. Für sehr viele gleichzeitige Gäste wäre ein zentraler Pub/Sub-Mechanismus sinnvoll. Der Docker-Betrieb verwendet einen App-Prozess; kein Serverless-Hosting erforderlich.

### Konsistenz und Doppelbestellungen

Alle Bestell-, Verfügbarkeits- und Partyende-Mutationen sperren dieselbe Partyzeile mit `SELECT … FOR UPDATE`. Validierung, Vergabe der nächsten Bestellnummer und Speicherung erfolgen gemeinsam in einer Transaktion. Die Sperre verhindert sowohl doppelte Nummern als auch Rennen zwischen Deaktivieren einer Zutat und Bestellen. Bestellnummern bilden die verbindliche Eingangsreihenfolge; ein Datenbank-Unique-Constraint sichert sie zusätzlich.

Jede Bestellanfrage erhält eine UUID als Idempotency-Key. Diese wird vor dem Senden mit der Auswahl lokal gespeichert. Bei unklarem Netzwerkergebnis bleibt die Anfrage bestehen, auch nach einem Reload. „Bestellung prüfen“ wiederholt exakt diese Anfrage; bereits gespeicherte Bestellungen werden zurückgegeben, auch wenn die Party inzwischen beendet oder eine Zutat deaktiviert ist. Unterschiedliche Nutzdaten mit gleichem Key werden abgewiesen. Ein neuer Key entsteht erst nach bestätigtem Erfolg oder einer eindeutigen Validierungsablehnung. Die DB erzwingt Eindeutigkeit je Gast/Key.

### Sicherheit

Der Bäcker meldet sich mit dem ausschließlich serverseitig gespeicherten `BAKER_PASSWORD` an. Diese einfache Host-Rolle verwaltet alle Partys dieser Installation. Der Gruppencode verleiht **keine** Verwaltungsrechte. Gast-Snapshots und SSE-Zugriff sind an die Gast-Session gebunden; Gäste können keine fremden Bestellungen abrufen.

Sessions werden mit HMAC-SHA256 signiert, sind HttpOnly und SameSite=Lax und bei HTTPS zusätzlich Secure. Passwortvergleiche erfolgen über gleichlange HMAC-Werte mit zeitkonstantem Vergleich. Es gibt kein Passwort-Reset per E-Mail. Passwort in `.env` ändern und App neu erstellen; um bereits ausgestellte Sessions zu widerrufen, zusätzlich `SESSION_SECRET` wechseln (meldet auch Gäste ab).

Alle schreibenden API-Aufrufe prüfen `Origin` gegen `APP_ORIGIN`. Serverseitige Zod- und Datenbankvalidierung ist verbindlich. React maskiert Benutzereingaben. Login ist auf 8 Versuche/Minute/IP, Beitritt auf 30/Minute/IP, neue Partys auf 10/Minute/IP und Bestellanfragen auf 15/Minute/Gast begrenzt. Rate-Limit-Zähler liegen in PostgreSQL und funktionieren über Prozessneustarts hinweg. Caddy überschreibt `X-Real-IP`; den App-Port nicht direkt öffentlich freigeben. Bei einem anderen Reverse Proxy unbedingt denselben Schutz übernehmen. Unter direktem lokalen Zugriff teilen Anfragen ohne Proxy-IP einen gemeinsamen Grenzwert.

`npm audit` meldete nach Aktualisierung der indirekten Prisma-Abhängigkeiten keine bekannten Schwachstellen. Die Overrides für `deepmerge-ts` und `mysql2` in `package.json` halten korrigierte Versionen fest; nach Prisma-Updates erneut prüfen.

## Tests

Fachtests ohne Datenbank:

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

Für Integrationstests eine **separate** Datenbank `forno_test` verwenden. Der lokale Datenbankstarter legt sie automatisch an. Die Tests brechen ab, wenn die URL nicht auf `forno_test` verweist.

```sh
DATABASE_URL=postgresql://forno:local-development-only@127.0.0.1:55432/forno_test npm run db:migrate
DATABASE_URL=postgresql://forno:local-development-only@127.0.0.1:55432/forno_test npm run test:integration
npx playwright install chromium
DATABASE_URL=postgresql://forno:local-development-only@127.0.0.1:55432/forno_test npm run test:e2e
```

Playwright startet einen Entwicklungsserver selbst. Mit `E2E_PRODUCTION=1` wird stattdessen ein zuvor erzeugter Standalone-Produktionsbuild gestartet. Auf Port 3000 darf dabei kein anderer Server mit einer anderen Datenbank laufen. Der Browser-Test nutzt separate Gast-/Bäckerprofile, prüft den vollständigen Ablauf einschließlich Hälften, Käsemenge, Live-Fertigmeldung, Undo, Reload, Zutatenverfügbarkeit, Partyende, Wiederverbindung und eine nach dem Speichern verlorene Bestellantwort mit anschließendem Reload. Zusätzlich werden nicht autorisierte Admin-Aufrufe und fremde Origins getestet. Integrationstests prüfen außerdem zwölf parallele Bestellungen und sechs parallele Wiederholungen derselben Anfrage. Browser-Tests hinterlassen beendete Testpartys ausschließlich in der Testdatenbank. Screenshots und Fehler-Traces liegen unter `test-results/` (nicht in Git).

### Durchgeführte Prüfung

Am 25.09.2026 erfolgreich ausgeführt: 3 Fachtests, 7 PostgreSQL-Integrationstests und 3 Playwright-Tests gegen den Standalone-Produktionsserver. TypeScript, ESLint, Formatprüfung und Produktionsbuild bestanden; `npm audit` meldete 0 bekannte Schwachstellen. Smartphone-, Desktop- und Tablet-Screenshots wurden kontrolliert. Die Initialmigration und 17 Seed-Zutaten wurden in der lokalen Entwicklungs- und Testdatenbank eingespielt.

Compose-YAML und Backup-Shellskript wurden auf Syntax geprüft. Docker ist in der Entwicklungsumgebung nicht installiert; Container-Build, Caddy-Zertifikatsausstellung und tatsächlicher VPS-Betrieb wurden deshalb hier nicht ausgeführt.

## Hostinger-VPS mit Docker Compose

Benötigt werden ein Linux-VPS (z. B. Ubuntu 24.04), Docker Engine mit Compose-v2-Plugin, Git und eine Domain/Subdomain. Für Builds mindestens 2 GB RAM plus Swap einplanen. Die App benötigt keine speziellen Hostinger-Dienste.

1. DNS-A-Record (ggf. auch korrekten AAAA-Record) deiner Subdomain auf die VPS-IP setzen. In der VPS-Firewall SSH, TCP 80 und TCP 443 öffnen; UDP 443 ist optional. PostgreSQL-Port 5432 und App-Port 3000 bleiben intern.
2. Projekt per Git oder Dateitransfer auf den VPS bringen, in den Projektordner wechseln.
3. Produktionskonfiguration anlegen:

```sh
cp .env.example .env
chmod 600 .env
openssl rand -hex 24
openssl rand -hex 32
```

Folgende Werte in `.env` setzen:

| Variable            | Bedeutung                                                                             |
| ------------------- | ------------------------------------------------------------------------------------- |
| `DOMAIN`            | Eigene Subdomain ohne Schema, z. B. `pizza.example.com`                               |
| `POSTGRES_PASSWORD` | Eigenes zufälliges DB-Passwort; Hex-Zeichen vermeiden URL-Escaping-Probleme           |
| `BAKER_PASSWORD`    | Eigenes starkes Passwort, mindestens 16 Zeichen                                       |
| `SESSION_SECRET`    | Zufälliger Signaturschlüssel, z. B. 64 Hex-Zeichen                                    |
| `APP_ORIGIN`        | Bei Betrieb ohne Compose die exakte öffentliche Origin, lokal `http://localhost:3000` |
| `DATABASE_URL`      | Bei Betrieb ohne Compose die PostgreSQL-Verbindungs-URL                               |

Compose setzt `APP_ORIGIN=https://${DOMAIN}` und `DATABASE_URL` selbst aus dem internen DB-Service und `POSTGRES_PASSWORD`. Lokale Werte dieser beiden Variablen werden im Container nicht übernommen. In Produktion unbedingt neue Secrets verwenden. Alle `.env`-Dateien sind von Git und Docker-Build-Kontext ausgeschlossen.

4. Starten:

```sh
docker compose up -d --build
docker compose ps -a
docker compose logs --tail=100 migrate app caddy
```

Der einmalige `migrate`-Container wartet auf PostgreSQL, spielt `prisma migrate deploy` ein und führt den Seed aus. Erst bei Erfolg startet die App. Ein erfolgreicher `migrate`-Container steht danach auf `Exited (0)` – das ist beabsichtigt. Caddy startet nach erfolgreichem App-Healthcheck und besorgt/erneuert HTTPS-Zertifikate automatisch. Voraussetzung sind korrektes DNS und erreichbare Ports 80/443.

5. `https://DEINE-DOMAIN/baecker` öffnen, mit `BAKER_PASSWORD` anmelden und eine Party erstellen. Gäste öffnen die Startseite und geben den angezeigten Code ein.

### Betrieb und Updates

```sh
# Logs
docker compose logs -f --tail=100 app
# App neu starten
docker compose restart app
# Nach Änderungen an .env Container neu erstellen
docker compose up -d --force-recreate app
# Update: zuerst Backup, dann neuen Code holen und neu bauen
./scripts/backup.sh
git pull --ff-only
docker compose up -d --build
```

Die App läuft als unprivilegierter `node`-Benutzer. Der öffentliche Zugang erfolgt ausschließlich über Caddy; Datenbank und App haben keine veröffentlichten Host-Ports. `Caddyfile` enthält HTTPS, Sicherheitsheader, Größenlimit für Requests und sofortiges Weiterreichen von SSE-Daten. Der Healthcheck `/api/health` prüft die DB-Verbindung, ohne Daten oder Secrets auszugeben.

Daten liegen dauerhaft in `postgres_data`, Zertifikate in `caddy_data` und Caddy-Konfiguration in `caddy_config`. `docker compose down` erhält diese Volumes; **`docker compose down -v` löscht sie**. Ein geändertes `POSTGRES_PASSWORD` aktualisiert ein bereits initialisiertes PostgreSQL-Volume nicht automatisch; das DB-Passwort muss dann auch innerhalb von PostgreSQL geändert werden.

### Backup und Restore

```sh
./scripts/backup.sh
```

Das Skript erzeugt ein PostgreSQL-Custom-Format-Backup mit restriktiven Dateirechten unter `backups/`. Täglich per Cron ausführen (mit `cd` in den Projektordner), verschlüsselt auf einen anderen Host kopieren und Wiederherstellung regelmäßig testen. Ein VPS-Snapshot allein ersetzt kein externes Datenbankbackup. `.env` und Secrets separat sicher aufbewahren.

Wiederherstellung in eine leere bzw. bewusst zu ersetzende Datenbank, während die App gestoppt ist:

```sh
docker compose stop app
docker compose exec -T db pg_restore -U forno -d forno --clean --if-exists --no-owner < backups/DEIN-BACKUP.dump
docker compose start app
```

Ohne Docker: PostgreSQL bereitstellen, `.env` konfigurieren, `npm ci`, `npm run db:generate`, `npm run db:migrate`, `npm run db:seed`, `npm run build`, `npm start`. Den Prozess über systemd betreiben und Caddy mit `reverse_proxy 127.0.0.1:3000` davor setzen; dabei `X-Real-IP` wie in der mitgelieferten Konfiguration überschreiben. Node-Port per Firewall auf lokale Zugriffe beschränken.

## Grenzen

- Ton und Browser-Benachrichtigungen hängen von Browserberechtigungen, Sichtbarkeit und Autoplay-Regeln ab. Keine Push-Mitteilung bei geschlossenem Browser; der sichtbare Bestellstatus ist die zuverlässige Basis.
- Eine Gastidentität ist an ein Browserprofil gebunden. Nach Löschen der Cookies kann sie ohne Benutzerkonto nicht wiederhergestellt werden. Ein erneuter Beitritt erzeugt einen neuen Gast, bestehende Bestellungen bleiben beim Bäcker sichtbar.
- Der einfache Bäckerzugang gilt installationsweit, nicht für voneinander getrennte öffentliche Veranstalter.
- Keine automatische Löschung alter Partys; Aufbewahrung und Backups verwaltet der Betreiber. Bestellungen enthalten Gastnamen.
- Das lokale PostgreSQL-Hilfspaket ist ausschließlich für Entwicklung vorgesehen; der VPS verwendet das offizielle PostgreSQL-Image.
- Docker/HTTPS-Konfiguration ist vorbereitet; der tatsächliche Hostinger-Start benötigt deine Domain, Secrets und VPS-Zugangsdaten.

## Git

Repository auf Branch `main` vorbereitet. `.gitignore` schließt Abhängigkeiten, Builds, echte `.env`-Dateien, lokale Datenbanken, Backups und Testartefakte aus. Vor dem ersten Push:

```sh
git add .
git commit -m "Implement Forno Amici pizza party app"
git remote add origin DEINE_GITHUB_REPOSITORY_URL
git push -u origin main
```
