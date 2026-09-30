#!/usr/bin/env python3
"""Bungkus tiap MP3 di samples/ jadi samples/packs/<path__dengan__garis>.js (base64),
supaya studio tetap jalan saat index.html dibuka langsung dari file:// .
Jalankan ulang setelah menambah / mengganti sampel."""
import base64, json, os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SAMPLES = os.path.join(ROOT, 'samples')
OUT = os.path.join(SAMPLES, 'packs')
os.makedirs(OUT, exist_ok=True)
n = 0
for dp, dn, fn in os.walk(SAMPLES):
    if os.path.abspath(dp).startswith(os.path.abspath(OUT)):
        continue
    for f in fn:
        if not f.endswith('.mp3'):
            continue
        rel = os.path.relpath(os.path.join(dp, f), SAMPLES)[:-4].replace(os.sep, '/')
        with open(os.path.join(dp, f), 'rb') as fh:
            b64 = base64.b64encode(fh.read()).decode()
        with open(os.path.join(OUT, rel.replace('/', '__') + '.js'), 'w') as fh:
            fh.write('window.SAMPLE_PACKS=window.SAMPLE_PACKS||{};window.SAMPLE_PACKS[%s]=%s;\n' % (json.dumps(rel), json.dumps(b64)))
        n += 1
print(n, 'pack')
