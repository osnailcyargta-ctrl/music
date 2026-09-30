/* =========================================================
   PANEL: track header, browser, channel rack, mixer, inspector,
   knob, context menu
   ========================================================= */
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const k in attrs) {
    const v = attrs[k];
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
};

// ---------- Context menu ----------
const Menu = {
  el: null,
  show(x, y, items) {
    const m = this.el || (this.el = $('#ctxMenu'));
    m.innerHTML = '';
    for (const it of items) {
      if (it.sep) { m.append(h('div', { class: 'sep' })); continue; }
      m.append(h('div', { class: 'item' + (it.disabled ? ' disabled' : ''), onclick: () => { this.hide(); if (!it.disabled) it.fn(); } }, it.label));
    }
    m.classList.remove('hidden');
    const r = m.getBoundingClientRect();
    m.style.left = Math.min(x, innerWidth - r.width - 4) + 'px';
    m.style.top = Math.min(y, innerHeight - r.height - 4) + 'px';
  },
  hide() { if (this.el) this.el.classList.add('hidden'); },
};
document.addEventListener('pointerdown', (e) => { if (Menu.el && !Menu.el.contains(e.target)) Menu.hide(); });

// ---------- Knob (drag naik/turun, dblclick reset) ----------
function Knob({ label, min, max, value, def, fmt, onInput, size = 34, color = '#ff9a3c' }) {
  const wrap = h('div', { class: 'knob-wrap', title: label + ' — seret naik/turun, klik 2x reset' });
  const k = h('div', { class: 'knob', style: `width:${size}px;height:${size}px` });
  const ind = h('div', { class: 'knob-ind', style: `background:${color}` });
  k.append(ind);
  const val = h('div', { class: 'knob-val' });
  wrap.append(k, h('div', { class: 'knob-label' }, label), val);
  let v = value;
  const render = () => {
    const f = (v - min) / (max - min);
    k.style.setProperty('--rot', (-135 + f * 270) + 'deg');
    k.style.background = `conic-gradient(from 225deg, ${color} ${f * 75}%, #2a3036 ${f * 75}% 75%, transparent 75%)`;
    val.textContent = fmt ? fmt(v) : v.toFixed(2);
  };
  render();
  k.addEventListener('pointerdown', (e) => {
    e.preventDefault(); k.setPointerCapture(e.pointerId);
    History.push();
    const y0 = e.clientY, v0 = v;
    const mv = (ev) => {
      const fine = ev.shiftKey ? 0.2 : 1;
      v = Math.max(min, Math.min(max, v0 + ((y0 - ev.clientY) / 150) * (max - min) * fine));
      render(); onInput(v);
    };
    const up = () => { k.removeEventListener('pointermove', mv); k.removeEventListener('pointerup', up); App.changed(true); };
    k.addEventListener('pointermove', mv); k.addEventListener('pointerup', up);
  });
  k.addEventListener('dblclick', () => { History.push(); v = def; render(); onInput(v); App.changed(true); });
  wrap.setValue = (nv) => { v = nv; render(); };
  return wrap;
}

function Slider({ label, min, max, step, value, fmt, onInput, wide }) {
  const out = h('span', { class: 'sl-val' }, fmt ? fmt(value) : value);
  const inp = h('input', { type: 'range', min, max, step, value });
  inp.addEventListener('pointerdown', () => History.push());
  inp.addEventListener('keydown', () => History.push());
  inp.addEventListener('input', () => { const v = parseFloat(inp.value); out.textContent = fmt ? fmt(v) : v; onInput(v); });
  inp.addEventListener('change', () => App.changed(true));
  return h('label', { class: 'slider' + (wide ? ' wide' : '') }, h('span', { class: 'sl-label' }, label), inp, out);
}

// Input angka volume 0% .. 1000% (bisa diketik / scroll; shift+scroll = langkah 50%)
function PctInput(get, set, max = 1000) {
  const inp = h('input', { type: 'number', class: 'pct', min: 0, max, step: 1, value: Math.round(get() * 100), title: 'Volume 0–' + max + '% (ketik angka, atau scroll)' });
  const apply = (pct, final) => {
    pct = Math.max(0, Math.min(max, pct || 0));
    inp.value = Math.round(pct);
    set(pct / 100);
    if (final) App.changed();
  };
  inp.addEventListener('focus', () => History.push());
  inp.addEventListener('change', () => apply(parseFloat(inp.value), true));
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); e.stopPropagation(); });
  inp.addEventListener('wheel', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (document.activeElement !== inp) History.push();
    apply(parseFloat(inp.value) + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 50 : 5));
    clearTimeout(inp._t); inp._t = setTimeout(() => App.changed(), 400);
  }, { passive: false });
  inp.sync = () => { if (document.activeElement !== inp) inp.value = Math.round(get() * 100); };
  return h('span', { class: 'pct-wrap' }, inp, '%');
}
const fmtPct = (v) => Math.round(v * 100) + '%';
const fmtPan = (v) => { const p = Math.round(v * 100); return p === 0 ? 'C' : p < 0 ? 'L' + -p : 'R' + p; };
const fmtDb = (v) => (v > 0 ? '+' : '') + v.toFixed(1) + 'dB';
const fmtVol = (v) => { const db = 20 * Math.log10(Math.max(v, 1e-4)); return v < 0.001 ? '-∞' : (db > 0 ? '+' : '') + db.toFixed(1) + 'dB'; };

// ---------- Track headers ----------
const Panels = {
  renderHeads() {
    const box = $('#trackHeads');
    box.innerHTML = '';
    const rows = A.rows();
    for (const r of rows) {
      const t = r.track;
      const def = t.type === 'inst' ? INSTRUMENTS[t.inst] : null;
      const icon = def ? def.icon : '🎙';
      const head = h('div', { class: 'thead' + (UI.selTrack === t.id ? ' sel' : ''), style: `height:${TRACK_H}px` });
      head.addEventListener('pointerdown', (e) => { if (e.target.closest('button,select,input')) return; UI.selTrack = t.id; Panels.renderHeads(); Panels.renderInspector(); A.dirty = true; });
      head.addEventListener('contextmenu', (e) => { e.preventDefault(); Panels.trackMenu(e, t); });
      const colorBar = h('div', { class: 'tcolor', style: `background:${t.color}` });
      const name = h('div', { class: 'tname', title: 'Klik 2x untuk ganti nama' }, icon + ' ' + t.name);
      name.addEventListener('dblclick', () => { const n = prompt('Nama track', t.name); if (n) { History.push(); t.name = n; App.changed(); } });
      const btns = h('div', { class: 'tbtns' },
        h('button', { class: 'tb' + (t.mute ? ' on-m' : ''), title: 'Mute', onclick: () => { History.push(); t.mute = !t.mute; App.changed(true); App.mixChanged(); } }, 'M'),
        h('button', { class: 'tb' + (t.solo ? ' on-s' : ''), title: 'Solo', onclick: () => { History.push(); t.solo = !t.solo; App.changed(true); App.mixChanged(); } }, 'S'),
        t.type === 'audio' ? h('button', { class: 'tb' + (t.arm ? ' on-r' : ''), title: 'Arm rekam (mic masuk ke track ini)', onclick: () => { P.tracks.forEach((x) => { if (x !== t) x.arm = false; }); t.arm = !t.arm; App.changed(true); } }, '●') : null,
      );
      const autoSel = h('select', { class: 'tauto', title: 'Tampilkan lane automation (keyframe)' },
        h('option', { value: '' }, '〰 Auto…'),
        ...AUTO_ORDER.filter((k) => !(t.type === 'audio' && false)).map((k) => h('option', { value: k, selected: t.showAuto === k }, (t.auto[k].length ? '● ' : '') + AUTO_PARAMS[k].label)));
      autoSel.addEventListener('change', () => { t.showAuto = autoSel.value || null; App.changed(true); });
      const vol = h('input', { type: 'range', class: 'tvol', min: 0, max: 1.5, step: 0.01, value: Math.min(1.5, t.vol), title: 'Volume track (ketik di kotak % untuk sampai 1000%)' });
      const pct = PctInput(() => t.vol, (v) => { t.vol = v; vol.value = Math.min(1.5, v); App.mixChanged(); });
      vol.addEventListener('pointerdown', () => History.push());
      vol.addEventListener('input', () => { t.vol = parseFloat(vol.value); pct.firstChild.sync(); App.mixChanged(); });
      vol.addEventListener('change', () => App.changed(true));
      const meter = h('div', { class: 'tmeter' }, h('div', { class: 'tmeter-fill', 'data-meter': t.id }));
      head.append(colorBar, h('div', { class: 'tbody' }, h('div', { class: 'trow1' }, name, btns), h('div', { class: 'trow2' }, autoSel, vol, pct), meter));
      box.append(head);
      if (t.showAuto) {
        const ah = h('div', { class: 'thead-auto', style: `height:${AUTO_H}px` },
          h('div', { style: `color:${AUTO_PARAMS[t.showAuto].color}` }, '〰 ' + AUTO_PARAMS[t.showAuto].label),
          h('div', { class: 'hint' }, 'Klik = keyframe · seret titik tengah = kurva · klik kanan titik = jenis kurva'),
          h('button', { class: 'tb', onclick: () => { t.showAuto = null; App.changed(true); } }, 'Tutup'));
        box.append(ah);
      }
    }
    box.append(h('div', { style: 'height:120px' }));
    App.syncHeadScroll();
  },
  trackMenu(e, t) {
    const i = P.tracks.indexOf(t);
    Menu.show(e.clientX, e.clientY, [
      { label: '✎ Ganti nama', fn: () => { const n = prompt('Nama track', t.name); if (n) { History.push(); t.name = n; App.changed(); } } },
      { label: '🎨 Ganti warna', fn: () => { History.push(); t.color = TRACK_COLORS[(TRACK_COLORS.indexOf(t.color) + 1) % TRACK_COLORS.length]; App.changed(); } },
      { label: '⧉ Duplikat track', fn: () => { History.push(); const n = JSON.parse(JSON.stringify(t)); n.id = uid('t'); n.name += ' (2)'; n.clips.forEach((c) => (c.id = uid('c'))); P.tracks.splice(i + 1, 0, n); App.structureChanged(); } },
      { label: '↑ Pindah ke atas', disabled: i === 0, fn: () => { History.push(); P.tracks.splice(i, 1); P.tracks.splice(i - 1, 0, t); App.changed(); } },
      { label: '↓ Pindah ke bawah', disabled: i === P.tracks.length - 1, fn: () => { History.push(); P.tracks.splice(i, 1); P.tracks.splice(i + 1, 0, t); App.changed(); } },
      { sep: true },
      { label: '🗑 Hapus track', fn: () => { if (!confirm('Hapus track "' + t.name + '"?')) return; History.push(); P.tracks.splice(i, 1); App.structureChanged(); } },
    ]);
  },

  // ---------- Browser ----------
  renderBrowser() {
    const il = $('#instList'); il.innerHTML = '';
    for (const id of INSTRUMENT_ORDER) {
      const d = INSTRUMENTS[id];
      const it = h('div', { class: 'bitem', draggable: 'true', title: 'Klik untuk tambah track · seret ke playlist' },
        h('span', { class: 'bicon', style: `background:${hexA(d.color, 0.25)};border-color:${d.color}` }, d.icon),
        h('span', { class: 'bname' }, d.name),
        h('button', { class: 'bplay', title: 'Dengar contoh', onclick: async (e) => { e.stopPropagation(); await App.previewInstrument(id); } }, '▶'));
      it.addEventListener('click', () => App.addInstrumentTrack(id));
      it.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-inst', id); e.dataTransfer.effectAllowed = 'copy'; });
      il.append(it);
    }
    this.renderFx();
  },
  renderFx() {
    const fl = $('#fxList'); fl.innerHTML = '';
    const items = [...BUILTIN_LOOPS.map((l) => ({ id: l.id, name: l.name, builtin: true })), ...P.fx.filter((id) => !id.startsWith('loop:') && AUDIO[id]).map((id) => ({ id, name: AUDIO[id].name }))];
    for (const x of items) {
      const dur = AUDIO[x.id] ? AUDIO[x.id].buffer.duration.toFixed(1) + 's' : '';
      const it = h('div', { class: 'bitem', draggable: 'true', title: 'Klik = taruh di track audio terpilih pada playhead · seret ke playlist' },
        h('span', { class: 'bicon fx' }, x.builtin ? '🔁' : '🔊'),
        h('span', { class: 'bname' }, x.name, h('small', {}, ' ' + dur)),
        h('button', { class: 'bplay', title: 'Preview', onclick: async (e) => { e.stopPropagation(); await App.ensureAudio(x.id); previewAudio(x.id); } }, '▶'),
        x.builtin ? null : h('button', { class: 'bplay', title: 'Hapus dari daftar', onclick: (e) => { e.stopPropagation(); P.fx = P.fx.filter((i) => i !== x.id); Panels.renderFx(); App.changed(true); } }, '×'));
      it.addEventListener('click', () => App.placeAudio(x.id));
      it.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-fx', x.id); e.dataTransfer.effectAllowed = 'copy'; });
      fl.append(it);
    }
  },

  // ---------- Channel Rack (step sequencer) ----------
  renderRack() {
    const box = $('#rack'); box.innerHTML = '';
    const f = UI.editClip ? findClip(UI.editClip) : null;
    const title = $('#rackTitle');
    // daftar channel ala FL
    const chans = h('div', { class: 'rack-chans' });
    for (const t of P.tracks.filter((x) => x.type === 'inst')) {
      const d = INSTRUMENTS[t.inst];
      const btn = h('button', { class: 'rack-ch' + (f && f.track === t ? ' sel' : ''), style: `border-left:4px solid ${t.color}` }, d.icon + ' ' + t.name);
      btn.addEventListener('click', () => {
        let c = t.clips.find((c) => UI.playhead >= c.start && UI.playhead < c.start + c.len) || t.clips[0];
        if (!c) { History.push(); c = makeInstClip(Math.floor(UI.playhead / 4) * 4, 4, 4, []); t.clips.push(c); App.changed(); }
        App.openPiano(c, t, true); App.showTab('rack');
      });
      chans.append(btn);
    }
    box.append(chans);
    if (!f || f.clip.type !== 'inst') { title.textContent = 'Pilih channel di bawah atau clip instrumen di playlist'; return; }
    const { clip: c, track: t } = f;
    const d = INSTRUMENTS[t.inst];
    title.textContent = d.icon + ' ' + t.name + ' — pola ' + c.patLen + ' beat';
    const oct = parseInt($('#rackOct').value, 10) || 4;
    const rows = d.drum ? d.pieces.map((p, i) => ({ p: i, label: p.label })) : Array.from({ length: 13 }, (_, i) => { const p = (oct + 2) * 12 - i; return { p, label: midiToName(p) }; });
    const steps = Math.round(c.patLen * 4);
    const grid = h('div', { class: 'rack-grid' });
    for (const row of rows) {
      const rEl = h('div', { class: 'rack-row' });
      const lbl = h('button', { class: 'rack-lbl' + (!d.drum && [1, 3, 6, 8, 10].includes(row.p % 12) ? ' black' : ''), title: 'Preview', onclick: () => previewNote(t, row.p, 0.85) }, row.label);
      rEl.append(lbl);
      for (let s = 0; s < steps; s++) {
        const beat = s * 0.25;
        const on = c.notes.find((n) => n.p === row.p && Math.abs(n.s - beat) < 1e-3);
        const b = h('button', { class: 'step' + (on ? ' on' : '') + (Math.floor(s / 4) % 2 ? ' alt' : ''), style: on ? `background:${t.color}` : '' });
        b.addEventListener('click', () => {
          History.push();
          const ex = c.notes.find((n) => n.p === row.p && Math.abs(n.s - beat) < 1e-3);
          if (ex) c.notes.splice(c.notes.indexOf(ex), 1);
          else { c.notes.push({ p: row.p, s: beat, l: d.drum ? 0.25 : 0.5, v: 0.8 }); previewNote(t, row.p, 0.8, 0.25); }
          App.changed();
        });
        rEl.append(b);
      }
      grid.append(rEl);
    }
    box.append(grid);
  },

  // ---------- Mixer ----------
  renderMixer() {
    const box = $('#mixer'); box.innerHTML = '';
    for (const t of P.tracks) box.append(this.strip(t));
    box.append(this.masterStrip());
  },
  strip(t) {
    const d = t.type === 'inst' ? INSTRUMENTS[t.inst] : null;
    const el = h('div', { class: 'mstrip' + (UI.selTrack === t.id ? ' sel' : '') });
    el.addEventListener('pointerdown', () => { if (UI.selTrack !== t.id) { UI.selTrack = t.id; Panels.renderHeads(); A.dirty = true; el.parentElement.querySelectorAll('.mstrip').forEach((x) => x.classList.remove('sel')); el.classList.add('sel'); } });
    el.append(h('div', { class: 'mname', style: `border-top:3px solid ${t.color}` }, (d ? d.icon : '🎙') + ' ' + t.name));
    const knobs = h('div', { class: 'mknobs' });
    const autoNote = (k) => (t.auto[k].length ? ' (A)' : '');
    knobs.append(
      Knob({ label: 'Pan' + autoNote('pan'), min: -1, max: 1, value: t.pan, def: 0, fmt: fmtPan, onInput: (v) => { t.pan = v; App.mixChanged(); }, color: '#57c7ff' }),
      Knob({ label: 'Reverb' + autoNote('reverb'), min: 0, max: 1, value: t.reverb, def: 0.12, fmt: fmtPct, onInput: (v) => { t.reverb = v; App.mixChanged(); }, color: '#b388ff' }),
      Knob({ label: 'Delay', min: 0, max: 1, value: t.delay, def: 0, fmt: fmtPct, onInput: (v) => { t.delay = v; App.mixChanged(); }, color: '#5ee0c8' }),
      Knob({ label: 'Pitch', min: -12, max: 12, value: t.transpose || 0, def: 0, fmt: (v) => (v > 0 ? '+' : '') + Math.round(v) + 'st', onInput: (v) => { t.transpose = Math.round(v); App.softChanged(); }, color: '#7dff9b' }),
      Knob({ label: 'EQ Low', min: -15, max: 15, value: t.eq.low, def: 0, fmt: fmtDb, onInput: (v) => { t.eq.low = v; App.mixChanged(); }, color: '#ffb347', size: 28 }),
      Knob({ label: 'EQ Mid', min: -15, max: 15, value: t.eq.mid, def: 0, fmt: fmtDb, onInput: (v) => { t.eq.mid = v; App.mixChanged(); }, color: '#ffb347', size: 28 }),
      Knob({ label: 'EQ High', min: -15, max: 15, value: t.eq.high, def: 0, fmt: fmtDb, onInput: (v) => { t.eq.high = v; App.mixChanged(); }, color: '#ffb347', size: 28 }),
    );
    el.append(knobs);
    // bitcrusher
    const cr = t.crush;
    const crBtn = h('button', { class: 'tb' + (cr.on ? ' crush-on' : ''), title: 'Bitcrusher on/off' }, cr.on ? '👾 BITCRUSH ON' : '👾 Bitcrush off');
    crBtn.addEventListener('click', () => { History.push(); cr.on = !cr.on; crBtn.className = 'tb' + (cr.on ? ' crush-on' : ''); crBtn.textContent = cr.on ? '👾 BITCRUSH ON' : '👾 Bitcrush off'; App.mixChanged(); App.queueSave(); });
    el.append(h('div', { class: 'crush-row' }, crBtn, h('div', { class: 'mknobs' },
      Knob({ label: 'Bits', min: 1, max: 16, value: cr.bits, def: 6, fmt: (v) => Math.round(v) + ' bit', onInput: (v) => { cr.bits = Math.round(v); App.mixChanged(); }, color: '#c94cff', size: 26 }),
      Knob({ label: 'Downsmp', min: 1, max: 40, value: cr.down, def: 6, fmt: (v) => Math.round(v) + 'x', onInput: (v) => { cr.down = Math.round(v); App.mixChanged(); }, color: '#c94cff', size: 26 }),
      Knob({ label: 'Mix', min: 0, max: 1, value: cr.mix, def: 1, fmt: fmtPct, onInput: (v) => { cr.mix = v; App.mixChanged(); }, color: '#c94cff', size: 26 }))));
    const fader = h('input', { type: 'range', class: 'vfader', min: 0, max: 1.5, step: 0.01, value: Math.min(1.5, t.vol) });
    const fv = h('div', { class: 'mval' }, fmtVol(t.vol) + autoNote('volume'));
    const fpct = PctInput(() => t.vol, (v) => { t.vol = v; fader.value = Math.min(1.5, v); fv.textContent = fmtVol(v); App.mixChanged(); });
    fader.addEventListener('pointerdown', () => History.push());
    fader.addEventListener('input', () => { t.vol = parseFloat(fader.value); fv.textContent = fmtVol(t.vol); fpct.firstChild.sync(); App.mixChanged(); });
    fader.addEventListener('change', () => App.changed(true));
    const meter = h('div', { class: 'vmeter' }, h('div', { class: 'vmeter-fill', 'data-meter': t.id }));
    el.append(h('div', { class: 'mfader' }, fader, meter), fv, fpct);
    el.append(h('div', { class: 'mbtns' },
      h('button', { class: 'tb' + (t.mute ? ' on-m' : ''), onclick: (e) => { History.push(); t.mute = !t.mute; e.target.classList.toggle('on-m', t.mute); App.mixChanged(); App.renderHeads(); App.changed(true); } }, 'M'),
      h('button', { class: 'tb' + (t.solo ? ' on-s' : ''), onclick: (e) => { History.push(); t.solo = !t.solo; e.target.classList.toggle('on-s', t.solo); App.mixChanged(); App.renderHeads(); App.changed(true); } }, 'S')));
    return el;
  },
  masterStrip() {
    const M = P.master;
    const el = h('div', { class: 'mstrip master' });
    el.append(h('div', { class: 'mname', style: 'border-top:3px solid #ff9a3c' }, '★ MASTER'));
    const upd = () => { if (E.ctx) updateMasterFx(E.ctx, E.master, P); };
    const knobs = h('div', { class: 'mknobs' });
    knobs.append(
      Knob({ label: 'Rev Size', min: 0.3, max: 6, value: M.revSize, def: 2.4, fmt: (v) => v.toFixed(1) + 's', onInput: (v) => { M.revSize = v; }, color: '#b388ff' }),
      Knob({ label: 'Rev Decay', min: 0.5, max: 8, value: M.revDecay, def: 3, fmt: (v) => v.toFixed(1), onInput: (v) => { M.revDecay = v; }, color: '#b388ff' }),
      Knob({ label: 'Rev Level', min: 0, max: 2, value: M.revLevel, def: 1, fmt: fmtPct, onInput: (v) => { M.revLevel = v; upd(); }, color: '#b388ff' }),
      Knob({ label: 'Pre-delay', min: 0, max: 0.15, value: M.revPre, def: 0.02, fmt: (v) => Math.round(v * 1000) + 'ms', onInput: (v) => { M.revPre = v; upd(); }, color: '#b388ff', size: 28 }),
      Knob({ label: 'Delay beat', min: 0.25, max: 2, value: M.delBeats, def: 0.75, fmt: (v) => (Math.round(v * 4) / 4).toFixed(2), onInput: (v) => { M.delBeats = Math.round(v * 4) / 4; upd(); }, color: '#5ee0c8', size: 28 }),
      Knob({ label: 'Feedback', min: 0, max: 0.9, value: M.delFb, def: 0.35, fmt: fmtPct, onInput: (v) => { M.delFb = v; upd(); }, color: '#5ee0c8', size: 28 }),
    );
    // reverb IR dibangun ulang saat knob dilepas
    knobs.addEventListener('pointerup', () => upd());
    el.append(knobs);
    const fader = h('input', { type: 'range', class: 'vfader', min: 0, max: 1.5, step: 0.01, value: Math.min(1.5, M.vol) });
    const fv = h('div', { class: 'mval' }, fmtVol(M.vol));
    const mp = PctInput(() => M.vol, (v) => { M.vol = v; fader.value = Math.min(1.5, v); fv.textContent = fmtVol(v); $('#masterVol').value = Math.min(1.5, v); App.renderMasterPct(); upd(); });
    fader.addEventListener('input', () => { M.vol = parseFloat(fader.value); fv.textContent = fmtVol(M.vol); mp.firstChild.sync(); $('#masterVol').value = M.vol; App.renderMasterPct(); upd(); });
    fader.addEventListener('change', () => App.changed(true));
    const meter = h('div', { class: 'vmeter' }, h('div', { class: 'vmeter-fill', 'data-meter': 'master' }));
    el.append(h('div', { class: 'mfader' }, fader, meter), fv, mp);
    return el;
  },

  // ---------- Inspector (clip + track) ----------
  renderInspector() {
    const box = $('#inspector'); box.innerHTML = '';
    const sel = [...UI.sel].map(findClip).filter(Boolean);
    const f = sel[0];
    const col1 = h('div', { class: 'insp-col' });
    if (!f) {
      col1.append(h('h3', {}, 'Clip'), h('p', { class: 'hint' }, 'Pilih clip di playlist untuk mengatur gain, pitch, speed, fade, reverse, split & duplikat.'));
    } else {
      const { clip: c, track: t } = f;
      col1.append(h('h3', {}, (c.type === 'audio' ? '🔊 Clip Audio: ' : '🎹 Clip Pola: ') + (c.name || (c.type === 'audio' ? (AUDIO[c.buf] || {}).name : t.name))));
      if (sel.length > 1) col1.append(h('p', { class: 'hint' }, sel.length + ' clip terpilih — pengaturan di bawah untuk clip pertama.'));
      const nameIn = h('input', { type: 'text', value: c.name || '', placeholder: 'Nama clip' });
      nameIn.addEventListener('change', () => { History.push(); c.name = nameIn.value; App.changed(true); });
      col1.append(h('label', { class: 'slider' }, h('span', { class: 'sl-label' }, 'Nama'), nameIn));
      col1.append(Slider({ label: 'Gain', min: 0, max: 2, step: 0.01, value: Math.min(2, c.gain), fmt: fmtVol, onInput: (v) => { c.gain = v; App.softChanged(); } }));
      col1.append(h('label', { class: 'slider' }, h('span', { class: 'sl-label' }, 'Gain custom'), PctInput(() => c.gain, (v) => { c.gain = v; App.softChanged(); }), h('span', { class: 'hint' }, ' 0–1000%'))); 
      if (c.type === 'audio') {
        const keepLen = (fn) => (v) => { const r0 = clipTimeRate(c); fn(v); const r1 = clipTimeRate(c); c.len = Math.min(c.len * r0 / r1, audioFullLen(c)); App.softChanged(); };
        col1.append(Slider({ label: 'Pitch', min: -24, max: 24, step: 1, value: c.pitch, fmt: (v) => (v > 0 ? '+' : '') + v + ' semitone', onInput: keepLen((v) => { c.pitch = v; }) }));
        col1.append(Slider({ label: 'Fine', min: -100, max: 100, step: 1, value: c.cents || 0, fmt: (v) => v + ' cent', onInput: (v) => { c.cents = v; App.softChanged(); } }));
        col1.append(Slider({ label: 'Speed', min: -2, max: 2, step: 0.01, value: Math.log2(c.speed), fmt: (v) => Math.pow(2, v).toFixed(2) + 'x', onInput: keepLen((v) => { c.speed = Math.round(Math.pow(2, v) * 100) / 100; }) }));
        const keep = h('input', { type: 'checkbox', checked: c.keepPitch });
        keep.addEventListener('change', () => { History.push(); const r0 = clipTimeRate(c); c.keepPitch = keep.checked; c.len = Math.min(c.len * r0 / clipTimeRate(c), audioFullLen(c)); App.changed(true); });
        col1.append(h('label', { class: 'check' }, keep, ' Pertahankan pitch saat ubah speed (time-stretch) — matikan untuk mode "tape/resample" ala FL'));
        const rev = h('input', { type: 'checkbox', checked: c.reverse });
        rev.addEventListener('change', () => { History.push(); c.reverse = rev.checked; App.changed(true); });
        col1.append(h('label', { class: 'check' }, rev, ' Reverse (putar terbalik)'));
        col1.append(Slider({ label: 'Fade In', min: 0, max: Math.max(0.25, c.len), step: 0.05, value: c.fadeIn || 0, fmt: (v) => v.toFixed(2) + ' beat', onInput: (v) => { c.fadeIn = Math.min(v, c.len - (c.fadeOut || 0)); App.softChanged(); } }));
        col1.append(Slider({ label: 'Fade Out', min: 0, max: Math.max(0.25, c.len), step: 0.05, value: c.fadeOut || 0, fmt: (v) => v.toFixed(2) + ' beat', onInput: (v) => { c.fadeOut = Math.min(v, c.len - (c.fadeIn || 0)); App.softChanged(); } }));
      } else {
        col1.append(Slider({ label: 'Pitch', min: -24, max: 24, step: 1, value: c.pitch || 0, fmt: (v) => (v > 0 ? '+' : '') + v + ' semitone', onInput: (v) => { c.pitch = v; App.softChanged(); } }));
        const pl = h('input', { type: 'number', min: 1, max: 256, value: c.patLen });
        pl.addEventListener('change', () => { History.push(); c.patLen = Math.max(1, parseFloat(pl.value) || 4); App.changed(); });
        col1.append(h('label', { class: 'slider' }, h('span', { class: 'sl-label' }, 'Panjang pola'), pl, h('span', { class: 'sl-val' }, 'beat')));
      }
      const mute = h('input', { type: 'checkbox', checked: c.muted });
      mute.addEventListener('change', () => { History.push(); c.muted = mute.checked; App.changed(true); });
      col1.append(h('label', { class: 'check' }, mute, ' Mute clip'));
      col1.append(h('div', { class: 'btnrow' },
        c.type === 'inst' ? h('button', { onclick: () => App.openPiano(c, t) }, '🎹 Piano Roll') : null,
        h('button', { onclick: () => App.splitAtPlayhead() }, '✂ Split di playhead'),
        h('button', { onclick: () => App.duplicateSel() }, '⧉ Duplikat'),
        c.type === 'audio' ? h('button', { onclick: () => { History.push(); c.len = audioFullLen(c); App.changed(); } }, '↔ Panjang penuh') : null,
        h('button', { class: 'danger', onclick: () => App.deleteSel() }, '🗑 Hapus')));
    }
    // kolom track
    const col2 = h('div', { class: 'insp-col' });
    const t = UI.selTrack ? findTrack(UI.selTrack) : (f && f.track);
    if (t) {
      col2.append(h('h3', {}, '🎚 Track: ' + t.name));
      if (t.type === 'inst') {
        const s = h('select', {}, ...INSTRUMENT_ORDER.map((id) => h('option', { value: id, selected: id === t.inst }, INSTRUMENTS[id].icon + ' ' + INSTRUMENTS[id].name)));
        s.addEventListener('change', async () => { History.push(); const old = INSTRUMENTS[t.inst]; t.inst = s.value; if (t.name === old.name) t.name = INSTRUMENTS[s.value].name; t.color = INSTRUMENTS[s.value].color; await App.loadInst(s.value); App.changed(); });
        col2.append(h('label', { class: 'slider' }, h('span', { class: 'sl-label' }, 'Instrumen'), s));
      }
      col2.append(Slider({ label: 'Volume', min: 0, max: 1.5, step: 0.01, value: Math.min(1.5, t.vol), fmt: fmtVol, onInput: (v) => { t.vol = v; App.mixChanged(); } }));
      col2.append(h('label', { class: 'slider' }, h('span', { class: 'sl-label' }, 'Volume custom'), PctInput(() => t.vol, (v) => { t.vol = v; App.mixChanged(); }), h('span', { class: 'hint' }, ' 0–1000% (ketik / scroll)')));
      col2.append(Slider({ label: 'Pan', min: -1, max: 1, step: 0.01, value: t.pan, fmt: fmtPan, onInput: (v) => { t.pan = v; App.mixChanged(); } }));
      col2.append(Slider({ label: 'Reverb', min: 0, max: 1, step: 0.01, value: t.reverb, fmt: fmtPct, onInput: (v) => { t.reverb = v; App.mixChanged(); } }));
      col2.append(Slider({ label: 'Delay', min: 0, max: 1, step: 0.01, value: t.delay, fmt: fmtPct, onInput: (v) => { t.delay = v; App.mixChanged(); } }));
      col2.append(h('h4', {}, '👾 Bitcrusher'));
      const cre = h('input', { type: 'checkbox', checked: t.crush.on });
      cre.addEventListener('change', () => { History.push(); t.crush.on = cre.checked; App.mixChanged(); App.changed(true); });
      col2.append(h('label', { class: 'check' }, cre, ' Aktifkan bitcrusher (suara lo-fi / 8-bit)'));
      col2.append(Slider({ label: 'Bit depth', min: 1, max: 16, step: 1, value: t.crush.bits, fmt: (v) => v + ' bit', onInput: (v) => { t.crush.bits = v; App.mixChanged(); } }));
      col2.append(Slider({ label: 'Downsample', min: 1, max: 40, step: 1, value: t.crush.down, fmt: (v) => v + 'x (' + Math.round((E.ctx ? E.ctx.sampleRate : 48000) / v) + ' Hz)', onInput: (v) => { t.crush.down = v; App.mixChanged(); } }));
      col2.append(Slider({ label: 'Mix', min: 0, max: 1, step: 0.01, value: t.crush.mix, fmt: fmtPct, onInput: (v) => { t.crush.mix = v; App.mixChanged(); } }));
      col2.append(Slider({ label: 'Pitch track', min: -12, max: 12, step: 1, value: t.transpose || 0, fmt: (v) => (v > 0 ? '+' : '') + v + ' st', onInput: (v) => { t.transpose = v; App.softChanged(); } }));
      col2.append(h('h4', {}, '〰 Automation / Keyframe'));
      col2.append(h('p', { class: 'hint' }, 'Buka lane, lalu klik di lane untuk menambah keyframe. Seret titik bulat kecil di tengah segmen untuk membentuk kurva kustom. Klik kanan titik untuk jenis kurva (tunggal, S, hold, tangga, pulsa).'));
      const list = h('div', { class: 'auto-list' });
      for (const k of AUTO_ORDER) {
        const n = t.auto[k].length;
        list.append(h('div', { class: 'auto-row' },
          h('span', { class: 'dot', style: `background:${AUTO_PARAMS[k].color}` }),
          h('span', { class: 'an' }, AUTO_PARAMS[k].label),
          h('span', { class: 'ac' }, n ? n + ' titik' : '—'),
          h('button', { class: t.showAuto === k ? 'on' : '', onclick: () => { t.showAuto = t.showAuto === k ? null : k; App.changed(true); } }, t.showAuto === k ? 'Tutup lane' : 'Buka lane'),
          n ? h('button', { onclick: () => { History.push(); t.auto[k] = []; App.changed(); } }, 'Hapus') : null));
      }
      col2.append(list);
    } else col2.append(h('h3', {}, 'Track'), h('p', { class: 'hint' }, 'Pilih track.'));
    box.append(col1, col2);
  },
};
