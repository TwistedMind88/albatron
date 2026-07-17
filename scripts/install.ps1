# Albatron - interaktivna instalacija i update za Windows server.
# Preuzimanje:
#   Invoke-WebRequest https://raw.githubusercontent.com/TwistedMind88/albatron/main/scripts/install.ps1 -OutFile install.ps1
#   PowerShell pokrenuti KAO ADMINISTRATOR pa: powershell -ExecutionPolicy Bypass -File install.ps1
#
# ponytail: bez backup scheduled task-a i proxy podrske - dodati kad se zatrazi.

$ErrorActionPreference = "Stop"

$RepoUrl = "https://github.com/TwistedMind88/albatron.git"
$InstallDir = "C:\Albatron"
$ServiceName = "Albatron"
$DefaultPort = "3000"

function Info($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Warn($msg) { Write-Host "UPOZORENJE: $msg" -ForegroundColor Yellow }
function Die($msg) { Write-Host "GRESKA: $msg" -ForegroundColor Red; exit 1 }

# ---------- osnovne provere ----------
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Die "skripta mora da se pokrene kao Administrator"
}

$Mode = "install"
if (Test-Path (Join-Path $InstallDir ".git")) {
  $Mode = "update"
  Info "postojeca instalacija pronadjena u $InstallDir - rezim: UPDATE"
} elseif ((Test-Path $InstallDir) -and (Get-ChildItem $InstallDir -Force | Select-Object -First 1)) {
  Die "$InstallDir postoji i nije prazan, a nije git instalacija - ukloni ga pa pokreni ponovo"
}

function RefreshPath {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
              [Environment]::GetEnvironmentVariable("Path", "User")
}

function TajniUnos($poruka) {
  $sec = Read-Host $poruka -AsSecureString
  return [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}

function NadjiPsql {
  $cmd = Get-Command psql -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $kandidati = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending
  if ($kandidati) { return $kandidati[0].FullName }
  return $null
}

# ---------- sken preduslova (bez instalacije) ----------
Info "provera preduslova"
$fali = @()

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { $fali += @{ naziv = "Git"; id = "Git.Git" } }

$nodeOk = $false
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) {
  $nodeMajor = [int]((node -v) -replace "^v" -split "\.")[0]
  if ($nodeMajor -ge 22) { $nodeOk = $true } else { Warn "pronadjen Node.js $nodeMajor, potreban je 22+" }
}
if (-not $nodeOk) { $fali += @{ naziv = "Node.js (LTS)"; id = "OpenJS.NodeJS.LTS" } }

$pnpmOk = $false
if (Get-Command pnpm -ErrorAction SilentlyContinue) {
  $pnpmMajor = [int]((pnpm --version) -split "\.")[0]
  if ($pnpmMajor -ge 9) { $pnpmOk = $true }
}
if (-not $pnpmOk) { $fali += @{ naziv = "pnpm"; id = "pnpm.pnpm" } }

if (-not (NadjiPsql)) { $fali += @{ naziv = "PostgreSQL 17"; id = "PostgreSQL.PostgreSQL.17" } }

if (-not (Get-Command nssm -ErrorAction SilentlyContinue)) { $fali += @{ naziv = "NSSM (servis menadzer)"; id = "NSSM.NSSM" } }

if ($fali.Count -gt 0) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Die "nedostaju preduslovi ($(($fali | ForEach-Object { $_.naziv }) -join ', ')), a winget nije dostupan - instaliraj ih rucno (docs/instalacija.md)"
  }
  Write-Host ""
  Write-Host "Sledeci programi nedostaju i bice instalirani preko winget-a:" -ForegroundColor Yellow
  foreach ($p in $fali) { Write-Host "  - $($p.naziv)" }
  Write-Host ""
  $ans = Read-Host "Da li razumes i odobravas instalaciju navedenih programa? [da/ne]"
  if ($ans -notmatch "^[Dd]") { Die "instalacija prekinuta - preduslovi nisu odobreni" }
  foreach ($p in $fali) {
    Info "instaliram $($p.naziv)"
    winget install --id $p.id --accept-package-agreements --accept-source-agreements --silent
    if ($LASTEXITCODE -ne 0) { Die "winget instalacija $($p.naziv) nije uspela (kod $LASTEXITCODE)" }
  }
  RefreshPath
}

$Psql = NadjiPsql
if (-not $Psql) { Die "psql nije pronadjen ni posle instalacije - proveri PostgreSQL" }
$PgBin = Split-Path $Psql

# PostgreSQL servis mora da radi
$pgServis = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($pgServis -and $pgServis.Status -ne "Running") { Start-Service $pgServis.Name }

# ---------- pitanja (samo sveza instalacija) ----------
if ($Mode -eq "install") {
  $AppPort = Read-Host "Port na kom server slusa [$DefaultPort]"
  if (-not $AppPort) { $AppPort = $DefaultPort }

  $DbName = Read-Host "Ime baze podataka [albatron]"
  if (-not $DbName) { $DbName = "albatron" }
  $DbUser = Read-Host "Korisnik baze podataka [albatron]"
  if (-not $DbUser) { $DbUser = "albatron" }

  while ($true) {
    $DbPass = TajniUnos "Lozinka baze (dozvoljeno: slova, brojevi, _ . -)"
    if (-not $DbPass) { Write-Host "lozinka ne sme biti prazna"; continue }
    if ($DbPass -notmatch "^[A-Za-z0-9_.-]+$") { Write-Host "nedozvoljeni znakovi u lozinki, pokusaj ponovo"; continue }
    $DbPass2 = TajniUnos "Ponovi lozinku"
    if ($DbPass -eq $DbPass2) { break }
    Write-Host "lozinke se ne poklapaju, pokusaj ponovo"
  }

  # postgres superuser lozinka - potrebna za kreiranje role i baze.
  # NAPOMENA: winget/EDB instalacija sama postavlja lozinku super korisnika;
  # ako je PostgreSQL upravo instaliran a lozinka nepoznata, probati "postgres".
  while ($true) {
    $PgSuperPass = TajniUnos "Lozinka PostgreSQL 'postgres' super korisnika"
    $env:PGPASSWORD = $PgSuperPass
    & $Psql -U postgres -h localhost -tAc "SELECT 1" | Out-Null
    if ($LASTEXITCODE -eq 0) { break }
    Write-Host "veza sa PostgreSQL nije uspela sa datom lozinkom, pokusaj ponovo (Ctrl+C za prekid)"
  }

  $ans = Read-Host "Otvoriti port $AppPort u Windows firewall-u za pristup iz mreze? [D/n]"
  $FirewallOpen = ($ans -eq "" -or $ans -match "^[DdYy]")
}

# ---------- kod: clone/checkout najnovijeg taga ----------
if ($Mode -eq "install") {
  Info "preuzimam kod sa $RepoUrl"
  git clone --quiet $RepoUrl $InstallDir
  if ($LASTEXITCODE -ne 0) { Die "git clone nije uspeo" }
  $Tag = git -C $InstallDir tag --sort=-version:refname | Select-Object -First 1
  if ($Tag) {
    Info "prelazim na verziju $Tag"
    git -C $InstallDir checkout --quiet $Tag
  } else {
    Warn "repo nema release tagove - koristim main granu"
  }
} else {
  Info "proveravam nove verzije"
  git -C $InstallDir fetch --quiet --tags origin
  # bez 2> redirekcije: PS 5.1 pod ErrorActionPreference=Stop baca izuzetak
  # kada se stderr native komande preusmeri, a git describe pise na stderr kad nema taga
  $Current = "nepoznata"
  $opis = git -C $InstallDir describe --tags --exact-match
  if ($LASTEXITCODE -eq 0 -and $opis) { $Current = $opis }
  $Tag = git -C $InstallDir tag --sort=-version:refname | Select-Object -First 1
  if (-not $Tag) { Die "repo nema release tagove" }
  if ($Current -eq $Tag) {
    Write-Host "Vec je instalirana najnovija verzija ($Tag). Nema sta da se radi."
    exit 0
  }
  Info "update: $Current -> $Tag"
  git -C $InstallDir checkout --quiet $Tag
}

# ---------- desktop instalater sa GitHub Release-a ----------
# Server servira desktop instalater na /download i update manifest na /updates
if ($Tag) {
  Info "preuzimam desktop instalater za $Tag"
  $DlDir = Join-Path $InstallDir "downloads"
  New-Item -ItemType Directory -Force $DlDir | Out-Null
  try {
    $release = Invoke-RestMethod "https://api.github.com/repos/TwistedMind88/albatron/releases/tags/$Tag"
    $exeAsset = $release.assets | Where-Object { $_.name -like "*-setup.exe" } | Select-Object -First 1
    $sigAsset = $release.assets | Where-Object { $_.name -like "*-setup.exe.sig" } | Select-Object -First 1
    if ($exeAsset -and $sigAsset) {
      Invoke-WebRequest $exeAsset.browser_download_url -OutFile (Join-Path $DlDir "albatron-setup.exe.tmp")
      Invoke-WebRequest $sigAsset.browser_download_url -OutFile (Join-Path $DlDir "albatron-setup.exe.sig.tmp")
      Move-Item -Force (Join-Path $DlDir "albatron-setup.exe.tmp") (Join-Path $DlDir "albatron-setup.exe")
      Move-Item -Force (Join-Path $DlDir "albatron-setup.exe.sig.tmp") (Join-Path $DlDir "albatron-setup.exe.sig")
      Info "desktop instalater spreman u $DlDir"
    } else {
      Warn "desktop instalater nije objavljen za $Tag - preskacem (postojeci fajlovi ostaju)"
    }
  } catch {
    Remove-Item (Join-Path $DlDir "albatron-setup.exe.tmp"), (Join-Path $DlDir "albatron-setup.exe.sig.tmp") -ErrorAction SilentlyContinue
    Warn "preuzimanje desktop instalatera nije uspelo - preskacem (postojeci fajlovi ostaju)"
  }
}

# ---------- baza (samo sveza instalacija) ----------
if ($Mode -eq "install") {
  Info "podesavam PostgreSQL rolu i bazu"
  $env:PGPASSWORD = $PgSuperPass
  $sql = @"
DO `$`$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$DbUser') THEN
    CREATE ROLE "$DbUser" LOGIN PASSWORD '$DbPass';
  ELSE
    ALTER ROLE "$DbUser" LOGIN PASSWORD '$DbPass';
  END IF;
END `$`$;
"@
  $sql | & $Psql -U postgres -h localhost -v ON_ERROR_STOP=1 --quiet
  if ($LASTEXITCODE -ne 0) { Die "kreiranje role nije uspelo" }
  $postoji = & $Psql -U postgres -h localhost -tAc "SELECT 1 FROM pg_database WHERE datname='$DbName'"
  if ($postoji -ne "1") {
    & (Join-Path $PgBin "createdb.exe") -U postgres -h localhost -O $DbUser $DbName
    if ($LASTEXITCODE -ne 0) { Die "kreiranje baze nije uspelo" }
  }
}

# ---------- .env (samo sveza instalacija) ----------
$EnvFile = Join-Path $InstallDir ".env"
if ($Mode -eq "install") {
  Info "pisem $EnvFile"
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $secret = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
  $storageDir = Join-Path $InstallDir "storage"
  @"
PORT=$AppPort
DATABASE_URL=postgres://${DbUser}:${DbPass}@localhost:5432/$DbName
SESSION_COOKIE_SECRET=$secret
FILE_STORAGE=$storageDir
"@ | Out-File -FilePath $EnvFile -Encoding ascii
  New-Item -ItemType Directory -Force $storageDir | Out-Null
}

# ---------- build ----------
Set-Location $InstallDir
Info "instaliram zavisnosti (pnpm install)"
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { Die "pnpm install nije uspeo" }

# desktop paket (tauri) se ne gradi na serveru - sluzi samo za klijentske masine
Info "gradim aplikaciju (server + web)"
pnpm --filter "@albatron/shared" --filter "@albatron/server" --filter "@albatron/web" build
if ($LASTEXITCODE -ne 0) { Die "build nije uspeo" }

# ---------- migracije + seed ----------
$dbUrlLinija = Get-Content $EnvFile | Where-Object { $_ -like "DATABASE_URL=*" } | Select-Object -First 1
$env:DATABASE_URL = $dbUrlLinija.Substring("DATABASE_URL=".Length)
Info "pokrecem migracije baze"
Set-Location (Join-Path $InstallDir "apps\server")
pnpm db:migrate
if ($LASTEXITCODE -ne 0) { Die "migracije nisu uspele" }
if ($Mode -eq "install") {
  Info "ubacujem pocetne podatke (seed)"
  pnpm db:seed
  if ($LASTEXITCODE -ne 0) { Die "seed nije uspeo" }
}
Set-Location $InstallDir

# ---------- Windows servis (NSSM) ----------
$NodeExe = (Get-Command node).Source
if ($Mode -eq "install") {
  Info "kreiram Windows servis $ServiceName"
  $LogDir = Join-Path $InstallDir "logs"
  New-Item -ItemType Directory -Force $LogDir | Out-Null
  nssm install $ServiceName $NodeExe "--conditions=production" "--env-file=$EnvFile" "dist\index.js"
  nssm set $ServiceName AppDirectory (Join-Path $InstallDir "apps\server")
  nssm set $ServiceName AppStdout (Join-Path $LogDir "albatron.log")
  nssm set $ServiceName AppStderr (Join-Path $LogDir "albatron-error.log")
  nssm set $ServiceName Start SERVICE_AUTO_START
  nssm start $ServiceName
} else {
  Info "restartujem servis"
  nssm set $ServiceName AppParameters "--conditions=production" "--env-file=$EnvFile" "dist\index.js"
  nssm restart $ServiceName
}

# ---------- firewall (samo sveza instalacija) ----------
if ($Mode -eq "install" -and $FirewallOpen) {
  Info "otvaram port $AppPort u Windows firewall-u"
  New-NetFirewallRule -DisplayName "Albatron" -Direction Inbound -Protocol TCP -LocalPort $AppPort -Action Allow | Out-Null
}

# ---------- kraj ----------
Start-Sleep -Seconds 2
$status = (Get-Service $ServiceName -ErrorAction SilentlyContinue).Status
Write-Host ""
Write-Host "=============================================="
if ($status -eq "Running") {
  $verzija = $Tag
  if (-not $verzija) { $verzija = "main" }
  Write-Host "Albatron je pokrenut (verzija $verzija)."
} else {
  Write-Host "PAZNJA: servis nije aktivan (status: $status)."
  Write-Host "Proveri log: $InstallDir\logs\albatron-error.log"
}
if ($Mode -eq "install") {
  Write-Host ""
  Write-Host "Pristup iz mreze:"
  Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
    ForEach-Object { Write-Host "  http://$($_.IPAddress):$AppPort" }
  Write-Host ""
  Write-Host "Prijava: admin / admin123 - ODMAH PROMENI LOZINKU posle prve prijave."
}
Write-Host "=============================================="
