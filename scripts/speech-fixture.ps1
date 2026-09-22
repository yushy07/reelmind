$ErrorActionPreference = 'Stop'
$fixtureRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../.test-data/speech'))
New-Item -ItemType Directory -Force -Path $fixtureRoot | Out-Null
Add-Type -AssemblyName System.Speech
$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voice.Rate = -1
$voice.SetOutputToWaveFile((Join-Path $fixtureRoot 'speech.wav'))
$voice.Speak('Why do so many creative projects fail before they even begin? I learned this lesson the hard way. For years, I thought I needed the perfect camera, the perfect office, and the perfect plan. Every weekend I spent hours researching equipment instead of making anything. Then a friend asked me a surprising question. What would you make if nobody could see the equipment you used? That changed everything. I picked up my old phone and recorded one short story. The picture was ordinary, but the story mattered. People remembered the idea, not the camera. Because I finally started, I discovered what I actually needed to improve. The biggest mistake is waiting until you feel ready. You learn by making something, paying attention, and making the next thing better. Here is another useful lesson. Never judge your first attempt against somebody else''s tenth year. Remember that a small finished project teaches you more than a perfect unfinished plan. Start with one idea, share it clearly, and learn from what happens next. That is how you turn a creative habit into real progress.')
$voice.Dispose()
& (Join-Path $PSScriptRoot '../runtime/ffmpeg.exe') -hide_banner -loglevel error -y -f lavfi -i 'color=c=0x272135:s=1280x720:r=30' -i (Join-Path $fixtureRoot 'speech.wav') -shortest -c:v libopenh264 -b:v 3M -c:a aac (Join-Path $fixtureRoot 'speech.mp4')
if ($LASTEXITCODE) { throw 'Speech fixture encoding failed' }
