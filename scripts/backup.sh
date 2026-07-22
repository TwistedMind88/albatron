#!/usr/bin/env bash
# Albatron - rezervna kopija baze + storage foldera (Ubuntu).
# Poziva ga cron na svaki pun sat (/etc/cron.d/albatron-backup); moze i rucno: sudo bash backup.sh
# Konfiguracija se cita iz baze (app_settings key='backup'), Podesavanja > Rezervne kopije.
# FORCE_RUN=1 preskace proveru ukljuceno/sat (rucno pokretanje).
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/albatron}"
LOG_FILE="/var/log/albatron-backup.log"

if [ -t 1 ]; then
  exec > >(tee -a "$LOG_FILE") 2>&1
else
  exec >> "$LOG_FILE" 2>&1
fi
echo "---- $(date '+%Y-%m-%d %H:%M:%S') albatron backup ----"

[ "$(id -u)" -eq 0 ] || { echo "GRESKA: skripta mora da se pokrene kao root"; exit 1; }

ENV_FILE="$INSTALL_DIR/.env"
DB_URL="$(grep '^DATABASE_URL=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)"
[ -n "$DB_URL" ] || { echo "GRESKA: DATABASE_URL nije nadjen u $ENV_FILE"; exit 1; }
STORAGE="$(grep '^FILE_STORAGE=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)"
STORAGE="${STORAGE:-$INSTALL_DIR/storage}"

# citanje konfiguracije iz baze (tab-razdvojeno); prazan rezultat = podrazumevano.
# razlikuj gresku upita (baza nedostupna) od praznog rezultata (nema reda):
# fail-closed - ako baza ne odgovara, ne nagadjaj da je ukljuceno, prekini.
if CFG="$(psql "$DB_URL" -tAF$'\t' -c \
  "SELECT COALESCE(value->>'ukljucen','true'), COALESCE(value->>'sat','3'), \
          COALESCE(value->>'cuvajDana','14'), COALESCE(value->>'lokalniDir','/var/backups/albatron'), \
          COALESCE(value#>>'{mreza,tip}',''), COALESCE(value#>>'{mreza,server}',''), \
          COALESCE(value#>>'{mreza,deo}',''), COALESCE(value#>>'{mreza,folder}',''), \
          COALESCE(value#>>'{mreza,korisnik}',''), COALESCE(value#>>'{mreza,lozinka}','') \
   FROM app_settings WHERE key='backup'" 2>/dev/null)"; then
  :
else
  echo "GRESKA: citanje konfiguracije iz baze nije uspelo - prekidam (fail-closed)"
  exit 1
fi

if [ -n "$CFG" ]; then
  IFS=$'\t' read -r UKLJUCEN SAT CUVAJ LOKALNI M_TIP M_SERVER M_DEO M_FOLDER M_USER M_PASS <<<"$CFG"
else
  echo "nema sacuvane konfiguracije - podrazumevano (lokalno, 3h, 14 dana)"
  UKLJUCEN="true"; SAT="3"; CUVAJ="14"; LOKALNI="/var/backups/albatron"
  M_TIP=""; M_SERVER=""; M_DEO=""; M_FOLDER=""; M_USER=""; M_PASS=""
fi

if [ "${FORCE_RUN:-0}" != "1" ]; then
  if [ "$UKLJUCEN" = "false" ]; then
    echo "rezervne kopije iskljucene u podesavanjima - preskacem"
    exit 0
  fi
  # cron radi svaki sat; radi backup samo u zakazani cas
  if [ "$((10#$(date +%H)))" -ne "$((10#${SAT:-3}))" ]; then
    echo "nije zakazani sat za backup (zakazano: ${SAT}h) - preskacem"
    exit 0
  fi
fi

mkdir -p "$LOKALNI"
STAMP="$(date +%Y%m%d-%H%M%S)"
DB_FILE="$LOKALNI/db-$STAMP.sql.gz"
ST_FILE="$LOKALNI/storage-$STAMP.tar.gz"

echo "pravim kopiju baze: $DB_FILE"
pg_dump "$DB_URL" | gzip > "$DB_FILE"

if [ -d "$STORAGE" ]; then
  echo "pravim kopiju foldera storage: $ST_FILE"
  tar -czf "$ST_FILE" -C "$(dirname "$STORAGE")" "$(basename "$STORAGE")"
else
  echo "UPOZORENJE: storage folder ($STORAGE) ne postoji - preskacem fajlove"
  ST_FILE=""
fi

# retencija lokalno
find "$LOKALNI" -maxdepth 1 -type f -name '*.gz' -mtime "+${CUVAJ:-14}" -delete || true

# ---------- mrezni cilj ----------
# SMB i NFS se oba montiraju pa se kopira obican cp - bez smbclient -c string
# konkatenacije (injection) i bez lozinke u argv (vidljiva kroz ps). Za SMB
# kredencijali idu u privremeni fajl (chmod 600), obrisan trap-om.
push_smb() {
  command -v mount.cifs >/dev/null || { echo "GRESKA: cifs-utils (mount.cifs) nije instaliran"; return 1; }
  local mnt cred
  mnt="$(mktemp -d)"
  cred="$(mktemp)"
  chmod 600 "$cred"
  printf 'username=%s\npassword=%s\n' "$M_USER" "$M_PASS" > "$cred"
  trap 'umount "$mnt" 2>/dev/null || true; rmdir "$mnt" 2>/dev/null || true; rm -f "$cred"' RETURN
  mount -t cifs "//$M_SERVER/$M_DEO" "$mnt" -o "credentials=$cred"
  local cilj="$mnt/${M_FOLDER:-}"
  mkdir -p "$cilj"
  cp "$DB_FILE" "$cilj/"
  [ -n "$ST_FILE" ] && cp "$ST_FILE" "$cilj/"
}

push_nfs() {
  command -v mount.nfs >/dev/null || { echo "GRESKA: NFS podrska (nfs-common) nije instalirana"; return 1; }
  local mnt
  mnt="$(mktemp -d)"
  mount -t nfs "$M_SERVER:$M_DEO" "$mnt"
  local cilj="$mnt/${M_FOLDER:-}"
  mkdir -p "$cilj"
  cp "$DB_FILE" "$cilj/"
  [ -n "$ST_FILE" ] && cp "$ST_FILE" "$cilj/"
  umount "$mnt"
  rmdir "$mnt"
}

# podfolder ulazi u putanju na mount-u; odbij '..' i cudne znakove (path traversal).
# neispravan podfolder gasi samo mrezni upis - lokalna kopija ostaje.
if [ -n "$M_TIP" ] && [ -n "$M_FOLDER" ]; then
  if printf '%s' "$M_FOLDER" | grep -q '\.\.' || ! printf '%s' "$M_FOLDER" | grep -qE '^[A-Za-z0-9_./-]+$'; then
    echo "GRESKA: podfolder '$M_FOLDER' nije dozvoljen (samo slova/cifre/_ - . / bez '..') - preskacem mrezni upis"
    M_TIP=""
  fi
fi

case "$M_TIP" in
  smb)
    echo "kopiram na SMB //$M_SERVER/$M_DEO"
    if push_smb; then echo "SMB kopija gotova"; else echo "UPOZORENJE: SMB kopija nije uspela"; fi
    ;;
  nfs)
    echo "kopiram na NFS $M_SERVER:$M_DEO"
    if push_nfs; then echo "NFS kopija gotova"; else echo "UPOZORENJE: NFS kopija nije uspela"; fi
    ;;
  *)
    echo "mrezni cilj nije podesen - samo lokalna kopija"
    ;;
esac

echo "gotovo: rezervna kopija napravljena u $LOKALNI"
