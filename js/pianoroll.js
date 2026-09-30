/* =========================================================
   PIANO ROLL (gaya FL Studio) + lane velocity
   ========================================================= */
'use strict';

const PR = {
  cv: null, g: null, w: 0, h: 0,
  KEY_W: 64, RULER: 20, VEL_H: 64, ROW: 14,
  zoom: 48, scrollX: 0, scrollY: 0,
  sel: new Set(), // index nada terpilih (obj ref)
  drag: null, dirty: true, hoverNote: null,

  init() {
    this.cv = document.getElementById('pr');
    this.g = this.cv.getContext('2d');
    new ResizeObserver(() => this.resize()).observe(this.cv.parentElement);
    this.cv.addEventListener('pointerdown', (e) => this.onDown(e));
    this.cv.addEventListener('pointermove', (e) => this.onMove(e));
    this.cv.addEventListener('pointerup', (e) => this.onUp(e));
    this.cv.addEventListener('contextmenu', (e) => e.preventDefault());
    this.cv.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.resize();
  },
  resize() {
    const p = this.cv.parentElement, dpr = window.devicePixelRatio || 1;
    this.w = p.clientWidth; this.h = p.clientHeight;
    this.cv.width = Math.max(1, this.w * dpr); this.cv.height = Math.max(1, this.h * dpr);
    this.cv.style.width = this.w + 'px'; this.cv.style.height = this.h + 'px';
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this._pendingCenter && this.h >= 60) { const [c, t] = this._pendingCenter; this._pendingCenter = null; this.centerOn(c, t); }
    this.dirty = true;
  },
  ctx() {
    const f = UI.editClip ? findClip(UI.editClip) : null;
    return f;
  },
  isDrum(t) { return t && t.type === 'inst' && INSTRUMENTS[t.inst].drum; },
  rowCount(t) { return this.isDrum(t) ? INSTRUMENTS[t.inst].pieces.length : 84; },
  pitchOfRow(t, r) { return this.isDrum(t) ? r : 107 - r; }, // C8(108) .. C1(24)
  rowOfPitch(t, p) { return this.isDrum(t) ? p : 107 - p; },
  rowH(t) { return this.isDrum(t) ? 24 : this.ROW; },
  gridH() { return this.h - this.RULER - this.VEL_H; },
  xOf(b) { return this.KEY_W + b * this.zoom - this.scrollX; },
  beatOf(x) { return (x - this.KEY_W + this.scrollX) / this.zoom; },
  yOfRow(t, r) { return this.RULER + r * this.rowH(t) - this.scrollY; },
  rowAt(t, y) { return Math.floor((y - this.RULER + this.scrollY) / this.rowH(t)); },
  snapB(b, free) { const s = UI.snap; return !s || free ? b : Math.floor(b / s + 1e-6) * s; },
  centerOn(c, t) {
    this.scrollX = 0;
    if (this.h < 60) { this._pendingCenter = [c, t]; return; }
    if (this.isDrum(t)) { this.scrollY = 0; return; }
    const ps = c.notes.map((n) => n.p);
    const mid = ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 60;
    this.scrollY = Math.max(0, this.rowOfPitch(t, Math.round(mid)) * this.ROW - this.gridH() / 2);
  },
  pos(e) { const r = this.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; },
  noteAt(c, t, x, y) {
    const r = this.rowAt(t, y);
    const b = this.beatOf(x);
    for (let i = c.notes.length - 1; i >= 0; i--) {
      const n = c.notes[i];
      if (this.rowOfPitch(t, n.p) === r && b >= n.s && b <= n.s + n.l) {
        const x1 = this.xOf(n.s + n.l);
        return { n, edge: x1 - x < Math.max(5, Math.min(10, n.l * this.zoom / 3)) };
      }
    }
    return null;
  },

  onDown(e) {
    const f = this.ctx(); if (!f) return;
    const { clip: c, track: t } = f;
    const { x, y } = this.pos(e);
    this.cv.setPointerCapture(e.pointerId);
    // keyboard kiri: preview
    if (x < this.KEY_W && y > this.RULER && y < this.RULER + this.gridH()) {
      const p = this.pitchOfRow(t, this.rowAt(t, y));
      if (p >= 0) previewNote(t, p, 0.85);
      return;
    }
    // lane velocity
    if (y > this.RULER + this.gridH()) {
      History.push();
      this.drag = { kind: 'vel' };
      this.velAt(c, x, y);
      return;
    }
    if (y < this.RULER) { // ruler: seret penanda oranye = panjang pola
      if (Math.abs(x - this.xOf(c.patLen)) > 10) return;
      History.push();
      this.drag = { kind: 'patlen' };
      c.patLen = Math.max(1, Math.round(this.beatOf(x)));
      App.changed();
      return;
    }
    const hit = this.noteAt(c, t, x, y);
    if (e.button === 2 || UI.tool === 'erase') {
      History.push();
      this.drag = { kind: 'erase' };
      if (hit) { c.notes.splice(c.notes.indexOf(hit.n), 1); this.sel.delete(hit.n); App.changed(); }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !hit) {
      this.drag = { kind: 'marquee', x0: x, y0: y, x1: x, y1: y };
      return;
    }
    History.push();
    if (hit) {
      if (e.shiftKey) { this.sel.has(hit.n) ? this.sel.delete(hit.n) : this.sel.add(hit.n); }
      else if (!this.sel.has(hit.n)) { this.sel.clear(); this.sel.add(hit.n); }
      if (e.altKey || (e.ctrlKey && !hit.edge)) {
        // duplikat nada terpilih lalu geser
        const copies = [...this.sel].map((n) => ({ ...n }));
        c.notes.push(...copies); this.sel = new Set(copies);
        hit.n = copies[0];
      }
      const orig = [...this.sel].map((n) => ({ n, s: n.s, p: n.p, l: n.l }));
      this.drag = { kind: hit.edge ? 'resize' : 'move', x0: x, y0: y, orig, lead: hit.n, moved: false };
      UI.lastNoteLen = hit.n.l;
      if (!hit.edge) previewNote(t, hit.n.p, hit.n.v, 0.3);
      return;
    }
    // tambah nada baru
    const r = this.rowAt(t, y);
    if (r < 0 || r >= this.rowCount(t)) return;
    const p = this.pitchOfRow(t, r);
    const s = Math.max(0, this.snapB(this.beatOf(x), e.shiftKey));
    const l = this.isDrum(t) ? Math.max(0.25, UI.snap || 0.25) : (UI.lastNoteLen || parseFloat(document.getElementById('prNoteLen').value));
    const n = { p, s, l, v: 0.8 };
    c.notes.push(n);
    this.sel.clear(); this.sel.add(n);
    previewNote(t, p, 0.8, 0.3);
    this.drag = { kind: 'move', x0: x, y0: y, orig: [{ n, s, p, l }], lead: n, moved: true };
    App.changed();
  },
  velAt(c, x, y) {
    const top = this.RULER + this.gridH() + 6, h = this.VEL_H - 10;
    const v = Math.max(0.02, Math.min(1, 1 - (y - top) / h));
    const b = this.beatOf(x);
    let best = null, bd = Infinity;
    const targets = this.sel.size ? [...this.sel] : c.notes;
    for (const n of targets) { const d = Math.abs(n.s - b); if (d < bd && d * this.zoom < 12) { bd = d; best = n; } }
    if (best) {
      for (const n of targets) if (Math.abs(n.s - best.s) < 1e-6) n.v = v;
      this.dirty = true; App.softChanged();
    }
  },
  onMove(e) {
    const f = this.ctx(); if (!f) return;
    const { clip: c, track: t } = f;
    const { x, y } = this.pos(e);
    const d = this.drag;
    if (!d) {
      const hit = y > this.RULER && y < this.RULER + this.gridH() && x > this.KEY_W ? this.noteAt(c, t, x, y) : null;
      this.cv.style.cursor = x < this.KEY_W ? 'pointer' : hit ? (hit.edge ? 'e-resize' : 'grab') : (y < this.RULER ? 'col-resize' : 'crosshair');
      return;
    }
    if (d.kind === 'vel') return this.velAt(c, x, y);
    if (d.kind === 'patlen') { c.patLen = Math.max(1, Math.round(this.beatOf(x))); this.dirty = true; App.softChanged(); return; }
    if (d.kind === 'erase') {
      const hit = this.noteAt(c, t, x, y);
      if (hit) { c.notes.splice(c.notes.indexOf(hit.n), 1); this.dirty = true; App.softChanged(); }
      return;
    }
    if (d.kind === 'marquee') {
      d.x1 = x; d.y1 = y;
      const b0 = this.beatOf(Math.min(d.x0, x)), b1 = this.beatOf(Math.max(d.x0, x));
      const r0 = this.rowAt(t, Math.min(d.y0, y)), r1 = this.rowAt(t, Math.max(d.y0, y));
      this.sel = new Set(c.notes.filter((n) => { const r = this.rowOfPitch(t, n.p); return r >= r0 && r <= r1 && n.s < b1 && n.s + n.l > b0; }));
      this.dirty = true; return;
    }
    const db = (x - d.x0) / this.zoom;
    if (d.kind === 'move') {
      const lead = d.orig.find((o) => o.n === d.lead);
      let ns = this.snapB(lead.s + db + (UI.snap ? UI.snap / 2 : 0), e.shiftKey);
      let dsb = ns - lead.s;
      const minS = Math.min(...d.orig.map((o) => o.s));
      if (minS + dsb < 0) dsb = -minS;
      const dr = this.rowAt(t, y) - this.rowOfPitch(t, lead.p);
      let dp = this.isDrum(t) ? dr : -dr;
      for (const o of d.orig) {
        const np = o.p + dp;
        if (np < (this.isDrum(t) ? 0 : 24) || np > (this.isDrum(t) ? this.rowCount(t) - 1 : 107)) { dp = 0; break; }
      }
      const prevP = d.lead.p;
      for (const o of d.orig) { o.n.s = o.s + dsb; o.n.p = o.p + dp; }
      if (d.lead.p !== prevP) previewNote(t, d.lead.p, d.lead.v, 0.25);
    } else if (d.kind === 'resize') {
      for (const o of d.orig) {
        const end = this.snapB(o.s + o.l + db + (UI.snap ? UI.snap / 2 : 0), e.shiftKey);
        o.n.l = Math.max(UI.snap || 0.05, end - o.s);
      }
      UI.lastNoteLen = d.lead.l;
    }
    d.moved = true;
    this.dirty = true; App.softChanged();
  },
  onUp() {
    const d = this.drag; this.drag = null;
    if (!d) return;
    if ((d.kind === 'move' || d.kind === 'resize') && !d.moved) History.undo.pop();
    if (d.kind !== 'marquee') App.changed();
    this.dirty = true;
  },
  onWheel(e) {
    e.preventDefault();
    const f = this.ctx(); if (!f) return;
    if (e.ctrlKey || e.metaKey) {
      const { x } = this.pos(e); const b = this.beatOf(x);
      this.zoom = Math.max(8, Math.min(300, this.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      this.scrollX = Math.max(0, b * this.zoom - (x - this.KEY_W));
    } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      this.scrollX = Math.max(0, this.scrollX + (e.deltaX || e.deltaY));
    } else {
      const max = Math.max(0, this.rowCount(f.track) * this.rowH(f.track) - this.gridH());
      this.scrollY = Math.max(0, Math.min(max, this.scrollY + e.deltaY));
    }
    this.dirty = true;
  },

  draw() {
    const g = this.g, W = this.w, H = this.h;
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#1e2429'; g.fillRect(0, 0, W, H);
    const f = this.ctx();
    if (!f || f.clip.type !== 'inst') {
      g.fillStyle = '#7b8791'; g.font = '14px sans-serif';
      g.fillText('Klik 2x clip instrumen di Playlist (atau pakai tool ✎ di track instrumen) untuk mengedit nada di sini.', 20, 40);
      return;
    }
    const { clip: c, track: t } = f;
    const drum = this.isDrum(t), rh = this.rowH(t), gh = this.gridH();
    const rows = this.rowCount(t);
    // grid baris
    g.save(); g.beginPath(); g.rect(0, this.RULER, W, gh); g.clip();
    for (let r = 0; r < rows; r++) {
      const y = this.yOfRow(t, r);
      if (y + rh < this.RULER || y > this.RULER + gh) continue;
      const p = this.pitchOfRow(t, r);
      const black = !drum && [1, 3, 6, 8, 10].includes(p % 12);
      g.fillStyle = black ? '#1a1f23' : '#252c32';
      g.fillRect(this.KEY_W, y, W, rh);
      g.fillStyle = !drum && p % 12 === 0 ? '#3a434b' : '#1c2226'; g.fillRect(this.KEY_W, y + rh - 1, W, 1);
    }
    const b0 = Math.max(0, Math.floor(this.beatOf(this.KEY_W))), b1 = Math.ceil(this.beatOf(W));
    const sub = this.zoom > 30 ? 0.25 : 1;
    for (let b = b0; b <= b1; b += sub) {
      const x = Math.round(this.xOf(b)) + 0.5;
      g.strokeStyle = b % 4 === 0 ? 'rgba(255,255,255,0.2)' : b % 1 === 0 ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.035)';
      g.beginPath(); g.moveTo(x, this.RULER); g.lineTo(x, this.RULER + gh); g.stroke();
    }
    // area di luar pola
    const px = this.xOf(c.patLen);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(px, this.RULER, W, gh);
    // nada
    const col = t.color;
    for (const n of c.notes) {
      const x = this.xOf(n.s), y = this.yOfRow(t, this.rowOfPitch(t, n.p));
      const w = Math.max(3, n.l * this.zoom - 1);
      if (x > W || x + w < this.KEY_W) continue;
      const sel = this.sel.has(n);
      g.fillStyle = sel ? '#ffe7c2' : hexA(col, 0.45 + n.v * 0.55);
      roundRect(g, x + 0.5, y + 1.5, w, rh - 3, 3); g.fill();
      g.strokeStyle = sel ? '#ff9a3c' : 'rgba(0,0,0,0.5)'; g.stroke();
      if (w > 26 && rh >= 12) { g.fillStyle = '#111'; g.font = '9px sans-serif'; g.fillText(drum ? '' : midiToName(n.p), x + 4, y + rh - 4); }
    }
    // playhead relatif clip
    const rel = UI.playhead - c.start + c.offset;
    if (UI.playhead >= c.start && UI.playhead <= c.start + c.len) {
      const pr = ((rel % c.patLen) + c.patLen) % c.patLen;
      const x = this.xOf(pr);
      g.strokeStyle = '#7dff9b'; g.beginPath(); g.moveTo(x, this.RULER); g.lineTo(x, this.RULER + gh); g.stroke();
    }
    if (this.drag && this.drag.kind === 'marquee') {
      const d = this.drag;
      g.fillStyle = 'rgba(120,170,255,0.15)'; g.fillRect(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
    }
    // keyboard
    for (let r = 0; r < rows; r++) {
      const y = this.yOfRow(t, r);
      if (y + rh < this.RULER || y > this.RULER + gh) continue;
      const p = this.pitchOfRow(t, r);
      if (drum) {
        g.fillStyle = r % 2 ? '#2e353c' : '#353d45'; g.fillRect(0, y, this.KEY_W, rh);
        g.fillStyle = '#dfe6ec'; g.font = '10px sans-serif'; g.fillText(INSTRUMENTS.drums.pieces[r].label, 4, y + rh / 2 + 4);
      } else {
        const black = [1, 3, 6, 8, 10].includes(p % 12);
        g.fillStyle = black ? '#15181b' : '#e9edf0'; g.fillRect(0, y, black ? this.KEY_W * 0.62 : this.KEY_W, rh);
        if (black) { g.fillStyle = '#e9edf0'; g.fillRect(this.KEY_W * 0.62, y, this.KEY_W * 0.38, rh); }
        g.fillStyle = '#9aa3ab'; g.fillRect(0, y + rh - 1, this.KEY_W, 1);
        if (p % 12 === 0) { g.fillStyle = '#333'; g.font = '9px sans-serif'; g.fillText(midiToName(p), this.KEY_W - 22, y + rh - 3); }
      }
    }
    g.restore();
    // ruler
    g.fillStyle = '#2c333a'; g.fillRect(0, 0, W, this.RULER);
    g.font = '10px sans-serif';
    for (let b = b0; b <= b1; b++) {
      const x = this.xOf(b);
      if (b % 4 === 0) { g.fillStyle = '#cfd6dc'; g.fillText(String(b / 4 + 1), x + 3, 13); g.fillStyle = '#7f8a94'; g.fillRect(x, 8, 1, 12); }
      else { g.fillStyle = '#56606a'; g.fillRect(x, 14, 1, 6); }
    }
    g.fillStyle = '#ff9a3c'; g.fillRect(px - 2, 0, 4, this.RULER);
    g.fillStyle = '#2c333a'; g.fillRect(0, 0, this.KEY_W, this.RULER);
    g.fillStyle = '#9aa3ab'; g.fillText('pola ⇥', 6, 13);
    // velocity lane
    const vy = this.RULER + gh;
    g.fillStyle = '#171b1f'; g.fillRect(0, vy, W, this.VEL_H);
    g.fillStyle = '#6f7a85'; g.fillText('Velocity', 6, vy + 14);
    for (const n of c.notes) {
      const x = this.xOf(n.s); if (x < this.KEY_W - 2 || x > W) continue;
      const h = (this.VEL_H - 10) * n.v;
      g.fillStyle = this.sel.has(n) ? '#ff9a3c' : col;
      g.fillRect(x, vy + this.VEL_H - 4 - h, 3, h);
      g.beginPath(); g.arc(x + 1.5, vy + this.VEL_H - 4 - h, 3, 0, Math.PI * 2); g.fill();
    }
  },

  quantize() {
    const f = this.ctx(); if (!f) return;
    const s = UI.snap || 0.25;
    History.push();
    const targets = this.sel.size ? [...this.sel] : f.clip.notes;
    for (const n of targets) n.s = Math.round(n.s / s) * s;
    App.changed();
  },
  transposeSel(d) {
    const f = this.ctx(); if (!f || !this.sel.size) return;
    History.push();
    for (const n of this.sel) n.p = Math.max(this.isDrum(f.track) ? 0 : 24, Math.min(this.isDrum(f.track) ? this.rowCount(f.track) - 1 : 107, n.p + d));
    App.changed();
  },
  deleteSel() {
    const f = this.ctx(); if (!f || !this.sel.size) return false;
    History.push();
    f.clip.notes = f.clip.notes.filter((n) => !this.sel.has(n));
    this.sel.clear(); App.changed(); return true;
  },
  duplicateSel() {
    const f = this.ctx(); if (!f || !this.sel.size) return false;
    History.push();
    const ns = [...this.sel];
    const s0 = Math.min(...ns.map((n) => n.s)), s1 = Math.max(...ns.map((n) => n.s + n.l));
    const span = Math.ceil((s1 - s0) / (UI.snap || 0.25)) * (UI.snap || 0.25);
    const copies = ns.map((n) => ({ ...n, s: n.s + span }));
    f.clip.notes.push(...copies);
    this.sel = new Set(copies);
    if (s1 + span > f.clip.patLen) f.clip.patLen = Math.ceil(s1 + span);
    App.changed(); return true;
  },
};
