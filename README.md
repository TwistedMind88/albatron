# Albatron

Poslovna (ERP) aplikacija za upravljanje artiklima, cenovnicima, dokumentima (ponude, predračuni, fakture), projektima i izveštajima. Višekorisnički sistem sa nalozima, privilegijama i logovanjem izmena. Server radi na Ubuntu ili Windows serveru; klijenti pristupaju preko web pregledača ili nativne Windows aplikacije.

## Zahtevi

- Ubuntu Server 22.04 / 24.04 ili Windows Server 2022+ (radi i na Windows 10/11)
- Node.js 22+
- PostgreSQL 16+
- pnpm 9+

Instalacione skripte same proveravaju i instaliraju sve navedeno.

## Brza instalacija (Ubuntu)

```bash
curl -fsSL https://raw.githubusercontent.com/TwistedMind88/albatron/main/scripts/install.sh -o install.sh
sudo bash install.sh
```

Skripta je interaktivna i vodi kroz ceo postupak:

- provera i instalacija preduslova (Node.js, PostgreSQL, pnpm)
- izbor instalacionog direktorijuma (podrazumevano `/opt/albatron`) i porta (podrazumevano `3000`)
- kreiranje baze podataka i korisnika baze (unosiš ime i lozinku)
- automatsko generisanje `.env` fajla sa tajnim ključem sesije
- kreiranje sistemskog korisnika `albatron` pod kojim servis radi
- systemd servis (`albatron`) koji se sam pokreće pri boot-u
- preuzimanje instalera desktop aplikacije, koji server dalje deli radnim stanicama
- opciono: otvaranje porta u UFW firewall-u i dnevni backup baze i fajlova
- podrška za rad iza HTTP proxyja tokom instalacije

Posle instalacije aplikacija je dostupna na `http://ADRESA-SERVERA:3000`. Prva prijava: `admin` / `admin123` - lozinku promeni odmah.

## Brza instalacija (Windows Server)

U PowerShell-u pokrenutom **kao administrator**:

```powershell
Invoke-WebRequest https://raw.githubusercontent.com/TwistedMind88/albatron/main/scripts/install.ps1 -OutFile install.ps1
powershell -ExecutionPolicy Bypass -File install.ps1
```

Skripta je interaktivna:

- proveri preduslove (Git, Node.js, pnpm, PostgreSQL, NSSM); šta nedostaje izlista i instalira preko winget-a tek posle tvoje izričite potvrde
- pita port, ime/korisnika/lozinku baze i lozinku `postgres` super korisnika
- klonira kod u `C:\Albatron`, pređe na poslednju objavljenu verziju, build, migracije, početni podaci
- preuzme instaler desktop aplikacije, koji server dalje deli radnim stanicama
- registruje Windows servis `Albatron` koji se sam pokreće pri boot-u (logovi u `C:\Albatron\logs`)
- opciono otvara port u Windows firewall-u

Prijava ista kao gore: `admin` / `admin123` - lozinku promeni odmah.

## Update

Pokreni istu skriptu ponovo na serveru:

```bash
sudo bash install.sh
```

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

Skripta prepoznaje postojeću instalaciju, povlači najnoviju objavljenu verziju (release tag), ponovo gradi aplikaciju, pokreće migracije baze i restartuje servis. Podešavanja i podaci ostaju netaknuti.

## Pristup preko mreže i domena

Server sluša na svim mrežnim adresama (`0.0.0.0`), pa je aplikacija odmah dostupna sa drugih računara u mreži preko IP adrese servera.

Za pristup preko domena sa HTTPS-om postavi reverse proxy (nginx, Caddy) ili Cloudflare ispred servera i uperi ga na port aplikacije. TLS se terminira na proxyju; aplikacija podržava `X-Forwarded` zaglavlja. Pri instalaciji u tom slučaju izaberi HTTPS režim pristupa (uključuje secure kolačiće).

## Windows desktop klijent

Instaler (`.exe`) se preuzima preko linka **"Preuzmi desktop verziju aplikacije za Windows"** na dnu login strane u web pregledaču, ili sa [Releases](https://github.com/TwistedMind88/albatron/releases) stranice. Pri prvom pokretanju unosi se adresa servera.

Ažuriranje je automatsko: kada server dobije noviju verziju, desktop aplikacija na login ekranu prikaže obaveštenje i dugme **"Ažuriraj"** - preuzimanje, instalacija i restart idu sami, preko lokalnog servera (radne stanice ne moraju imati pristup internetu).

## Ručna instalacija

Ako ne koristiš skriptu, koraci su:

1. Instaliraj PostgreSQL 16+, Node.js 22+ i pnpm 9+.
2. Kreiraj bazu i korisnika baze: `CREATE ROLE albatron LOGIN PASSWORD '...'; CREATE DATABASE albatron OWNER albatron;`
3. Kloniraj repo u `/opt/albatron` i pređi na poslednji release tag.
4. Napravi `/opt/albatron/.env` po uzoru na `.env.example` (obavezno promeni `DATABASE_URL` i `SESSION_COOKIE_SECRET`, dodaj `FILE_STORAGE=/opt/albatron/storage`).
5. `pnpm install --frozen-lockfile`, zatim `pnpm --filter @albatron/server --filter @albatron/web build`
6. Iz `apps/server`: `pnpm db:migrate` pa `pnpm db:seed` (seed samo pri prvoj instalaciji).
7. Pokreni server: `node --env-file=/opt/albatron/.env apps/server/dist/index.js` (ili napravi systemd servis kao u skripti).

## Licenca

Videti [LICENSE](LICENSE).
