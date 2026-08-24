# Lanceur temporaire du serveur dev (Phase 4F) — EXT_* injectés depuis .env sans guillemets.
$ErrorActionPreference = "Stop"
$lines = Get-Content (Join-Path $PSScriptRoot "..\.env") -Encoding UTF8
foreach ($l in $lines) {
  if ($l -match "^EXT_SUPABASE_URL=(.+)$") { $env:EXT_SUPABASE_URL = $matches[1] }
  elseif ($l -match "^EXT_SUPABASE_SERVICE_ROLE_KEY=(.+)$") { $env:EXT_SUPABASE_SERVICE_ROLE_KEY = $matches[1] }
}
Set-Location (Join-Path $PSScriptRoot "..")
npm run dev
