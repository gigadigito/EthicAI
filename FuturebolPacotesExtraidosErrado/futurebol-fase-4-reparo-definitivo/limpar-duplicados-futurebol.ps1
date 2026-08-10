$ErrorActionPreference = "Stop"

$projectRoot = (Get-Location).Path
$canonicalDirectory = Join-Path $projectRoot "Components\Pages\Futurebol"

$expected = @{
    "FuturebolLab.razor"            = Join-Path $canonicalDirectory "FuturebolLab.razor"
    "FuturebolLab.razor.cs"         = Join-Path $canonicalDirectory "FuturebolLab.razor.cs"
    "FuturebolDebugPanel.razor"     = Join-Path $canonicalDirectory "FuturebolDebugPanel.razor"
    "FuturebolDebugPanel.razor.cs"  = Join-Path $canonicalDirectory "FuturebolDebugPanel.razor.cs"
    "FuturebolLoading.razor"        = Join-Path $canonicalDirectory "FuturebolLoading.razor"
    "FuturebolLoading.razor.cs"     = Join-Path $canonicalDirectory "FuturebolLoading.razor.cs"
}

$sourceNames = $expected.Keys
$duplicates = Get-ChildItem -Path $projectRoot -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object {
        $sourceNames -contains $_.Name -and
        $_.FullName -notmatch '\\(bin|obj|\.git)\\' -and
        (-not $expected.ContainsKey($_.Name) -or
         -not [string]::Equals(
             [System.IO.Path]::GetFullPath($_.FullName),
             [System.IO.Path]::GetFullPath($expected[$_.Name]),
             [System.StringComparison]::OrdinalIgnoreCase))
    }

Write-Host "Arquivos canônicos:" -ForegroundColor Cyan
$expected.GetEnumerator() |
    Where-Object { Test-Path $_.Value } |
    ForEach-Object { Write-Host "  OK  $($_.Value)" -ForegroundColor Green }

if (-not $duplicates) {
    Write-Host "Nenhuma cópia duplicada encontrada fora da pasta canônica." -ForegroundColor Green
    exit 0
}

Write-Host "`nCópias duplicadas encontradas:" -ForegroundColor Yellow
$duplicates | Select-Object FullName | Format-Table -AutoSize

$parentDirectory = Split-Path $projectRoot -Parent
$backupDirectory = Join-Path $parentDirectory ("FuturebolDuplicados_" + (Get-Date -Format "yyyyMMdd_HHmmss"))
New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null

foreach ($file in $duplicates) {
    $relative = $file.FullName.Substring($projectRoot.Length).TrimStart('\')
    $destination = Join-Path $backupDirectory $relative
    $destinationDirectory = Split-Path $destination -Parent
    New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
    Move-Item -LiteralPath $file.FullName -Destination $destination -Force
    Write-Host "MOVIDO: $relative" -ForegroundColor Yellow
}

Write-Host "`nBackup criado fora do projeto:" -ForegroundColor Cyan
Write-Host $backupDirectory -ForegroundColor Cyan
Write-Host "Agora execute dotnet clean, remova bin/obj e rode dotnet build." -ForegroundColor Green
