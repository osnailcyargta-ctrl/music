/* =========================================================
   MODE HP
   - Portrait (HP berdiri): layout mirip CapCut — preview di atas,
     tombol play di tengah, timeline dengan playhead tetap di tengah
     (geser timeline pakai jari, cubit untuk zoom), toolbar ikon di bawah
     yang berubah saat clip dipilih, panel muncul sebagai bottom sheet.
   - Landscape HP / layar kecil: layout desktop versi ringkas.
   ========================================================= */
'use strict';

const Mobile = {
  on: false, compact: false, sig: '',

  init() {
    this.check();
    window.addEventListener('resize', () => this.check());
    window.addEventListener('orientationchange', () => setTimeout(() => this.check(), 200));
    $('#mPlay').onclick = () => App.togglePlay();
    $('#mUndo').onclick = () => App.undo();
    $('#mRedo').onclick = () => App.redo();
    $('#mLoop').onclick = () => $('#btnLoop').click();
    $('#mExport').onclick = () => Menu.show(innerWidth - 230, 50, [
      { label: '⬇ Export lagu ke WAV', fn: () => App.exportWav(false) },
      { label: '⬇ Export loop region ke WAV', fn: () => App.exportWav(true) },
      { label: '💾 Simpan project ke file', fn: () => App.saveFile() },
    ]);
    $('#mMenu').onclick = () => Menu.show(8, 50, [
      { label: '📄 Project baru', fn: () => App.newProject(false) },
      { label: '🎵 Muat demo lagu', fn: () => App.newProject(true) },
      { label: '📂 Buka project…', fn: () => pickFile('.json,application/json', (f) => App.openFile(f)) },
      { label: '💾 Simpan project', fn: () => App.saveFile() },
      { sep: true },
      { label: '✎ Ganti nama lagu', fn: () => { const n = prompt('Nama lagu', P.name); if (n) { P.name = n; App.queueSave(); } } },
      { label: '📋 Paste clip di playhead', fn: () => App.pasteClip() },
      { label: '▦ Pilih semua clip', fn: () => App.selectAll() },
    ]);
    $('#mBpm').addEventListener('change', () => { $('#bpm').value = $('#mBpm').value; $('#bpm').dispatchEvent(new Event('change')); });
    $('#mSheetClose').onclick = () => this.closeSheet();
    $('#mBackdrop').onclick = () => { this.closeSheet(); this.closeBrowser(); };
    $('#dockClose').onclick = () => document.body.classList.remove('m-dock-open');
    $('#mBrowserBtn').onclick = () => document.body.classList.toggle('browser-open');
    // pilih item browser di HP -> sheet otomatis tertutup
    $('#browser').addEventListener('click', (e) => {
      if (!e.target.closest('.bplay') && e.target.closest('.bitem') && this.on) setTimeout(() => this.closeBrowser(), 50);
    });
    requestAnimationFrame(() => this.frame());
  },
  check() {
    const w = innerWidth, hgt = innerHeight;
    const mobile = hgt > w && w <= 820;
    const compact = !mobile && (hgt <= 560 || w <= 1000);
    if (mobile === this.on && compact === this.compact) return;
    this.on = mobile; this.compact = compact;
    UI.mobile = mobile;
    document.body.classList.toggle('mobile', mobile);
    document.body.classList.toggle('compact', compact);
    TRACK_H = mobile ? 60 : compact ? 60 : 72;
    AUTO_H = mobile ? 70 : 78;
    if (!mobile) { document.body.classList.remove('m-dock-open', 'm-browser-open'); this.closeSheet(); }
    if (mobile) { UI.zoom = Math.max(UI.zoom, 18); PR.ROW = 18; PR.KEY_W = 48; } else { PR.ROW = 14; PR.KEY_W = 64; }
    this.sig = '';
    setTimeout(() => { A.resize(); PR.resize(); if (P.tracks) App.renderAll(); }, 30);
  },

  // ---------- bottom sheets ----------
  openDock(tab) { document.body.classList.add('m-dock-open'); App.showTab(tab); setTimeout(() => { PR.resize(); PR.dirty = true; }, 260); },
  openBrowser(section) {
    document.body.classList.add('m-browser-open');
    $('#mBackdrop').classList.remove('hidden');
    const el = section === 'fx' ? $('#fxList') : $('#instList');
    setTimeout(() => el.scrollIntoView({ block: 'start' }), 50);
  },
  closeBrowser() { document.body.classList.remove('m-browser-open'); if ($('#mSheet').classList.contains('hidden')) $('#mBackdrop').classList.add('hidden'); },
  sheet(title, ...nodes) {
    $('#mSheetTitle').textContent = title;
    const b = $('#mSheetBody'); b.innerHTML = ''; b.append(...nodes);
    $('#mSheet').classList.remove('hidden'); $('#mBackdrop').classList.remove('hidden');
  },
  closeSheet() { $('#mSheet').classList.add('hidden'); if (!document.body.classList.contains('m-browser-open')) $('#mBackdrop').classList.add('hidden'); },

  // ---------- toolbar bawah ----------
  sel() { const id = [...UI.sel][0]; return id ? findClip(id) : null; },
  renderTools() {
    const bar = $('#mTools'); bar.innerHTML = '';
    const f = this.sel();
    const btn = (icon, label, fn, on) => {
      const b = h('button', { class: 'mt' + (on ? ' on' : '') }, h('span', { class: 'mt-i' }, icon), h('span', { class: 'mt-l' }, label));
      b.onclick = (e) => fn(e.currentTarget);
      bar.append(b);
    };
    if (f) {
      const { clip: c, track: t } = f;
      btn('‹', 'Kembali', () => { UI.sel.clear(); App.selectClip(null); });
      btn('✂', 'Split', () => App.splitAtPlayhead());
      btn('⧉', 'Duplikat', () => App.duplicateSel());
      btn('🗑', 'Hapus', () => App.deleteSel());
      btn('🔊', 'Volume', () => this.volumeSheet(c));
      if (c.type === 'inst') btn('🎹', 'Edit nada', () => { App.openPiano(c, t, true); this.openDock('piano'); });
      if (c.type === 'audio') btn('⏩', 'Speed', () => this.speedSheet(c));
      btn('🎵', 'Pitch', () => this.pitchSheet(c));
      if (c.type === 'audio') btn('◢', 'Fade', () => this.fadeSheet(c));
      btn('◆', 'Keyframe', () => this.keyframeSheet(t));
      if (c.type === 'audio') btn('⇄', 'Reverse', () => { History.push(); c.reverse = !c.reverse; App.changed(); }, c.reverse);
      if (c.type === 'audio') btn('🎤', 'Jadi note', () => App.audioClipToNotes(c, 'piano'));
      if (c.type === 'audio') btn('🥁', 'Jadi drum', () => App.audioClipToNotes(c, 'drums-pro'));
      btn('🔇', c.muted ? 'Unmute' : 'Mute', () => { History.push(); c.muted = !c.muted; App.changed(); }, c.muted);
      btn('🎛', 'Efek', () => this.openDock('clip'));
      return;
    }
    const snaps = [[4, '1 bar'], [1, '1 beat'], [0.5, '1/2'], [0.25, '1/4'], [0.125, '1/8'], [0, 'bebas']];
    const si = snaps.findIndex((s) => s[0] === UI.snap);
    btn('🎹', 'Instrumen', () => this.openBrowser('inst'));
    btn('🔊', 'Sound FX', () => this.openBrowser('fx'));
    btn('📥', 'Import', () => $('#fileInput').click());
    btn('🎤', 'Dubler', () => App.toggleDubler(), T.recording && T.recInfo && T.recInfo.dubler);
    btn('🎧', 'Coba Dubler', () => App.toggleDubler(true), T.dubTry);
    btn('⚙', 'Set Dubler', (b) => App.dublerSettings(b));
    btn('●', 'Rekam', () => App.toggleRecord(), T.recording && !(T.recInfo && T.recInfo.dubler));
    btn('🎼', 'Piano Roll', () => this.openDock('piano'));
    btn('🥁', 'Step Seq', () => this.openDock('rack'));
    btn('🎚', 'Mixer', () => this.openDock('mixer'));
    btn('🎛', 'Track/Efek', () => this.openDock('clip'));
    btn('✏️', UI.tool === 'draw' ? 'Pensil ON' : 'Pensil', () => App.setTool(UI.tool === 'draw' ? 'pointer' : 'draw'), UI.tool === 'draw');
    btn('🧲', 'Snap ' + (snaps[si] ? snaps[si][1] : ''), () => { const n = snaps[(si + 1) % snaps.length][0]; UI.snap = n; $('#snap').value = String(n); });
    btn('♩', 'Metronom', () => $('#btnMetro').click(), E.metronome);
    btn('＋', 'Track audio', () => App.addAudioTrack());
    btn('🔍', 'Zoom +', () => { UI.zoom = Math.min(400, UI.zoom * 1.3); A.dirty = true; });
    btn('🔎', 'Zoom −', () => { UI.zoom = Math.max(4, UI.zoom / 1.3); A.dirty = true; });
  },

  volumeSheet(c) {
    const slider = Slider({ label: 'Volume', min: 0, max: 1000, step: 1, value: Math.round(c.gain * 100), fmt: (v) => v + '%', wide: true, onInput: (v) => { c.gain = v / 100; pct.firstChild.sync(); App.softChanged(); } });
    const pct = PctInput(() => c.gain, (v) => { c.gain = v; slider.querySelector('input').value = Math.round(v * 100); App.softChanged(); });
    const presets = h('div', { class: 'btnrow' }, ...[0, 50, 100, 150, 200, 500, 1000].map((v) => h('button', { onclick: () => { History.push(); c.gain = v / 100; App.changed(); this.volumeSheet(c); } }, v + '%')));
    this.sheet('🔊 Volume clip (0–1000%)', slider, h('label', { class: 'slider' }, h('span', { class: 'sl-label' }, 'Ketik'), pct), presets);
  },
  speedSheet(c) {
    const keep = h('input', { type: 'checkbox', checked: c.keepPitch });
    keep.onchange = () => { History.push(); const r0 = clipTimeRate(c); c.keepPitch = keep.checked; c.len = Math.min(c.len * r0 / clipTimeRate(c), audioFullLen(c)); App.changed(); };
    this.sheet('⏩ Speed', Slider({ label: 'Speed', min: -2, max: 2, step: 0.01, value: Math.log2(c.speed), wide: true, fmt: (v) => Math.pow(2, v).toFixed(2) + 'x', onInput: (v) => { const r0 = clipTimeRate(c); c.speed = Math.round(Math.pow(2, v) * 100) / 100; c.len = Math.min(c.len * r0 / clipTimeRate(c), audioFullLen(c)); App.softChanged(); } }),
      h('label', { class: 'check' }, keep, ' Pertahankan pitch'),
      h('div', { class: 'btnrow' }, ...[0.5, 0.75, 1, 1.25, 1.5, 2].map((v) => h('button', { onclick: () => { History.push(); const r0 = clipTimeRate(c); c.speed = v; c.len = Math.min(c.len * r0 / clipTimeRate(c), audioFullLen(c)); App.changed(); this.speedSheet(c); } }, v + 'x'))));
  },
  pitchSheet(c) {
    this.sheet('🎵 Pitch', Slider({ label: 'Pitch', min: -24, max: 24, step: 1, value: c.pitch || 0, wide: true, fmt: (v) => (v > 0 ? '+' : '') + v + ' semitone', onInput: (v) => {
      if (c.type === 'audio') { const r0 = clipTimeRate(c); c.pitch = v; c.len = Math.min(c.len * r0 / clipTimeRate(c), audioFullLen(c)); } else c.pitch = v;
      App.softChanged();
    } }));
  },
  fadeSheet(c) {
    this.sheet('◢ Fade', Slider({ label: 'Fade In', min: 0, max: Math.max(0.25, c.len), step: 0.05, value: c.fadeIn || 0, wide: true, fmt: (v) => v.toFixed(2) + ' beat', onInput: (v) => { c.fadeIn = Math.min(v, c.len - (c.fadeOut || 0)); App.softChanged(); } }),
      Slider({ label: 'Fade Out', min: 0, max: Math.max(0.25, c.len), step: 0.05, value: c.fadeOut || 0, wide: true, fmt: (v) => v.toFixed(2) + ' beat', onInput: (v) => { c.fadeOut = Math.min(v, c.len - (c.fadeIn || 0)); App.softChanged(); } }));
  },
  // ◆ keyframe ala CapCut: tambah titik di posisi playhead
  keyframeSheet(t) {
    const rows = AUTO_ORDER.map((k) => {
      const pts = t.auto[k];
      const add = h('button', { class: 'kf-add' }, '◆ Tambah di playhead');
      add.onclick = () => {
        History.push();
        const at = A.snap(UI.playhead);
        const cur = autoValueAt(pts, at);
        let v = cur != null ? cur : AUTO_PARAMS[k].def;
        if (cur == null && k === 'volume') v = Math.min(1, t.vol / 1.25);
        if (cur == null && k === 'pan') v = (t.pan + 1) / 2;
        if (cur == null && k === 'reverb') v = t.reverb;
        const ex = pts.find((p) => Math.abs(p.t - at) < 1e-6);
        if (!ex) { pts.push({ t: at, v, c: 0, m: 'curve' }); pts.sort((a, b) => a.t - b.t); }
        t.showAuto = k;
        App.changed(); this.keyframeSheet(t);
      };
      const show = h('button', { class: t.showAuto === k ? 'on' : '' }, t.showAuto === k ? 'Lane tampil' : 'Tampilkan');
      show.onclick = () => { t.showAuto = t.showAuto === k ? null : k; App.changed(true); this.keyframeSheet(t); };
      return h('div', { class: 'auto-row' }, h('span', { class: 'dot', style: `background:${AUTO_PARAMS[k].color}` }), h('span', { class: 'an' }, AUTO_PARAMS[k].label), h('span', { class: 'ac' }, pts.length ? pts.length + ' titik' : '—'), add, show);
    });
    this.sheet('◆ Keyframe — ' + t.name, h('p', { class: 'hint' }, 'Geser timeline ke posisi yang diinginkan, lalu tekan ◆. Di lane, seret titik untuk ubah nilai; seret titik kecil di tengah garis untuk melengkungkan kurva; tahan lama titik untuk ganti jenis kurva.'), ...rows);
  },

  // ---------- loop HP ----------
  frame() {
    if (this.on) {
      const want = UI.playhead * UI.zoom - A.w / 2;
      if (Math.abs(UI.scrollX - want) > 0.5) { UI.scrollX = want; A.dirty = true; }
      const sig = [...UI.sel].join() + '|' + UI.tool + '|' + UI.snap + '|' + T.recording + '|' + T.dubTry + '|' + E.metronome + '|' + P.tracks.length;
      if (sig !== this.sig) { this.sig = sig; this.renderTools(); }
      const s = UI.playhead * 60 / P.bpm, end = Math.max(songEnd(), 1) * 60 / P.bpm;
      const fmt = (x) => Math.floor(x / 60) + ':' + String(Math.floor(x % 60)).padStart(2, '0');
      $('#mTime').textContent = fmt(s) + ' / ' + fmt(end);
      $('#mPlay').textContent = T.playing ? '❚❚' : '▶';
      $('#mNowBig').textContent = $('#timeBars').textContent;
      const t = UI.selTrack && findTrack(UI.selTrack);
      const inst = t ? (t.type === 'inst' ? INSTRUMENTS[t.inst].icon + ' ' : '🎙 ') + t.name : '—';
      $('#mNowInst').textContent = DubLive.an ? '🎤 ' + $('#dubNote').textContent : inst;
      if (document.activeElement !== $('#mBpm')) $('#mBpm').value = P.bpm;
      $('#mTitle').textContent = P.name;
      this.viz();
    }
    requestAnimationFrame(() => this.frame());
  },
  viz() {
    const cv = $('#mViz'), dpr = devicePixelRatio || 1;
    const w = cv.clientWidth, hh = cv.clientHeight;
    if (cv.width !== w * dpr || cv.height !== hh * dpr) { cv.width = w * dpr; cv.height = hh * dpr; }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#07090b'; g.fillRect(0, 0, w, hh);
    const an = E.master && E.master.analyser; if (!an) return;
    const bins = an._fbuf || (an._fbuf = new Uint8Array(an.frequencyBinCount));
    an.getByteFrequencyData(bins);
    const n = 48, bw = w / n;
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(Math.pow(i / n, 2) * bins.length * 0.7);
      const v = bins[idx] / 255, bh = v * hh * 0.8;
      const gr = g.createLinearGradient(0, hh, 0, hh - bh);
      gr.addColorStop(0, '#ff9a3c'); gr.addColorStop(1, '#ff4fa3');
      g.fillStyle = gr; g.fillRect(i * bw + 1, hh - bh, bw - 2, bh);
    }
    // meter per track (warna track)
    const tr = P.tracks.slice(0, 12), mw = Math.min(14, w / 30);
    tr.forEach((t, i) => {
      const lv = Math.min(1, Math.pow(meterLevel(E.strips[t.id] && E.strips[t.id].analyser), 0.6));
      g.fillStyle = hexA(t.color, 0.9); g.fillRect(8 + i * (mw + 3), 8, mw, 4 + lv * (hh * 0.35));
    });
  },
};

