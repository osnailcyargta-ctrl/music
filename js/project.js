/* =========================================================
   PROJECT — data lagu, undo/redo, simpan/buka, demo lagu
   ========================================================= */
'use strict';

let _uid = Date.now() % 100000;
const uid = (p = 'id') => p + (++_uid).toString(36) + Math.random().toString(36).slice(2, 5);

const TRACK_COLORS = ['#f0a33a', '#4aa3ff', '#8a6df0', '#63d49a', '#e0584f', '#5ec8e0', '#e8c547', '#ff7eb6', '#b0e04a', '#c26a3a'];

function newProject() {
  return {
    name: 'Lagu Baru',
    bpm: 110,
    tsig: 4,
    loop: { on: false, start: 0, end: 16 },
    master: { vol: 0.9, revSize: 2.4, revDecay: 3, revPre: 0.02, revLevel: 1, delBeats: 0.75, delFb: 0.35, delLevel: 0.8 },
    tracks: [],
    fx: [], // id audio di browser Sound FX
  };
}
let P = newProject();

function emptyAuto() { const a = {}; for (const k of AUTO_ORDER) a[k] = []; return a; }
function makeTrack(type, inst) {
  const def = type === 'inst' ? INSTRUMENTS[inst] : null;
  const idx = P.tracks.length;
  return {
    id: uid('t'), type, inst: inst || null,
    name: def ? def.name : 'Audio ' + (P.tracks.filter((t) => t.type === 'audio').length + 1),
    color: def ? def.color : TRACK_COLORS[idx % TRACK_COLORS.length],
    vol: 1, pan: 0, reverb: 0.12, delay: 0, eq: { low: 0, mid: 0, high: 0 }, transpose: 0, crush: defaultCrush(),
    mute: false, solo: false, arm: false, auto: emptyAuto(), showAuto: null,
    clips: [],
  };
}
function makeInstClip(start, len, patLen, notes) {
  return { id: uid('c'), type: 'inst', start, len, offset: 0, patLen: patLen || len, notes: notes || [], gain: 1, pitch: 0, muted: false, name: '' };
}
function makeAudioClip(bufId, start) {
  const c = { id: uid('c'), type: 'audio', buf: bufId, start, len: 4, offset: 0, gain: 1, pitch: 0, cents: 0, speed: 1, keepPitch: true, reverse: false, fadeIn: 0, fadeOut: 0, muted: false, name: AUDIO[bufId] ? AUDIO[bufId].name : 'audio' };
  c.len = audioFullLen(c);
  return c;
}
function audioFullLen(c) {
  const spb = 60 / P.bpm;
  return Math.max(0.05, (clipSourceLen(c) - c.offset) / clipTimeRate(c) / spb);
}
function findTrack(id) { return P.tracks.find((t) => t.id === id); }
function findClip(id) {
  for (const t of P.tracks) for (const c of t.clips) if (c.id === id) return { track: t, clip: c };
  return null;
}
function songEnd() {
  let e = 0;
  for (const t of P.tracks) for (const c of t.clips) e = Math.max(e, c.start + c.len);
  return e;
}
function cloneClip(c) { const n = JSON.parse(JSON.stringify(c)); n.id = uid('c'); return n; }

// Split clip pada beat x -> [kiri, kanan]
function splitClip(track, c, x) {
  if (x <= c.start + 0.01 || x >= c.start + c.len - 0.01) return null;
  const right = cloneClip(c);
  const d = x - c.start;
  right.start = x;
  right.len = c.len - d;
  if (c.type === 'inst') {
    right.offset = c.offset + d;
  } else {
    right.offset = c.offset + d * (60 / P.bpm) * clipTimeRate(c);
    right.fadeIn = 0;
    c.fadeOut = 0;
  }
  c.len = d;
  track.clips.push(right);
  return right;
}

// ---------- Undo / Redo ----------
const History = {
  undo: [], redo: [],
  push() {
    this.undo.push(JSON.stringify(P));
    if (this.undo.length > 80) this.undo.shift();
    this.redo.length = 0;
  },
  doUndo() {
    if (!this.undo.length) return false;
    this.redo.push(JSON.stringify(P));
    P = JSON.parse(this.undo.pop());
    return true;
  },
  doRedo() {
    if (!this.redo.length) return false;
    this.undo.push(JSON.stringify(P));
    P = JSON.parse(this.redo.pop());
    return true;
  },
};

// ---------- Simpan / buka ----------
function usedAudioIds() {
  const ids = new Set(P.fx);
  for (const t of P.tracks) for (const c of t.clips) if (c.type === 'audio') ids.add(c.buf);
  return [...ids].filter((id) => AUDIO[id] && !id.startsWith('loop:'));
}
function abToB64(ab) {
  const u = new Uint8Array(ab); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
function projectToFile() {
  const audio = {};
  for (const id of usedAudioIds()) audio[id] = { name: AUDIO[id].name, b64: abToB64(AUDIO[id].bytes) };
  return JSON.stringify({ app: 'studioloop', v: 1, project: P, audio });
}
async function loadAudioMap(entries) {
  // entries: [[id,{name, bytes}]]
  for (const [id, a] of entries) {
    if (AUDIO[id]) continue;
    try {
      const buf = await E.ctx.decodeAudioData(a.bytes.slice(0));
      registerAudio(id, a.name, buf, a.bytes);
    } catch (e) { console.warn('Audio gagal di-decode', id, e); }
  }
}
async function ensureBuiltinLoops(proj) {
  const need = new Set(proj.fx.filter((id) => id.startsWith('loop:')));
  for (const t of proj.tracks) for (const c of t.clips) if (c.type === 'audio' && c.buf.startsWith('loop:')) need.add(c.buf);
  for (const id of need) {
    if (AUDIO[id]) continue;
    const l = BUILTIN_LOOPS.find((x) => x.id === id);
    if (!l) continue;
    try { const r = await loadBuiltinLoop(E.ctx, l); registerAudio(id, l.name, r.buffer, r.bytes); } catch (e) { console.warn(e); }
  }
}
function normalizeProject(p) {
  const d = newProject();
  for (const k in d) if (p[k] === undefined) p[k] = d[k];
  for (const k in d.master) if (p.master[k] === undefined) p.master[k] = d.master[k];
  for (const t of p.tracks) {
    if (!t.auto) t.auto = emptyAuto();
    for (const k of AUTO_ORDER) if (!t.auto[k]) t.auto[k] = [];
    if (!t.eq) t.eq = { low: 0, mid: 0, high: 0 };
    if (!t.crush) t.crush = defaultCrush();
  }
  return p;
}

// IndexedDB autosave
const DB = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('studioloop', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('audio'); };
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async put(store, key, val) {
    const db = await this.open();
    return new Promise((res, rej) => { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(val, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  },
  async get(store, key) {
    const db = await this.open();
    return new Promise((res, rej) => { const r = db.transaction(store).objectStore(store).get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  },
  async keys(store) {
    const db = await this.open();
    return new Promise((res, rej) => { const r = db.transaction(store).objectStore(store).getAllKeys(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  },
};
const _savedAudio = new Set();
async function autosave() {
  try {
    for (const id of usedAudioIds()) {
      if (_savedAudio.has(id)) continue;
      await DB.put('audio', id, { name: AUDIO[id].name, bytes: AUDIO[id].bytes });
      _savedAudio.add(id);
    }
    await DB.put('kv', 'project', JSON.stringify(P));
  } catch (e) { console.warn('autosave gagal', e); }
}
async function loadAutosave() {
  try {
    const json = await DB.get('kv', 'project');
    if (!json) return false;
    const p = normalizeProject(JSON.parse(json));
    const ids = new Set(p.fx);
    for (const t of p.tracks) for (const c of t.clips) if (c.type === 'audio') ids.add(c.buf);
    const entries = [];
    for (const id of ids) {
      if (id.startsWith('loop:')) continue;
      const a = await DB.get('audio', id);
      if (a) { entries.push([id, a]); _savedAudio.add(id); }
    }
    await loadAudioMap(entries);
    await ensureBuiltinLoops(p);
    P = p;
    return true;
  } catch (e) { console.warn(e); return false; }
}

// ---------- Demo lagu ----------
function demoProject() {
  P = newProject();
  P.name = 'Demo — Sore di Kota';
  P.bpm = 100;
  P.loop = { on: false, start: 0, end: 32 };

  // Drum
  const dr = makeTrack('inst', 'drums');
  const dn = [];
  const add = (p, s, l = 0.25, v = 0.9) => dn.push({ p, s, l, v });
  for (let b = 0; b < 8; b += 4) {
    add(0, b); add(0, b + 2.5, 0.25, 0.8); add(0, b + 3.75, 0.25, 0.6);
    add(2, b + 1); add(2, b + 3);
    for (let h = 0; h < 4; h += 0.5) add(4, b + h, 0.25, h % 1 ? 0.45 : 0.7);
  }
  add(5, 7.5, 0.5, 0.6); add(7, 7.5, 0.25, 0.7); add(8, 7.75, 0.25, 0.8);
  dr.clips.push(makeInstClip(4, 28, 8, dn));
  dr.vol = 0.95; dr.reverb = 0.08;

  // Bass
  const bs = makeTrack('inst', 'bass');
  const bn = [];
  [36, 31, 33, 29].forEach((r, i) => {
    const o = i * 4;
    bn.push({ p: r, s: o, l: 1.4, v: 0.95 }, { p: r, s: o + 1.5, l: 0.5, v: 0.8 }, { p: r + 12, s: o + 2, l: 0.9, v: 0.85 }, { p: r + 7, s: o + 3, l: 0.9, v: 0.8 });
  });
  bs.clips.push(makeInstClip(4, 28, 16, bn));
  bs.clips[0].offset = 0;
  bs.reverb = 0.02; bs.vol = 1.05;

  // Piano chords
  const pn = makeTrack('inst', 'piano');
  const chords = [[60, 64, 67], [59, 62, 67], [60, 64, 69], [60, 65, 69]];
  const pnn = [];
  chords.forEach((ch, i) => {
    const o = i * 4;
    for (const p of ch) { pnn.push({ p, s: o, l: 1.4, v: 0.75 }, { p, s: o + 1.5, l: 1, v: 0.6 }, { p, s: o + 3, l: 0.9, v: 0.65 }); }
    pnn.push({ p: ch[0] - 12, s: o, l: 3.8, v: 0.55 });
  });
  pn.clips.push(makeInstClip(0, 32, 16, pnn));
  pn.reverb = 0.3;
  pn.auto.volume = [{ t: 0, v: 0.35, c: 0.4, m: 'curve' }, { t: 4, v: 0.8, c: 0, m: 'curve' }, { t: 28, v: 0.8, c: -0.5, m: 'curve' }, { t: 32, v: 0.3, c: 0, m: 'curve' }];
  pn.showAuto = 'volume';

  // Flute melodi
  const fl = makeTrack('inst', 'flute');
  const m = [[76, 0, 1], [79, 1, 1], [76, 2, 0.5], [74, 2.5, 0.5], [72, 3, 1],
    [74, 4, 1.5], [71, 5.5, 0.5], [74, 6, 1], [79, 7, 1],
    [76, 8, 1], [72, 9, 1], [69, 10, 1], [72, 11, 1],
    [69, 12, 1.5], [72, 13.5, 0.5], [72, 14, 2]];
  fl.clips.push(makeInstClip(16, 16, 16, m.map(([p, s, l]) => ({ p, s, l, v: 0.8 }))));
  fl.reverb = 0.4; fl.delay = 0.18; fl.vol = 0.85;
  fl.auto.reverb = [{ t: 16, v: 0.25, c: 0, m: 'curve' }, { t: 30, v: 0.7, c: 0.5, m: 'scurve' }, { t: 32, v: 0.7, c: 0, m: 'curve' }];

  // Harpa arpeggio
  const hp = makeTrack('inst', 'harp');
  const hn = [];
  chords.forEach((ch, i) => { const o = i * 4; [ch[0] - 12, ch[1] - 12, ch[2] - 12, ch[0], ch[1], ch[2], ch[1], ch[0]].forEach((p, j) => hn.push({ p: p + 12, s: o + j * 0.5, l: 0.5, v: 0.55 })); });
  hp.clips.push(makeInstClip(16, 16, 16, hn));
  hp.vol = 0.6; hp.pan = 0.35; hp.reverb = 0.35;

  P.tracks.push(pn, dr, bs, fl, hp);
  P.tracks.push(makeTrack('audio'));
  return P;
}
