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
  piano: {
    name: 'Grand Piano', icon: '🎹', color: '#f0a33a', release: 0.45,
    notes: ['A1', 'C2', 'Ds2', 'Fs2', 'A2', 'C3', 'Ds3', 'Fs3', 'A3', 'C4', 'Ds4', 'Fs4', 'A4', 'C5', 'Ds5', 'Fs5', 'A5', 'C6', 'Fs6', 'C7'],
  },
  'guitar-acoustic': {
    name: 'Gitar Akustik', icon: '🎸', color: '#d9824b', release: 0.35,
    notes: ['E2', 'A2', 'D3', 'G3', 'C4', 'E4', 'A4', 'D5'],
  },
  'guitar-electric': {
    name: 'Gitar Elektrik', icon: '🎸', color: '#e0584f', release: 0.3,
    notes: ['E2', 'A2', 'C3', 'Fs3', 'C4', 'Fs4', 'C5', 'A5'],
  },
  bass: {
    name: 'Bass Elektrik', icon: '🎸', color: '#8a6df0', release: 0.2,
    notes: ['E1', 'G1', 'As1', 'Cs2', 'E2', 'G2', 'As2', 'Cs3', 'E3', 'G3'],
  },
  violin: {
    name: 'Biola', icon: '🎻', color: '#c26a3a', release: 0.3,
    notes: ['G3', 'C4', 'E4', 'A4', 'C5', 'E5', 'A5', 'C6'],
  },
  cello: {
    name: 'Cello', icon: '🎻', color: '#9c5a36', release: 0.35,
    notes: ['C2', 'E2', 'A2', 'C3', 'E3', 'A3', 'C4', 'E4'],
  },
  flute: {
    name: 'Seruling (Flute)', icon: '🪈', color: '#5ec8e0', release: 0.2,
    notes: ['C4', 'E4', 'A4', 'C5', 'E5', 'A5', 'C6'],
  },
  saxophone: {
    name: 'Saxophone', icon: '🎷', color: '#e8c547', release: 0.2,
    notes: ['Cs3', 'E3', 'G3', 'As3', 'Cs4', 'E4', 'G4', 'A4', 'Cs5', 'F5'],
  },
  trumpet: {
    name: 'Trumpet', icon: '🎺', color: '#f2d06b', release: 0.15,
    notes: ['F3', 'A3', 'C4', 'F4', 'As4', 'D5', 'F5', 'C6'],
  },
  harp: {
    name: 'Harpa', icon: '🪕', color: '#63d49a', release: 0.8,
    notes: ['E1', 'B1', 'F2', 'C3', 'G3', 'D4', 'A4', 'E5', 'B5', 'F6'],
  },
  drums: {
    name: 'Drum Kit (akustik)', icon: '🥁', color: '#4aa3ff', drum: true, folder: 'drums',
    pieces: [
      { id: 'kick', label: 'Kick' },
      { id: 'kick2', label: 'Kick 2' },
      { id: 'snare', label: 'Snare' },
      { id: 'snare2', label: 'Snare 2' },
      { id: 'hihat-short', label: 'Hi-hat Tutup' },
      { id: 'hihat', label: 'Hi-hat Buka' },
      { id: 'tom1', label: 'Tom Tinggi' },
      { id: 'tom2', label: 'Tom Tengah' },
      { id: 'tom3', label: 'Tom Rendah' },
    ],
  },
};
const INSTRUMENT_ORDER = ['piano', 'guitar-acoustic', 'guitar-electric', 'bass', 'violin', 'cello', 'flute', 'saxophone', 'trumpet', 'harp', 'drums'];

// Loop audio bawaan (rekaman asli) untuk browser Sound FX
const BUILTIN_LOOPS = [
  { id: 'loop:breakbeat', file: 'breakbeat', name: 'Breakbeat Loop (drum)' },
  { id: 'loop:conga', file: 'conga-rhythm', name: 'Conga Rhythm Loop' },
];

// -------- Loader sampel --------
// 1) coba fetch file MP3 langsung (jalan kalau dibuka lewat http/https)
// 2) kalau gagal (misal dibuka dari file:// ), pakai "pack" JS berisi MP3 base64
window.SAMPLE_PACKS = window.SAMPLE_PACKS || {};
const _packLoads = {};
function loadPackScript(id) {
  if (window.SAMPLE_PACKS[id]) return Promise.resolve(window.SAMPLE_PACKS[id]);
  if (_packLoads[id]) return _packLoads[id];
  _packLoads[id] = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'samples/packs/' + id + '.js';
    s.onload = () => res(window.SAMPLE_PACKS[id]);
    s.onerror = () => rej(new Error('Pack ' + id + ' gagal dimuat'));
    document.head.appendChild(s);
  });
  return _packLoads[id];
}
function b64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
async function fetchSampleBytes(packId, folder, name) {
  if (location.protocol !== 'file:') {
    try {
      const r = await fetch('samples/' + folder + '/' + name + '.mp3');
      if (r.ok) return await r.arrayBuffer();
    } catch (e) { /* fallback ke pack */ }
  }
  const pack = await loadPackScript(packId);
  return b64ToArrayBuffer(pack[name]);
}

const instCache = {}; // id -> Promise<{samples:[{midi,buffer}], pieces:{id:buffer}}>
function loadInstrument(ctx, id) {
  if (instCache[id]) return instCache[id];
  const def = INSTRUMENTS[id];
  const folder = def.folder || id;
  instCache[id] = (async () => {
    if (def.drum) {
      const pieces = {};
      await Promise.all(def.pieces.map(async (pc) => {
        const bytes = await fetchSampleBytes(id, folder, pc.id);
        pieces[pc.id] = await ctx.decodeAudioData(bytes);
      }));
      def.loaded = { pieces };
    } else {
      const samples = await Promise.all(def.notes.map(async (n) => {
        const bytes = await fetchSampleBytes(id, folder, n);
        return { midi: noteToMidi(n), buffer: await ctx.decodeAudioData(bytes) };
      }));
      samples.sort((a, b) => a.midi - b.midi);
      def.loaded = { samples };
    }
    return def.loaded;
  })();
  instCache[id].catch(() => { delete instCache[id]; });
  return instCache[id];
}

async function loadBuiltinLoop(ctx, loop) {
  const bytes = await fetchSampleBytes('loops', 'drums', loop.file);
  const copy = bytes.slice(0);
  const buffer = await ctx.decodeAudioData(bytes);
  return { buffer, bytes: copy };
}

// Pilih sampel terdekat untuk sebuah nada, kembalikan buffer + rasio pitch
function pickSample(def, p) {
  if (def.drum) {
    const pc = def.pieces[p];
    if (!pc || !def.loaded) return null;
    return { buffer: def.loaded.pieces[pc.id], rate: 1 };
  }
  if (!def.loaded) return null;
  const s = def.loaded.samples;
  let best = s[0];
  for (const x of s) if (Math.abs(x.midi - p) < Math.abs(best.midi - p)) best = x;
  return { buffer: best.buffer, rate: Math.pow(2, (p - best.midi) / 12) };
}
