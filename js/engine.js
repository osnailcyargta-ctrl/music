/* =========================================================
   AUDIO ENGINE — Web Audio API
   - Channel strip per track: EQ 3-band, filter, volume, pan, mute/solo,
     send ke Reverb & Delay (bus FX bersama), meter.
   - Automation (keyframe + kurva kustom) untuk volume, pan, reverb,
     pitch, speed, filter.
   - Clip audio: gain, pitch, speed, keep-pitch (time-stretch WSOLA),
     reverse, fade in/out.
   - Export WAV (render offline), rekam mikrofon.
   ========================================================= */
'use strict';

// ---------- Registry audio (file import / rekaman / loop bawaan) ----------
const AUDIO = {}; // id -> { name, buffer, bytes, peaks }

// ---------- Parameter automation ----------
const AUTO_PARAMS = {
  volume: { label: 'Volume', def: 0.8, color: '#ffb347', fmt: (v) => Math.round(v * 125) + '%' },
  pan: { label: 'Pan', def: 0.5, color: '#57c7ff', fmt: (v) => { const p = Math.round((v * 2 - 1) * 100); return p === 0 ? 'C' : (p < 0 ? 'L' + -p : 'R' + p); } },
  reverb: { label: 'Reverb', def: 0, color: '#b388ff', fmt: (v) => Math.round(v * 100) + '%' },
  pitch: { label: 'Pitch', def: 0.5, color: '#7dff9b', fmt: (v) => { const s = (v * 2 - 1) * 12; return (s >= 0 ? '+' : '') + s.toFixed(1) + ' st'; } },
  speed: { label: 'Speed', def: 0.5, color: '#ff7eb6', fmt: (v) => Math.pow(2, v * 2 - 1).toFixed(2) + 'x' },
  filter: { label: 'Filter LP', def: 1, color: '#ffe066', fmt: (v) => Math.round(40 * Math.pow(500, v)) + ' Hz' },
};
const AUTO_ORDER = ['volume', 'pan', 'reverb', 'pitch', 'speed', 'filter'];
const autoMap = {
  volume: (v) => v * 1.25,
  pan: (v) => v * 2 - 1,
  reverb: (v) => v,
  pitch: (v) => (v * 2 - 1) * 1200, // cents
  speed: (v) => Math.pow(2, v * 2 - 1),
  filter: (v) => 40 * Math.pow(500, v),
};

// Bentuk kurva antar keyframe. c = tension (-1..1), m = mode
const CURVE_MODES = { curve: 'Kurva tunggal', scurve: 'Kurva S', hold: 'Hold (tahan)', stairs: 'Tangga', pulse: 'Pulsa' };
function shapeCurve(f, c, m) {
  c = c || 0;
  switch (m) {
    case 'hold': return 0;
    case 'stairs': { const g = f < 1 ? Math.floor(f * 4) / 4 : 1; return g; }
    case 'pulse': { const n = 4 + Math.round((c + 1) * 6); return Math.floor(f * n * 2) % 2 ? 0 : 1; }
    case 'scurve': {
      const e = Math.max(0.35, 2 + c * 5);
      return f < 0.5 ? 0.5 * Math.pow(2 * f, e) : 1 - 0.5 * Math.pow(2 - 2 * f, e);
    }
    default: {
      const e = c >= 0 ? 1 + c * 7 : 1 / (1 - c * 7);
      return Math.pow(f, e);
    }
  }
}
// Nilai automation (0..1) pada beat t
function autoValueAt(points, t) {
  if (!points.length) return null;
  if (t <= points[0].t) return points[0].v;
  const last = points[points.length - 1];
  if (t >= last.t) return last.v;
  let i = 0;
  while (i < points.length - 1 && points[i + 1].t <= t) i++;
  const a = points[i], b = points[i + 1];
  const span = b.t - a.t;
  if (span <= 0) return b.v;
  const f = (t - a.t) / span;
  return a.v + (b.v - a.v) * shapeCurve(f, a.c, a.m);
}

// ---------- Engine ----------
const E = {
  ctx: null,
  master: null,
  strips: {},       // trackId -> strip (live)
  active: [],       // node sumber yang sedang dijadwalkan (live)
  stretchCache: {},
  reverseCache: {},
  metronome: false,

  init() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.master = createMaster(this.ctx, P, true);
    return this.ctx;
  },
  async resume() { this.init(); if (this.ctx.state !== 'running') await this.ctx.resume(); },
};

function createMaster(ctx, proj, live) {
  const m = {};
  m.input = ctx.createGain();
  m.gain = ctx.createGain();
  m.gain.gain.value = proj.master.vol;
  m.limiter = ctx.createDynamicsCompressor();
  m.limiter.threshold.value = -3; m.limiter.knee.value = 3; m.limiter.ratio.value = 20;
  m.limiter.attack.value = 0.002; m.limiter.release.value = 0.12;
  m.input.connect(m.gain); m.gain.connect(m.limiter); m.limiter.connect(ctx.destination);
  if (live) {
    m.analyser = ctx.createAnalyser(); m.analyser.fftSize = 1024;
    m.limiter.connect(m.analyser);
  }
  // Reverb bus
  m.revIn = ctx.createGain();
  m.revPre = ctx.createDelay(0.2);
  m.conv = ctx.createConvolver();
  m.revOut = ctx.createGain();
  m.revIn.connect(m.revPre); m.revPre.connect(m.conv); m.conv.connect(m.revOut); m.revOut.connect(m.input);
  // Delay bus (ping-pong sederhana)
  m.delIn = ctx.createGain();
  m.delL = ctx.createDelay(4); m.delR = ctx.createDelay(4);
  m.fb = ctx.createGain(); m.delLP = ctx.createBiquadFilter(); m.delLP.type = 'lowpass'; m.delLP.frequency.value = 5000;
  const merger = ctx.createChannelMerger(2);
  m.delOut = ctx.createGain();
  m.delIn.connect(m.delL); m.delL.connect(m.delLP); m.delLP.connect(m.delR); m.delR.connect(m.fb); m.fb.connect(m.delL);
  m.delL.connect(merger, 0, 0); m.delR.connect(merger, 0, 1); merger.connect(m.delOut); m.delOut.connect(m.input);
  updateMasterFx(ctx, m, proj);
  return m;
}
function updateMasterFx(ctx, m, proj) {
  const M = proj.master;
  m.gain.gain.setTargetAtTime(M.vol, ctx.currentTime, 0.02);
  const key = M.revSize.toFixed(2) + '|' + M.revDecay.toFixed(2);
  if (m._irKey !== key) { m.conv.buffer = makeIR(ctx, M.revSize, M.revDecay); m._irKey = key; }
  m.revPre.delayTime.value = M.revPre;
  m.revOut.gain.value = M.revLevel;
  const beat = 60 / proj.bpm;
  m.delL.delayTime.value = beat * M.delBeats;
  m.delR.delayTime.value = beat * M.delBeats;
  m.fb.gain.value = M.delFb;
  m.delOut.gain.value = M.delLevel;
}
// Impulse response reverb (ruangan): noise stereo dengan peluruhan eksponensial
function makeIR(ctx, seconds, decay) {
  const rate = ctx.sampleRate, len = Math.max(1, Math.floor(rate * seconds));
  const ir = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      lp = lp * 0.6 + (Math.random() * 2 - 1) * 0.4; // sedikit redam frekuensi tinggi
      d[i] = lp * Math.pow(1 - t, decay) * (i < rate * 0.004 ? i / (rate * 0.004) : 1);
    }
  }
  return ir;
}

function createStrip(ctx, track, master, live) {
  const s = {};
  s.input = ctx.createGain();
  s.eqL = ctx.createBiquadFilter(); s.eqL.type = 'lowshelf'; s.eqL.frequency.value = 220;
  s.eqM = ctx.createBiquadFilter(); s.eqM.type = 'peaking'; s.eqM.frequency.value = 1100; s.eqM.Q.value = 0.8;
  s.eqH = ctx.createBiquadFilter(); s.eqH.type = 'highshelf'; s.eqH.frequency.value = 5000;
  s.filt = ctx.createBiquadFilter(); s.filt.type = 'lowpass'; s.filt.Q.value = 0.8; s.filt.frequency.value = 20000;
  s.vol = ctx.createGain();
  s.pan = ctx.createStereoPanner();
  s.mute = ctx.createGain();
  s.sendRev = ctx.createGain();
  s.sendDel = ctx.createGain();
  s.input.connect(s.eqL); s.eqL.connect(s.eqM); s.eqM.connect(s.eqH); s.eqH.connect(s.filt);
  s.filt.connect(s.vol); s.vol.connect(s.pan); s.pan.connect(s.mute); s.mute.connect(master.input);
  s.mute.connect(s.sendRev); s.sendRev.connect(master.revIn);
  s.mute.connect(s.sendDel); s.sendDel.connect(master.delIn);
  if (live) {
    s.analyser = ctx.createAnalyser(); s.analyser.fftSize = 512;
    s.mute.connect(s.analyser);
  }
  return s;
}
function hasAuto(track, key) { return track.auto[key] && track.auto[key].length > 0; }
function applyStripStatic(ctx, s, track, anySolo, now) {
  const t = now == null ? ctx.currentTime : now;
  const set = (param, v) => { param.cancelScheduledValues(t); param.setTargetAtTime(v, t, 0.015); };
  set(s.eqL.gain, track.eq.low); set(s.eqM.gain, track.eq.mid); set(s.eqH.gain, track.eq.high);
  if (!hasAuto(track, 'volume')) set(s.vol.gain, track.vol);
  if (!hasAuto(track, 'pan')) set(s.pan.pan, track.pan);
  if (!hasAuto(track, 'reverb')) set(s.sendRev.gain, track.reverb);
  if (!hasAuto(track, 'filter')) set(s.filt.frequency, 20000);
  set(s.sendDel.gain, track.delay);
  set(s.mute.gain, (track.mute || (anySolo && !track.solo)) ? 0 : 1);
}

// Sampling kurva automation ke Float32Array utk setValueCurveAtTime
const AUTO_RATE = 120; // titik per detik
function buildCurve(points, b0, b1, spb, mapFn) {
  const dur = (b1 - b0) * spb;
  const n = Math.max(2, Math.ceil(dur * AUTO_RATE));
  const arr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const beat = b0 + (i / (n - 1)) * (b1 - b0);
    arr[i] = mapFn(autoValueAt(points, beat));
  }
  return arr;
}
function setCurve(param, arr, when, dur) {
  try {
    param.cancelScheduledValues(when);
    param.setValueAtTime(arr[0], when);
    if (dur > 0.01) param.setValueCurveAtTime(arr, when + 0.0005, dur - 0.003);
  } catch (e) { /* abaikan tumpang tindih kecil */ }
}

// ---------- Audio clip helpers ----------
function pitchRatio(semi) { return Math.pow(2, semi / 12); }
// detik sumber yang dikonsumsi per 1 detik timeline
function clipTimeRate(c) { return c.keepPitch ? c.speed : c.speed * pitchRatio(c.pitch); }
function clipSourceLen(c) { const a = AUDIO[c.buf]; return a ? a.buffer.duration : 0; }

function getReversed(id) {
  if (E.reverseCache[id]) return E.reverseCache[id];
  const b = AUDIO[id].buffer;
  const r = new AudioBuffer({ length: b.length, numberOfChannels: b.numberOfChannels, sampleRate: b.sampleRate });
  for (let ch = 0; ch < b.numberOfChannels; ch++) {
    const src = b.getChannelData(ch), dst = r.getChannelData(ch);
    for (let i = 0, n = src.length; i < n; i++) dst[i] = src[n - 1 - i];
  }
  return (E.reverseCache[id] = r);
}
// buffer yg benar2 diputar + rate & faktor stretch
function clipPlayback(c) {
  let buf = c.reverse ? getReversed(c.buf) : AUDIO[c.buf].buffer;
  const r = pitchRatio(c.pitch + (c.cents || 0) / 100);
  if (c.keepPitch && (Math.abs(r - 1) > 1e-4 || Math.abs(c.speed - 1) > 1e-4)) {
    const k = r / c.speed;
    const key = c.buf + '|' + (c.reverse ? 1 : 0) + '|' + k.toFixed(4);
    if (!E.stretchCache[key]) E.stretchCache[key] = timeStretch(buf, k);
    return { buffer: E.stretchCache[key], rate: r, k };
  }
  return { buffer: buf, rate: c.speed * r, k: 1 };
}

// WSOLA time-stretch: ubah durasi tanpa mengubah pitch
function timeStretch(buf, k) {
  const N = 2048, Hs = 512, tol = 384, L = 768;
  const Ha = Hs / k;
  const len = buf.length, chs = buf.numberOfChannels;
  const outLen = Math.ceil(len * k);
  const outs = [], ins = [];
  for (let ch = 0; ch < chs; ch++) { ins.push(buf.getChannelData(ch)); outs.push(new Float32Array(outLen + N)); }
  const mono = new Float32Array(len);
  for (let ch = 0; ch < chs; ch++) { const d = ins[ch]; for (let i = 0; i < len; i++) mono[i] += d[i] / chs; }
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const wsum = new Float32Array(outLen + N);
  let prev = 0;
  const frames = Math.ceil(outLen / Hs);
  for (let m = 0; m < frames; m++) {
    const ideal = Math.round(m * Ha);
    let best = ideal;
    if (m > 0) {
      const nat = prev + Hs;
      let bestC = -Infinity;
      for (let d = -tol; d <= tol; d += 4) {
        const a = ideal + d;
        if (a < 0 || a + L >= len || nat + L >= len) continue;
        let c = 0;
        for (let i = 0; i < L; i += 4) c += mono[a + i] * mono[nat + i];
        if (c > bestC) { bestC = c; best = a; }
      }
    }
    if (best < 0) best = 0;
    const o = m * Hs;
    for (let ch = 0; ch < chs; ch++) {
      const src = ins[ch], dst = outs[ch];
      for (let i = 0; i < N; i++) { const si = best + i; if (si >= len) break; dst[o + i] += src[si] * win[i]; }
    }
    for (let i = 0; i < N; i++) wsum[o + i] += win[i];
    prev = best;
  }
  const res = new AudioBuffer({ length: outLen, numberOfChannels: chs, sampleRate: buf.sampleRate });
  for (let ch = 0; ch < chs; ch++) {
    const d = res.getChannelData(ch), s = outs[ch];
    for (let i = 0; i < outLen; i++) d[i] = s[i] / Math.max(wsum[i], 0.3);
  }
  return res;
}

// Peak waveform utk tampilan
function computePeaks(buffer, block = 256) {
  const n = Math.ceil(buffer.length / block);
  const mins = new Float32Array(n), maxs = new Float32Array(n);
  const chs = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) chs.push(buffer.getChannelData(c));
  for (let i = 0; i < n; i++) {
    let lo = 1, hi = -1;
    const end = Math.min(buffer.length, (i + 1) * block);
    for (let j = i * block; j < end; j += 2) {
      let v = 0; for (const d of chs) v += d[j]; v /= chs.length;
      if (v < lo) lo = v; if (v > hi) hi = v;
    }
    mins[i] = lo; maxs[i] = hi;
  }
  return { mins, maxs, block, rate: buffer.sampleRate };
}
function registerAudio(id, name, buffer, bytes) {
  AUDIO[id] = { name, buffer, bytes, peaks: computePeaks(buffer) };
  return AUDIO[id];
}

// ---------- Scheduler ----------
// Menjadwalkan semua event di rentang beat [b0,b1) mulai waktu ctx t0
function scheduleRange(ctx, proj, strips, b0, b1, t0, store) {
  const spb = 60 / proj.bpm;
  const tAt = (beat) => t0 + (beat - b0) * spb;
  const anySolo = proj.tracks.some((t) => t.solo);
  for (const tr of proj.tracks) {
    const s = strips[tr.id];
    if (!s) continue;
    applyStripStatic(ctx, s, tr, anySolo, t0);
    const segDur = (b1 - b0) * spb;
    // automation tingkat strip
    if (hasAuto(tr, 'volume')) setCurve(s.vol.gain, buildCurve(tr.auto.volume, b0, b1, spb, autoMap.volume), t0, segDur);
    if (hasAuto(tr, 'pan')) setCurve(s.pan.pan, buildCurve(tr.auto.pan, b0, b1, spb, autoMap.pan), t0, segDur);
    if (hasAuto(tr, 'reverb')) setCurve(s.sendRev.gain, buildCurve(tr.auto.reverb, b0, b1, spb, autoMap.reverb), t0, segDur);
    if (hasAuto(tr, 'filter')) setCurve(s.filt.frequency, buildCurve(tr.auto.filter, b0, b1, spb, autoMap.filter), t0, segDur);

    const pitchAuto = hasAuto(tr, 'pitch') ? tr.auto.pitch : null;
    const speedAuto = hasAuto(tr, 'speed') ? tr.auto.speed : null;
    // pasang automation pitch/speed per sumber suara
    const modSource = (src, baseRate, nb0, nb1, when, baseCents) => {
      const d = (nb1 - nb0) * spb;
      if (pitchAuto) {
        setCurve(src.detune, buildCurve(pitchAuto, nb0, nb1, spb, (v) => autoMap.pitch(v) + baseCents), when, d);
      } else src.detune.value = baseCents;
      if (speedAuto) {
        setCurve(src.playbackRate, buildCurve(speedAuto, nb0, nb1, spb, (v) => autoMap.speed(v) * baseRate), when, d);
      } else src.playbackRate.value = baseRate;
    };

    if (tr.type === 'inst') {
      const def = INSTRUMENTS[tr.inst];
      if (!def || !def.loaded) continue;
      for (const c of tr.clips) {
        if (c.muted) continue;
        const cEnd = c.start + c.len;
        if (cEnd <= b0 || c.start >= b1) continue;
        const pat = c.patLen;
        const kFrom = Math.floor(c.offset / pat) - 1, kTo = Math.ceil((c.offset + c.len) / pat);
        for (let k = kFrom; k <= kTo; k++) {
          for (const n of c.notes) {
            const pos = n.s + k * pat;
            if (pos < c.offset || pos >= c.offset + c.len) continue;
            const tl = c.start + pos - c.offset;
            if (tl < b0 - 1e-6 || tl >= b1) continue;
            const endBeat = Math.min(tl + n.l, cEnd);
            const pick = pickSample(def, def.drum ? n.p : n.p + (tr.transpose || 0));
            if (!pick || !pick.buffer) continue;
            const when = tAt(tl);
            const src = ctx.createBufferSource();
            src.buffer = pick.buffer;
            const g = ctx.createGain();
            const vel = Math.pow(n.v, 1.4) * (c.gain != null ? c.gain : 1);
            const offT = tAt(endBeat);
            g.gain.setValueAtTime(vel, when);
            let stopAt;
            if (def.drum) {
              stopAt = when + pick.buffer.duration / pick.rate + 0.05;
            } else {
              const rel = def.release;
              g.gain.setValueAtTime(vel, offT);
              g.gain.setTargetAtTime(0, offT, rel / 4);
              stopAt = offT + rel * 1.5;
            }
            const nb1 = tl + (stopAt - when) / spb;
            modSource(src, pick.rate, tl, nb1, when, (c.pitch || 0) * 100);
            src.connect(g); g.connect(s.input);
            src.start(when);
            src.stop(stopAt);
            store.push(src);
          }
        }
      }
    } else {
      for (const c of tr.clips) {
        if (c.muted || !AUDIO[c.buf]) continue;
        const cEnd = c.start + c.len;
        const from = Math.max(c.start, b0), to = Math.min(cEnd, b1);
        if (to <= from) continue;
        const pb = clipPlayback(c);
        const tRate = clipTimeRate(c);
        const srcPos = c.offset + (from - c.start) * spb * tRate; // detik sumber
        const bufPos = srcPos * pb.k;
        if (bufPos >= pb.buffer.duration) continue;
        const when = tAt(from);
        const durT = (to - from) * spb;
        const src = ctx.createBufferSource();
        src.buffer = pb.buffer;
        const g = ctx.createGain();
        const gain = c.gain;
        // fade in/out (beat)
        const fi = c.fadeIn || 0, fo = c.fadeOut || 0;
        const gainAt = (beat) => {
          let v = gain;
          if (fi > 0 && beat < c.start + fi) v *= Math.max(0, (beat - c.start) / fi);
          if (fo > 0 && beat > cEnd - fo) v *= Math.max(0, (cEnd - beat) / fo);
          return v;
        };
        g.gain.setValueAtTime(gainAt(from), when);
        if (fi > 0 && from < c.start + fi) g.gain.linearRampToValueAtTime(gainAt(c.start + fi), tAt(c.start + fi));
        if (fo > 0) {
          const fs = Math.max(from, cEnd - fo);
          g.gain.setValueAtTime(gainAt(fs), tAt(fs));
          g.gain.linearRampToValueAtTime(0, tAt(to));
        }
        modSource(src, pb.rate, from, to, when, 0);
        src.connect(g); g.connect(s.input);
        src.start(when, bufPos);
        src.stop(when + durT + 0.01);
        store.push(src);
      }
    }
  }
  // metronom
  if (E.metronome && store === E.active) {
    const tsig = proj.tsig || 4;
    for (let b = Math.ceil(b0 - 1e-6); b < b1; b++) {
      const when = tAt(b);
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = b % tsig === 0 ? 1760 : 1100;
      g.gain.setValueAtTime(0.25, when); g.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
      o.connect(g); g.connect(ctx.destination); o.start(when); o.stop(when + 0.06);
      store.push(o);
    }
  }
}

// Mainkan satu nada (preview piano roll / keyboard)
function previewNote(track, p, vel = 0.8, dur = 0.45) {
  if (!E.ctx || !track || track.type !== 'inst') return;
  const def = INSTRUMENTS[track.inst];
  const s = E.strips[track.id];
  if (!def.loaded || !s) return;
  const pick = pickSample(def, def.drum ? p : p + (track.transpose || 0));
  if (!pick) return;
  const ctx = E.ctx, now = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = pick.buffer; src.playbackRate.value = pick.rate;
  const g = ctx.createGain(); g.gain.setValueAtTime(Math.pow(vel, 1.4), now);
  if (!def.drum) g.gain.setTargetAtTime(0, now + dur, def.release / 4);
  src.connect(g); g.connect(s.input); src.start(now); src.stop(now + (def.drum ? pick.buffer.duration : dur + def.release * 1.5));
}
function previewAudio(id) {
  if (!E.ctx || !AUDIO[id]) return;
  if (E._prev) { try { E._prev.stop(); } catch (e) {} }
  const src = E.ctx.createBufferSource(); src.buffer = AUDIO[id].buffer; src.connect(E.master.input); src.start();
  E._prev = src;
}
function stopPreview() { if (E._prev) { try { E._prev.stop(); } catch (e) {} E._prev = null; } }

// ---------- Export WAV ----------
async function renderMix(proj, fromBeat, toBeat) {
  const spb = 60 / proj.bpm;
  const tail = 2.5;
  const dur = (toBeat - fromBeat) * spb + tail;
  const rate = 44100;
  const off = new OfflineAudioContext(2, Math.ceil(dur * rate), rate);
  const master = createMaster(off, proj, false);
  const strips = {};
  for (const t of proj.tracks) strips[t.id] = createStrip(off, t, master, false);
  const store = [];
  scheduleRange(off, proj, strips, fromBeat, toBeat, 0.05, store);
  return off.startRendering();
}
function encodeWav(buffer) {
  const chs = buffer.numberOfChannels, len = buffer.length, rate = buffer.sampleRate;
  const data = new DataView(new ArrayBuffer(44 + len * chs * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); data.setUint32(4, 36 + len * chs * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, chs, true);
  data.setUint32(24, rate, true); data.setUint32(28, rate * chs * 2, true); data.setUint16(32, chs * 2, true);
  data.setUint16(34, 16, true); w(36, 'data'); data.setUint32(40, len * chs * 2, true);
  const cd = []; for (let c = 0; c < chs; c++) cd.push(buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < chs; c++) {
    const v = Math.max(-1, Math.min(1, cd[c][i]));
    data.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2;
  }
  return new Blob([data], { type: 'audio/wav' });
}

// ---------- Rekam mikrofon ----------
const Recorder = {
  stream: null, rec: null, chunks: [],
  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    this.chunks = [];
    this.rec = new MediaRecorder(this.stream);
    this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.rec.start();
  },
  stop() {
    return new Promise((res) => {
      if (!this.rec) return res(null);
      this.rec.onstop = async () => {
        this.stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(this.chunks, { type: this.rec.mimeType || 'audio/webm' });
        this.rec = null;
        res(blob);
      };
      this.rec.stop();
    });
  },
};

function meterLevel(analyser) {
  if (!analyser) return 0;
  const a = analyser._buf || (analyser._buf = new Float32Array(analyser.fftSize));
  analyser.getFloatTimeDomainData(a);
  let pk = 0;
  for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > pk) pk = v; }
  return pk;
}
