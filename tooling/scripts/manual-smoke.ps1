[CmdletBinding()]
param(
  [string]$FilePath,
  [string]$BaseUrl = 'http://localhost:3000',
  [int]$TimeoutSeconds = 45,
  [int]$PollIntervalSeconds = 2
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Net.Http

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$defaultFixturePath = Join-Path $repoRoot 'packages\testkit\fixtures\pdf\clinical-one-page.pdf'
$trimmedBaseUrl = $BaseUrl.TrimEnd('/')

function Resolve-InputFilePath {
  param(
    [string]$RequestedPath,
    [string]$FallbackPath
  )

  if ([string]::IsNullOrWhiteSpace($RequestedPath)) {
    if (-not (Test-Path $FallbackPath)) {
      throw "Default smoke fixture not found: $FallbackPath"
    }

    return (Resolve-Path $FallbackPath).Path
  }

  $candidate = if ([System.IO.Path]::IsPathRooted($RequestedPath)) {
    $RequestedPath
  } else {
    Join-Path $repoRoot $RequestedPath
  }

  if (-not (Test-Path $candidate)) {
    throw "Input file not found: $candidate"
  }

  return (Resolve-Path $candidate).Path
}

function Get-MimeTypeFromPath {
  param([string]$Path)

  switch ([System.IO.Path]::GetExtension($Path).ToLowerInvariant()) {
    '.pdf' { return 'application/pdf' }
    '.jpg' { return 'image/jpeg' }
    '.jpeg' { return 'image/jpeg' }
    '.png' { return 'image/png' }
    default { return 'application/octet-stream' }
  }
}

function Try-ParseJson {
  param([string]$Content)

  if ([string]::IsNullOrWhiteSpace($Content)) {
    return $null
  }

  try {
    return $Content | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Format-ApiError {
  param(
    [int]$StatusCode,
    [object]$Body,
    [string]$RawContent
  )

  if ($Body -and $Body.errorCode) {
    $metadataSummary = if ($Body.metadata) {
      try {
        " metadata=$($Body.metadata | ConvertTo-Json -Compress -Depth 8)"
      } catch {
        ''
      }
    } else {
      ''
    }

    return "HTTP $StatusCode $($Body.errorCode): $($Body.message)$metadataSummary"
  }

  if (-not [string]::IsNullOrWhiteSpace($RawContent)) {
    return "HTTP ${StatusCode}: $RawContent"
  }

  return "HTTP $StatusCode with empty response body"
}

function Get-RootExceptionMessage {
  param([System.Exception]$Exception)

  $current = $Exception
  while ($current.InnerException) {
    $current = $current.InnerException
  }

  return $current.Message
}

function Invoke-JsonRequest {
  param(
    [System.Net.Http.HttpClient]$HttpClient,
    [string]$Method,
    [string]$Path,
    [System.Net.Http.HttpContent]$Content
  )

  $request = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::new($Method), "$trimmedBaseUrl$Path")
  $request.Headers.Accept.ParseAdd('application/json') | Out-Null
  $request.Content = $Content

  try {
    try {
      $response = $HttpClient.SendAsync($request).GetAwaiter().GetResult()
    } catch {
      throw "Request to $trimmedBaseUrl$Path failed: $(Get-RootExceptionMessage -Exception $_.Exception)"
    }

    $rawContent = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    $body = Try-ParseJson -Content $rawContent

    if (-not $response.IsSuccessStatusCode) {
      throw (Format-ApiError -StatusCode ([int]$response.StatusCode) -Body $body -RawContent $rawContent)
    }

    return [pscustomobject]@{
      StatusCode = [int]$response.StatusCode
      Body = $body
      RawContent = $rawContent
    }
  } finally {
    $request.Dispose()

    if ($null -ne $response) {
      $response.Dispose()
    }
  }
}

function New-MultipartFileContent {
  param([string]$Path)

  $multipartContent = New-Object System.Net.Http.MultipartFormDataContent
  $fileBytes = [System.IO.File]::ReadAllBytes($Path)
  $fileContent = New-Object System.Net.Http.ByteArrayContent(, $fileBytes)
  $fileContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse(
    (Get-MimeTypeFromPath -Path $Path)
  )
  $multipartContent.Add($fileContent, 'file', [System.IO.Path]::GetFileName($Path))
  return $multipartContent
}

function Get-PayloadPreview {
  param([string]$Payload)

  if ([string]::IsNullOrWhiteSpace($Payload)) {
    return '[empty]'
  }

  $normalized = ($Payload -replace '\s+', ' ').Trim()
  if ($normalized.Length -le 160) {
    return $normalized
  }

  return $normalized.Substring(0, 160) + '...'
}

$resolvedFilePath = Resolve-InputFilePath -RequestedPath $FilePath -FallbackPath $defaultFixturePath
$httpClient = New-Object System.Net.Http.HttpClient
$httpClient.Timeout = [TimeSpan]::FromSeconds([Math]::Max($TimeoutSeconds, 10))

try {
  Write-Host "[smoke] Checking API health at $trimmedBaseUrl/health ..."
  $healthResponse = Invoke-JsonRequest -HttpClient $httpClient -Method 'GET' -Path '/health'

  if (-not $healthResponse.Body) {
    throw 'Health endpoint returned an empty response.'
  }

  Write-Host "[smoke] API is healthy. runtimeMode=$($healthResponse.Body.runtimeMode) service=$($healthResponse.Body.service)"

  $multipartContent = New-MultipartFileContent -Path $resolvedFilePath
  try {
    Write-Host "[smoke] Uploading $([System.IO.Path]::GetFileName($resolvedFilePath)) ..."
    $submitResponse = Invoke-JsonRequest -HttpClient $httpClient -Method 'POST' -Path '/v1/parsing/jobs' -Content $multipartContent
  } finally {
    $multipartContent.Dispose()
  }

  if (-not $submitResponse.Body -or [string]::IsNullOrWhiteSpace($submitResponse.Body.jobId)) {
    throw 'Submit response did not include a jobId.'
  }

  $jobId = [string]$submitResponse.Body.jobId
  $deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
  $lastStatus = $null
  $terminalJob = $null

  Write-Host "[smoke] Job accepted. jobId=$jobId status=$($submitResponse.Body.status)"

  while ([DateTimeOffset]::UtcNow -lt $deadline) {
    $jobResponse = Invoke-JsonRequest -HttpClient $httpClient -Method 'GET' -Path "/v1/parsing/jobs/$jobId"

    if (-not $jobResponse.Body -or [string]::IsNullOrWhiteSpace($jobResponse.Body.status)) {
      throw "Job status response for '$jobId' did not include a status."
    }

    $status = [string]$jobResponse.Body.status
    if ($status -ne $lastStatus) {
      Write-Host "[smoke] jobId=$jobId status=$status"
      $lastStatus = $status
    }

    if ($status -in @('COMPLETED', 'PARTIAL', 'FAILED')) {
      $terminalJob = $jobResponse.Body
      break
    }

    Start-Sleep -Seconds $PollIntervalSeconds
  }

  if ($null -eq $terminalJob) {
    throw "Timed out after $TimeoutSeconds seconds waiting for job '$jobId' to reach COMPLETED, PARTIAL or FAILED."
  }

  if ([string]$terminalJob.status -eq 'FAILED') {
    throw "Job '$jobId' finished with FAILED. Use GET /v1/ops/jobs/$jobId/context for operational detail."
  }

  $resultResponse = Invoke-JsonRequest -HttpClient $httpClient -Method 'GET' -Path "/v1/parsing/jobs/$jobId/result"
  if (-not $resultResponse.Body) {
    throw "Result endpoint returned an empty response for job '$jobId'."
  }

  $warnings = if ($resultResponse.Body.warnings) {
    [string]::Join(', ', @($resultResponse.Body.warnings))
  } else {
    'none'
  }

  Write-Host ''
  Write-Host 'Smoke Summary'
  Write-Host "Job ID: $($resultResponse.Body.jobId)"
  Write-Host "Status: $($resultResponse.Body.status)"
  Write-Host "Confidence: $($resultResponse.Body.confidence)"
  Write-Host "Warnings: $warnings"
  Write-Host "Payload Preview: $(Get-PayloadPreview -Payload ([string]$resultResponse.Body.payload))"
}
finally {
  $httpClient.Dispose()
}
