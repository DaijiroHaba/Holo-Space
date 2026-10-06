$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
$node=(Get-Command node -ErrorAction SilentlyContinue).Source
if(-not $node){throw 'Node.js is required. Please use the PC on which this app was created.'}
$url='http://127.0.0.1:8796'
$running=$false
try{$response=Invoke-WebRequest -Uri $url -TimeoutSec 2; $running=$response.StatusCode -eq 200 -and $response.Content -match 'HOLO / SPACE'}catch{}
if(-not $running){
  Start-Process -FilePath $node -ArgumentList @('server.mjs') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PSScriptRoot 'server.stdout.log') -RedirectStandardError (Join-Path $PSScriptRoot 'server.stderr.log')
  for($i=0;$i -lt 20;$i++){Start-Sleep -Milliseconds 250;try{$response=Invoke-WebRequest -Uri $url -TimeoutSec 1;if($response.StatusCode -eq 200 -and $response.Content -match 'HOLO / SPACE'){$running=$true;break}}catch{}}
}
if(-not $running){throw 'Could not start HOLO / SPACE. Check server.stderr.log or whether port 8796 is already in use.'}
Start-Process $url
