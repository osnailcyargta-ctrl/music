/* =========================================================
   DUBLER — ngomong / nyanyi / beatbox ke mic, jadi NOTE
   - Mode melodi: deteksi pitch (algoritma YIN) -> nada piano roll
   - Mode drum (track Drum Kit): beatbox -> kick / snare / hi-hat
     ("bum" = kick, "ka/pah" = snare, "tss" = hi-hat)
   ========================================================= */
'use strict';

const SCALES = {
  chromatic: { name: 'Kromatik (semua nada)', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  major: { name: 'Mayor', steps: [0, 2, 4, 5, 7, 9, 11] },
  minor: { name: 'Minor', steps: [0, 2, 3, 5, 7, 8, 10] },
  penta: { name: 'Pentatonik mayor', steps: [0, 2, 4, 7, 9] },
  pentam: { name: 'Pentatonik minor', steps: [0, 3, 5, 7, 10] },
};
const DUB = { scale: 'chromatic', root: 0, octave: 0, sens: 0.5 };

function snapToScale(m) {
  const sc = SCALES[DUB.scale].steps;
  let best = m, bd = 99;
  for (let d = -6; d <= 6; d++) {
    const x = m + d;
    if (sc.includes((((x - DUB.root) % 12) + 12) % 12) && Math.abs(d) < bd) { bd = Math.abs(d); best = x; }
  }
  return best;
}

// YIN pitch detector. x = data, o = offset, W = window. return {f, conf} atau null
function yin(x, o, W, sr, minF = 60, maxF = 1100) {
  const tauMin = Math.max(2, Math.floor(sr / maxF)), tauMax = Math.min(Math.floor(sr / minF), W - 1);
  if (o + W + tauMax >= x.length) return null;
  const d = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let j = 0; j < W; j++) { const v = x[o + j] - x[o + j + tau]; sum += v * v; }
    d[tau] = sum;
  }
  // cumulative mean normalized difference
  let run = 0;
  d[0] = 1;
  for (let tau = 1; tau <= tauMax; tau++) { run += d[tau]; d[tau] = run ? (d[tau] * tau) / run : 1; }
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (d[t] < 0.15) { while (t + 1 <= tauMax && d[t + 1] < d[t]) t++; tau = t; break; }
  }
  if (tau < 0) {
    let mn = 1, mt = -1;
    for (let t = tauMin; t <= tauMax; t++) if (d[t] < mn) { mn = d[t]; mt = t; }
    if (mn > 0.35) return null;
    tau = mt;
  }
  // interpolasi parabola
  let bt = tau;
  if (tau > 1 && tau < tauMax) {
    const a = d[tau - 1], b = d[tau], c = d[tau + 1];
    const den = a + c - 2 * b;
    if (den) bt = tau + (a - c) / (2 * den);
  }
  return { f: sr / bt, conf: 1 - d[tau] };
}
const freqToMidi = (f) => 69 + 12 * Math.log2(f / 440);

function mixMono(buffer, from = 0, to = buffer.length) {
  const n = to - from, out = new Float32Array(n), chs = buffer.numberOfChannels;
  for (let c = 0; c < chs; c++) { const d = buffer.getChannelData(c); for (let i = 0; i < n; i++) out[i] += d[from + i] / chs; }
  return out;
}
function downsample(x, sr) {
  const f = Math.max(1, Math.floor(sr / 11000));
  const out = new Float32Array(Math.floor(x.length / f));
  for (let i = 0; i < out.length; i++) { let s = 0; for (let j = 0; j < f; j++) s += x[i * f + j]; out[i] = s / f; }
  return { x: out, sr: sr / f };
}

// Analisa per frame (10 ms)
function analyzeFrames(mono, sr) {
  const ds = downsample(mono, sr);
  const x = ds.x, dsr = ds.sr;
  const hop = Math.round(dsr * 0.01), W = Math.round(dsr * 0.04);
  const frames = [];
  for (let o = 0; o + W < x.length; o += hop) {
    let e = 0; for (let j = 0; j < W; j++) e += x[o + j] * x[o + j];
    const rms = Math.sqrt(e / W);
    frames.push({ t: o / dsr, rms, pitch: rms > 0.004 ? yin(x, o, W, dsr) : null });
  }
  return { frames, hop: hop / dsr };
}

// Rekaman -> nada melodi. startSec = posisi mulai di buffer; beat0 = beat awal clip
function voiceToNotes(buffer, startSec, durSec, bpm) {
  const sr = buffer.sampleRate;
  const a = Math.max(0, Math.floor(startSec * sr)), b = Math.min(buffer.length, Math.floor((startSec + durSec) * sr));
  const mono = mixMono(buffer, a, b);
  const { frames, hop } = analyzeFrames(mono, sr);
  if (!frames.length) return [];
  const maxRms = Math.max(...frames.map((f) => f.rms));
  const thr = Math.max(0.006, maxRms * (0.18 - DUB.sens * 0.14));
  // nada per frame
  let raw = frames.map((f) => (f.rms > thr && f.pitch && f.pitch.conf > 0.6 ? freqToMidi(f.pitch.f) : null));
  // median filter 5 frame (buang glitch oktaf)
  const med = raw.map((v, i) => {
    if (v == null) return null;
    const w = raw.slice(Math.max(0, i - 2), i + 3).filter((q) => q != null).sort((p, q) => p - q);
    return w[w.length >> 1];
  });
  let n = med.map((v) => (v == null ? null : snapToScale(Math.round(v)) + DUB.octave * 12));
  // isi celah pendek (< 40ms) supaya nada tidak putus-putus
  for (let i = 1; i < n.length - 1; i++) {
    if (n[i] !== n[i - 1]) {
      let j = i; while (j < n.length && n[j] === n[i]) j++;
      if (j - i < 4 && n[i - 1] != null && (j >= n.length || n[j] === n[i - 1])) for (let k = i; k < j; k++) n[k] = n[i - 1];
    }
  }
  const spb = 60 / bpm;
  const notes = [];
  let i = 0;
  while (i < n.length) {
    if (n[i] == null) { i++; continue; }
    let j = i + 1, peak = frames[i].rms;
    while (j < n.length && n[j] === n[i]) {
      // pemisah artikulasi: energi naik tajam lagi di nada yang sama
      const prevMin = Math.min(frames[j - 1].rms, frames[Math.max(i, j - 3)].rms);
      if (j - i > 6 && frames[j].rms > prevMin * 2.2 && frames[j].rms > thr * 2) break;
      peak = Math.max(peak, frames[j].rms); j++;
    }
    if (j - i >= 5) {
      const s = frames[i].t / spb, e = (frames[j - 1].t + hop) / spb;
      notes.push({ p: Math.max(24, Math.min(107, n[i])), s, l: e - s, v: Math.min(1, 0.35 + (peak / maxRms) * 0.65) });
    }
    i = j;
  }
  return quantizeNotes(notes);
}

// Beatbox -> drum (index piece: 0 kick, 2 snare, 4 hihat tutup)
function beatboxToDrums(buffer, startSec, durSec, bpm) {
  const sr = buffer.sampleRate;
  const a = Math.max(0, Math.floor(startSec * sr)), b = Math.min(buffer.length, Math.floor((startSec + durSec) * sr));
  const mono = mixMono(buffer, a, b);
  const hop = Math.round(sr * 0.005), W = hop * 2;
  const env = [];
  for (let o = 0; o + W < mono.length; o += hop) { let e = 0; for (let j = 0; j < W; j++) e += mono[o + j] * mono[o + j]; env.push(Math.sqrt(e / W)); }
  if (!env.length) return [];
  const maxE = Math.max(...env);
  const thr = Math.max(0.01, maxE * (0.25 - DUB.sens * 0.2));
  const spb = 60 / bpm, notes = [];
  let last = -1e9;
  for (let i = 0; i < env.length; i++) {
    const t = (i * hop) / sr;
    const prev = i < 3 ? 0 : Math.min(env[i - 1], env[i - 2], env[i - 3]);
    if (env[i] > thr && env[i] > prev * 1.8 + 0.002 && t - last > 0.08) {
      last = t;
      // estimasi "kecerahan" suara: frekuensi efektif dari energi turunan / energi
      const s0 = i * hop, s1 = Math.min(mono.length, s0 + Math.round(sr * 0.04));
      let e = 0, de = 0, pk = 0;
      for (let k = s0 + 1; k < s1; k++) { e += mono[k] * mono[k]; const dd = mono[k] - mono[k - 1]; de += dd * dd; pk = Math.max(pk, Math.abs(mono[k])); }
      const fc = (sr / (2 * Math.PI)) * Math.sqrt(de / Math.max(e, 1e-9));
      const p = fc < 400 ? 0 : fc > 5500 ? 4 : 2;
      notes.push({ p, s: t / spb, l: 0.25, v: Math.min(1, 0.4 + (pk / Math.max(maxE * 2, 1e-6)) * 0.6) });
    }
  }
  return quantizeNotes(notes, true);
}

function quantizeNotes(notes, drum) {
  const q = UI.snap;
  if (q) {
    for (const n of notes) {
      const e = n.s + n.l;
      n.s = Math.max(0, Math.round(n.s / q) * q);
      n.l = drum ? Math.max(0.25, q) : Math.max(q, Math.round(e / q) * q - n.s);
    }
  }
  // buang dobel (nada sama di posisi sama) & potong tumpang tindih
  notes.sort((a, b) => a.s - b.s || a.p - b.p);
  const out = [];
  for (const n of notes) {
    if (out.some((o) => o.p === n.p && Math.abs(o.s - n.s) < 1e-6)) continue;
    const prev = [...out].reverse().find((o) => o.p === n.p);
    if (prev && prev.s + prev.l > n.s) prev.l = Math.max(0.05, n.s - prev.s);
    out.push(n);
  }
  return out;
}

// Deteksi nada live utk HUD saat merekam
const DubLive = {
  an: null, src: null, buf: null,
  start(stream) {
    this.src = E.ctx.createMediaStreamSource(stream);
    this.an = E.ctx.createAnalyser(); this.an.fftSize = 2048;
    this.buf = new Float32Array(this.an.fftSize);
    this.src.connect(this.an);
    $('#dubHud').classList.remove('hidden');
  },
  stop() {
    if (this.src) { try { this.src.disconnect(); } catch (e) {} }
    this.src = this.an = null;
    $('#dubHud').classList.add('hidden');
  },
  tick(drum) {
    if (!this.an) return;
    this.an.getFloatTimeDomainData(this.buf);
    let e = 0; for (const v of this.buf) e += v * v;
    const rms = Math.sqrt(e / this.buf.length);
    let txt = '—';
    if (rms > 0.01) {
      if (drum) txt = '🥁';
      else {
        const ds = downsample(this.buf, E.ctx.sampleRate);
        const r = yin(ds.x, 0, Math.floor(ds.x.length / 2), ds.sr);
        if (r && r.conf > 0.6) txt = midiToName(snapToScale(Math.round(freqToMidi(r.f))) + DUB.octave * 12);
      }
    }
    $('#dubNote').textContent = txt;
    $('#dubLevel').style.width = Math.min(100, Math.sqrt(rms) * 250) + '%';
  },
};
