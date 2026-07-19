# Albatron - neinteraktivni update na najnoviji git tag (Windows).
# Poziva ga Task Scheduler zadatak "AlbatronUpdate" u 03:00; moze i rucno kao Administrator:
#   powershell -ExecutionPolicy Bypass -File update.ps1 [-ForceRun]
# -ForceRun preskace proveru auto_update flaga iz baze (rucno pokretanje).
# ponytail: update tok dupliran iz install.ps1 update grane - install.ps1 ostaje
# samostalan jer stariji checkout nema ovu skriptu; spajati tek kad zatreba.

param([switch]$ForceRun)

$ErrorActionPreference = "Stop"

$InstallDir = "C:\Albatron"
$ServiceName = "Albatron"
$LogFile = Join-Path $InstallDir "update.log"

function Log($msg) {
  $linija = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
  Write-Host $linija
  Add-Content -Path $LogFile -Value $linija -Encoding utf8
}

function NadjiPsql {
  $cmd = Get-Command psql -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $kandidati = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending
  if ($kandidati) { return $kandidati[0].FullName }
  return $null
}

Log "---- albatron update ----"

if (-not (Test-Path (Join-Path $InstallDir ".git"))) { Log "GRESKA: $InstallDir nije git instalacija"; exit 1 }

$EnvFile = Join-Path $InstallDir ".env"
$dbUrlLinija = Get-Content $EnvFile | Where-Object { $_ -like "DATABASE_URL=*" } | Select-Object -First 1
$DbUrl = $dbUrlLinija.Substring("DATABASE_URL=".Length)

# flag iz baze: podrazumevano ukljuceno; neuspeo upit = nastavi (podrazumevano ukljuceno)
if (-not $ForceRun) {
  $Psql = NadjiPsql
  if ($Psql) {
    $flag = & $Psql $DbUrl -tAc "SELECT COALESCE((value->>'ukljucen')::boolean, true) FROM app_settings WHERE key='auto_update'"
    if ($LASTEXITCODE -eq 0 -and "$flag".Trim() -eq "f") {
      Log "auto-update iskljucen u podesavanjima - preskacem"
      exit 0
    }
    if ($LASTEXITCODE -ne 0) { Log "UPOZORENJE: provera flaga nije uspela - nastavljam (podrazumevano ukljuceno)" }
  } else {
    Log "UPOZORENJE: psql nije pronadjen - nastavljam (podrazumevano ukljuceno)"
  }
}

Log "proveravam nove verzije"
git -C $InstallDir fetch --quiet --tags origin
$Current = "nepoznata"
$opis = git -C $InstallDir describe --tags --exact-match
if ($LASTEXITCODE -eq 0 -and $opis) { $Current = $opis }
$Tag = git -C $InstallDir tag --sort=-version:refname | Select-Object -First 1
if (-not $Tag) { Log "GRESKA: repo nema release tagove"; exit 1 }
if ($Current -eq $Tag) { Log "vec je instalirana najnovija verzija ($Tag)"; exit 0 }

Log "update: $Current -> $Tag"
git -C $InstallDir checkout --quiet $Tag
if ($LASTEXITCODE -ne 0) { Log "GRESKA: git checkout $Tag nije uspeo"; exit 1 }

# desktop instalater sa GitHub Release-a (za LAN distribuciju klijentima)
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
    Log "desktop instalater spreman u $DlDir"
  } else {
    Log "UPOZORENJE: desktop instalater nije objavljen za $Tag - preskacem"
  }
} catch {
  Remove-Item (Join-Path $DlDir "albatron-setup.exe.tmp"), (Join-Path $DlDir "albatron-setup.exe.sig.tmp") -ErrorAction SilentlyContinue
  Log "UPOZORENJE: preuzimanje desktop instalatera nije uspelo - preskacem"
}

Set-Location $InstallDir
Log "instaliram zavisnosti (pnpm install)"
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { Log "GRESKA: pnpm install nije uspeo"; exit 1 }

Log "gradim aplikaciju (server + web)"
pnpm --filter "@albatron/shared" --filter "@albatron/server" --filter "@albatron/web" build
if ($LASTEXITCODE -ne 0) { Log "GRESKA: build nije uspeo"; exit 1 }

Log "pokrecem migracije baze"
$env:DATABASE_URL = $DbUrl
Set-Location (Join-Path $InstallDir "apps\server")
pnpm db:migrate
if ($LASTEXITCODE -ne 0) { Log "GRESKA: migracije nisu uspele"; exit 1 }
Set-Location $InstallDir

Log "restartujem servis"
$EnvFilePath = Join-Path $InstallDir ".env"
nssm set $ServiceName AppParameters "--conditions=production" "--env-file=$EnvFilePath" "dist\index.js"
nssm restart $ServiceName

Start-Sleep -Seconds 2
$status = (Get-Service $ServiceName -ErrorAction SilentlyContinue).Status
if ($status -eq "Running") {
  Log "gotovo: Albatron azuriran na $Tag i pokrenut"
} else {
  Log "PAZNJA: servis nije aktivan posle update-a (status: $status) - proveri $InstallDir\logs\albatron-error.log"
  exit 1
}
