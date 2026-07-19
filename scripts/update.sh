#!/usr/bin/env bash
# Albatron - neinteraktivni update na najnoviji git tag (Ubuntu).
# Poziva ga cron u 03:00 (/etc/cron.d/albatron-update); moze i rucno: sudo bash update.sh
# FORCE_RUN=1 preskace proveru auto_update flaga iz baze (rucno pokretanje).
# ponytail: update tok dupliran iz install.sh update grane - install.sh ostaje
# samostalan jer stariji checkout nema ovu skriptu; spajati tek kad zatreba.
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/albatron}"
SERVICE_NAME="albatron"
APP_USER="albatron"
LOG_FILE="/var/log/albatron-update.log"
LOCK_FILE="/var/run/albatron-update.lock"

# interaktivno pokretanje pise i na ekran i u log; cron samo u log
if [ -t 1 ]; then
  exec > >(tee -a "$LOG_FILE") 2>&1
else
  exec >> "$LOG_FILE" 2>&1
fi
echo "---- $(date '+%Y-%m-%d %H:%M:%S') albatron update ----"

[ "$(id -u)" -eq 0 ] || { echo "GRESKA: skripta mora da se pokrene kao root"; exit 1; }
[ -d "$INSTALL_DIR/.git" ] || { echo "GRESKA: $INSTALL_DIR nije git instalacija"; exit 1; }

ENV_FILE="$INSTALL_DIR/.env"
DB_URL="$(grep '^DATABASE_URL=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)"

# flag iz baze: podrazumevano ukljuceno; neuspeo upit = nastavi (default ukljuceno)
if [ "${FORCE_RUN:-0}" != "1" ]; then
  FLAG="$(psql "$DB_URL" -tAc "SELECT COALESCE((value->>'ukljucen')::boolean, true) FROM app_settings WHERE key='auto_update'" 2>/dev/null || echo "greska")"
  if [ "$FLAG" = "f" ]; then
    echo "auto-update iskljucen u podesavanjima - preskacem"
    exit 0
  fi
  [ "$FLAG" = "greska" ] && echo "UPOZORENJE: provera flaga nije uspela - nastavljam (podrazumevano ukljuceno)"
fi

# zastita od preklapanja sa rucnim update-om
exec 9> "$LOCK_FILE"
flock -n 9 || { echo "update je vec u toku - preskacem"; exit 0; }

# git kao root u direktorijumu ciji je vlasnik $APP_USER
git config --system --get-all safe.directory 2>/dev/null | grep -qxF "$INSTALL_DIR" \
  || git config --system --add safe.directory "$INSTALL_DIR"

git -C "$INSTALL_DIR" fetch --quiet --tags origin
CURRENT="$(git -C "$INSTALL_DIR" describe --tags --exact-match 2>/dev/null || echo 'nepoznata')"
TAG="$(git -C "$INSTALL_DIR" tag --sort=-version:refname | head -1)"
[ -n "$TAG" ] || { echo "GRESKA: repo nema release tagove"; exit 1; }
if [ "$CURRENT" = "$TAG" ]; then
  echo "vec je instalirana najnovija verzija ($TAG)"
  exit 0
fi
echo "update: $CURRENT -> $TAG"
git -C "$INSTALL_DIR" checkout --quiet "$TAG"
chown -R "$APP_USER:$APP_USER" "$INSTALL_DIR"

# desktop instalater sa GitHub Release-a (za LAN distribuciju klijentima)
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
    echo "desktop instalater spreman u $DL_DIR"
  else
    rm -f "$DL_DIR/albatron-setup.exe.tmp" "$DL_DIR/albatron-setup.exe.sig.tmp"
    echo "UPOZORENJE: preuzimanje desktop instalatera nije uspelo - preskacem"
  fi
else
  echo "UPOZORENJE: desktop instalater nije objavljen za $TAG - preskacem"
fi
chown -R "$APP_USER:$APP_USER" "$DL_DIR"

# build i migracije kao aplikacioni korisnik
run_as_app() { sudo -u "$APP_USER" -H env HOME="$INSTALL_DIR" PATH="$PATH" bash -c "$1"; }

echo "instaliram zavisnosti (pnpm install)"
run_as_app "cd '$INSTALL_DIR' && pnpm install --frozen-lockfile"
echo "gradim aplikaciju (server + web)"
run_as_app "cd '$INSTALL_DIR' && pnpm --filter @albatron/shared --filter @albatron/server --filter @albatron/web build"
echo "pokrecem migracije baze"
run_as_app "cd '$INSTALL_DIR/apps/server' && DATABASE_URL='$DB_URL' pnpm db:migrate"

echo "restartujem servis"
if ! grep -q -- "--conditions=production" "/etc/systemd/system/$SERVICE_NAME.service"; then
  sed -i 's|/usr/bin/node --env-file=|/usr/bin/node --conditions=production --env-file=|' "/etc/systemd/system/$SERVICE_NAME.service"
  systemctl daemon-reload
fi
systemctl restart "$SERVICE_NAME"

sleep 2
STATUS="$(systemctl is-active "$SERVICE_NAME" || true)"
if [ "$STATUS" = "active" ]; then
  echo "gotovo: Albatron azuriran na $TAG i pokrenut"
else
  echo "PAZNJA: servis nije aktivan posle update-a (status: $STATUS) - proveri: journalctl -u $SERVICE_NAME -n 50"
  exit 1
fi
