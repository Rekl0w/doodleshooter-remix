param([switch]$NoBrowser, [int]$Port = 8911)
$ErrorActionPreference = 'Stop'

function Test-GameServer([string]$Address) {
    try {
        $response = Invoke-WebRequest -Uri "$Address/index.html" -TimeoutSec 2 -UseBasicParsing
        return $response.Content.Contains('Doodle District') -and $response.Content.Contains('Remix')
    } catch { return $false }
}

$address = "http://127.0.0.1:$Port"
if (-not (Test-GameServer $address)) {
    $available = $false
    for ($attempt = 0; $attempt -lt 10; $attempt++) {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
        try { $listener.Start(); $available = $true; break }
        catch { $Port++ }
        finally { $listener.Stop() }
    }
    if (-not $available) { throw 'No free local port found.' }
    $address = "http://127.0.0.1:$Port"
    $bundledPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
    if (Test-Path -LiteralPath $bundledPython) { $pythonPath = $bundledPython }
    else {
        $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
        if (-not $pythonCommand) { throw 'Python 3 is required. Install Python, then run OYNA.cmd again.' }
        $pythonPath = $pythonCommand.Source
    }
    $script = Join-Path $PSScriptRoot 'serve.py'
    $server = Start-Process -FilePath $pythonPath -ArgumentList @(('"' + $script + '"'), "$Port") -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru
    $ready = $false
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        if (Test-GameServer $address) { $ready = $true; break }
        if ($server.HasExited) { throw 'The game server stopped unexpectedly.' }
        Start-Sleep -Milliseconds 150
    }
    if (-not $ready) { throw 'The local game server did not become ready.' }
}
Write-Output $address
if (-not $NoBrowser) { Start-Process $address }
