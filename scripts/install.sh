#!/usr/bin/env bash
# Albatron - interaktivna instalacija i update za Ubuntu server.
# Preuzimanje:
#   curl -fsSL https://raw.githubusercontent.com/TwistedMind88/albatron/main/scripts/install.sh -o install.sh
#   sudo bash install.sh
set -euo pipefail

REPO_URL="https://github.com/TwistedMind88/albatron.git"
DEFAULT_DIR="/opt/albatron"
DEFAULT_PORT="3000"
SERVICE_NAME="albatron"
APP_USER="albatron"

info()  { echo -e "\n==> $*"; }
warn()  { echo "UPOZORENJE: $*"; }
die()   { echo "GRESKA: $*" >&2; exit 1; }

# ---------- osnovne provere ----------
[ "$(id -u)" -eq 0 ] || die "skripta mora da se pokrene kao root: sudo bash install.sh"
command -v apt-get >/dev/null || die "potreban je Ubuntu/Debian (apt-get nije pronadjen)"
[ -t 0 ] || die "skriptu prvo preuzmi pa pokreni (interaktivna je, ne moze preko curl | bash)"

# ---------- proxy ----------
read -rp "HTTP proxy za preuzimanja, npr. http://proxy.firma.local:8080 (prazno = nema): " PROXY_URL
if [ -n "$PROXY_URL" ]; then
  export http_proxy="$PROXY_URL" https_proxy="$PROXY_URL"
  export no_proxy="localhost,127.0.0.1"
  cat > /etc/apt/apt.conf.d/95albatron-proxy <<EOF
Acquire::http::Proxy "$PROXY_URL";
Acquire::https::Proxy "$PROXY_URL";
EOF
  info "proxy podesen za apt, git i npm/pnpm (samo tokom instalacije)"
fi

# ---------- instalacioni direktorijum i rezim ----------
read -rp "Instalacioni direktorijum [$DEFAULT_DIR]: " INSTALL_DIR
INSTALL_DIR="${INSTALL_DIR:-$DEFAULT_DIR}"

MODE="install"
if [ -d "$INSTALL_DIR/.git" ]; then
  MODE="update"
  info "postojeca instalacija pronadjena u $INSTALL_DIR - rezim: UPDATE"
elif [ -e "$INSTALL_DIR" ] && [ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
  die "$INSTALL_DIR postoji i nije prazan, a nije git instalacija - ukloni ga ili izaberi drugi direktorijum"
fi

# git kao root u direktorijumu ciji je vlasnik $APP_USER
git_safe() {
  git config --system --get-all safe.directory 2>/dev/null | grep -qxF "$INSTALL_DIR" \
    || git config --system --add safe.directory "$INSTALL_DIR"
}

# ---------- pitanja (samo sveza instalacija) ----------
if [ "$MODE" = "install" ]; then
  read -rp "Port na kom server slusa [$DEFAULT_PORT]: " APP_PORT
  APP_PORT="${APP_PORT:-$DEFAULT_PORT}"

  read -rp "Ime baze podataka [albatron]: " DB_NAME
  DB_NAME="${DB_NAME:-albatron}"
  read -rp "Korisnik baze podataka [albatron]: " DB_USER
  DB_USER="${DB_USER:-albatron}"

  while true; do
    read -rsp "Lozinka baze (dozvoljeno: slova, brojevi, _ . -): " DB_PASS; echo
    [ -n "$DB_PASS" ] || { echo "lozinka ne sme biti prazna"; continue; }
    case "$DB_PASS" in
      *[!A-Za-z0-9_.-]*) echo "nedozvoljeni znakovi u lozinki, pokusaj ponovo"; continue ;;
    esac
    read -rsp "Ponovi lozinku: " DB_PASS2; echo
    [ "$DB_PASS" = "$DB_PASS2" ] && break
    echo "lozinke se ne poklapaju, pokusaj ponovo"
  done

  echo
  echo "Nacin pristupa aplikaciji:"
  echo "  1) Lokalna mreza preko HTTP (npr. http://192.168.1.10:$APP_PORT) - podrazumevano"
  echo "  2) Preko domena sa HTTPS (reverse proxy ili Cloudflare ispred servera)"
  echo "     PAZNJA: opcija 2 bez ispravnog HTTPS-a lomi prijavljivanje (secure cookie)."
  read -rp "Izbor [1]: " ACCESS_MODE
  ACCESS_MODE="${ACCESS_MODE:-1}"

  UFW_OPEN="ne"
  if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
    read -rp "UFW firewall je aktivan. Otvoriti port $APP_PORT? [D/n]: " ans
    [[ "${ans:-d}" =~ ^[DdYy]?$ ]] && UFW_OPEN="da"
  fi
fi

# ---------- preduslovi ----------
info "azuriranje apt indeksa"
apt-get update -qq

need_pkg=""
for p in git curl openssl ca-certificates; do
  command -v "$p" >/dev/null || need_pkg="$need_pkg $p"
done
# mount.cifs (SMB) i mount.nfs (NFS) za mrezni backup
command -v mount.cifs >/dev/null || need_pkg="$need_pkg cifs-utils"
command -v mount.nfs >/dev/null || need_pkg="$need_pkg nfs-common"
if [ -n "$need_pkg" ]; then
  info "instaliram:$need_pkg"
  # shellcheck disable=SC2086
  apt-get install -y -qq $need_pkg
fi

# PostgreSQL
if ! command -v psql >/dev/null; then
  info "PostgreSQL nije pronadjen - instaliram"
  apt-get install -y -qq postgresql
else
  PG_MAJOR="$(psql -V | grep -oE '[0-9]+' | head -1)"
  if [ "$PG_MAJOR" -lt 16 ]; then
    warn "pronadjen PostgreSQL $PG_MAJOR, preporuceno je 16+"
    read -rp "Nastaviti sa postojecom verzijom? [d/N]: " ans
    [[ "${ans:-n}" =~ ^[DdYy]$ ]] || die "instalacija prekinuta - nadogradi PostgreSQL pa pokreni ponovo"
  fi
fi
systemctl enable --now postgresql >/dev/null 2>&1 || true

# Node.js 22+
NODE_OK="ne"
if command -v node >/dev/null; then
  NODE_MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
  [ "$NODE_MAJOR" -ge 22 ] && NODE_OK="da"
fi
if [ "$NODE_OK" = "ne" ]; then
  info "instaliram Node.js 22 (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi

# pnpm 9+
PNPM_OK="ne"
if command -v pnpm >/dev/null; then
  PNPM_MAJOR="$(pnpm --version | cut -d. -f1)"
  [ "$PNPM_MAJOR" -ge 9 ] && PNPM_OK="da"
fi
if [ "$PNPM_OK" = "ne" ]; then
  info "instaliram pnpm"
  npm install -g pnpm >/dev/null
fi

# ---------- sistemski korisnik ----------
if ! id "$APP_USER" >/dev/null 2>&1; then
  info "kreiram sistemskog korisnika $APP_USER"
  useradd -r -d "$INSTALL_DIR" -s /usr/sbin/nologin "$APP_USER"
fi

# ---------- kod: clone/checkout najnovijeg taga ----------
git_safe
if [ "$MODE" = "install" ]; then
  info "preuzimam kod sa $REPO_URL"
  git clone --quiet "$REPO_URL" "$INSTALL_DIR"
  TAG="$(git -C "$INSTALL_DIR" tag --sort=-version:refname | head -1)"
  if [ -n "$TAG" ]; then
    info "prelazim na verziju $TAG"
    git -C "$INSTALL_DIR" checkout --quiet "$TAG"
  else
    warn "repo nema release tagove - koristim main granu"
  fi
else
  info "proveravam nove verzije"
  git -C "$INSTALL_DIR" fetch --quiet --tags origin
  CURRENT="$(git -C "$INSTALL_DIR" describe --tags --exact-match 2>/dev/null || echo 'nepoznata')"
  TAG="$(git -C "$INSTALL_DIR" tag --sort=-version:refname | head -1)"
  [ -n "$TAG" ] || die "repo nema release tagove"
  if [ "$CURRENT" = "$TAG" ]; then
    echo "Vec je instalirana najnovija verzija ($TAG). Nema sta da se radi."
    exit 0
  fi
  info "update: $CURRENT -> $TAG"
  git -C "$INSTALL_DIR" checkout --quiet "$TAG"
fi
chown -R "$APP_USER:$APP_USER" "$INSTALL_DIR"

# ---------- desktop instalater sa GitHub Release-a ----------
# Server servira desktop instalater na /download i update manifest na /updates
# (radne stanice ne moraju imati internet). Preuzima se asset objavljenog taga.
if [ -n "${TAG:-}" ]; then
  info "preuzimam desktop instalater za $TAG"
  DL_DIR="$INSTALL_DIR/downloads"
  mkdir -p "$DL_DIR"
  RELEASE_JSON="$(curl -fsSL "https://api.github.com/repos/TwistedMind88/albatron/releases/tags/$TAG" 2>/dev/null || true)"
  EXE_URL="$(echo "$RELEASE_JSON" | grep -o '"browser_download_url": *"[^"]*-setup\.exe"' | cut -d'"' -f4 | head -1)"
  SIG_URL="$(echo "$RELEASE_JSON" | grep -o '"browser_download_url": *"[^"]*-setup\.exe\.sig"' | cut -d'"' -f4 | head -1)"
  if [ -n "$EXE_URL" ] && [ -n "$SIG_URL" ]; then
    if curl -fsSL "$EXE_URL" -o "$DL_DIR/albatron-setup.exe.tmp" \
       && curl -fsSL "$SIG_URL" -o "$DL_DIR/albatron-setup.exe.sig.tmp"; then
      mv "$DL_DIR/albatron-setup.exe.tmp" "$DL_DIR/albatron-setup.exe"
      mv "$DL_DIR/albatron-setup.exe.sig.tmp" "$DL_DIR/albatron-setup.exe.sig"
      info "desktop instalater spreman u $DL_DIR"
    else
      rm -f "$DL_DIR/albatron-setup.exe.tmp" "$DL_DIR/albatron-setup.exe.sig.tmp"
      warn "preuzimanje desktop instalatera nije uspelo - preskacem (postojeci fajlovi ostaju)"
    fi
  else
    warn "desktop instalater nije objavljen za $TAG - preskacem"
  fi
  chown -R "$APP_USER:$APP_USER" "$DL_DIR"
fi

# ---------- baza (samo sveza instalacija) ----------
if [ "$MODE" = "install" ]; then
  info "podesavam PostgreSQL rolu i bazu"
  sudo -u postgres psql -v ON_ERROR_STOP=1 --quiet <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$DB_USER') THEN
    CREATE ROLE "$DB_USER" LOGIN PASSWORD '$DB_PASS';
  ELSE
    ALTER ROLE "$DB_USER" LOGIN PASSWORD '$DB_PASS';
  END IF;
END \$\$;
SQL
  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1; then
    sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
  fi
fi

# ---------- .env (samo sveza instalacija) ----------
ENV_FILE="$INSTALL_DIR/.env"
if [ "$MODE" = "install" ]; then
  info "pisem $ENV_FILE"
  cat > "$ENV_FILE" <<EOF
PORT=$APP_PORT
DATABASE_URL=postgres://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME
SESSION_COOKIE_SECRET=$(openssl rand -hex 32)
FILE_STORAGE=$INSTALL_DIR/storage
EOF
  chown "$APP_USER:$APP_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  mkdir -p "$INSTALL_DIR/storage"
  chown "$APP_USER:$APP_USER" "$INSTALL_DIR/storage"
fi

# ---------- build ----------
run_as_app() { sudo -u "$APP_USER" -H env HOME="$INSTALL_DIR" \
  http_proxy="${http_proxy:-}" https_proxy="${https_proxy:-}" no_proxy="${no_proxy:-}" \
  PATH="$PATH" bash -c "$1"; }

info "instaliram zavisnosti (pnpm install)"
run_as_app "cd '$INSTALL_DIR' && pnpm install --frozen-lockfile"

# desktop paket (tauri) se ne gradi na serveru - treba mu Rust i sluzi samo za Windows klijent
info "gradim aplikaciju (server + web)"
run_as_app "cd '$INSTALL_DIR' && pnpm --filter @albatron/shared --filter @albatron/server --filter @albatron/web build"

# ---------- migracije + seed ----------
DB_URL="$(grep '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2-)"
info "pokrecem migracije baze"
run_as_app "cd '$INSTALL_DIR/apps/server' && DATABASE_URL='$DB_URL' pnpm db:migrate"
if [ "$MODE" = "install" ]; then
  info "ubacujem pocetne podatke (seed)"
  run_as_app "cd '$INSTALL_DIR/apps/server' && pnpm db:seed"
fi

# ---------- systemd ----------
if [ "$MODE" = "install" ]; then
  info "kreiram systemd servis $SERVICE_NAME"
  NODE_ENV_LINE=""
  [ "$ACCESS_MODE" = "2" ] && NODE_ENV_LINE="Environment=NODE_ENV=production"
  cat > "/etc/systemd/system/$SERVICE_NAME.service" <<EOF
[Unit]
Description=Albatron server
After=network.target postgresql.service

[Service]
User=$APP_USER
WorkingDirectory=$INSTALL_DIR/apps/server
ExecStart=/usr/bin/node --conditions=production --env-file=$INSTALL_DIR/.env dist/index.js
Restart=always
$NODE_ENV_LINE

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now "$SERVICE_NAME"
else
  info "restartujem servis"
  if ! grep -q -- "--conditions=production" "/etc/systemd/system/$SERVICE_NAME.service"; then
    sed -i 's|/usr/bin/node --env-file=|/usr/bin/node --conditions=production --env-file=|' "/etc/systemd/system/$SERVICE_NAME.service"
    systemctl daemon-reload
  fi
  systemctl restart "$SERVICE_NAME"
fi

# ---------- UFW ----------
if [ "$MODE" = "install" ] && [ "$UFW_OPEN" = "da" ]; then
  info "otvaram port $APP_PORT u UFW"
  ufw allow "$APP_PORT/tcp"
fi

# ---------- backup cron (svaki pun sat) ----------
# cron radi svaki sat; backup.sh cita konfiguraciju iz baze (Podesavanja > Rezervne
# kopije): ukljuceno, zakazani sat, retencija, lokalni folder i opcioni SMB/NFS cilj.
# stari cron.daily/albatron-backup (ako postoji od ranije verzije) se uklanja.
rm -f /etc/cron.daily/albatron-backup
info "podesavam rezervne kopije (svaki sat, podesava se u aplikaciji) (/etc/cron.d/albatron-backup)"
cat > /etc/cron.d/albatron-backup <<EOF
0 * * * * root INSTALL_DIR=$INSTALL_DIR /bin/bash $INSTALL_DIR/scripts/backup.sh
EOF
chmod 644 /etc/cron.d/albatron-backup

# ---------- auto-update cron (svaki pun sat) ----------
# cron radi svaki sat; update.sh cita flag auto_update i zakazani 'sat' iz baze
# (Podesavanja > Automatsko azuriranje) pa preskace ako nije taj sat.
info "podesavam automatski update (svaki sat, cas se bira u podesavanjima) (/etc/cron.d/albatron-update)"
cat > /etc/cron.d/albatron-update <<EOF
0 * * * * root INSTALL_DIR=$INSTALL_DIR /bin/bash $INSTALL_DIR/scripts/update.sh
EOF
chmod 644 /etc/cron.d/albatron-update

# ---------- kraj ----------
sleep 2
STATUS="$(systemctl is-active "$SERVICE_NAME" || true)"
echo
echo "=============================================="
if [ "$STATUS" = "active" ]; then
  echo "Albatron je pokrenut (verzija ${TAG:-main})."
else
  echo "PAZNJA: servis nije aktivan (status: $STATUS)."
  echo "Proveri log: journalctl -u $SERVICE_NAME -n 50"
fi
if [ "$MODE" = "install" ]; then
  echo
  echo "Pristup iz mreze:"
  for ip in $(hostname -I); do
    echo "  http://$ip:$APP_PORT"
  done
  echo
  echo "Prijava: admin / admin123 - ODMAH PROMENI LOZINKU posle prve prijave."
  if [ "$ACCESS_MODE" = "2" ]; then
    echo
    echo "HTTPS rezim: uperi reverse proxy ili Cloudflare na port $APP_PORT."
    echo "TLS se terminira na proxyju, aplikacija vec podrzava X-Forwarded zaglavlja."
  fi
fi
echo "=============================================="
