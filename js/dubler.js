/* =========================================================
   DUBLER — REAL-TIME: nyanyi / senandung / beatbox ke mic,
   instrumen LANGSUNG bunyi mengikuti suaramu dan tiap nada
   dicatat jadi NOTE di piano roll.
   - Melodi: deteksi pitch YIN + filter stabilitas (hysteresis),
     jadi vibrato / suara goyang tidak bikin nada loncat-loncat.
   - Drum Kit: beatbox — "bum" = kick, "ka/pah" = snare, "tss" = hi-hat.
   ========================================================= */
'use strict';

const SCALES = {
  chromatic: { name: 'Kromatik (semua nada)', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  major: { name: 'Mayor', steps: [0, 2, 4, 5, 7, 9, 11] },
  minor: { name: 'Minor', steps: [0, 2, 3, 5, 7, 8, 10] },
  penta: { name: 'Pentatonik mayor', steps: [0, 2, 4, 7, 9] },
  pentam: { name: 'Pentatonik minor', steps: [0, 3, 5, 7, 10] },
};
// monitor = instrumen bunyi live, quant = rapikan ke grid Snap
const DUB = { scale: 'major', root: 0, octave: 0, sens: 0.5, monitor: true, quant: true, stable: 0.5 };

function snapToScale(m) {
  const sc = SCALES[DUB.scale].steps;
  let best = m, bd = 99;
  for (let d = 0; d <= 6; d++) {
    for (const x of [m - d, m + d]) {
      if (sc.includes((((x - DUB.root) % 12) + 12) % 12) && d < bd) { bd = d; best = x; }
    }
    if (bd < 99) break;
  }
  return best;
}

// YIN pitch detector. return {f, conf} atau null
function yin(x, o, W, sr, minF = 65, maxF = 1000) {
  const tauMin = Math.max(2, Math.floor(sr / maxF)), tauMax = Math.min(Math.floor(sr / minF), W - 1);
  if (o < 0 || o + W + tauMax >= x.length) return null;
  const d = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let j = 0; j < W; j++) { const v = x[o + j] - x[o + j + tau]; sum += v * v; }
    d[tau] = sum;
  }
  let run = 0;
  d[0] = 1;
  for (let tau = 1; tau <= tauMax; tau++) { run += d[tau]; d[tau] = run ? (d[tau] * tau) / run : 1; }
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (d[t] < 0.12) { while (t + 1 <= tauMax && d[t + 1] < d[t]) t++; tau = t; break; }
  }
  if (tau < 0) {
    let mn = 1, mt = -1;
    for (let t = tauMin; t <= tauMax; t++) if (d[t] < mn) { mn = d[t]; mt = t; }
    if (mn > 0.3) return null;
    tau = mt;
  }
  let bt = tau;
  if (tau > 1 && tau < tauMax) {
    const a = d[tau - 1], b = d[tau], c = d[tau + 1], den = a + c - 2 * b;
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

// Fitur dari potongan audio TERBARU (seg berakhir di "sekarang")
function frameFeatures(seg, sr, drum) {
  const N = Math.min(seg.length, Math.round(sr * 0.025));
  let e = 0, de = 0;
  for (let i = seg.length - N + 1; i < seg.length; i++) { const v = seg[i]; e += v * v; const dd = v - seg[i - 1]; de += dd * dd; }
  const rms = Math.sqrt(e / N);
  const bright = (sr / (2 * Math.PI)) * Math.sqrt(de / Math.max(e, 1e-12));
  let pf = null, conf = 0;
  if (!drum && rms > 0.002) {
    const ds = downsample(seg, sr);
    const W = Math.round(ds.sr * 0.035), tauMax = Math.floor(ds.sr / 65);
    const r = yin(ds.x, ds.x.length - W - tauMax - 1, W, ds.sr);
    if (r) { pf = freqToMidi(r.f); conf = r.conf; }
  }
  return { rms, bright, pf, conf };
}

// Mesin pelacak nada: frame masuk -> event note on / off
class DubTracker {
  constructor(drum, cb) {
    this.drum = drum; this.cb = cb;
    this.cur = null; this.cand = null; this.candT = 0; this.silentT = null; this.onT = 0;
    this.floor = 0.004; this.hist = []; this.lastHit = -1;
  }
  gate() { return Math.max(0.012, this.floor * 3) * (1.6 - DUB.sens * 1.2); }
  process(t, f) {
    // pelacak noise floor (naik pelan, turun cepat)
    this.floor = Math.max(0.0015, Math.min(this.floor * 1.004 + 1e-6, f.rms < this.floor ? f.rms : this.floor * 1.004 + 1e-6));
    this.hist.push({ t, rms: f.rms });
    while (this.hist.length && t - this.hist[0].t > 0.12) this.hist.shift();
    const g = this.gate();
    const recentMin = (win) => { let m = Infinity; for (const x of this.hist) if (t - x.t <= win && t - x.t > 0.005) m = Math.min(m, x.rms); return m === Infinity ? 0 : m; };
    const vel = Math.min(1, 0.35 + Math.sqrt(f.rms) * 1.4);

    if (this.drum) {
      // klasifikasi beatbox ditunda ~50ms supaya tahu karakter bunyinya:
      // bung = kick, dung = tom rendah (bunyi rendah yg panjang), tak/ka = snare,
      // tss = hi-hat tutup, dess/cesss = crash / hi-hat buka (desis panjang)
      const pd = this.pending;
      if (pd) {
        pd.peak = Math.max(pd.peak, f.rms); pd.bs += f.bright; pd.n++;
        if (t - pd.t >= 0.05) {
          const br = pd.bs / pd.n, decay = f.rms / pd.peak, map = this.drum;
          let p;
          if (br < 500) p = decay > 0.7 ? map.tom : map.kick;
          else if (br > 6000) p = decay > 0.5 ? map.open : map.hat;
          else p = br < 1100 && decay < 0.3 ? map.rim : map.snare;
          this.lastPiece = p;
          this.cb.on(p, Math.min(1, 0.35 + Math.sqrt(pd.peak) * 1.4), pd.t);
          this.cb.off(pd.t + 0.05);
          this.pending = null;
        }
        return;
      }
      if (f.rms > g * 1.3 && f.rms > recentMin(0.05) * 1.8 + 0.003 && t - this.lastHit > 0.09) {
        this.lastHit = t;
        this.pending = { t, peak: f.rms, bs: f.bright, n: 1 };
      }
      return;
    }
    const voiced = f.rms > g && f.pf != null && f.conf > 0.55;
    const shift = DUB.octave * 12;
    const m = voiced ? snapToScale(Math.round(f.pf)) + shift : null;
    const holdOn = 0.02 + DUB.stable * 0.04;      // nada harus stabil segini dulu
    const holdSwitch = 0.03 + DUB.stable * 0.07;  // ganti nada butuh stabil segini

    if (this.cur == null) {
      if (!voiced) { this.cand = null; return; }
      if (this.cand === m) {
        if (t - this.candT >= holdOn) { this.start(m, vel, this.candT); }
      } else { this.cand = m; this.candT = t; }
      return;
    }
    if (!voiced) {
      if (this.silentT == null) this.silentT = t;
      if (t - this.silentT >= 0.07) { this.cb.off(this.silentT); this.cur = null; this.cand = null; this.silentT = null; }
      return;
    }
    this.silentT = null;
    // hysteresis: cuma pindah nada kalau suaramu benar2 jauh dari nada sekarang
    if (m !== this.cur && Math.abs(f.pf + shift - this.cur) > 0.75) {
      if (this.cand === m) {
        if (t - this.candT >= holdSwitch) { this.cb.off(this.candT); this.start(m, vel, this.candT); }
      } else { this.cand = m; this.candT = t; }
      return;
    }
    this.cand = null;
    // artikulasi ulang ("da-da-da" di nada yang sama)
    if (t - this.onT > 0.14 && f.rms > g * 2 && f.rms > recentMin(0.08) * 2.4) {
      this.cb.off(t); this.start(this.cur, vel, t);
    }
  }
  start(m, vel, t) { this.cur = m; this.cand = null; this.onT = t; this.cb.on(m, vel, t); }
  finish(t) { if (this.cur != null) this.cb.off(t); this.cur = null; }
}

// Event (detik) -> note (beat)
function eventsToNotes(events, spb, drum) {
  const notes = [];
  let open = null;
  for (const e of events) {
    if (e.type === 'on') {
      if (open) { open.l = Math.max(0.01, e.t - open.s); }
      open = { p: e.p, s: e.t, l: 0, v: e.v };
      notes.push(open);
    } else if (open) { open.l = Math.max(0.01, e.t - open.s); open = null; }
  }
  if (open && !open.l) open.l = 0.25 * spb;
  const out = [];
  for (const n of notes) {
    if (!drum && n.l < 0.06) continue; // buang kedipan
    out.push({ p: n.p, s: n.s / spb, l: drum ? 0.25 : n.l / spb, v: n.v });
  }
  return quantizeNotes(out, drum);
}

// Analisa offline (clip audio yang sudah ada) memakai pelacak yang sama
function analyzeAudio(buffer, startSec, durSec, bpm, drum) {
  const sr = buffer.sampleRate;
  const a = Math.max(0, Math.floor(startSec * sr)), b = Math.min(buffer.length, Math.floor((startSec + durSec) * sr));
  const mono = mixMono(buffer, a, b);
  const hop = Math.round(sr * 0.01), SEG = Math.round(sr * 0.085);
  const events = [];
  const tr = new DubTracker(drum, { on: (p, v, t) => events.push({ type: 'on', p, v, t }), off: (t) => events.push({ type: 'off', t }) });
  for (let i = hop * 3; i <= mono.length; i += hop) tr.process(Math.max(0, i / sr - 0.025), frameFeatures(mono.subarray(Math.max(0, i - SEG), i), sr, drum));
  tr.finish(mono.length / sr);
  return eventsToNotes(events, 60 / bpm, drum);
}
const voiceToNotes = (buf, s, d, bpm) => analyzeAudio(buf, s, d, bpm, false);
const beatboxToDrums = (buf, s, d, bpm, map) => analyzeAudio(buf, s, d, bpm, map);

function quantizeNotes(notes, drum) {
  const q = DUB.quant ? UI.snap : 0;
  if (q) {
    for (const n of notes) {
      const e = n.s + n.l;
      n.s = Math.max(0, Math.round(n.s / q) * q);
      n.l = drum ? Math.max(0.25, q) : Math.max(q, Math.round(e / q) * q - n.s);
    }
  }
  notes.sort((a, b) => a.s - b.s || a.p - b.p);
  const out = [];
  for (const n of notes) {
    if (out.some((o) => o.p === n.p && Math.abs(o.s - n.s) < 1e-6)) continue;
    if (!drum) { // monofonik: potong nada sebelumnya
      const prev = out[out.length - 1];
      if (prev && prev.s + prev.l > n.s) prev.l = Math.max(q || 0.05, n.s - prev.s);
      if (prev && prev.l <= 0) out.pop();
    }
    out.push(n);
  }
  return out;
}

// ---------- mainkan instrumen live ----------
function liveNoteOn(track, p, vel) {
  const def = INSTRUMENTS[track.inst], s = E.strips[track.id];
  if (!def || !def.loaded || !s) return null;
  const pick = pickSample(def, def.drum ? p : p + (track.transpose || 0), vel);
  if (!pick) return null;
  const ctx = E.ctx, now = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = pick.buffer; src.playbackRate.value = pick.rate;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(Math.pow(vel, 1.3), now + 0.005);
  src.connect(g); g.connect(s.input); src.start(now);
  if (def.drum) src.stop(now + pick.buffer.duration + 0.05);
  return { src, g, def };
}
function liveNoteOff(hd) {
  if (!hd || hd.def.drum) return;
  const now = E.ctx.currentTime, rel = hd.def.release;
  hd.g.gain.cancelScheduledValues(now);
  hd.g.gain.setValueAtTime(hd.g.gain.value, now);
  hd.g.gain.setTargetAtTime(0, now, rel / 4);
  try { hd.src.stop(now + rel * 1.5); } catch (e) {}
}

// ---------- sesi Dubler live ----------
const DubLive = {
  an: null, src: null, buf: null, tracker: null, events: [], track: null, playing: null, count: 0,
  latency: 0.06,
  start(stream, track) {
    this.track = track;
    this.events = []; this.count = 0;
    this.src = E.ctx.createMediaStreamSource(stream);
    this.an = E.ctx.createAnalyser(); this.an.fftSize = 4096;
    this.buf = new Float32Array(this.an.fftSize);
    this.src.connect(this.an);
    const def = INSTRUMENTS[track.inst], drum = def.drum ? def.dub : false;
    this.tracker = new DubTracker(drum, {
      on: (p, v, t) => {
        this.events.push({ type: 'on', p, v, t: t - this.latency });
        window._dbg && console.log('DUB on', p, t);
        this.count++;
        if (this.playing) liveNoteOff(this.playing);
        this.playing = DUB.monitor ? liveNoteOn(this.track, p, v) : null;
        this.lastNote = p;
      },
      off: (t) => {
        this.events.push({ type: 'off', t: t - this.latency });
        liveNoteOff(this.playing); this.playing = null; if (!this.tracker.drum) this.lastNote = null;
      },
    });
    $('#dubHud').classList.remove('hidden');
    $('#dubHud').classList.toggle('drum', !!drum);
  },
  stop() {
    if (!this.an) return [];
    this.tracker.finish(E.ctx.currentTime);
    liveNoteOff(this.playing); this.playing = null;
    try { this.src.disconnect(); } catch (e) {}
    this.src = this.an = null;
    $('#dubHud').classList.add('hidden');
    return this.events;
  },
  tick() {
    if (!this.an) return;
    this.an.getFloatTimeDomainData(this.buf);
    const drum = this.tracker.drum;
    const f = frameFeatures(this.buf, E.ctx.sampleRate, drum);
    this.tracker.process(E.ctx.currentTime, f);
    let txt;
    if (drum) txt = this.lastNote != null ? INSTRUMENTS[this.track.inst].pieces[this.lastNote].label : '🥁';
    else txt = this.tracker.cur != null ? midiToName(this.tracker.cur) : (f.pf != null && f.rms > this.tracker.gate() ? '…' : '—');
    $('#dubNote').textContent = txt;
    $('#dubCount').textContent = this.count + ' note';
    const lv = Math.min(100, Math.sqrt(f.rms) * 250);
    $('#dubLevel').style.width = lv + '%';
    $('#dubGate').style.left = Math.min(100, Math.sqrt(this.tracker.gate()) * 250) + '%';
    if (drum && this.lastNote != null && E.ctx.currentTime - this.tracker.lastHit > 0.2) this.lastNote = null;
  },
};
