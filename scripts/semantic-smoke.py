"""Real offline model check, not a transcription-quality benchmark."""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'workers'))
from semantic import embed

texts = [
    'Regular exercise helps you sleep better and improves your mood.',
    'Regular exercise helps you sleep better and improves your mood.',
    'Exercising regularly improves sleep quality and makes you feel happier.',
    'नियमित व्यायाम से नींद अच्छी आती है और आपका मूड बेहतर होता है।',
    '定期的な運動は睡眠の質を高め、気分を良くします。',
    'The spacecraft landed on Mars after a seven month journey.',
    'I lost my restaurant during the pandemic, then started teaching cooking online.',
    'My restaurant became successful when I hired a new chef and changed the menu.',
    ('A long discussion about exercise and sleep. ' * 100) + 'The spacecraft landed on Mars.',
]
vectors = embed(texts, Path(__file__).resolve().parents[1] / 'runtime/models/minilm')
cos = lambda i,j: sum(a*b for a,b in zip(vectors[i],vectors[j]))
assert cos(0,1) > .999
assert cos(0,2) > cos(0,5)
assert cos(0,3) > cos(0,5)
assert cos(0,4) > cos(0,5)
assert cos(6,7) < .88
assert len(vectors[8]) == 384
print({name: round(cos(0,i),4) for name,i in [('identical',1),('paraphrase',2),('Hindi',3),('Japanese',4),('different',5)]})
print('MiniLM offline multilingual and long-window smoke passed')
