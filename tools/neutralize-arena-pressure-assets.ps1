param(
    [string]$AssetDirectory = (Join-Path $PSScriptRoot '..\CriptoVersus\wwwroot\games\arena-pressure\assets')
)

Add-Type -AssemblyName System.Drawing

function Test-PressureColor([System.Drawing.Color]$color) {
    $max = [Math]::Max($color.R, [Math]::Max($color.G, $color.B))
    $min = [Math]::Min($color.R, [Math]::Min($color.G, $color.B))
    if (($max - $min) -le 28) { return $false }

    $orange = ($color.R -gt ($color.B * 1.22)) -and ($color.G -gt ($color.B * 1.08))
    $cyan = ($color.B -gt ($color.R * 1.22)) -and ($color.G -gt ($color.R * 1.08))
    return $orange -or $cyan
}

function Test-CrownPixel([System.Drawing.Color]$color, [int]$x, [int]$y) {
    if ($x -lt 230 -or $x -gt 283 -or $y -lt 232 -or $y -gt 282) { return $false }
    $warm = ($color.R -gt 118) -and ($color.G -gt 42) -and ($color.R -gt ($color.B * 1.35))
    return $warm -and (($color.R - $color.B) -gt 42)
}

function Get-Radius([int]$x, [int]$y, [int]$center) {
    return [Math]::Sqrt([Math]::Pow($x - $center, 2) + [Math]::Pow($y - $center, 2))
}

function Save-UpdatedPng(
    [string]$path,
    [scriptblock]$transform
) {
    $source = [System.Drawing.Bitmap]::FromFile($path)
    $output = New-Object System.Drawing.Bitmap($source.Width, $source.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
        for ($y = 0; $y -lt $source.Height; $y++) {
            for ($x = 0; $x -lt $source.Width; $x++) {
                $pixel = $source.GetPixel($x, $y)
                $updated = & $transform $source $pixel $x $y
                $output.SetPixel($x, $y, $updated)
            }
        }

        $temporaryPath = "$path.neutralized.tmp.png"
        $output.Save($temporaryPath, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $source.Dispose()
        $output.Dispose()
    }

    Move-Item -LiteralPath $temporaryPath -Destination $path -Force
}

function Export-WheelCrown([string]$hubPath, [string]$crownPath) {
    $source = [System.Drawing.Bitmap]::FromFile($hubPath)
    $cleanHub = New-Object System.Drawing.Bitmap($source.Width, $source.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $crown = New-Object System.Drawing.Bitmap($source.Width, $source.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
        for ($y = 0; $y -lt $source.Height; $y++) {
            for ($x = 0; $x -lt $source.Width; $x++) {
                $pixel = $source.GetPixel($x, $y)
                $cleanPixel = $pixel
                $crownPixel = [System.Drawing.Color]::Transparent
                if (Test-CrownPixel $pixel $x $y) {
                    $luminance = (0.299 * $pixel.R) + (0.587 * $pixel.G) + (0.114 * $pixel.B)
                    $value = [Math]::Min(255, [Math]::Max(90, [int]($luminance * 1.22)))
                    $crownPixel = [System.Drawing.Color]::FromArgb($pixel.A, $value, $value, $value)
                    $cleanPixel = [System.Drawing.Color]::FromArgb($pixel.A, 31, 24, 29)
                }
                $cleanHub.SetPixel($x, $y, $cleanPixel)
                $crown.SetPixel($x, $y, $crownPixel)
            }
        }

        $cleanTemporary = "$hubPath.crown-clean.tmp.png"
        $crownTemporary = "$crownPath.tmp.png"
        $cleanHub.Save($cleanTemporary, [System.Drawing.Imaging.ImageFormat]::Png)
        $crown.Save($crownTemporary, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $source.Dispose()
        $cleanHub.Dispose()
        $crown.Dispose()
    }

    Move-Item -LiteralPath $cleanTemporary -Destination $hubPath -Force
    Move-Item -LiteralPath $crownTemporary -Destination $crownPath -Force
}

$basePath = Join-Path $AssetDirectory 'wheel-base.png'
Save-UpdatedPng $basePath {
    param($source, $pixel, $x, $y)
    if ($pixel.A -eq 0) { return $pixel }

    $radius = Get-Radius $x $y 256
    $connectorZone = ([Math]::Abs($x - 256) -gt 160) -and ($y -ge 200) -and ($y -le 335)
    $sideLightZone = (($x -lt 48) -or ($x -gt 464)) -and ($y -ge 220) -and ($y -le 295)
    $supportZone = $y -gt 432
    if ($radius -lt 142 -or $radius -gt 250 -or ($connectorZone -and -not $sideLightZone) -or $supportZone -or -not (Test-PressureColor $pixel)) {
        return $pixel
    }

    $luminance = (0.299 * $pixel.R) + (0.587 * $pixel.G) + (0.114 * $pixel.B)
    $neutral = [Math]::Min(168, [Math]::Max(36, [int]($luminance * 0.55)))
    $r = [Math]::Min(255, [int](($pixel.R * 0.08) + ($neutral * 0.92)))
    $g = [Math]::Min(255, [int](($pixel.G * 0.08) + ($neutral * 0.92)))
    $b = [Math]::Min(255, [int](($pixel.B * 0.08) + ($neutral * 0.92)))
    return [System.Drawing.Color]::FromArgb($pixel.A, $r, $g, $b)
}

$discPath = Join-Path $AssetDirectory 'wheel-disc.png'
Save-UpdatedPng $discPath {
    param($source, $pixel, $x, $y)
    if ($pixel.A -eq 0) { return $pixel }

    $radius = Get-Radius $x $y 256
    $sideBar = ($y -ge 212) -and ($y -le 300) -and ([Math]::Abs($x - 256) -ge 82)
    $arrowArea = (($x -ge 106 -and $x -le 196) -or ($x -ge 316 -and $x -le 406)) -and ($y -ge 232) -and ($y -le 282)
    if ($sideBar -and $arrowArea -and $pixel.A -gt 0) {
        $metal = 38 + (($y - 232) % 9) * 2
        return [System.Drawing.Color]::FromArgb($pixel.A, $metal, $metal + 4, $metal + 10)
    }
    if ($radius -lt 92 -or $radius -gt 156 -or -not $sideBar -or -not (Test-PressureColor $pixel)) {
        return $pixel
    }

    $sampleX = if ($x -lt 256) { [Math]::Min($source.Width - 1, $x + 80) } else { [Math]::Max(0, $x - 80) }
    $sample = $source.GetPixel($sampleX, $y)
    if ($sample.A -eq 0 -or (Test-PressureColor $sample)) {
        $luminance = (0.299 * $pixel.R) + (0.587 * $pixel.G) + (0.114 * $pixel.B)
        $neutral = [Math]::Min(140, [Math]::Max(28, [int]($luminance * 0.42)))
        return [System.Drawing.Color]::FromArgb($pixel.A, $neutral, $neutral, $neutral)
    }

    return [System.Drawing.Color]::FromArgb($pixel.A, $sample.R, $sample.G, $sample.B)
}

$hubPath = Join-Path $AssetDirectory 'wheel-hub.png'
$crownPath = Join-Path $AssetDirectory 'wheel-crown.png'
Export-WheelCrown $hubPath $crownPath

Write-Output "Neutralized fixed wheel shell and mechanical disc in $AssetDirectory"
