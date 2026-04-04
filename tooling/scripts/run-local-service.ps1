[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('api', 'worker')]
  [string]$Service,

  [Parameter(Mandatory = $true)]
  [string]$EnvFile,

  [string]$WindowTitle
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$envFilePath = if ([System.IO.Path]::IsPathRooted($EnvFile)) {
  $EnvFile
} else {
  Join-Path $repoRoot $EnvFile
}

if (-not (Test-Path $envFilePath)) {
  throw "Env file not found: $envFilePath"
}

if ($WindowTitle) {
  $Host.UI.RawUI.WindowTitle = $WindowTitle
}

function Import-EnvFile {
  param([string]$Path)

  foreach ($line in Get-Content $Path) {
    $trimmedLine = $line.Trim()
    if ($trimmedLine -eq '' -or $trimmedLine.StartsWith('#')) {
      continue
    }

    $separatorIndex = $trimmedLine.IndexOf('=')
    if ($separatorIndex -lt 1) {
      continue
    }

    $name = $trimmedLine.Substring(0, $separatorIndex).Trim()
    $value = $trimmedLine.Substring($separatorIndex + 1)

    if ($value.Length -ge 2) {
      $quote = $value.Substring(0, 1)
      if (($quote -eq '"' -or $quote -eq "'") -and $value.EndsWith($quote)) {
        $value = $value.Substring(1, $value.Length - 2)
      }
    }

    Set-Item -Path "Env:$name" -Value $value
  }
}

function Replace-EnvToken {
  param(
    [string]$Name,
    [string]$OldValue,
    [string]$NewValue
  )

  $currentValue = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($currentValue)) {
    return
  }

  if ($currentValue.Contains($OldValue)) {
    Set-Item -Path "Env:$Name" -Value ($currentValue.Replace($OldValue, $NewValue))
  }
}

function Normalize-LocalInfrastructureHosts {
  Replace-EnvToken -Name 'MONGODB_URI' -OldValue 'host.docker.internal' -NewValue 'localhost'
  Replace-EnvToken -Name 'RABBITMQ_URL' -OldValue 'host.docker.internal' -NewValue 'localhost'
  Replace-EnvToken -Name 'MINIO_ENDPOINT' -OldValue 'host.docker.internal' -NewValue 'localhost'
  Replace-EnvToken -Name 'OTEL_EXPORTER_OTLP_ENDPOINT' -OldValue 'host.docker.internal' -NewValue 'localhost'
}

function Enable-LocalMongoReplicaSetUri {
  $mongoUri = $env:MONGODB_URI
  if ([string]::IsNullOrWhiteSpace($mongoUri)) {
    Set-Item -Path 'Env:MONGODB_URI' -Value 'mongodb://localhost:27017/document-parser?replicaSet=rs0'
    return
  }

  if ($mongoUri -match '^mongodb://(localhost|127\.0\.0\.1)(:\d+)?/' -and $mongoUri -notmatch '(^|[?&])replicaSet=') {
    $separator = if ($mongoUri.Contains('?')) { '&' } else { '?' }
    Set-Item -Path 'Env:MONGODB_URI' -Value ($mongoUri + $separator + 'replicaSet=rs0')
  }
}

Import-EnvFile -Path $envFilePath
Normalize-LocalInfrastructureHosts
Enable-LocalMongoReplicaSetUri

Set-Item -Path 'Env:DOCUMENT_PARSER_RUNTIME_MODE' -Value 'real'
switch ($Service) {
  'api' {
    Set-Item -Path 'Env:ORCHESTRATOR_RUNTIME_MODE' -Value 'real'
  }
  'worker' {
    Set-Item -Path 'Env:WORKER_RUNTIME_MODE' -Value 'real'
  }
}

Set-Location $repoRoot
& node 'tooling/scripts/local-dev-runner.cjs' $Service
exit $LASTEXITCODE
