[CmdletBinding()]
param(
  [string]$EnvFile = '.env'
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$composeFile = Join-Path $repoRoot 'docker-compose.local.yml'
$serviceScript = Join-Path $repoRoot 'tooling\scripts\run-local-service.ps1'

function Resolve-EnvFilePath {
  param([string]$RequestedPath)

  $candidate = if ([System.IO.Path]::IsPathRooted($RequestedPath)) {
    $RequestedPath
  } else {
    Join-Path $repoRoot $RequestedPath
  }

  if (Test-Path $candidate) {
    return (Resolve-Path $candidate).Path
  }

  $fallback = Join-Path $repoRoot '.env.example'
  if (Test-Path $fallback) {
    Write-Host "[start-dev] Env file '$RequestedPath' not found. Using '.env.example'."
    return (Resolve-Path $fallback).Path
  }

  throw "Env file '$RequestedPath' not found and '.env.example' is unavailable."
}

function Wait-ForDockerHealth {
  param(
    [string]$Service,
    [int]$Retries = 45,
    [int]$DelaySeconds = 2
  )

  for ($attempt = 1; $attempt -le $Retries; $attempt++) {
    $containerId = (& docker compose -f $composeFile ps -q $Service).Trim()
    if ($containerId) {
      $status = (& docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $containerId).Trim()
      if ($status -eq 'healthy') {
        Write-Host "[start-dev] $Service is healthy."
        return
      }

      if ($status -in @('dead', 'exited')) {
        throw "Service '$Service' stopped unexpectedly."
      }
    }

    Start-Sleep -Seconds $DelaySeconds
  }

  throw "Timed out waiting for '$Service' to become healthy."
}

function Wait-ForTcpPort {
  param(
    [string]$HostName,
    [int]$Port,
    [string]$DisplayName,
    [int]$Retries = 30,
    [int]$DelaySeconds = 2
  )

  for ($attempt = 1; $attempt -le $Retries; $attempt++) {
    if (Test-NetConnection -ComputerName $HostName -Port $Port -InformationLevel Quiet -WarningAction SilentlyContinue) {
      Write-Host "[start-dev] $DisplayName is reachable on $HostName`:$Port."
      return
    }

    Start-Sleep -Seconds $DelaySeconds
  }

  throw "Timed out waiting for '$DisplayName' on $HostName`:$Port."
}

function Wait-ForUrl {
  param(
    [string]$Url,
    [string]$DisplayName,
    [int]$Retries = 30,
    [int]$DelaySeconds = 2
  )

  for ($attempt = 1; $attempt -le $Retries; $attempt++) {
    try {
      Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3 | Out-Null
      Write-Host "[start-dev] $DisplayName is responding."
      return
    } catch {
      Start-Sleep -Seconds $DelaySeconds
    }
  }

  throw "Timed out waiting for '$DisplayName' at $Url."
}

function Start-ServiceTerminal {
  param(
    [string]$Service,
    [string]$ResolvedEnvFile
  )

  $windowTitle = if ($Service -eq 'api') { 'Document Parser API' } else { 'Document Parser Worker' }
  $command = "& '$serviceScript' -Service '$Service' -EnvFile '$ResolvedEnvFile' -WindowTitle '$windowTitle'"
  Start-Process -FilePath 'powershell.exe' -ArgumentList @(
    '-NoExit',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    $command
  ) | Out-Null
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker CLI not found in PATH.'
}

if (-not (Get-Command corepack -ErrorAction SilentlyContinue)) {
  throw 'Corepack not found in PATH.'
}

$resolvedEnvFile = Resolve-EnvFilePath -RequestedPath $EnvFile
Set-Location $repoRoot

if (-not (Test-Path (Join-Path $repoRoot 'node_modules'))) {
  Write-Host '[start-dev] Installing workspace dependencies...'
  & corepack pnpm install
  if ($LASTEXITCODE -ne 0) {
    throw 'pnpm install failed.'
  }
}

Write-Host '[start-dev] Starting external infrastructure with docker compose...'
& docker compose -f $composeFile up -d
if ($LASTEXITCODE -ne 0) {
  throw 'docker compose up failed.'
}

Wait-ForDockerHealth -Service 'mongodb'
Wait-ForDockerHealth -Service 'rabbitmq'
Wait-ForUrl -Url 'http://localhost:9000/minio/health/live' -DisplayName 'MinIO'

Start-ServiceTerminal -Service 'api' -ResolvedEnvFile $resolvedEnvFile
Start-ServiceTerminal -Service 'worker' -ResolvedEnvFile $resolvedEnvFile

Write-Host "[start-dev] API and worker opened in separate terminals."
Write-Host '[start-dev] RabbitMQ UI: http://localhost:15672'
Write-Host '[start-dev] MinIO Console: http://localhost:9001'
