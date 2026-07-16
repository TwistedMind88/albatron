# Albatron

Poslovna (ERP) aplikacija za upravljanje artiklima, cenovnicima, dokumentima (ponude, predracuni, fakture), projektima i izvestajima. Visekorisnicki sistem sa nalozima, privilegijama i logovanjem izmena. Server radi na Ubuntu ili Windows serveru; klijenti pristupaju preko web pregledaca ili nativne Windows aplikacije.

## Zahtevi

- Ubuntu Server 22.04 ili 24.04 (za Windows server videti rucnu instalaciju)
- Node.js 22+
- PostgreSQL 16+
- pnpm 9+

Instalaciona skripta sama proverava i instalira sve navedeno.

## Brza instalacija (Ubuntu)

```bash
curl -fsSL https://raw.githubusercontent.com/TwistedMind88/albatron/main/scripts/install.sh -o install.sh
sudo bash install.sh
```

Skripta je interaktivna i vodi kroz ceo postupak:

- provera i instalacija preduslova (Node.js, PostgreSQL, pnpm)
- izbor instalacionog direktorijuma (podrazumevano `/opt/albatron`) i porta (podrazumevano `3000`)
- kreiranje baze podataka i korisnika baze (unosis ime i lozinku)
- automatsko generisanje `.env` fajla sa tajnim kljucem sesije
- kreiranje sistemskog korisnika `albatron` pod kojim servis radi
- systemd servis (`albatron`) koji se sam pokrece pri boot-u
- opciono: otvaranje porta u UFW firewall-u i dnevni backup baze i fajlova
- podrska za rad iza HTTP proxyja tokom instalacije

Posle instalacije aplikacija je dostupna na `http://ADRESA-SERVERA:3000`. Prva prijava: `admin` / `admin123` - lozinku promeni odmah.

## Update

Pokreni istu skriptu ponovo na serveru:

```bash
sudo bash install.sh
```

Skripta prepoznaje postojecu instalaciju, povlaci najnoviju objavljenu verziju (release tag), ponovo gradi aplikaciju, pokrece migracije baze i restartuje servis. Podesavanja i podaci ostaju netaknuti.

## Pristup preko mreze i domena

Server slusa na svim mreznim adresama (`0.0.0.0`), pa je aplikacija odmah dostupna sa drugih racunara u mrezi preko IP adrese servera.

Za pristup preko domena sa HTTPS-om postavi reverse proxy (nginx, Caddy) ili Cloudflare ispred servera i uperi ga na port aplikacije. TLS se terminira na proxyju; aplikacija podrzava `X-Forwarded` zaglavlja. Pri instalaciji u tom slucaju izaberi HTTPS rezim pristupa (ukljucuje secure kolacice).

## Windows desktop klijent

Nativna Windows aplikacija (instaler `.msi` / `.exe`) se preuzima sa [Releases](https://github.com/TwistedMind88/albatron/releases) stranice. Pri prvom pokretanju unosi se adresa servera.

## Rucna instalacija

Ako ne koristis skriptu, koraci su:

1. Instaliraj PostgreSQL 16+, Node.js 22+ i pnpm 9+.
2. Kreiraj bazu i korisnika baze: `CREATE ROLE albatron LOGIN PASSWORD '...'; CREATE DATABASE albatron OWNER albatron;`
3. Kloniraj repo u `/opt/albatron` i predji na poslednji release tag.
4. Napravi `/opt/albatron/.env` po uzoru na `.env.example` (obavezno promeni `DATABASE_URL` i `SESSION_COOKIE_SECRET`, dodaj `FILE_STORAGE=/opt/albatron/storage`).
5. `pnpm install --frozen-lockfile`, zatim `pnpm --filter @albatron/server --filter @albatron/web build`
6. Iz `apps/server`: `pnpm db:migrate` pa `pnpm db:seed` (seed samo pri prvoj instalaciji).
7. Pokreni server: `node --env-file=/opt/albatron/.env apps/server/dist/index.js` (ili napravi systemd servis kao u skripti).

## Licenca

Videti [LICENSE](LICENSE).
