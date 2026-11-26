# Deploy the Cloudflare Worker and write its URL into data/visits-config.json.
# Requires `npx wrangler login` (OAuth token stored by wrangler) or
# CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID in the environment or .env file.
# PROXY_TOKEN secret is generated automatically and stored in
# worker/.proxy-token.txt (gitignored). Set the same value as
# ENERGO_VISITS_PROXY_TOKEN in the Render environment.

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

$envFile = Join-Path (Get-Location) '.env'
if (Test-Path $envFile) {
    foreach ($line in Get-Content $envFile) {
        if ($line -match '^\s*([A-Z_]+)\s*=\s*(.+?)\s*$') {
            $name = $matches[1]
            if (-not (Get-Item "Env:$name" -ErrorAction SilentlyContinue)) {
                [Environment]::SetEnvironmentVariable($name, $matches[2], 'Process')
            }
        }
    }
}

$who = npx wrangler whoami 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) {
    throw "Cloudflare auth missing. Run: npx wrangler login`n$who"
}

$secretFile = Join-Path (Get-Location) 'worker\.proxy-token.txt'
if (Test-Path $secretFile) {
    $secret = (Get-Content $secretFile -Raw).Trim()
} else {
    $secret = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
    Set-Content -Path $secretFile -Value $secret -NoNewline
}
$env:ENERGO_VISITS_PROXY_TOKEN = $secret

Write-Host 'Deploying Worker...'
$raw = npx wrangler deploy --config worker/wrangler.toml 2>&1 | Out-String
Write-Host $raw
$match = [regex]::Match($raw, 'https://energo-visits\.[a-z0-9-]+\.workers\.dev')
if (-not $match.Success) { throw 'Worker URL not found in wrangler output' }
$endpoint = $match.Value + '/api/energo/visits'

Write-Host 'Setting PROXY_TOKEN secret...'
$secret | npx wrangler secret put PROXY_TOKEN --config worker/wrangler.toml

Write-Host "Updating visits-config.json: $endpoint"
node -e "
const fs=require('fs');
const p='data/visits-config.json';
const c=JSON.parse(fs.readFileSync(p,'utf8'));
const endpoint=process.argv[1];
c.endpoint=endpoint;
c.endpoints=[endpoint,'https://bot-29-nx0w.onrender.com/api/energo/visits'];
fs.writeFileSync(p,JSON.stringify(c,null,2)+'\n');
" $endpoint

Write-Host ''
Write-Host 'DONE. In Render Environment set:'
Write-Host "  ENERGO_VISITS_PROXY_TOKEN = $secret"
Write-Host "Secret file: worker/.proxy-token.txt (gitignored)."
