/* =========================================================
   APP — transport, shortcut, menu, import/drop, rekam, export
   ========================================================= */
'use strict';

const T = { playing: false, segs: [], recording: false, recInfo: null, playFrom: 0 };

const App = {
  _resched: null, _save: null,

  async boot() {
    E.init();
    await loadWorklets(E.ctx);
    A.init(); PR.init();
    if (typeof Mobile !== 'undefined') Mobile.init();
    this.bindUI();
    this.loading(true, 'Memuat project…');
    let ok = false;
    try { ok = await loadAutosave(); } catch (e) { ok = false; }
    if (!ok || !P.tracks.length) demoProject();
    await this.loadNeeded();
    this.afterLoad();
    this.loading(false);
    this.status(ok ? 'Project terakhir dimuat (autosave)' : 'Demo lagu dimuat — tekan Spasi untuk play ▶');
    requestAnimationFrame(() => this.frame());
  },
  afterLoad() {
    this.syncStrips();
    if (E.ctx) updateMasterFx(E.ctx, E.master, P);
    $('#bpm').value = P.bpm;
    $('#masterVol').value = Math.min(1.5, P.master.vol);
    this.renderMasterPct();
    const first = P.tracks.find((t) => t.type === 'inst' && t.clips.length);
    if (first && !UI.editClip) this.openPiano(first.clips[0], first, true);
    UI.selTrack = UI.selTrack && findTrack(UI.selTrack) ? UI.selTrack : (P.tracks[0] && P.tracks[0].id);
    // zoom supaya seluruh lagu kelihatan
    const end = Math.max(songEnd(), 16);
    if (A.w > 100) UI.zoom = Math.max(6, Math.min(80, (A.w - 30) / end));
    Panels.renderBrowser();
    this.renderAll();
    this.updateTransportUI();
  },
  async loadNeeded() {
    // nada persis yang dipakai lagu -> muat rekaman aslinya
    const need = {};
    for (const t of P.tracks) {
      if (t.type !== 'inst' || !INSTRUMENTS[t.inst]) continue;
      const s = need[t.inst] || (need[t.inst] = new Set());
      for (const c of t.clips) for (const n of c.notes) s.add(n.p + (t.transpose || 0));
    }
    await Promise.all(Object.keys(need).map((id) => this.loadInst(id, true, [...need[id]])));
    await ensureBuiltinLoops(P);
  },
  async loadInst(id, quiet, pitches) {
    const def = INSTRUMENTS[id];
    if (def.loaded && !pitches) return;
    if (def.loaded) quiet = true;
    if (!quiet) this.loading(true, 'Memuat sampel ' + def.name + '…');
    try { await loadInstrument(E.ctx, id, pitches); }
    catch (e) { console.error(e); this.status('Gagal memuat ' + def.name + ': ' + e.message); }
    if (!quiet) this.loading(false);
  },
  async ensureAudio(id) {
    if (AUDIO[id]) return true;
    const l = BUILTIN_LOOPS.find((x) => x.id === id);
    if (!l) return false;
    this.loading(true, 'Memuat ' + l.name + '…');
    try { const r = await loadBuiltinLoop(E.ctx, l); registerAudio(id, l.name, r.buffer, r.bytes); }
    catch (e) { this.status('Gagal memuat loop'); }
    this.loading(false);
    return !!AUDIO[id];
  },
  syncStrips() {
    if (!E.ctx) return;
    const ids = new Set(P.tracks.map((t) => t.id));
    for (const id in E.strips) {
      if (!ids.has(id)) { try { E.strips[id].mute.disconnect(); } catch (e) {} delete E.strips[id]; }
    }
    for (const t of P.tracks) if (!E.strips[t.id]) E.strips[t.id] = createStrip(E.ctx, t, E.master, true);
    this.mixChanged();
  },

  // ---------- perubahan ----------
  changed(light) {
    A.dirty = true; PR.dirty = true;
    this.syncStrips();
    if (!light) this.renderAll();
    else { this.renderHeads(); }
    this.reschedule();
    this.queueSave();
  },
  softChanged() { A.dirty = true; PR.dirty = true; this.reschedule(); this.queueSave(); },
  structureChanged() { this.changed(); },
  mixChanged() {
    if (E.ctx) {
      const anySolo = P.tracks.some((t) => t.solo);
      for (const t of P.tracks) if (E.strips[t.id]) applyStripStatic(E.ctx, E.strips[t.id], t, anySolo);
    }
    A.dirty = true;
    this.queueSave();
  },
  queueSave() { clearTimeout(this._save); this._save = setTimeout(() => autosave(), 1200); },
  renderAll() {
    this.renderHeads();
    Panels.renderInspector();
    const tab = this.activeTab();
    if (tab === 'rack') Panels.renderRack();
    if (tab === 'mixer') Panels.renderMixer();
    this.updatePianoBar();
  },
  renderHeads() { Panels.renderHeads(); },
  syncHeadScroll() { $('#trackHeads').style.transform = `translateY(${-UI.scrollY}px)`; },

  // ---------- transport ----------
  spb() { return 60 / P.bpm; },
  async play() {
    await E.resume();
    await this.loadNeeded();
    this.syncStrips();
    if (P.loop.on && (UI.playhead >= P.loop.end || UI.playhead < P.loop.start - 1e-6) && !T.recording) UI.playhead = P.loop.start;
    T.playing = true; T.playFrom = UI.playhead;
    T.segs = [];
    this.startSeg(UI.playhead, E.ctx.currentTime + 0.06);
    this.updateTransportUI();
  },
  segEnd(b0) {
    if (P.loop.on && b0 < P.loop.end && !T.recording) return P.loop.end;
    if (T.recording) return b0 + 4 * 400;
    return Math.max(songEnd(), b0) + 2;
  },
  startSeg(b0, t0) {
    const b1 = this.segEnd(b0);
    scheduleRange(E.ctx, P, E.strips, b0, b1, t0, E.active);
    T.segs.push({ b0, b1, t0, t1: t0 + (b1 - b0) * this.spb(), next: false });
    if (T.segs.length > 3) T.segs.shift();
  },
  stopSources() {
    for (const s of E.active) { try { s.stop(0); } catch (e) {} try { s.disconnect(); } catch (e) {} }
    E.active = [];
    const anySolo = P.tracks.some((t) => t.solo);
    for (const t of P.tracks) if (E.strips[t.id]) applyStripStatic(E.ctx, E.strips[t.id], t, anySolo);
  },
  pause() {
    if (!T.playing) return;
    T.playing = false;
    this.stopSources();
    this.updateTransportUI();
  },
  async togglePlay() { if (T.recording) return this.toggleRecord(); T.playing ? this.pause() : await this.play(); },
  stop() {
    if (T.recording) this.toggleRecord();
    this.pause();
    UI.playhead = P.loop.on ? P.loop.start : 0;
    if (UI.playhead === 0) UI.scrollX = 0;
    A.dirty = true; PR.dirty = true;
  },
  seek(b) {
    UI.playhead = b;
    A.dirty = true; PR.dirty = true;
    if (T.playing) this.reschedule(true);
  },
  reschedule(now) {
    if (!T.playing) return;
    clearTimeout(this._resched);
    const go = () => {
      if (!T.playing) return;
      const b = UI.playhead;
      this.stopSources();
      T.segs = [];
      this.startSeg(b, E.ctx.currentTime + 0.03);
    };
    if (now) go(); else this._resched = setTimeout(go, 120);
  },
  tick() {
    if (!T.playing) return;
    const now = E.ctx.currentTime;
    let seg = T.segs[0];
    for (const s of T.segs) if (s.t0 <= now) seg = s;
    const beat = seg.b0 + Math.max(0, now - seg.t0) / this.spb();
    UI.playhead = Math.min(beat, seg.b1);
    const last = T.segs[T.segs.length - 1];
    if (!last.next && last.t1 - now < 0.35) {
      if (P.loop.on && last.b1 === P.loop.end && !T.recording) { last.next = true; this.startSeg(P.loop.start, last.t1); }
    }
    if (now >= last.t1 && !last.next) { this.pause(); }
    // auto-scroll halaman
    const x = A.xOf(UI.playhead);
    if (!UI.mobile && (x > A.w - 40 || x < 0)) UI.scrollX = Math.max(0, UI.playhead * UI.zoom - 60);
    A.dirty = true; PR.dirty = true;
  },
  updateTransportUI() {
    $('#btnPlay').textContent = T.playing ? '❚❚' : '▶';
    $('#btnPlay').classList.toggle('on', T.playing);
    const dubbing = T.recording && T.recInfo && T.recInfo.dubler;
    $('#btnRec').classList.toggle('rec', T.recording && !dubbing);
    $('#btnDub').classList.toggle('rec', !!dubbing || !!T.dubTry);
    $('#btnLoop').classList.toggle('on', P.loop.on);
    $('#btnMetro').classList.toggle('on', E.metronome);
  },
  updateTime() {
    const b = UI.playhead;
    const bar = Math.floor(b / P.tsig) + 1, beat = Math.floor(b % P.tsig) + 1, tick = Math.floor((b % 1) * 96);
    $('#timeBars').textContent = String(bar).padStart(3, '0') + ':' + beat + ':' + String(tick).padStart(3, '0');
    const s = b * this.spb();
    $('#timeSecs').textContent = Math.floor(s / 60) + ':' + (s % 60).toFixed(2).padStart(5, '0');
  },

  frame() {
    this.tick();
    this.updateTime();
    if (A.dirty) { A.draw(); A.dirty = false; }
    if (PR.dirty && this.activeTab() === 'piano') { PR.draw(); PR.dirty = false; }
    this.meters();
    if (DubLive.an) DubLive.tick();
    requestAnimationFrame(() => this.frame());
  },
  meters() {
    if (!E.ctx) return;
    const els = document.querySelectorAll('[data-meter]');
    const lv = {};
    for (const el of els) {
      const id = el.dataset.meter;
      if (lv[id] == null) lv[id] = id === 'master' ? meterLevel(E.master.analyser) : meterLevel(E.strips[id] && E.strips[id].analyser);
      const pct = Math.min(100, Math.pow(lv[id], 0.6) * 100);
      if (el.classList.contains('vmeter-fill')) el.style.height = pct + '%'; else el.style.width = pct + '%';
      el.classList.toggle('clip', lv[id] > 0.98);
    }
    const mc = $('#masterMeter'); const g = mc.getContext('2d');
    const l = lv.master != null ? lv.master : meterLevel(E.master.analyser);
    g.fillStyle = '#111'; g.fillRect(0, 0, 80, 14);
    const w = Math.min(80, Math.pow(l, 0.6) * 80);
    const grd = g.createLinearGradient(0, 0, 80, 0); grd.addColorStop(0, '#3ddc84'); grd.addColorStop(0.75, '#ffd84a'); grd.addColorStop(1, '#ff4b4b');
    g.fillStyle = grd; g.fillRect(0, 2, w, 10);
  },

  // ---------- tracks & clips ----------
  async addInstrumentTrack(id) {
    History.push();
    const t = makeTrack('inst', id);
    const at = UI.selTrack ? P.tracks.findIndex((x) => x.id === UI.selTrack) + 1 : P.tracks.length;
    P.tracks.splice(at > 0 ? at : P.tracks.length, 0, t);
    const c = makeInstClip(Math.floor(UI.playhead / 4) * 4, 4, 4, []);
    t.clips.push(c);
    UI.selTrack = t.id; UI.sel = new Set([c.id]);
    await this.loadInst(id);
    this.openPiano(c, t, true);
    this.changed();
    this.status(INSTRUMENTS[id].name + ' ditambahkan — gambar nada di Piano Roll / Channel Rack');
    return t;
  },
  addAudioTrack() {
    History.push();
    const t = makeTrack('audio');
    P.tracks.push(t); UI.selTrack = t.id;
    this.changed();
    return t;
  },
  async placeAudio(id, track, beat) {
    if (!(await this.ensureAudio(id))) return;
    History.push();
    let t = track || (UI.selTrack && findTrack(UI.selTrack));
    if (!t || t.type !== 'audio') t = P.tracks.find((x) => x.type === 'audio' && !x.clips.some((c) => UI.playhead < c.start + c.len && UI.playhead >= c.start));
    if (!t) { t = makeTrack('audio'); P.tracks.push(t); }
    const c = makeAudioClip(id, beat != null ? beat : A.snap(UI.playhead));
    t.clips.push(c);
    UI.selTrack = t.id; UI.sel = new Set([c.id]);
    if (!P.fx.includes(id)) P.fx.push(id);
    this.changed();
    Panels.renderFx();
    this.status('Clip "' + c.name + '" ditaruh di ' + t.name);
  },
  selectClip(c, t) {
    UI.selTrack = t ? t.id : UI.selTrack;
    Panels.renderInspector();
    A.dirty = true;
  },
  openPiano(c, t, quiet) {
    if (c.type !== 'inst') return;
    const changedClip = UI.editClip !== c.id;
    UI.editClip = c.id;
    if (changedClip) { PR.sel.clear(); PR.centerOn(c, t); }
    UI.selTrack = t.id;
    if (!quiet) this.showTab('piano');
    this.updatePianoBar();
    if (this.activeTab() === 'rack') Panels.renderRack();
    PR.dirty = true;
  },
  updatePianoBar() {
    const f = UI.editClip ? findClip(UI.editClip) : null;
    if (!f) { UI.editClip = null; $('#prTitle').textContent = 'Pilih clip instrumen (klik 2x di playlist)'; return; }
    const d = INSTRUMENTS[f.track.inst];
    $('#prTitle').innerHTML = '';
    $('#prTitle').append(h('b', { style: `color:${f.track.color}` }, d.icon + ' ' + f.track.name), ' — clip @ bar ' + (Math.floor(f.clip.start / 4) + 1));
    $('#prPatLen').value = f.clip.patLen;
    $('#tabInfo').textContent = d.icon + ' ' + f.track.name;
  },
  selectedClips() { return [...UI.sel].map(findClip).filter(Boolean); },
  deleteSel() {
    const s = this.selectedClips(); if (!s.length) return;
    History.push();
    for (const { track, clip } of s) track.clips.splice(track.clips.indexOf(clip), 1);
    UI.sel.clear();
    this.changed();
  },
  duplicateSel() {
    const s = this.selectedClips(); if (!s.length) return;
    History.push();
    const s0 = Math.min(...s.map((f) => f.clip.start)), s1 = Math.max(...s.map((f) => f.clip.start + f.clip.len));
    const span = s1 - s0;
    const ns = new Set();
    for (const { track, clip } of s) { const n = cloneClip(clip); n.start += span; track.clips.push(n); ns.add(n.id); }
    UI.sel = ns;
    this.changed();
    this.status('Clip diduplikat');
  },
  splitAtPlayhead() {
    const b = UI.playhead;
    let targets = this.selectedClips().filter((f) => b > f.clip.start && b < f.clip.start + f.clip.len);
    if (!targets.length) {
      const t = UI.selTrack && findTrack(UI.selTrack);
      if (t) targets = t.clips.filter((c) => b > c.start && b < c.start + c.len).map((clip) => ({ track: t, clip }));
    }
    if (!targets.length) { this.status('Taruh playhead di atas clip (atau pilih clip) untuk split'); return; }
    History.push();
    const ns = new Set();
    for (const { track, clip } of targets) { const r = splitClip(track, clip, b); if (r) ns.add(r.id); }
    UI.sel = ns;
    this.changed();
    this.status('Clip di-split');
  },
  copySel() {
    const s = this.selectedClips(); if (!s.length) return;
    const min = Math.min(...s.map((f) => f.clip.start));
    UI.clipboard = s.map((f) => ({ ti: P.tracks.indexOf(f.track), clip: JSON.parse(JSON.stringify(f.clip)), rel: f.clip.start - min }));
    this.status(s.length + ' clip dicopy');
  },
  pasteClip() {
    if (!UI.clipboard) return;
    History.push();
    const minTi = Math.min(...UI.clipboard.map((x) => x.ti));
    const selTi = UI.selTrack ? P.tracks.findIndex((t) => t.id === UI.selTrack) : -1;
    const ns = new Set();
    for (const x of UI.clipboard) {
      let t = selTi >= 0 ? P.tracks[selTi + x.ti - minTi] : null;
      if (!t || t.type !== x.clip.type) t = P.tracks[x.ti];
      if (!t || t.type !== x.clip.type) continue;
      const n = cloneClip(x.clip); n.start = A.snap(UI.playhead) + x.rel;
      t.clips.push(n); ns.add(n.id);
    }
    UI.sel = ns;
    this.changed();
  },
  selectAll() { UI.sel = new Set(P.tracks.flatMap((t) => t.clips.map((c) => c.id))); A.dirty = true; Panels.renderInspector(); },

  // ---------- import / drop ----------
  async importFiles(files) {
    await E.resume();
    const ids = [];
    for (const f of files) {
      if (!/^audio\/|^video\/webm/.test(f.type) && !/\.(mp3|wav|ogg|m4a|flac|aac|webm)$/i.test(f.name)) continue;
      this.loading(true, 'Import ' + f.name + '…');
      try {
        const bytes = await f.arrayBuffer();
        const buf = await E.ctx.decodeAudioData(bytes.slice(0));
        const id = uid('a');
        registerAudio(id, f.name.replace(/\.[^.]+$/, ''), buf, bytes);
        P.fx.push(id); ids.push(id);
      } catch (e) { this.status('Gagal import ' + f.name + ' (format tidak didukung?)'); }
    }
    this.loading(false);
    Panels.renderFx();
    if (ids.length) { this.status(ids.length + ' file audio di-import ke Sound FX'); this.queueSave(); }
    return ids;
  },
  async onDropArrange(e) {
    const r = A.cv.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const hit = A.hit(x, Math.max(0, y));
    const beat = Math.max(0, A.snap(A.beatOf(x)));
    const inst = e.dataTransfer.getData('text/x-inst');
    if (inst) return this.addInstrumentTrack(inst);
    const fx = e.dataTransfer.getData('text/x-fx');
    let track = hit.track && hit.track.type === 'audio' ? hit.track : null;
    if (fx) {
      if (!track) { History.push(); track = makeTrack('audio'); P.tracks.push(track); }
      return this.placeAudio(fx, track, beat);
    }
    if (e.dataTransfer.files && e.dataTransfer.files.length) {
      const ids = await this.importFiles([...e.dataTransfer.files]);
      let b = beat;
      for (const id of ids) {
        if (!track) { History.push(); track = makeTrack('audio'); P.tracks.push(track); }
        await this.placeAudio(id, track, b);
        track = null; // file berikutnya ke track baru
      }
    }
  },

  // ---------- rekam ----------
  async toggleRecord(dub) {
    if (T.recording) {
      T.recording = false;
      const info = T.recInfo;
      this.pause();
      const dubEvents0 = info && info.dubler ? DubLive.stop() : null;
      const blob = await Recorder.stop();
      this.updateTransportUI();
      if (info.dubler) return this.finishDubler(blob, info, dubEvents0);
      if (!blob) return;
      this.loading(true, 'Memproses rekaman…');
      try {
        const bytes = await blob.arrayBuffer();
        const buf = await E.ctx.decodeAudioData(bytes.slice(0));
        const n = Object.keys(AUDIO).filter((k) => k.startsWith('rec')).length + 1;
        const id = uid('rec');
        registerAudio(id, 'Rekaman ' + n, buf, bytes);
        P.fx.push(id);
        History.push();
        const c = makeAudioClip(id, info.beat);
        c.offset = Math.min(buf.duration - 0.01, Math.max(0, info.lat));
        c.len = audioFullLen(c);
        info.track.clips.push(c);
        UI.sel = new Set([c.id]);
        Panels.renderFx();
        this.changed();
        this.status('Rekaman disimpan (' + buf.duration.toFixed(1) + 's) — juga ada di Sound FX');
      } catch (e) { this.status('Gagal memproses rekaman: ' + e.message); }
      this.loading(false);
      return;
    }
    await E.resume();
    if (dub === true) return this.startDubler(false);
    let t = P.tracks.find((x) => x.arm) || (UI.selTrack && findTrack(UI.selTrack));
    if (!t || t.type !== 'audio') { History.push(); t = makeTrack('audio'); t.name = 'Rekaman Vokal'; t.arm = true; P.tracks.push(t); this.changed(); }
    try { await Recorder.start(); }
    catch (e) { this.status('Mikrofon tidak bisa diakses: ' + e.message); return; }
    const recStartT = E.ctx.currentTime;
    if (T.playing) this.pause();
    T.recording = true;
    T.recInfo = { track: t, beat: UI.playhead };
    await this.play();
    T.recInfo.lat = T.segs[0].t0 - recStartT;
    this.updateTransportUI();
    this.status('● Merekam ke "' + t.name + '"… tekan ● atau Spasi untuk berhenti');
  },

  // ---------- DUBLER (real-time): suara -> instrumen live -> note ----------
  async dublerTarget() {
    let t = UI.selTrack && findTrack(UI.selTrack);
    if (!t || t.type !== 'inst') {
      History.push();
      t = makeTrack('inst', 'piano'); t.name = 'Dubler (Piano)';
      P.tracks.push(t); UI.selTrack = t.id;
      this.changed();
    }
    await this.loadInst(t.inst, false, INSTRUMENTS[t.inst].drum ? null : Array.from({ length: 49 }, (_, i) => 36 + i));
    this.syncStrips();
    return t;
  },
  async startDubler(tryOnly) {
    const t = await this.dublerTarget();
    try { await Recorder.start(true); }
    catch (e) { this.status('Mikrofon tidak bisa diakses: ' + e.message); return; }
    DubLive.start(Recorder.stream, t);
    $('#dubTitle').textContent = tryOnly ? '🎤 DUBLER — coba live (tidak direkam)' : '🎤 DUBLER — merekam ke "' + t.name + '"';
    if (tryOnly) { T.dubTry = true; this.updateTransportUI(); return; }
    if (T.playing) this.pause();
    T.recording = true;
    T.recInfo = { track: t, beat: A.snap(UI.playhead), dubler: true };
    UI.playhead = T.recInfo.beat;
    await this.play();
    this.updateTransportUI();
    this.status('🎤 Dubler → "' + t.name + '" — nyanyi / beatbox, tekan Selesai kalau sudah');
  },
  async toggleDubler(tryOnly) {
    if (T.dubTry) { T.dubTry = false; DubLive.stop(); await Recorder.stop(); this.updateTransportUI(); this.status('Dubler live dimatikan'); return; }
    return T.recording ? this.toggleRecord() : this.startDubler(tryOnly);
  },
  beatAtTime(t) {
    let seg = T.segs[0];
    for (const s of T.segs) if (s.t0 <= t) seg = s;
    return seg ? seg.b0 + (t - seg.t0) / this.spb() : UI.playhead;
  },
  async finishDubler(blob, info, events) {
    const spb = this.spb();
    // waktu ctx -> beat relatif awal rekaman
    const ev = events.map((e) => ({ ...e, t: (this.beatAtTime(e.t) - info.beat) * spb })).filter((e) => e.t > -0.2);
    ev.forEach((e) => { if (e.t < 0) e.t = 0; });
    const def = INSTRUMENTS[info.track.inst];
    const notes = eventsToNotes(ev, spb, def.drum);
    if (!notes.length) { this.status('Dubler belum menangkap nada — suara lebih keras / dekat mic, atau naikkan Sensitivitas di ⚙'); return; }
    History.push();
    const end = Math.max(...notes.map((x) => x.s + x.l));
    const len = Math.max(4, Math.ceil(end / 4) * 4);
    const c = makeInstClip(info.beat, len, len, notes);
    c.name = '🎤 Dubler';
    info.track.clips.push(c);
    UI.sel = new Set([c.id]); UI.selTrack = info.track.id;
    this.openPiano(c, info.track);
    this.changed();
    this.status('🎤→🎹 ' + notes.length + ' note tercatat dari suaramu');
    // simpan juga audio mentahnya di Sound FX
    try {
      if (blob) {
        const bytes = await blob.arrayBuffer();
        const buf = await E.ctx.decodeAudioData(bytes.slice(0));
        registerAudio(uid('rec'), 'Dubler take ' + (Object.values(AUDIO).filter((a) => a.name.startsWith('Dubler')).length + 1), buf, bytes);
        P.fx = Object.keys(AUDIO).filter((k) => !k.startsWith('loop:') && (P.fx.includes(k) || AUDIO[k].name.startsWith('Dubler take')));
        Panels.renderFx();
      }
    } catch (e) { /* abaikan */ }
  },
  // buat clip nada dari potongan audio; return jumlah note
  makeDublerClip(track, buf, startSec, durSec, bpm, beat) {
    const drum = INSTRUMENTS[track.inst].drum;
    const notes = drum ? beatboxToDrums(buf, startSec, durSec, bpm, INSTRUMENTS[track.inst].dub) : voiceToNotes(buf, startSec, durSec, bpm);
    if (!notes.length) return 0;
    History.push();
    const end = Math.max(...notes.map((x) => x.s + x.l));
    const len = Math.max(4, Math.ceil(end / 4) * 4);
    const c = makeInstClip(beat, len, len, notes);
    c.name = '🎤 Dubler';
    track.clips.push(c);
    UI.sel = new Set([c.id]); UI.selTrack = track.id;
    this.openPiano(c, track);
    this.changed();
    return notes.length;
  },
  async audioClipToNotes(clip, inst) {
    const a = AUDIO[clip.buf]; if (!a) return;
    await this.loadInst(inst);
    History.push();
    const t = makeTrack('inst', inst); t.name = INSTRUMENTS[inst].name + ' (dari ' + (clip.name || a.name) + ')';
    const idx = P.tracks.findIndex((x) => x.clips.includes(clip));
    P.tracks.splice(idx + 1, 0, t);
    const tr = clipTimeRate(clip);
    const n = this.makeDublerClip(t, a.buffer, clip.offset, clip.len * this.spb() * tr, P.bpm / tr, clip.start);
    if (!n) { P.tracks.splice(P.tracks.indexOf(t), 1); this.changed(); this.status('Tidak ada nada terdeteksi di clip ini'); }
    else this.status('🎤→🎹 ' + n + ' note dibuat dari clip audio');
  },
  dublerSettings(anchor) {
    const box = $('#dubCfg');
    if (!box.classList.contains('hidden')) { box.classList.add('hidden'); return; }
    box.innerHTML = '';
    const chk = (label, val, on) => { const c = h('input', { type: 'checkbox', checked: val }); c.onchange = () => on(c.checked); return h('label', { class: 'check' }, c, ' ' + label); };
    const sel = (opts, val, on) => { const s = h('select', {}, ...opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(val) }, l))); s.onchange = () => on(s.value); return s; };
    box.append(h('h4', {}, '🎤→🎹 Pengaturan Dubler'),
      h('label', { class: 'slider' }, h('span', { class: 'sl-label' }, 'Skala'), sel(Object.entries(SCALES).map(([k, v]) => [k, v.name]), DUB.scale, (v) => (DUB.scale = v))),
      h('label', { class: 'slider' }, h('span', { class: 'sl-label' }, 'Nada dasar'), sel(NOTE_NAMES.map((n, i) => [i, n]), DUB.root, (v) => (DUB.root = +v))),
      h('label', { class: 'slider' }, h('span', { class: 'sl-label' }, 'Geser oktaf'), sel([[-2, '-2'], [-1, '-1'], [0, '0'], [1, '+1'], [2, '+2']], DUB.octave, (v) => (DUB.octave = +v))),
      Slider({ label: 'Sensitivitas', min: 0, max: 1, step: 0.05, value: DUB.sens, fmt: fmtPct, onInput: (v) => (DUB.sens = v) }),
      Slider({ label: 'Stabil nada', min: 0, max: 1, step: 0.05, value: DUB.stable, fmt: (v) => (v < 0.3 ? 'cepat' : v > 0.7 ? 'sangat stabil' : 'normal'), onInput: (v) => (DUB.stable = v) }),
      chk('Instrumen bunyi live saat nyanyi', DUB.monitor, (v) => (DUB.monitor = v)),
      chk('Rapikan ke grid (quantize sesuai Snap)', DUB.quant, (v) => (DUB.quant = v)),
      h('p', { class: 'hint' }, 'Pilih track instrumen (Piano, Biola, Drum Kit, dll) lalu tekan 🎤→🎹. Melodi: senandung "na-na / du-du" per nada. Drum: bung = kick, tak = snare, dung = tom, tss = hi-hat, dess = crash. Pakai headset supaya suara speaker tidak ikut terdeteksi.'),
      h('div', { class: 'btnrow' },
        h('button', { onclick: () => { box.classList.add('hidden'); this.toggleDubler(true); } }, '🎧 Coba live (tanpa rekam)'),
        h('button', { onclick: () => { box.classList.add('hidden'); this.toggleDubler(false); } }, '● Rekam Dubler'),
        h('button', { onclick: () => box.classList.add('hidden') }, 'Tutup')));
    const r = anchor.getBoundingClientRect();
    box.style.left = Math.max(4, Math.min(r.left, innerWidth - 324)) + 'px'; box.style.top = Math.min(r.bottom + 6, innerHeight - 420) + 'px';
    box.classList.remove('hidden');
  },
  renderMasterPct() {
    const w = $('#masterPct');
    if (!w.firstChild) {
      w.append(PctInput(() => P.master.vol, (v) => { P.master.vol = v; $('#masterVol').value = Math.min(1.5, v); if (E.ctx) updateMasterFx(E.ctx, E.master, P); this.queueSave(); }));
    }
    w.querySelector('input').sync();
  },

  // ---------- export ----------
  async exportWav(loopOnly) {
    const from = loopOnly ? P.loop.start : 0, to = loopOnly ? P.loop.end : songEnd();
    if (to <= from) { this.status('Belum ada clip untuk di-export'); return; }
    await this.loadNeeded();
    this.loading(true, 'Render WAV…');
    try {
      const buf = await renderMix(P, from, to);
      const blob = encodeWav(buf);
      download(blob, (P.name || 'lagu').replace(/[^\w\- ]+/g, '') + '.wav');
      this.status('Export WAV selesai (' + buf.duration.toFixed(1) + 's)');
    } catch (e) { console.error(e); this.status('Export gagal: ' + e.message); }
    this.loading(false);
  },
  saveFile() {
    const blob = new Blob([projectToFile()], { type: 'application/json' });
    download(blob, (P.name || 'lagu').replace(/[^\w\- ]+/g, '') + '.studioloop.json');
    this.status('Project disimpan ke file');
  },
  async openFile(file) {
    this.loading(true, 'Membuka project…');
    try {
      const data = JSON.parse(await file.text());
      const entries = Object.entries(data.audio || {}).map(([id, a]) => [id, { name: a.name, bytes: b64ToArrayBuffer(a.b64) }]);
      await loadAudioMap(entries);
      if (T.playing) this.pause();
      History.push();
      P = normalizeProject(data.project);
      UI.editClip = null; UI.sel.clear();
      await this.loadNeeded();
      this.afterLoad();
      this.queueSave();
      this.status('Project dibuka: ' + P.name);
    } catch (e) { this.status('File project tidak valid'); console.error(e); }
    this.loading(false);
  },
  async newProject(demo) {
    if (!confirm(demo ? 'Muat demo lagu? (project sekarang diganti)' : 'Buat project baru? (project sekarang diganti)')) return;
    if (T.playing) this.pause();
    History.push();
    if (demo) demoProject(); else { P = newProject(); P.tracks.push(makeTrack('inst', 'piano'), makeTrack('inst', 'drums'), makeTrack('audio')); }
    UI.editClip = null; UI.sel.clear(); UI.playhead = 0; UI.scrollX = 0; UI.scrollY = 0;
    await this.loadNeeded();
    this.afterLoad();
    this.queueSave();
  },
  async previewInstrument(id) {
    await E.resume();
    await this.loadInst(id);
    const def = INSTRUMENTS[id];
    const ctx = E.ctx, t0 = ctx.currentTime + 0.05;
    const seq = def.drum ? [[0, 0], [4, 0.25], [2, 0.5], [4, 0.75], [0, 1], [4, 1.25], [2, 1.5], [5, 1.75]] : [[60, 0], [64, 0.25], [67, 0.5], [72, 0.75]];
    for (const [p, dt] of seq) {
      const pick = pickSample(def, p); if (!pick) continue;
      const src = ctx.createBufferSource(); src.buffer = pick.buffer; src.playbackRate.value = pick.rate;
      const g = ctx.createGain(); g.gain.value = 0.7;
      if (!def.drum) { g.gain.setValueAtTime(0.7, t0 + dt + 0.9); g.gain.setTargetAtTime(0, t0 + dt + 0.9, 0.1); }
      src.connect(g); g.connect(E.master.input); src.start(t0 + dt); src.stop(t0 + dt + 1.6);
    }
  },

  // ---------- UI ----------
  activeTab() { const b = $('#tabs button[data-tab].active'); return b ? b.dataset.tab : 'piano'; },
  showTab(name) {
    document.querySelectorAll('#tabs button[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab-page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + name));
    if (name === 'rack') Panels.renderRack();
    if (name === 'mixer') Panels.renderMixer();
    if (name === 'clip') Panels.renderInspector();
    if (name === 'piano') { PR.resize(); PR.dirty = true; }
  },
  status(msg) { $('#status').textContent = msg; },
  loading(on, text) {
    $('#loading').classList.toggle('hidden', !on);
    if (text) $('#loadingText').textContent = text;
  },
  setTool(t) {
    UI.tool = t;
    document.querySelectorAll('#tools button').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  },

  bindUI() {
    $('#btnPlay').onclick = () => this.togglePlay();
    $('#btnStop').onclick = () => this.stop();
    $('#btnRec').onclick = () => this.toggleRecord();
    $('#btnDub').onclick = () => this.toggleDubler();
    $('#dubStop').onclick = () => this.toggleDubler();
    $('#btnDubCfg').onclick = (e) => this.dublerSettings(e.currentTarget);
    $('#btnLoop').onclick = () => { P.loop.on = !P.loop.on; this.updateTransportUI(); A.dirty = true; this.queueSave(); if (T.playing) this.reschedule(true); };
    $('#btnMetro').onclick = () => { E.metronome = !E.metronome; this.updateTransportUI(); this.reschedule(true); };
    $('#bpm').addEventListener('change', () => {
      const v = Math.max(40, Math.min(240, parseFloat($('#bpm').value) || 120));
      History.push();
      // clip audio tetap sama durasi detiknya -> panjang beat disesuaikan
      const r = v / P.bpm;
      for (const t of P.tracks) for (const c of t.clips) if (c.type === 'audio') { c.len *= r; c.fadeIn *= r; c.fadeOut *= r; }
      P.bpm = v; $('#bpm').value = v;
      if (E.ctx) updateMasterFx(E.ctx, E.master, P);
      this.changed();
    });
    $('#snap').addEventListener('change', () => { UI.snap = parseFloat($('#snap').value); });
    $('#masterVol').addEventListener('input', () => { P.master.vol = parseFloat($('#masterVol').value); this.renderMasterPct(); if (E.ctx) updateMasterFx(E.ctx, E.master, P); this.queueSave(); });
    document.querySelectorAll('#tools button').forEach((b) => (b.onclick = () => this.setTool(b.dataset.tool)));
    document.querySelectorAll('#tabs button[data-tab]').forEach((b) => (b.onclick = () => this.showTab(b.dataset.tab)));
    $('#btnImport').onclick = () => $('#fileInput').click();
    $('#fileInput').addEventListener('change', async (e) => { await this.importFiles([...e.target.files]); e.target.value = ''; });
    $('#btnAddInst').onclick = (e) => Menu.show(e.clientX, e.clientY, INSTRUMENT_ORDER.map((id) => ({ label: INSTRUMENTS[id].icon + ' ' + INSTRUMENTS[id].name, fn: () => this.addInstrumentTrack(id) })));
    $('#btnAddAudio').onclick = () => this.addAudioTrack();
    $('#zoomIn').onclick = () => { UI.zoom = Math.min(400, UI.zoom * 1.25); A.dirty = true; };
    $('#zoomOut').onclick = () => { UI.zoom = Math.max(4, UI.zoom / 1.25); A.dirty = true; };
    $('#prZoomIn').onclick = () => { PR.zoom = Math.min(300, PR.zoom * 1.25); PR.dirty = true; };
    $('#prZoomOut').onclick = () => { PR.zoom = Math.max(8, PR.zoom / 1.25); PR.dirty = true; };
    $('#prQuant').onclick = () => PR.quantize();
    $('#prSelAll').onclick = () => { const f = PR.ctx(); if (f) { PR.sel = new Set(f.clip.notes); PR.dirty = true; } };
    $('#prNoteLen').addEventListener('change', () => { UI.lastNoteLen = parseFloat($('#prNoteLen').value); });
    $('#prPatLen').addEventListener('change', () => { const f = PR.ctx(); if (!f) return; History.push(); f.clip.patLen = Math.max(1, parseFloat($('#prPatLen').value) || 4); this.changed(); });
    $('#rackOct').addEventListener('change', () => Panels.renderRack());
    $('#trackHeadsClip').addEventListener('wheel', (e) => A.onWheel(e), { passive: false });

    // menu atas
    document.querySelectorAll('.menu-btn').forEach((b) => (b.onclick = (e) => {
      const r = b.getBoundingClientRect();
      const menus = {
        file: [
          { label: '📄 Project baru', fn: () => this.newProject(false) },
          { label: '🎵 Muat demo lagu', fn: () => this.newProject(true) },
          { label: '📂 Buka project (.json)…', fn: () => pickFile('.json,application/json', (f) => this.openFile(f)) },
          { label: '💾 Simpan project ke file', fn: () => this.saveFile() },
          { sep: true },
          { label: '⬇ Export lagu ke WAV', fn: () => this.exportWav(false) },
          { label: '⬇ Export loop region ke WAV', fn: () => this.exportWav(true) },
          { sep: true },
          { label: '✎ Ganti nama lagu', fn: () => { const n = prompt('Nama lagu', P.name); if (n) { P.name = n; this.queueSave(); } } },
        ],
        edit: [
          { label: '↶ Undo (Ctrl+Z)', fn: () => this.undo() },
          { label: '↷ Redo (Ctrl+Y)', fn: () => this.redo() },
          { sep: true },
          { label: '📋 Copy (Ctrl+C)', fn: () => this.copySel() },
          { label: '📋 Paste di playhead (Ctrl+V)', fn: () => this.pasteClip() },
          { label: '⧉ Duplikat (Ctrl+D)', fn: () => this.duplicateSel() },
          { label: '✂ Split di playhead (S)', fn: () => this.splitAtPlayhead() },
          { label: '🗑 Hapus (Del)', fn: () => this.deleteSel() },
          { label: '▦ Pilih semua clip (Ctrl+A)', fn: () => this.selectAll() },
        ],
        add: [
          ...INSTRUMENT_ORDER.map((id) => ({ label: INSTRUMENTS[id].icon + ' ' + INSTRUMENTS[id].name, fn: () => this.addInstrumentTrack(id) })),
          { sep: true },
          { label: '🎙 Track audio kosong', fn: () => this.addAudioTrack() },
          { label: '📥 Import MP3/WAV…', fn: () => $('#fileInput').click() },
          { label: '● Rekam dari mikrofon', fn: () => this.toggleRecord() },
          { label: '🎤→🎹 Dubler: suara jadi note (D)', fn: () => this.toggleDubler() },
        ],
      };
      Menu.show(r.left, r.bottom + 2, menus[b.dataset.menu]);
      e.stopPropagation();
    }));

    // drop file ke seluruh jendela
    let dragDepth = 0;
    window.addEventListener('dragenter', (e) => { if (e.dataTransfer.types.includes('Files')) { dragDepth++; $('#dropOverlay').classList.remove('hidden'); } });
    window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#dropOverlay').classList.add('hidden'); });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', async (e) => {
      dragDepth = 0; $('#dropOverlay').classList.add('hidden');
      e.preventDefault();
      if (e.target.closest && e.target.closest('#arrCanvasWrap')) return;
      if (e.dataTransfer.files.length) await this.importFiles([...e.dataTransfer.files]);
    });
    $('#browser').addEventListener('drop', () => {});

    // resize dock
    const dr = $('#dockResize');
    dr.addEventListener('pointerdown', (e) => {
      dr.setPointerCapture(e.pointerId);
      const y0 = e.clientY, h0 = $('#dock').offsetHeight;
      const mv = (ev) => { $('#dock').style.height = Math.max(120, Math.min(innerHeight - 200, h0 - (ev.clientY - y0))) + 'px'; };
      const up = () => { dr.removeEventListener('pointermove', mv); dr.removeEventListener('pointerup', up); };
      dr.addEventListener('pointermove', mv); dr.addEventListener('pointerup', up);
    });

    // fokus area terakhir (untuk shortcut)
    A.cv.addEventListener('pointerdown', () => (UI.focus = 'arr'), true);
    PR.cv.addEventListener('pointerdown', () => (UI.focus = 'pr'), true);
    window.addEventListener('keydown', (e) => this.onKey(e));
    // resume audio saat interaksi pertama
    const resume = () => { E.resume(); window.removeEventListener('pointerdown', resume); };
    window.addEventListener('pointerdown', resume);
  },
  undo() { if (History.doUndo()) this.afterHistory(); },
  redo() { if (History.doRedo()) this.afterHistory(); },
  afterHistory() {
    PR.sel.clear();
    UI.sel = new Set([...UI.sel].filter((id) => findClip(id)));
    if (UI.editClip && !findClip(UI.editClip)) UI.editClip = null;
    this.syncStrips();
    if (E.ctx) updateMasterFx(E.ctx, E.master, P);
    $('#bpm').value = P.bpm;
    this.changed();
    this.updateTransportUI();
  },
  onKey(e) {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' && !['range', 'checkbox'].includes(e.target.type) || tag === 'textarea' || tag === 'select') return;
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    const inPR = UI.focus === 'pr' && this.activeTab() === 'piano';
    if (k === ' ') { e.preventDefault(); this.togglePlay(); return; }
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); this.redo(); return; }
    if (mod && k === 's') { e.preventDefault(); this.saveFile(); return; }
    if (mod && k === 'c') { this.copySel(); return; }
    if (mod && k === 'v') { this.pasteClip(); return; }
    if (mod && k === 'd') { e.preventDefault(); if (!(inPR && PR.duplicateSel())) this.duplicateSel(); return; }
    if (mod && k === 'a') { e.preventDefault(); if (inPR) { const f = PR.ctx(); if (f) { PR.sel = new Set(f.clip.notes); PR.dirty = true; } } else this.selectAll(); return; }
    if (k === 'delete' || k === 'backspace') { e.preventDefault(); if (!(inPR && PR.deleteSel())) this.deleteSel(); return; }
    if (inPR && (k === 'arrowup' || k === 'arrowdown')) { e.preventDefault(); PR.transposeSel((k === 'arrowup' ? 1 : -1) * (e.shiftKey ? 12 : 1)); return; }
    if (mod) return;
    if (k === 's') this.splitAtPlayhead();
    else if (k === 'p') this.setTool('pointer');
    else if (k === 'b') this.setTool('draw');
    else if (k === 'c') this.setTool('slice');
    else if (k === 'e') this.setTool('erase');
    else if (k === 't') this.setTool('mute');
    else if (k === 'l') $('#btnLoop').click();
    else if (k === 'r') this.toggleRecord();
    else if (k === 'd') this.toggleDubler();
    else if (k === 'home' || k === 'enter') this.seek(P.loop.on ? P.loop.start : 0);
    else if (k === 'f5') { e.preventDefault(); this.showTab('piano'); }
    else if (k === 'f6') { e.preventDefault(); this.showTab('rack'); }
    else if (k === 'f9') { e.preventDefault(); this.showTab('mixer'); }
  },
};

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function pickFile(accept, cb) {
  const i = document.createElement('input'); i.type = 'file'; i.accept = accept;
  i.onchange = () => i.files[0] && cb(i.files[0]);
  i.click();
}

window.addEventListener('DOMContentLoaded', () => App.boot());
