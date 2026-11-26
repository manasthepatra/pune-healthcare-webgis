param(
    [string]$OutputPath = 'response.json',
    [switch]$Import
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    # Node runs inside the app only to build the query; HTTPS runs on Windows.
    $settingsJson = & docker compose exec -T app node --input-type=module -e "import { buildOverpassQuery, overpassEndpoints } from './server/overpass.mjs'; console.log(JSON.stringify({ query: buildOverpassQuery(), endpoints: overpassEndpoints() }))"
    if ($LASTEXITCODE -ne 0) {
        throw 'Cannot read app configuration. Start the app with docker compose up -d --build app first.'
    }
    $settings = ($settingsJson -join "`n") | ConvertFrom-Json
    if (-not $settings.query -or -not $settings.endpoints) {
        throw 'The app returned invalid download settings.'
    }

    # Enable TLS 1.2 on older Windows PowerShell installations.
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $downloaded = $false
    $failures = @()
    foreach ($endpoint in $settings.endpoints) {
        Write-Host "Downloading through Windows from $endpoint ..."
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $endpoint -Method Post -Body $settings.query -ContentType 'text/plain; charset=utf-8' -TimeoutSec 180
            $payload = $response.Content | ConvertFrom-Json
            if ($payload.remark -or $null -eq $payload.elements -or $payload.elements -isnot [System.Array] -or $payload.elements.Count -eq 0) {
                throw 'The server returned incomplete or empty Overpass data.'
            }
            $content = $response.Content
        } catch {
            $failures += "${endpoint}: $($_.Exception.Message)"
            Write-Warning $failures[-1]
            continue
        }
        # Preserve any existing file if all network attempts fail.
        $destination = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputPath)
        [IO.File]::WriteAllText($destination, $content, (New-Object System.Text.UTF8Encoding($false)))
        Write-Host "Saved $($payload.elements.Count) OSM objects to $destination"
        $downloaded = $true
        break
    }
    if (-not $downloaded) {
        throw "No server returned complete data. No import was attempted. Check Windows network/VPN/firewall access or try later after rate limits clear.`n$($failures -join "`n")"
    }

    if ($Import) {
        & docker compose cp $destination app:/tmp/response.json
        if ($LASTEXITCODE -ne 0) { throw 'Copy failed; no import was attempted.' }
        & docker compose exec -T app npm run data:import -- --file /tmp/response.json
        if ($LASTEXITCODE -ne 0) { throw 'Import failed. See the importer error above.' }
    }
} finally {
    Pop-Location
}
