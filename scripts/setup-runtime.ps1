param([string]$Destination = (Join-Path $PSScriptRoot '../runtime'))
$ErrorActionPreference = 'Stop'
$runtimeRoot = [IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
function Download-Asset([string]$url,[string]$destination) {
 if (-not (Test-Path -LiteralPath $destination)) { Write-Output ('Downloading '+[IO.Path]::GetFileName($destination)); Invoke-WebRequest -Uri $url -OutFile ($destination+'.download'); Move-Item -LiteralPath ($destination+'.download') -Destination $destination }
}
$pythonDir = Join-Path $runtimeRoot 'python'
New-Item -ItemType Directory -Force -Path $pythonDir | Out-Null
$pythonExe = Join-Path $pythonDir 'python.exe'
if (-not (Test-Path -LiteralPath $pythonExe)) {
 Download-Asset 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip' (Join-Path $runtimeRoot 'python.zip')
 Expand-Archive -LiteralPath (Join-Path $runtimeRoot 'python.zip') -DestinationPath $pythonDir -Force
 # Runtime configuration generated during dependency installation, not application source.
 [IO.File]::WriteAllText((Join-Path $pythonDir 'python312._pth'),"python312.zip`n.`nLib/site-packages`nimport site`n")
}
Download-Asset 'https://bootstrap.pypa.io/get-pip.py' (Join-Path $runtimeRoot 'get-pip.py')
if (-not (Test-Path (Join-Path $pythonDir 'Lib/site-packages/pip'))) { & $pythonExe (Join-Path $runtimeRoot 'get-pip.py') --no-warn-script-location; if ($LASTEXITCODE) { throw 'pip setup failed' } }
& $pythonExe -m pip install --disable-pip-version-check --no-warn-script-location -r (Join-Path $PSScriptRoot '../workers/requirements.txt')
if ($LASTEXITCODE) { throw 'Worker dependency installation failed' }
$ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
if (-not (Test-Path (Join-Path $runtimeRoot 'ffmpeg.exe'))) {
 if ($ffmpeg) { Copy-Item -LiteralPath $ffmpeg.Source -Destination (Join-Path $runtimeRoot 'ffmpeg.exe'); Copy-Item -LiteralPath (Join-Path (Split-Path $ffmpeg.Source) 'ffprobe.exe') -Destination (Join-Path $runtimeRoot 'ffprobe.exe') }
 else {
  Download-Asset 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n9.0-latest-win64-lgpl-9.0.zip' (Join-Path $runtimeRoot 'ffmpeg.zip')
  Expand-Archive -LiteralPath (Join-Path $runtimeRoot 'ffmpeg.zip') -DestinationPath (Join-Path $runtimeRoot 'ffmpeg-dist') -Force
  Get-ChildItem -LiteralPath (Join-Path $runtimeRoot 'ffmpeg-dist') -Recurse -Filter '*.exe' | Where-Object Name -In @('ffmpeg.exe','ffprobe.exe') | Copy-Item -Destination $runtimeRoot
 }
}
Download-Asset 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' (Join-Path $runtimeRoot 'yt-dlp.exe')
$modelDir = Join-Path $runtimeRoot 'models'
$fontDir = Join-Path $runtimeRoot 'fonts'
New-Item -ItemType Directory -Force -Path $modelDir,$fontDir | Out-Null
Download-Asset 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx' (Join-Path $modelDir 'speaker.onnx')
Download-Asset 'https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx' (Join-Path $modelDir 'face.onnx')
Download-Asset 'https://raw.githubusercontent.com/notofonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Bold.ttf' (Join-Path $fontDir 'NotoSans-Bold.ttf')
Download-Asset 'https://raw.githubusercontent.com/notofonts/noto-fonts/main/hinted/ttf/NotoSansDevanagari/NotoSansDevanagari-Bold.ttf' (Join-Path $fontDir 'NotoSansDevanagari-Bold.ttf')
Download-Asset 'https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/Japanese/NotoSansCJKjp-Bold.otf' (Join-Path $fontDir 'NotoSansCJKjp-Bold.otf')
& $pythonExe (Join-Path $PSScriptRoot '../workers/worker.py') setup --models $modelDir
if ($LASTEXITCODE) { throw 'Speech model download failed' }
Write-Output 'REELMIND runtime ready.'
