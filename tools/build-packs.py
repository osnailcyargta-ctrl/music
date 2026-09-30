#!/usr/bin/env python3
"""Bungkus MP3 di samples/<folder>/ jadi samples/packs/<id>.js (base64)
agar studio tetap jalan saat index.html dibuka langsung dari file:// ."""
import base64, json, os, re

ROOT = os.path.join(os.path.dirname(__file__), '..')
SAMPLES = os.path.join(ROOT, 'samples')
OUT = os.path.join(SAMPLES, 'packs')
os.makedirs(OUT, exist_ok=True)

src = open(os.path.join(ROOT, 'js', 'instruments.js'), encoding='utf-8').read()

def pack(pid, folder, names):
    data = {}
    for n in names:
        with open(os.path.join(SAMPLES, folder, n + '.mp3'), 'rb') as f:
            data[n] = base64.b64encode(f.read()).decode()
    with open(os.path.join(OUT, pid + '.js'), 'w') as f:
        f.write('window.SAMPLE_PACKS=window.SAMPLE_PACKS||{};window.SAMPLE_PACKS[%s]=%s;\n' % (json.dumps(pid), json.dumps(data)))
    print(pid, len(names))

for folder in sorted(os.listdir(SAMPLES)):
    d = os.path.join(SAMPLES, folder)
    if folder == 'packs' or not os.path.isdir(d):
        continue
    names = sorted(x[:-4] for x in os.listdir(d) if x.endswith('.mp3'))
    if folder == 'drums':
        loops = ['breakbeat', 'conga-rhythm']
        pack('drums', 'drums', [n for n in names if n not in loops])
        pack('loops', 'drums', loops)
    else:
        pack(folder, folder, names)
