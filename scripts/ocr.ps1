# OCR every PNG in -Dir with the Windows built-in engine (Windows.Media.Ocr).
# Output: one line per file, "basename<TAB>recognised text".
param([Parameter(Mandatory=$true)][string]$Dir)

# Emit UTF-8. PowerShell otherwise writes stdout in the console's ANSI
# codepage while the Node reader decodes it as UTF-8, which turned every
# umlaut into U+FFFD ("f<?>r" for "fuer") and silently lost the character.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder,Windows.Foundation,ContentType=WindowsRuntime]
$null = [Windows.Storage.StorageFile,Windows.Foundation,ContentType=WindowsRuntime]

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() |
  Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]

function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { Write-Error "No OCR engine available"; exit 1 }

Get-ChildItem -Path $Dir -Filter *.png | ForEach-Object {
  try {
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($_.FullName)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    $text = ($result.Text -replace "[`r`n`t]+", " ").Trim()
    Write-Output ($_.BaseName + "`t" + $text)
    $stream.Dispose(); $bitmap.Dispose()
  } catch {
    Write-Output ($_.BaseName + "`t")
  }
}
