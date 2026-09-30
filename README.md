# 🎛 StudioLoop — Web DAW (mirip FL Studio + BandLab) pakai HTML

Studio musik lengkap yang jalan di browser, cukup HTML + CSS + JavaScript (tanpa install, tanpa framework).

**Cara buka:** klik 2x `index.html`, atau jalankan server lokal (`python3 -m http.server`) lalu buka `http://localhost:8000`. Bisa juga di-host di GitHub Pages.

## Fitur

| Fitur | Keterangan |
|---|---|
| **10 instrumen asli + Drum Kit** | Grand Piano, Gitar Akustik, Gitar Elektrik, Bass Elektrik, Biola, Cello, Seruling, Saxophone, Trumpet, Harpa, plus Drum Kit akustik. **Bukan synth**: semuanya pakai sampel **MP3 rekaman instrumen asli** (multi-sample, dipitch dari sampel terdekat seperti sampler di FL). |
| **Playlist / Arrangement** | Track instrumen & track audio, clip pola nada & clip audio (waveform). Pindah, geser antar-track, resize/trim kiri-kanan, pola berulang otomatis kalau clip dipanjangkan (seperti FL). |
| **Piano Roll** | Gambar nada, geser, ubah panjang, hapus (klik kanan), seleksi (Ctrl+seret), transpose ↑↓, quantize, lane velocity. |
| **Channel Rack** | Step sequencer 16-step ala FL untuk drum dan melodi. |
| **Mixer** | Per track: volume fader + meter, pan, reverb send, delay send, pitch, EQ 3-band, mute/solo. Master: reverb (size, decay, pre-delay, level), delay (beat, feedback), limiter. |
| **Sound effect / audio sendiri** | Import MP3/WAV/OGG/M4A/FLAC (tombol Import atau seret file ke playlist), 2 loop rekaman bawaan, **rekam dari mikrofon** (tombol ● / R). |
| **Edit clip** | Split (tool ✂ / tombol S / di playhead), duplikat (Ctrl+D atau Ctrl+seret), copy-paste, mute clip, rename, reverse, fade in/out (seret kotak putih di pojok clip). |
| **Pitch & speed clip audio** | Pitch ±24 semitone + fine cent, speed 0.25×–4×. Mode *Pertahankan pitch* (time-stretch WSOLA) atau mode *tape/resample* ala FL. |
| **Keyframe / automation + kurva kustom** | Lane per track untuk **Volume, Pan, Reverb, Pitch, Speed, Filter**. Klik = tambah keyframe, seret titik = pindah, seret titik bulat kecil di tengah segmen = bentuk kurva (tension), klik kanan titik = jenis kurva (tunggal, S, hold, tangga, pulsa). |
| **🎤→🎹 Dubler** | Nyanyi / senandung / ngomong nada ke mic, langsung jadi **note** di track instrumen terpilih (deteksi pitch YIN, bisa dikunci ke skala mayor/minor/pentatonik, geser oktaf, sensitivitas). Kalau track-nya **Drum Kit** = mode beatbox: "bum" → kick, "ka/pah" → snare, "tss" → hi-hat. Tombol 🎤→🎹 atau **D**; ⚙ untuk pengaturan. Clip audio yang sudah ada juga bisa: klik kanan → *Jadikan note*. |
| **Volume 0–1000%** | Kotak **%** di header track, mixer, master, dan inspector (gain clip): ketik angka 0–1000 atau scroll di atasnya (Shift+scroll = ±50%). Slider biasa tetap sampai 150%. |
| **Bitcrusher** | Per track (Mixer / tab Clip-Efek): on/off, bit depth 1–16, downsample 1–40×, mix dry/wet. Ikut ter-render saat export WAV. |
| **Lainnya** | Undo/redo, loop region (seret di bagian atas ruler), metronom, BPM, snap grid, zoom, autosave otomatis (IndexedDB), simpan/buka project (.json berisi audio juga), **export WAV** (lagu penuh atau loop region). |

## Shortcut

| Tombol | Aksi |
|---|---|
| Spasi | Play / pause |
| R | Rekam mic |
| D | Dubler (suara → note) |
| L | Loop on/off |
| S | Split di playhead |
| Ctrl+D | Duplikat clip / nada |
| Ctrl+C / Ctrl+V | Copy / paste clip (di playhead) |
| Delete | Hapus |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| P / B / C / E / T | Tool pointer / pensil / pisau / hapus / mute |
| Ctrl+scroll | Zoom · Shift+scroll = geser horizontal |
| Ctrl+S | Simpan project ke file |

## Struktur

```
index.html
css/style.css
js/dubler.js        Dubler: deteksi pitch & beatbox -> note
js/instruments.js   definisi instrumen + loader sampel
js/engine.js        audio engine (strip mixer, FX, automation, time-stretch, export WAV, rekam)
js/project.js       data lagu, undo, simpan/buka, demo
js/arrange.js       playlist + lane automation
js/pianoroll.js     piano roll
js/panels.js        browser, channel rack, mixer, inspector
js/app.js           transport, shortcut, menu
samples/<instrumen>/*.mp3   sampel rekaman asli
samples/packs/*.js          sampel yang sama dalam base64 (agar jalan dari file://)
tools/build-packs.py        buat ulang packs setelah menambah/mengganti MP3
```

## Kredit sampel

Sampel instrumen dari [nbrosowsky/tonejs-instruments](https://github.com/nbrosowsky/tonejs-instruments) (MIT), yang bersumber dari VSO2 / Versilian Community Sample Library, Karoryfer Samples, University of Iowa Electronic Music Studios, dan Freesound.
Sampel drum & loop dari [Tonejs/audio](https://github.com/Tonejs/audio) (asal: cwilso/web-audio-samples).
