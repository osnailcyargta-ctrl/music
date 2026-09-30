/* =========================================================
   Instrumen: semuanya pakai SAMPEL REKAMAN ASLI (MP3), bukan synth.
   Tiap instrumen punya beberapa nada rekaman; nada di antaranya
   di-pitch dari sampel terdekat (multi-sampling seperti sampler di FL).
   ========================================================= */
'use strict';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// "As4" / "Cs3" / "C4" -> nomor MIDI
function noteToMidi(n) {
  const m = /^([A-G])(s?)(-?\d)$/.exec(n);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]];
  return (parseInt(m[3], 10) + 1) * 12 + base + (m[2] ? 1 : 0);
}
function midiToName(p) { return NOTE_NAMES[p % 12] + (Math.floor(p / 12) - 1); }

const INSTRUMENTS = {
  piano: { name: 'Grand Piano', icon: '🎹', color: '#f0a33a', release: 0.45 },
  'guitar-acoustic': { name: 'Gitar Akustik', icon: '🎸', color: '#d9824b', release: 0.35 },
  'guitar-electric': { name: 'Gitar Elektrik', icon: '🎸', color: '#e0584f', release: 0.3 },
  bass: { name: 'Bass Elektrik', icon: '🎸', color: '#8a6df0', release: 0.2 },
  violin: { name: 'Biola', icon: '🎻', color: '#c26a3a', release: 0.3 },
  cello: { name: 'Cello', icon: '🎻', color: '#9c5a36', release: 0.35 },
  flute: { name: 'Seruling (Flute)', icon: '🪈', color: '#5ec8e0', release: 0.2 },
  saxophone: { name: 'Saxophone', icon: '🎷', color: '#e8c547', release: 0.2 },
  trumpet: { name: 'Trumpet', icon: '🎺', color: '#f2d06b', release: 0.15 },
  harp: { name: 'Harpa', icon: '🪕', color: '#63d49a', release: 0.8 },
};
// daftar SEMUA nada rekaman yang tersedia per instrumen (piano, gitar akustik,
// cello, sax = kromatik lengkap: tiap nada rekaman aslinya sendiri)
const NOTE_LISTS = {
  piano: 'C1 Cs1 D1 Ds1 E1 F1 Fs1 G1 Gs1 A1 As1 B1 C2 Cs2 D2 Ds2 E2 F2 Fs2 G2 Gs2 A2 As2 B2 C3 Cs3 D3 Ds3 E3 F3 Fs3 G3 Gs3 A3 As3 B3 C4 Cs4 D4 Ds4 E4 F4 Fs4 G4 Gs4 A4 As4 B4 C5 Cs5 D5 Ds5 E5 F5 Fs5 G5 Gs5 A5 As5 B5 C6 Cs6 D6 Ds6 E6 F6 Fs6 G6 Gs6 A6 As6 B6 C7 Cs7 D7 Ds7 E7 F7 Fs7 G7 Gs7 A7 As7 B7 C8',
  'guitar-acoustic': 'D2 Ds2 E2 F2 Fs2 G2 Gs2 A2 As2 B2 C3 Cs3 D3 Ds3 E3 F3 Fs3 G3 Gs3 A3 As3 B3 C4 Cs4 D4 Ds4 E4 F4 Fs4 G4 Gs4 A4 As4 B4 C5 Cs5 D5',
  'guitar-electric': 'Cs2 E2 Fs2 A2 C3 Ds3 Fs3 A3 C4 Ds4 Fs4 A4 C5 Ds5 Fs5 A5 C6',
  bass: 'Cs1 E1 G1 As1 Cs2 E2 G2 As2 Cs3 E3 G3 As3 Cs4 E4 G4 As4 Cs5',
  violin: 'G3 A3 C4 E4 G4 A4 C5 E5 G5 A5 C6 E6 G6 A6 C7',
  cello: 'C2 D2 Ds2 E2 F2 G2 Gs2 A2 As2 B2 C3 Cs3 D3 Ds3 E3 F3 Fs3 G3 Gs3 A3 As3 B3 C4 Cs4 D4 Ds4 E4 F4 Fs4 G4 Gs4 A4 B4 C5',
  flute: 'C4 E4 A4 C5 E5 A5 C6 E6 A6 C7',
  saxophone: 'Cs3 D3 Ds3 E3 F3 Fs3 G3 Gs3 As3 B3 C4 Cs4 D4 Ds4 E4 F4 Fs4 G4 Gs4 A4 As4 B4 C5 Cs5 D5 Ds5 E5 F5 Fs5 G5 Gs5 A5',
  trumpet: 'F3 A3 C4 Ds4 F4 G4 As4 D5 F5 A5 C6',
  harp: 'E1 G1 B1 D2 F2 A2 C3 E3 G3 B3 D4 F4 A4 C5 E5 G5 B5 D6 F6 A6 B6 D7 F7',
};
for (const id in NOTE_LISTS) { INSTRUMENTS[id].notes = NOTE_LISTS[id].split(' '); INSTRUMENTS[id].folder = id; }

// ---------- DRUM KIT: semua rekaman drum asli ----------
// dub = pemetaan beatbox Dubler: bung=kick, tak=snare, dung=tom rendah, dess=crash/hat buka, tss=hat tutup
const pc = (id, label, files) => ({ id, label, files });
const PRO = (n) => ['studio-kit/' + n + '-soft', 'studio-kit/' + n + '-hard']; // 2 lapis velocity
INSTRUMENTS['drums-pro'] = {
  name: 'Drum Kit Pro (akustik asli)', icon: '🥁', color: '#3d8bff', drum: true,
  pieces: [
    pc('kick', 'Kick', PRO('kick')), pc('snare', 'Snare', PRO('snare')), pc('rimshot', 'Rimshot', PRO('rimshot')),
    pc('sidestick', 'Side Stick', PRO('sidestick')), pc('hh-closed', 'Hi-hat Tutup', PRO('hh-closed')),
    pc('hh-open', 'Hi-hat Buka', PRO('hh-open')), pc('hh-pedal', 'Hi-hat Pedal', PRO('hh-pedal')),
    pc('tom-hi', 'Tom Tinggi', PRO('tom-hi')), pc('tom-mid', 'Tom Tengah', PRO('tom-mid')),
    pc('tom-floor', 'Floor Tom', PRO('tom-floor')), pc('crash', 'Crash', PRO('crash')),
    pc('crash-bell', 'Crash Bell', PRO('crash-bell')), pc('ride', 'Ride', PRO('ride')), pc('ride-bell', 'Ride Bell', PRO('ride-bell')),
  ],
  dub: { kick: 0, snare: 1, tom: 9, open: 10, hat: 4, rim: 3 },
};
INSTRUMENTS.drums = {
  name: 'Drum Kit Akustik 2', icon: '🥁', color: '#4aa3ff', drum: true,
  pieces: [
    pc('kick', 'Kick', ['drums/kick']), pc('kick2', 'Kick 2', ['drums/kick2']), pc('snare', 'Snare', ['drums/snare']),
    pc('snare2', 'Snare 2', ['drums/snare2']), pc('hihat-short', 'Hi-hat Tutup', ['drums/hihat-short']),
    pc('hihat', 'Hi-hat Buka', ['drums/hihat']), pc('tom1', 'Tom Tinggi', ['drums/tom1']),
    pc('tom2', 'Tom Tengah', ['drums/tom2']), pc('tom3', 'Tom Rendah', ['drums/tom3']),
  ],
  dub: { kick: 0, snare: 2, tom: 8, open: 5, hat: 4, rim: 3 },
};
function toneKit(id, folder, name, icon, color, labels) {
  const ids = ['kick', 'snare', 'hihat', 'tom1', 'tom2', 'tom3'];
  INSTRUMENTS[id] = {
    name, icon, color, drum: true,
    pieces: ids.map((p, i) => pc(p, labels[i], ['drums/' + folder + '/' + p])),
    dub: { kick: 0, snare: 1, tom: 5, open: 2, hat: 2, rim: 3 },
  };
}
const STD = ['Kick', 'Snare', 'Hi-hat', 'Tom Tinggi', 'Tom Tengah', 'Tom Rendah'];
toneKit('perc', 'Bongos', 'Perkusi Bongo / Conga', '🪘', '#e0a060', ['Bass (bung)', 'Slap (tak)', 'Shaker', 'Bongo Tinggi', 'Bongo Tengah', 'Conga Rendah (dung)']);
toneKit('drum-rock', 'Kit8', 'Rock Kit', '🥁', '#ff6b6b', STD);
toneKit('drum-linn', 'LINN', 'Drum Machine 80an (LinnDrum)', '📟', '#c77dff', STD);
toneKit('drum-r8', 'R8', 'Drum Machine R8', '📟', '#9d8cff', STD);
toneKit('drum-cr78', 'CR78', 'Vintage CR-78', '📻', '#b9a36b', STD);
toneKit('drum-break', 'breakbeat8', 'Breakbeat Kit', '🎛', '#ff9f43', STD);
toneKit('drum-techno', 'Techno', 'Techno Kit', '🎛', '#00d2d3', STD);

const INSTRUMENT_ORDER = ['piano', 'guitar-acoustic', 'guitar-electric', 'bass', 'violin', 'cello', 'flute', 'saxophone', 'trumpet', 'harp',
  'drums-pro', 'drums', 'perc', 'drum-rock', 'drum-linn', 'drum-r8', 'drum-cr78', 'drum-break', 'drum-techno'];

// Loop audio bawaan (rekaman asli) untuk browser Sound FX
const BUILTIN_LOOPS = [
  { id: 'loop:breakbeat', file: 'drums/breakbeat', name: 'Breakbeat Loop' },
  { id: 'loop:conga', file: 'drums/conga-rhythm', name: 'Conga Rhythm Loop' },
  { id: 'loop:break12', file: 'loops/break12', name: 'Break 12' },
  { id: 'loop:break28', file: 'loops/break28', name: 'Break 28' },
  { id: 'loop:break29', file: 'loops/break29', name: 'Break 29' },
  { id: 'loop:coolloop7', file: 'loops/coolloop7', name: 'Cool Loop 7' },
  { id: 'loop:blueyellow', file: 'loops/blueyellow', name: 'Blue Yellow' },
  { id: 'loop:ominous', file: 'loops/ominous', name: 'Ominous' },
  { id: 'loop:organ', file: 'loops/organ-echo-chords', name: 'Organ Echo Chords' },
];

// -------- Loader sampel (per file, sesuai kebutuhan) --------
// 1) fetch MP3 langsung (http/https)  2) fallback "pack" JS base64 (file://)
window.SAMPLE_PACKS = window.SAMPLE_PACKS || {};
const _packLoads = {};
function loadPackScript(path) {
  if (window.SAMPLE_PACKS[path]) return Promise.resolve(window.SAMPLE_PACKS[path]);
  if (_packLoads[path]) return _packLoads[path];
  _packLoads[path] = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'samples/packs/' + path.replace(/\//g, '__') + '.js';
    s.onload = () => res(window.SAMPLE_PACKS[path]);
    s.onerror = () => { delete _packLoads[path]; rej(new Error('Sampel ' + path + ' gagal dimuat')); };
    document.head.appendChild(s);
  });
  return _packLoads[path];
}
function b64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
async function fetchSampleBytes(path) {
  if (location.protocol !== 'file:') {
    try {
      const r = await fetch('samples/' + path + '.mp3');
      if (r.ok) return await r.arrayBuffer();
    } catch (e) { /* fallback ke pack */ }
  }
  return b64ToArrayBuffer(await loadPackScript(path));
}

const SAMPLE_BUF = {};  // path -> AudioBuffer
const _sampleLoads = {};
function loadSample(ctx, path) {
  if (SAMPLE_BUF[path]) return Promise.resolve(SAMPLE_BUF[path]);
  if (!_sampleLoads[path]) {
    _sampleLoads[path] = fetchSampleBytes(path).then((b) => ctx.decodeAudioData(b)).then((buf) => (SAMPLE_BUF[path] = buf))
      .catch((e) => { delete _sampleLoads[path]; throw e; });
  }
  return _sampleLoads[path];
}
function notePath(def, n) { return def.folder + '/' + n; }
// nada rekaman ASLI terdekat untuk pitch p (nama sampel)
function nearestNote(def, p) {
  let best = def.notes[0], bd = 1e9;
  for (const n of def.notes) { const d = Math.abs(noteToMidi(n) - p); if (d < bd) { bd = d; best = n; } }
  return best;
}
// muat instrumen: drum = semua piece; melodi = set inti + nada persis yang dipakai lagu
async function loadInstrument(ctx, id, pitches) {
  const def = INSTRUMENTS[id];
  const paths = new Set();
  if (def.drum) def.pieces.forEach((p) => p.files.forEach((f) => paths.add(f)));
  else {
    const step = def.notes.length > 30 ? 4 : 1;
    def.notes.forEach((n, i) => { if (i % step === 0 || i === def.notes.length - 1) paths.add(notePath(def, n)); });
    (pitches || []).forEach((p) => paths.add(notePath(def, nearestNote(def, p))));
  }
  await Promise.all([...paths].map((p) => loadSample(ctx, p)));
  def.loaded = true;
  return def;
}

async function loadBuiltinLoop(ctx, loop) {
  const bytes = await fetchSampleBytes(loop.file);
  const copy = bytes.slice(0);
  const buffer = await ctx.decodeAudioData(bytes);
  return { buffer, bytes: copy };
}

// Pilih sampel: drum -> lapis velocity; melodi -> rekaman nada itu sendiri
// (kalau belum termuat, dimuat di latar & sementara pakai nada terdekat)
function pickSample(def, p, vel) {
  if (def.drum) {
    const pcs = def.pieces[p];
    if (!pcs) return null;
    const f = pcs.files[pcs.files.length > 1 && (vel == null || vel >= 0.6) ? 1 : 0];
    const buf = SAMPLE_BUF[f] || SAMPLE_BUF[pcs.files[0]];
    return buf ? { buffer: buf, rate: 1 } : null;
  }
  const exact = nearestNote(def, p);
  const ep = notePath(def, exact);
  if (SAMPLE_BUF[ep]) return { buffer: SAMPLE_BUF[ep], rate: Math.pow(2, (p - noteToMidi(exact)) / 12) };
  if (E.ctx) loadSample(E.ctx, ep).catch(() => {});
  let best = null, bd = 1e9;
  for (const n of def.notes) {
    const b = SAMPLE_BUF[notePath(def, n)]; if (!b) continue;
    const d = Math.abs(noteToMidi(n) - p);
    if (d < bd) { bd = d; best = { buffer: b, rate: Math.pow(2, (p - noteToMidi(n)) / 12) }; }
  }
  return best;
}
