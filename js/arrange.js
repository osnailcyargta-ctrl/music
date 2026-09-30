/* =========================================================
   PLAYLIST / ARRANGEMENT (gaya FL Studio playlist + BandLab tracks)
   - Clip instrumen (pola nada) & clip audio (waveform)
   - Pindah, resize/trim, split, duplikat, fade, mute clip
   - Lane automation per track: keyframe + kurva kustom (tension)
   ========================================================= */
'use strict';

const RULER_H = 30, TRACK_H = 72, AUTO_H = 78, HEAD_H = 15;

const UI = {
  tool: 'pointer',
  snap: 0.25,
  zoom: 34,        // px per beat
  scrollX: 0,
  scrollY: 0,
  sel: new Set(),  // id clip terpilih
  selTrack: null,
  playhead: 0,
  editClip: null,  // clip yang dibuka di piano roll
  clipboard: null,
  lastInstLen: 4,
};

const A = {
  cv: null, g: null, rc: null, rg: null,
  w: 0, h: 0, dirty: true,
  drag: null,
  marquee: null,
  hover: null,
  dropGhost: null,

  init() {
    this.cv = document.getElementById('arr');
    this.rc = document.getElementById('ruler');
    this.g = this.cv.getContext('2d');
    this.rg = this.rc.getContext('2d');
    new ResizeObserver(() => this.resize()).observe(document.getElementById('arrCanvasWrap'));
    this.resize();
    this.cv.addEventListener('pointerdown', (e) => this.onDown(e));
    this.cv.addEventListener('pointermove', (e) => this.onHover(e));
    this.cv.addEventListener('dblclick', (e) => this.onDbl(e));
    this.cv.addEventListener('contextmenu', (e) => { e.preventDefault(); this.onContext(e); });
    this.cv.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.rc.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.rc.addEventListener('pointerdown', (e) => this.onRulerDown(e));
    this.rc.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    // drag & drop file / item browser
    const wrap = document.getElementById('arrCanvasWrap');
    wrap.addEventListener('dragover', (e) => {
      e.preventDefault();
      const r = this.cv.getBoundingClientRect();
      this.dropGhost = { x: e.clientX - r.left, y: e.clientY - r.top };
      this.dirty = true;
    });
    wrap.addEventListener('dragleave', () => { this.dropGhost = null; this.dirty = true; });
    wrap.addEventListener('drop', (e) => { e.preventDefault(); this.dropGhost = null; App.onDropArrange(e); });
  },
  resize() {
    const wrap = document.getElementById('arrCanvasWrap');
    const dpr = window.devicePixelRatio || 1;
    this.w = wrap.clientWidth; this.h = wrap.clientHeight - RULER_H;
    for (const [c, h] of [[this.cv, this.h], [this.rc, RULER_H]]) {
      c.width = Math.max(1, this.w * dpr); c.height = Math.max(1, h * dpr);
      c.style.width = this.w + 'px'; c.style.height = h + 'px';
    }
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.rg.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dirty = true;
  },

  // ---------- Layout ----------
  rows() {
    const out = [];
    let y = 0;
    for (const t of P.tracks) {
      const r = { track: t, y, h: TRACK_H, autoY: null };
      y += TRACK_H;
      if (t.showAuto) { r.autoY = y; y += AUTO_H; }
      r.total = y - r.y;
      out.push(r);
    }
    this.contentH = y;
    return out;
  },
  xOf(beat) { return beat * UI.zoom - UI.scrollX; },
  beatOf(x) { return (x + UI.scrollX) / UI.zoom; },
  snap(b, force) {
    const s = UI.snap;
    if (!s || force === false) return b;
    return Math.round(b / s) * s;
  },
  hit(x, y) {
    const yy = y + UI.scrollY;
    for (const r of this.rows()) {
      if (yy >= r.y && yy < r.y + TRACK_H) {
        const beat = this.beatOf(x);
        for (let i = r.track.clips.length - 1; i >= 0; i--) {
          const c = r.track.clips[i];
          const x0 = this.xOf(c.start), x1 = this.xOf(c.start + c.len);
          if (x >= x0 && x <= x1) {
            let zone = 'move';
            const ly = yy - r.y;
            if (c.type === 'audio' && ly < HEAD_H + 8) {
              const fx0 = this.xOf(c.start + (c.fadeIn || 0)), fx1 = this.xOf(c.start + c.len - (c.fadeOut || 0));
              if (Math.abs(x - fx0) < 7 && x - x0 < (x1 - x0) / 2) zone = 'fadeIn';
              else if (Math.abs(x - fx1) < 7 && x1 - x < (x1 - x0) / 2) zone = 'fadeOut';
            }
            if (zone === 'move') {
              const edge = Math.min(7, (x1 - x0) / 4);
              if (x - x0 < edge) zone = 'left';
              else if (x1 - x < edge) zone = 'right';
            }
            return { area: 'clip', row: r, track: r.track, clip: c, zone, beat };
          }
        }
        return { area: 'track', row: r, track: r.track, beat };
      }
      if (r.autoY != null && yy >= r.autoY && yy < r.autoY + AUTO_H) {
        return { area: 'auto', row: r, track: r.track, beat: this.beatOf(x), ly: yy - r.autoY };
      }
    }
    return { area: 'none', beat: this.beatOf(x) };
  },

  // ---------- Automation geometry ----------
  laneY(r) { return { top: r.autoY + 16 - UI.scrollY, h: AUTO_H - 24 }; },
  autoPtXY(r, p) { const L = this.laneY(r); return { x: this.xOf(p.t), y: L.top + (1 - p.v) * L.h }; },
  autoHandle(r, pts, i) {
    const a = pts[i], b = pts[i + 1];
    const L = this.laneY(r);
    const v = a.v + (b.v - a.v) * shapeCurve(0.5, a.c, a.m);
    return { x: this.xOf((a.t + b.t) / 2), y: L.top + (1 - v) * L.h };
  },
  hitAuto(r, x, y) {
    const pts = r.track.auto[r.track.showAuto];
    for (let i = 0; i < pts.length; i++) {
      const q = this.autoPtXY(r, pts[i]);
      if (Math.hypot(q.x - x, q.y - y) < 7) return { kind: 'pt', i };
    }
    for (let i = 0; i < pts.length - 1; i++) {
      if (['hold', 'stairs'].includes(pts[i].m)) continue;
      const q = this.autoHandle(r, pts, i);
      if (Math.hypot(q.x - x, q.y - y) < 7) return { kind: 'handle', i };
    }
    return null;
  },

  // ---------- Mouse ----------
  pos(e) { const r = this.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; },
  onDown(e) {
    if (e.button === 2) return;
    this.cv.setPointerCapture(e.pointerId);
    const { x, y } = this.pos(e);
    const h = this.hit(x, y);
    const tool = UI.tool;

    if (h.track) { UI.selTrack = h.track.id; App.renderHeads(); }

    if (h.area === 'auto') return this.autoDown(e, h, x, y);

    if (h.area === 'clip') {
      const c = h.clip;
      if (tool === 'erase') { History.push(); h.track.clips.splice(h.track.clips.indexOf(c), 1); UI.sel.delete(c.id); App.changed(); return; }
      if (tool === 'mute') { History.push(); c.muted = !c.muted; App.changed(); return; }
      if (tool === 'slice' || (e.altKey && e.shiftKey)) {
        History.push();
        const b = this.snap(h.beat, !e.shiftKey && undefined);
        const right = splitClip(h.track, c, b);
        if (right) { UI.sel.clear(); UI.sel.add(right.id); }
        App.changed(); return;
      }
      if (e.shiftKey) { UI.sel.has(c.id) ? UI.sel.delete(c.id) : UI.sel.add(c.id); }
      else if (!UI.sel.has(c.id)) { UI.sel.clear(); UI.sel.add(c.id); }
      App.selectClip(c, h.track);
      History.push();
      let ids = [...UI.sel];
      if ((e.ctrlKey || e.metaKey) && h.zone === 'move') {
        // Ctrl+seret = duplikat
        const newIds = [];
        for (const id of ids) {
          const f = findClip(id); if (!f) continue;
          const n = cloneClip(f.clip); f.track.clips.push(n); newIds.push(n.id);
        }
        UI.sel = new Set(newIds); ids = newIds;
      }
      const orig = ids.map((id) => { const f = findClip(id); return { id, start: f.clip.start, len: f.clip.len, offset: f.clip.offset, fadeIn: f.clip.fadeIn, fadeOut: f.clip.fadeOut, trackIdx: P.tracks.indexOf(f.track) }; });
      this.drag = { kind: 'clip', zone: h.zone, x0: x, y0: y, beat0: h.beat, clip: c, track: h.track, orig, moved: false };
      this.dirty = true;
      return;
    }

    if (h.area === 'track') {
      if (tool === 'draw' && h.track.type === 'inst') {
        History.push();
        const start = Math.max(0, Math.floor(h.beat / 4) * 4);
        const len = UI.lastInstLen;
        const c = makeInstClip(start, len, len, []);
        h.track.clips.push(c);
        UI.sel.clear(); UI.sel.add(c.id);
        App.selectClip(c, h.track); App.openPiano(c, h.track);
        this.drag = { kind: 'clip', zone: 'right', x0: x, y0: y, beat0: h.beat, clip: c, track: h.track, orig: [{ id: c.id, start, len, offset: 0, trackIdx: P.tracks.indexOf(h.track) }], moved: false, created: true };
        App.changed(); return;
      }
      this.marquee = { x0: x, y0: y, x1: x, y1: y, add: e.shiftKey, prev: new Set(UI.sel) };
      this.drag = { kind: 'marquee', x0: x, y0: y, beat: h.beat, moved: false };
      return;
    }
    this.drag = { kind: 'marquee', x0: x, y0: y, beat: h.beat, moved: false };
    this.marquee = { x0: x, y0: y, x1: x, y1: y, add: e.shiftKey, prev: new Set(UI.sel) };
  },

  autoDown(e, h, x, y) {
    const r = h.row, tr = h.track, key = tr.showAuto;
    const pts = tr.auto[key];
    const hit = this.hitAuto(r, x, y);
    const L = this.laneY(r);
    if (y < L.top - 8) return; // area label
    if (UI.tool === 'erase') {
      if (hit && hit.kind === 'pt') { History.push(); pts.splice(hit.i, 1); App.changed(); }
      return;
    }
    History.push();
    if (hit && hit.kind === 'handle') {
      this.drag = { kind: 'tension', row: r, pts, i: hit.i, y0: y, c0: pts[hit.i].c || 0 };
      return;
    }
    let i;
    if (hit) i = hit.i;
    else {
      const t = Math.max(0, this.snap(h.beat, e.shiftKey ? false : undefined));
      const v = Math.min(1, Math.max(0, 1 - (y - L.top) / L.h));
      const p = { t, v, c: 0, m: 'curve' };
      // pewarisan mode dari titik sebelumnya
      const prev = pts.filter((q) => q.t <= t).pop();
      if (prev) p.m = prev.m;
      pts.push(p); pts.sort((a, b) => a.t - b.t);
      i = pts.indexOf(p);
      App.changed();
    }
    this.drag = { kind: 'autopt', row: r, pts, p: pts[i], moved: false };
  },

  onMove(e) {
    const d = this.drag;
    if (!d) return;
    const { x, y } = this.pos(e);
    if (d.kind === 'clip') {
      const dxB = (x - d.x0) / UI.zoom;
      if (!d.moved && Math.abs(x - d.x0) < 3 && Math.abs(y - d.y0) < 3) return;
      d.moved = true;
      const free = e.shiftKey && d.zone !== 'move' ? false : undefined;
      if (d.zone === 'move') {
        const lead = d.orig.find((o) => o.id === d.clip.id) || d.orig[0];
        let ns = this.snap(lead.start + dxB, e.altKey ? false : undefined);
        let db = ns - lead.start;
        const minStart = Math.min(...d.orig.map((o) => o.start));
        if (minStart + db < 0) db = -minStart;
        // pindah track (vertikal)
        const yy = y + UI.scrollY;
        const rows = this.rows();
        let ti = rows.findIndex((r) => yy >= r.y && yy < r.y + r.total);
        if (ti < 0) ti = yy < 0 ? 0 : rows.length - 1;
        const dt = ti - d.orig.find((o) => o.id === d.clip.id).trackIdx;
        let okMove = dt !== 0;
        if (okMove) for (const o of d.orig) {
          const f = findClip(o.id); const tgt = P.tracks[o.trackIdx + dt];
          if (!tgt || tgt.type !== f.clip.type) { okMove = false; break; }
        }
        for (const o of d.orig) {
          const f = findClip(o.id); if (!f) continue;
          f.clip.start = o.start + db;
          const want = okMove ? P.tracks[o.trackIdx + dt] : P.tracks[o.trackIdx];
          if (want !== f.track) { f.track.clips.splice(f.track.clips.indexOf(f.clip), 1); want.clips.push(f.clip); }
        }
      } else if (d.zone === 'right') {
        const c = d.clip, o = d.orig[0];
        const end = this.snap(o.start + o.len + dxB, free);
        let len = Math.max(UI.snap || 0.1, end - c.start);
        if (c.type === 'audio') len = Math.min(len, audioFullLen(c));
        c.len = len;
        if (d.created) { c.patLen = Math.max(1, Math.ceil(len)); }
      } else if (d.zone === 'left') {
        const c = d.clip, o = d.orig[0];
        let ns = this.snap(o.start + dxB, free);
        ns = Math.min(ns, o.start + o.len - 0.1);
        if (ns < 0) ns = 0;
        let delta = ns - o.start;
        if (c.type === 'audio') {
          const secPerBeat = (60 / P.bpm) * clipTimeRate(c);
          if (o.offset + delta * secPerBeat < 0) delta = -o.offset / secPerBeat;
          c.offset = o.offset + delta * secPerBeat;
        } else c.offset = o.offset + delta;
        c.start = o.start + delta; c.len = o.len - delta;
      } else if (d.zone === 'fadeIn' || d.zone === 'fadeOut') {
        const c = d.clip;
        const b = this.beatOf(x);
        if (d.zone === 'fadeIn') c.fadeIn = Math.max(0, Math.min(c.len - (c.fadeOut || 0), b - c.start));
        else c.fadeOut = Math.max(0, Math.min(c.len - (c.fadeIn || 0), c.start + c.len - b));
      }
      this.dirty = true; App.softChanged();
    } else if (d.kind === 'autopt') {
      d.moved = true;
      const L = this.laneY(d.row);
      const i = d.pts.indexOf(d.p);
      let t = this.snap(this.beatOf(x), e.shiftKey ? false : undefined);
      const lo = i > 0 ? d.pts[i - 1].t : 0, hi = i < d.pts.length - 1 ? d.pts[i + 1].t : Infinity;
      d.p.t = Math.max(lo, Math.min(hi, Math.max(0, t)));
      d.p.v = Math.min(1, Math.max(0, 1 - (y - L.top) / L.h));
      this.hover = { auto: d.p, row: d.row };
      this.dirty = true; App.softChanged();
    } else if (d.kind === 'tension') {
      const a = d.pts[d.i], b = d.pts[d.i + 1];
      const sign = b.v >= a.v ? 1 : -1;
      a.c = Math.max(-1, Math.min(1, d.c0 + ((y - d.y0) / 70) * sign));
      this.dirty = true; App.softChanged();
    } else if (d.kind === 'marquee') {
      if (Math.abs(x - d.x0) > 3 || Math.abs(y - d.y0) > 3) d.moved = true;
      const m = this.marquee; m.x1 = x; m.y1 = y;
      const bx0 = this.beatOf(Math.min(m.x0, m.x1)), bx1 = this.beatOf(Math.max(m.x0, m.x1));
      const y0 = Math.min(m.y0, m.y1) + UI.scrollY, y1 = Math.max(m.y0, m.y1) + UI.scrollY;
      UI.sel = new Set(m.add ? m.prev : []);
      for (const r of this.rows()) {
        if (r.y + TRACK_H < y0 || r.y > y1) continue;
        for (const c of r.track.clips) if (c.start < bx1 && c.start + c.len > bx0) UI.sel.add(c.id);
      }
      this.dirty = true;
    } else if (d.kind === 'seek') {
      App.seek(Math.max(0, this.snap(this.beatOf(x), e.shiftKey ? false : undefined)));
    } else if (d.kind === 'loop') {
      const b = Math.max(0, this.snap(this.beatOf(x)));
      P.loop.start = Math.min(d.b0, b); P.loop.end = Math.max(d.b0, b);
      if (P.loop.end - P.loop.start < 0.25) P.loop.end = P.loop.start + (UI.snap || 0.25);
      this.dirty = true;
    }
  },
  onUp(e) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (d.kind === 'marquee') {
      if (!d.moved) { UI.sel.clear(); App.seek(Math.max(0, this.snap(d.beat))); App.selectClip(null); }
      this.marquee = null;
    } else if (d.kind === 'clip') {
      if (!d.moved && !d.created) History.undo.pop();
      for (const t of P.tracks) t.clips.sort((a, b) => a.start - b.start);
      if (d.created) UI.lastInstLen = d.clip.len;
      App.changed();
    } else if (d.kind === 'autopt' || d.kind === 'tension') {
      App.changed();
    } else if (d.kind === 'loop') {
      P.loop.on = true; App.updateTransportUI(); App.changed();
    }
    this.dirty = true;
  },
  onHover(e) {
    if (this.drag) return;
    const { x, y } = this.pos(e);
    const h = this.hit(x, y);
    let cur = 'default';
    this.hover = null;
    if (h.area === 'clip') {
      if (UI.tool === 'slice') cur = 'col-resize';
      else if (UI.tool === 'erase') cur = 'not-allowed';
      else cur = { move: 'grab', left: 'w-resize', right: 'e-resize', fadeIn: 'nwse-resize', fadeOut: 'nesw-resize' }[h.zone];
      if (UI.tool === 'slice') this.hover = { slice: this.snap(h.beat), row: h.row };
    } else if (h.area === 'auto') {
      const hit = this.hitAuto(h.row, x, y);
      cur = hit ? (hit.kind === 'pt' ? 'move' : 'ns-resize') : 'crosshair';
      if (hit && hit.kind === 'pt') this.hover = { auto: h.track.auto[h.track.showAuto][hit.i], row: h.row };
    } else if (h.area === 'track' && UI.tool === 'draw' && h.track.type === 'inst') cur = 'copy';
    this.cv.style.cursor = cur;
    this.dirty = true;
  },
  onDbl(e) {
    const { x, y } = this.pos(e);
    const h = this.hit(x, y);
    if (h.area === 'clip') {
      if (h.clip.type === 'inst') { App.openPiano(h.clip, h.track); }
      else App.showTab('clip');
    } else if (h.area === 'track' && h.track.type === 'inst' && UI.tool === 'pointer') {
      History.push();
      const start = Math.max(0, Math.floor(h.beat / 4) * 4);
      const c = makeInstClip(start, UI.lastInstLen, UI.lastInstLen, []);
      h.track.clips.push(c); UI.sel = new Set([c.id]);
      App.selectClip(c, h.track); App.openPiano(c, h.track); App.changed();
    }
  },
  onContext(e) {
    const { x, y } = this.pos(e);
    const h = this.hit(x, y);
    if (h.area === 'auto') {
      const hit = this.hitAuto(h.row, x, y);
      const pts = h.track.auto[h.track.showAuto];
      if (!hit) {
        Menu.show(e.clientX, e.clientY, [
          { label: 'Hapus semua titik ' + AUTO_PARAMS[h.track.showAuto].label, fn: () => { History.push(); pts.length = 0; App.changed(); } },
          { label: 'Tutup lane automation', fn: () => { h.track.showAuto = null; App.changed(); } },
        ]);
        return;
      }
      if (hit.kind === 'handle') { History.push(); pts[hit.i].c = 0; App.changed(); return; }
      const p = pts[hit.i];
      const items = Object.keys(CURVE_MODES).map((m) => ({ label: (p.m === m ? '● ' : '○ ') + CURVE_MODES[m], fn: () => { History.push(); p.m = m; App.changed(); } }));
      items.push({ sep: true });
      items.push({ label: 'Reset tension kurva', fn: () => { History.push(); p.c = 0; App.changed(); } });
      items.push({ label: 'Hapus titik', fn: () => { History.push(); pts.splice(hit.i, 1); App.changed(); } });
      Menu.show(e.clientX, e.clientY, items);
      return;
    }
    if (h.area === 'clip') {
      if (!UI.sel.has(h.clip.id)) { UI.sel = new Set([h.clip.id]); }
      App.selectClip(h.clip, h.track);
      const c = h.clip;
      const items = [];
      if (c.type === 'inst') items.push({ label: '🎹 Buka di Piano Roll', fn: () => App.openPiano(c, h.track) });
      items.push({ label: '🎛 Properti clip / efek', fn: () => App.showTab('clip') });
      items.push({ sep: true });
      items.push({ label: '✂ Split di sini', fn: () => { History.push(); splitClip(h.track, c, this.snap(h.beat)); App.changed(); } });
      items.push({ label: '✂ Split di playhead (S)', fn: () => App.splitAtPlayhead() });
      items.push({ label: '⧉ Duplikat (Ctrl+D)', fn: () => App.duplicateSel() });
      items.push({ label: '📋 Copy (Ctrl+C)', fn: () => App.copySel() });
      items.push({ label: (c.muted ? '🔊 Unmute' : '🔇 Mute') + ' clip', fn: () => { History.push(); c.muted = !c.muted; App.changed(); } });
      if (c.type === 'audio') items.push({ label: '⇄ Reverse', fn: () => { History.push(); c.reverse = !c.reverse; App.changed(); } });
      items.push({ label: '✎ Ganti nama', fn: () => { const n = prompt('Nama clip', c.name || ''); if (n != null) { History.push(); c.name = n; App.changed(); } } });
      items.push({ sep: true });
      items.push({ label: '🗑 Hapus (Del)', fn: () => App.deleteSel() });
      Menu.show(e.clientX, e.clientY, items);
      return;
    }
    if (h.area === 'track') {
      const items = [];
      if (UI.clipboard) items.push({ label: '📋 Paste di sini', fn: () => { App.seek(this.snap(h.beat)); UI.selTrack = h.track.id; App.pasteClip(); } });
      if (h.track.type === 'inst') items.push({ label: '＋ Clip pola baru', fn: () => { History.push(); const c = makeInstClip(Math.floor(h.beat / 4) * 4, 4, 4, []); h.track.clips.push(c); App.openPiano(c, h.track); App.changed(); } });
      items.push({ label: 'Set playhead di sini', fn: () => App.seek(this.snap(h.beat)) });
      Menu.show(e.clientX, e.clientY, items);
    }
  },
  onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const { x } = this.pos(e);
      const b = this.beatOf(x);
      UI.zoom = Math.max(4, Math.min(400, UI.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      UI.scrollX = Math.max(0, b * UI.zoom - x);
    } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      UI.scrollX = Math.max(0, UI.scrollX + (e.deltaX || e.deltaY));
    } else {
      const maxY = Math.max(0, this.contentH + 80 - this.h);
      UI.scrollY = Math.max(0, Math.min(maxY, UI.scrollY + e.deltaY));
      App.syncHeadScroll();
    }
    this.dirty = true;
  },
  onRulerDown(e) {
    const r = this.rc.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    this.rc.setPointerCapture(e.pointerId);
    if (y < 12 || e.button === 2) {
      const b = Math.max(0, this.snap(this.beatOf(x)));
      this.drag = { kind: 'loop', b0: b };
      P.loop.start = b; P.loop.end = b + (UI.snap || 0.25);
    } else {
      this.drag = { kind: 'seek' };
      App.seek(Math.max(0, this.snap(this.beatOf(x), e.shiftKey ? false : undefined)));
    }
    this.dirty = true;
  },

  // ---------- Gambar ----------
  draw() {
    const g = this.g, W = this.w, H = this.h;
    const rows = this.rows();
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#20262c'; g.fillRect(0, 0, W, H);
    const tsig = P.tsig;
    const b0 = Math.floor(this.beatOf(0)), b1 = Math.ceil(this.beatOf(W));
    // shading per bar selang-seling
    for (let b = Math.floor(b0 / tsig) * tsig; b <= b1; b += tsig) {
      if ((b / tsig) % 2 === 1) { g.fillStyle = 'rgba(255,255,255,0.025)'; g.fillRect(this.xOf(b), 0, tsig * UI.zoom, H); }
    }
    // loop region
    if (P.loop.on) {
      g.fillStyle = 'rgba(255,154,60,0.06)';
      g.fillRect(this.xOf(P.loop.start), 0, (P.loop.end - P.loop.start) * UI.zoom, H);
    }
    // track rows
    for (const r of rows) {
      const y = r.y - UI.scrollY;
      if (y > H || y + r.total < 0) continue;
      const selT = UI.selTrack === r.track.id;
      g.fillStyle = selT ? 'rgba(120,160,255,0.06)' : 'rgba(0,0,0,0.0)';
      g.fillRect(0, y, W, TRACK_H);
      g.fillStyle = '#15191d'; g.fillRect(0, y + TRACK_H - 1, W, 1);
      if (r.autoY != null) {
        const ay = r.autoY - UI.scrollY;
        g.fillStyle = '#1a1f24'; g.fillRect(0, ay, W, AUTO_H);
        g.fillStyle = '#111417'; g.fillRect(0, ay + AUTO_H - 1, W, 1);
      }
    }
    // grid
    const step = UI.zoom < 10 ? tsig : UI.zoom < 22 ? 1 : UI.zoom > 90 ? 0.25 : 1;
    for (let b = Math.floor(b0 / step) * step; b <= b1; b += step) {
      const x = Math.round(this.xOf(b)) + 0.5;
      const bar = Math.abs(b % tsig) < 1e-6, beat = Math.abs(b % 1) < 1e-6;
      g.strokeStyle = bar ? 'rgba(255,255,255,0.14)' : beat ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)';
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
    }
    // clips
    for (const r of rows) {
      const y = r.y - UI.scrollY;
      if (y > H || y + TRACK_H < 0) continue;
      for (const c of r.track.clips) this.drawClip(g, r.track, c, y);
      if (r.autoY != null) this.drawAuto(g, r);
    }
    // slice hover
    if (this.hover && this.hover.slice != null) {
      const x = this.xOf(this.hover.slice), y = this.hover.row.y - UI.scrollY;
      g.strokeStyle = '#ff5b5b'; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + TRACK_H); g.stroke(); g.setLineDash([]);
    }
    // marquee
    if (this.marquee) {
      const m = this.marquee;
      g.fillStyle = 'rgba(120,170,255,0.12)'; g.strokeStyle = 'rgba(120,170,255,0.7)';
      g.fillRect(Math.min(m.x0, m.x1), Math.min(m.y0, m.y1), Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0));
      g.strokeRect(Math.min(m.x0, m.x1) + 0.5, Math.min(m.y0, m.y1) + 0.5, Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0));
    }
    // drop ghost
    if (this.dropGhost) {
      const b = this.snap(this.beatOf(this.dropGhost.x));
      g.fillStyle = 'rgba(255,154,60,0.25)'; g.fillRect(this.xOf(b), this.dropGhost.y - 20, 80, 40);
      g.fillStyle = '#fff'; g.font = '11px sans-serif'; g.fillText('+ drop', this.xOf(b) + 6, this.dropGhost.y + 4);
    }
    if (!P.tracks.length) {
      g.fillStyle = '#6f7a85'; g.font = '14px sans-serif';
      g.fillText('Klik instrumen di Browser (kiri) untuk menambah track, atau seret file MP3/WAV ke sini.', 20, 40);
    }
    // playhead
    const px = Math.round(this.xOf(UI.playhead)) + 0.5;
    g.strokeStyle = '#7dff9b'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(px, 0); g.lineTo(px, H); g.stroke(); g.lineWidth = 1;
    this.drawRuler();
  },

  drawClip(g, track, c, rowY) {
    const x0 = this.xOf(c.start), x1 = this.xOf(c.start + c.len);
    if (x1 < 0 || x0 > this.w) return;
    const y = rowY + 3, h = TRACK_H - 6, w = x1 - x0;
    const sel = UI.sel.has(c.id);
    const col = c.muted ? '#5a6068' : track.color;
    g.save();
    roundRect(g, x0 + 0.5, y + 0.5, Math.max(2, w - 1), h - 1, 4);
    g.fillStyle = hexA(col, 0.28); g.fill();
    g.clip();
    g.fillStyle = hexA(col, c.muted ? 0.5 : 0.9); g.fillRect(x0, y, w, HEAD_H);
    g.fillStyle = '#111'; g.font = 'bold 10px sans-serif';
    const label = (c.muted ? '[M] ' : '') + (c.name || (track.type === 'inst' ? track.name : (AUDIO[c.buf] ? AUDIO[c.buf].name : 'audio')));
    g.fillText(label, x0 + 5, y + 11);
    const by = y + HEAD_H + 2, bh = h - HEAD_H - 4;
    if (c.type === 'inst') {
      const notes = c.notes;
      if (notes.length) {
        let lo = 127, hi = 0;
        for (const n of notes) { lo = Math.min(lo, n.p); hi = Math.max(hi, n.p); }
        const span = Math.max(8, hi - lo + 1);
        const mid = (lo + hi) / 2;
        lo = mid - span / 2;
        const nh = Math.max(2, Math.min(5, bh / span));
        g.fillStyle = hexA(lightenHex(col), c.muted ? 0.4 : 0.95);
        const pat = c.patLen;
        const k0 = Math.floor(c.offset / pat) - 1, k1 = Math.ceil((c.offset + c.len) / pat);
        for (let k = k0; k <= k1; k++) {
          for (const n of notes) {
            const pos = n.s + k * pat;
            if (pos < c.offset || pos >= c.offset + c.len) continue;
            const nx = this.xOf(c.start + pos - c.offset);
            const nw = Math.max(1.5, Math.min(n.l, c.offset + c.len - pos) * UI.zoom - 1);
            const ny = by + bh - ((n.p - lo + 0.5) / span) * bh - nh / 2;
            g.fillRect(nx, ny, nw, nh);
          }
          // garis pengulangan pola
          const px = this.xOf(c.start + k * pat - c.offset);
          if (k * pat > c.offset && k * pat < c.offset + c.len) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(px, by, 1, bh); g.fillStyle = hexA(lightenHex(col), c.muted ? 0.4 : 0.95); }
        }
      }
    } else if (AUDIO[c.buf]) {
      const a = AUDIO[c.buf], pk = a.peaks;
      const spb = 60 / P.bpm, tr = clipTimeRate(c), dur = a.buffer.duration;
      const mid = by + bh / 2;
      g.fillStyle = hexA(lightenHex(col), c.muted ? 0.35 : 0.85);
      const xs = Math.max(x0, 0), xe = Math.min(x1, this.w);
      const amp = bh / 2 * Math.min(2.5, c.gain);
      for (let px = Math.floor(xs); px < xe; px++) {
        const bA = this.beatOf(px), bB = this.beatOf(px + 1);
        let sA = c.offset + (bA - c.start) * spb * tr, sB = c.offset + (bB - c.start) * spb * tr;
        if (c.reverse) { sA = dur - sA; sB = dur - sB; if (sA > sB) [sA, sB] = [sB, sA]; }
        let iA = Math.floor((sA * pk.rate) / pk.block), iB = Math.ceil((sB * pk.rate) / pk.block);
        iA = Math.max(0, iA); iB = Math.min(pk.maxs.length, Math.max(iB, iA + 1));
        let lo = 0, hi = 0;
        for (let i = iA; i < iB; i++) { if (pk.mins[i] < lo) lo = pk.mins[i]; if (pk.maxs[i] > hi) hi = pk.maxs[i]; }
        g.fillRect(px, mid - hi * amp, 1, Math.max(1, (hi - lo) * amp));
      }
      // fade
      g.strokeStyle = 'rgba(255,255,255,0.8)'; g.fillStyle = 'rgba(0,0,0,0.3)';
      if (c.fadeIn > 0) {
        const fx = this.xOf(c.start + c.fadeIn);
        g.beginPath(); g.moveTo(x0, y + h); g.lineTo(fx, y + HEAD_H); g.lineTo(x0, y + HEAD_H); g.closePath(); g.fill();
        g.beginPath(); g.moveTo(x0, y + h); g.lineTo(fx, y + HEAD_H); g.stroke();
      }
      if (c.fadeOut > 0) {
        const fx = this.xOf(c.start + c.len - c.fadeOut);
        g.beginPath(); g.moveTo(x1, y + h); g.lineTo(fx, y + HEAD_H); g.lineTo(x1, y + HEAD_H); g.closePath(); g.fill();
        g.beginPath(); g.moveTo(x1, y + h); g.lineTo(fx, y + HEAD_H); g.stroke();
      }
      // handle fade
      g.fillStyle = '#fff';
      g.fillRect(this.xOf(c.start + (c.fadeIn || 0)) - 3, y + HEAD_H - 3, 6, 6);
      g.fillRect(this.xOf(c.start + c.len - (c.fadeOut || 0)) - 3, y + HEAD_H - 3, 6, 6);
      // info pitch/speed
      const tags = [];
      if (c.pitch || c.cents) tags.push((c.pitch >= 0 ? '+' : '') + c.pitch + 'st');
      if (c.speed !== 1) tags.push(c.speed.toFixed(2) + 'x');
      if (c.reverse) tags.push('REV');
      if (tags.length) { g.fillStyle = '#111'; g.font = '9px sans-serif'; const tw = g.measureText(tags.join(' ')).width; g.fillText(tags.join(' '), Math.max(x0 + 5, x1 - tw - 6), y + 11); }
    }
    g.restore();
    roundRect(g, x0 + 0.5, y + 0.5, Math.max(2, w - 1), h - 1, 4);
    g.strokeStyle = sel ? '#ffffff' : hexA(col, 0.9); g.lineWidth = sel ? 2 : 1; g.stroke(); g.lineWidth = 1;
  },

  drawAuto(g, r) {
    const tr = r.track, key = tr.showAuto, def = AUTO_PARAMS[key];
    const pts = tr.auto[key];
    const L = this.laneY(r);
    const ay = r.autoY - UI.scrollY;
    if (ay > this.h || ay + AUTO_H < 0) return;
    g.fillStyle = def.color; g.font = 'bold 10px sans-serif';
    g.fillText('◢ AUTOMATION: ' + def.label + (pts.length ? '' : '  (klik untuk menambah keyframe)'), 8 , ay + 11);
    // garis tengah/default
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    for (const v of [0, 0.5, 1]) { const yy = L.top + (1 - v) * L.h + 0.5; g.beginPath(); g.moveTo(0, yy); g.lineTo(this.w, yy); g.stroke(); }
    const yOf = (v) => L.top + (1 - v) * L.h;
    let staticV = def.def;
    if (key === 'volume') staticV = tr.vol / 1.25; else if (key === 'pan') staticV = (tr.pan + 1) / 2; else if (key === 'reverb') staticV = tr.reverb; else if (key === 'pitch') staticV = 0.5 + (tr.transpose || 0) / 24;
    g.beginPath();
    for (let px = 0; px <= this.w; px += 2) {
      const v = pts.length ? autoValueAt(pts, this.beatOf(px)) : staticV;
      px === 0 ? g.moveTo(px, yOf(v)) : g.lineTo(px, yOf(v));
    }
    g.strokeStyle = pts.length ? def.color : hexA(def.color, 0.35); g.lineWidth = 2; g.stroke(); g.lineWidth = 1;
    g.lineTo(this.w, L.top + L.h); g.lineTo(0, L.top + L.h); g.closePath();
    g.fillStyle = hexA(def.color, 0.12); g.fill();
    // handles tension
    for (let i = 0; i < pts.length - 1; i++) {
      if (['hold', 'stairs'].includes(pts[i].m)) continue;
      const q = this.autoHandle(r, pts, i);
      g.beginPath(); g.arc(q.x, q.y, 3.5, 0, Math.PI * 2);
      g.strokeStyle = def.color; g.fillStyle = '#1a1f24'; g.fill(); g.stroke();
    }
    for (const p of pts) {
      const q = this.autoPtXY(r, p);
      g.beginPath(); g.arc(q.x, q.y, 5, 0, Math.PI * 2);
      g.fillStyle = this.hover && this.hover.auto === p ? '#fff' : def.color; g.fill();
      g.strokeStyle = '#111'; g.stroke();
    }
    if (this.hover && this.hover.auto && this.hover.row && this.hover.row.track === tr) {
      const p = this.hover.auto, q = this.autoPtXY(r, p);
      const txt = def.fmt(p.v);
      g.font = '11px sans-serif';
      const tw = g.measureText(txt).width + 10;
      g.fillStyle = 'rgba(0,0,0,0.8)'; g.fillRect(q.x + 8, q.y - 20, tw, 16);
      g.fillStyle = '#fff'; g.fillText(txt, q.x + 13, q.y - 8);
    }
  },

  drawRuler() {
    const g = this.rg, W = this.w;
    g.clearRect(0, 0, W, RULER_H);
    g.fillStyle = '#2c333a'; g.fillRect(0, 0, W, RULER_H);
    g.fillStyle = '#242a30'; g.fillRect(0, 0, W, 12);
    const tsig = P.tsig;
    // loop bar
    const lx0 = this.xOf(P.loop.start), lx1 = this.xOf(P.loop.end);
    g.fillStyle = P.loop.on ? '#ff9a3c' : '#5b6167';
    g.fillRect(lx0, 1, lx1 - lx0, 10);
    const b0 = Math.floor(this.beatOf(0)), b1 = Math.ceil(this.beatOf(W));
    const barStep = UI.zoom < 6 ? 4 : UI.zoom < 12 ? 2 : 1;
    g.font = '11px sans-serif';
    for (let b = Math.max(0, b0); b <= b1; b++) {
      const x = Math.round(this.xOf(b)) + 0.5;
      if (b % tsig === 0) {
        const bar = b / tsig;
        if (bar % barStep === 0) {
          g.strokeStyle = '#8a949e'; g.beginPath(); g.moveTo(x, 14); g.lineTo(x, RULER_H); g.stroke();
          g.fillStyle = '#cfd6dc'; g.fillText(String(bar + 1), x + 3, 25);
        }
      } else if (UI.zoom > 14) {
        g.strokeStyle = '#59616a'; g.beginPath(); g.moveTo(x, 23); g.lineTo(x, RULER_H); g.stroke();
      }
    }
    const px = this.xOf(UI.playhead);
    g.fillStyle = '#7dff9b';
    g.beginPath(); g.moveTo(px - 6, 14); g.lineTo(px + 6, 14); g.lineTo(px, 22); g.closePath(); g.fill();
    g.fillRect(px - 0.5, 14, 1.5, RULER_H - 14);
  },
};

// ---------- util gambar ----------
function roundRect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function lightenHex(hex) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.min(255, Math.round(v + (255 - v) * 0.55));
  return '#' + [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join('');
}
