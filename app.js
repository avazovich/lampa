'use strict';

(() => {
  // ---------- Helpers ----------
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const num = (el) => parseFloat(el.value);
  const fmtLux = (v) => (v >= 10 ? Math.round(v).toLocaleString('en-US') : v.toFixed(1));
  const fmtInt = (v) => Math.round(v).toLocaleString('en-US');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const byId = (arr, id) => arr.find((o) => o.id === id);
  const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif';
  const ACCENT = '#ffb547';
  const STORAGE_KEY = 'light-simulator.project.v1';
  let idCounter = 1;
  const uid = (p) => `${p}${idCounter++}`;

  function distSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  function rr(g, x, y, w, h, r) {
    g.beginPath();
    if (g.roundRect) { g.roundRect(x, y, w, h, r); return; }
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  // ---------- Reference data ----------
  const PRESETS = {
    downlight: { label: 'LED downlight', watts: 9, efficacy: 90, beam: 60 },
    spot: { label: 'Spotlight (GU10)', watts: 6, efficacy: 80, beam: 36 },
    panel: { label: 'LED panel 600×600', watts: 36, efficacy: 100, beam: 110 },
    ceiling: { label: 'Ceiling lamp', watts: 24, efficacy: 90, beam: 120 },
    pendant: { label: 'Pendant', watts: 12, efficacy: 85, beam: 100, drop: 0.8 },
    chandelier: { label: 'Chandelier / decorative', watts: 30, efficacy: 80, beam: 150, drop: 0.9 },
    linear: { label: 'Linear light (track / slot)', watts: 15, efficacy: 90, beam: 90, length: 1.0 },
    linearPendant: { label: 'Linear pendant', watts: 24, efficacy: 90, beam: 110, length: 1.2, drop: 0.8 },
    custom: { label: 'Custom', watts: 10, efficacy: 90, beam: 90 },
  };

  const CCT_RGB = {
    2700: [255, 169, 87], 3000: [255, 180, 107], 3500: [255, 196, 137],
    4000: [255, 209, 163], 5000: [255, 228, 206], 6500: [255, 249, 253],
  };
  const CCT_LABEL = {
    2700: '2700 K · warm', 3000: '3000 K · warm white', 3500: '3500 K',
    4000: '4000 K · neutral', 5000: '5000 K · cool', 6500: '6500 K · daylight',
  };
  // Colour per lumen, normalised to equal luminance so the tint doesn't change brightness.
  const CCT_NORM = {};
  for (const k in CCT_RGB) {
    const [r, g, b] = CCT_RGB[k].map((v) => v / 255);
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    CCT_NORM[k] = [r / y, g / y, b / y];
  }
  const cctNorm = (k) => CCT_NORM[k] || CCT_NORM[3000];
  const cctRgb = (k) => (CCT_RGB[k] || CCT_RGB[3000]).join(',');

  // Typical recommended average illuminance. Commercial values follow EN 12464-1.
  const ROOM_TYPES = {
    living: { label: 'Living room', target: 150, u0: 0 },
    kitchen: { label: 'Kitchen', target: 300, u0: 0 },
    bedroom: { label: 'Bedroom', target: 100, u0: 0 },
    bathroom: { label: 'Bathroom', target: 200, u0: 0 },
    hall: { label: 'Hallway / corridor', target: 100, u0: 0.4 },
    study: { label: 'Home office / study', target: 500, u0: 0.6 },
    office: { label: 'Office (open plan)', target: 500, u0: 0.6 },
    meeting: { label: 'Meeting room', target: 500, u0: 0.6 },
    classroom: { label: 'Classroom', target: 300, u0: 0.6 },
    retail: { label: 'Shop / retail', target: 300, u0: 0.4 },
    restaurant: { label: 'Restaurant / café', target: 200, u0: 0 },
    storage: { label: 'Storage / warehouse', target: 150, u0: 0.4 },
    custom: { label: 'Custom', target: 200, u0: 0 },
  };
  // Typical heights; detection guesses a type, the user can correct it.
  const FURNITURE = {
    table: { label: 'Table / desk', height: 0.75 },
    counter: { label: 'Counter / cabinet', height: 0.9 },
    sofa: { label: 'Sofa / armchair', height: 0.8 },
    bed: { label: 'Bed', height: 0.55 },
    chair: { label: 'Chair / stool', height: 0.45 },
    low: { label: 'Low unit / coffee table', height: 0.45 },
    tall: { label: 'Wardrobe / shelving', height: 2.0 },
    custom: { label: 'Custom', height: 1.0 },
  };
  const STATUS_LABEL = { ok: 'OK', low: 'Too dark', uneven: 'Uneven', high: 'Over-lit', na: '—' };
  const STATUS_COLOR = { ok: '#3ecf8e', low: '#ff6b6b', uneven: ACCENT, high: ACCENT, na: '#8c94a3' };

  // False-colour palette (dark blue → red), similar to professional lighting software.
  const PALETTE = [
    [0, '#1b2a8a'], [0.12, '#1f5bff'], [0.25, '#00a6ff'], [0.37, '#00d1c1'], [0.5, '#35dc5b'],
    [0.62, '#b5ea2c'], [0.74, '#ffe04a'], [0.86, '#ff9a2e'], [1, '#ee2f2a'],
  ];
  const PAL = PALETTE.map(([t, h]) => { const n = parseInt(h.slice(1), 16); return [t, (n >> 16) & 255, (n >> 8) & 255, n & 255]; });
  function palette(t) {
    t = clamp(t, 0, 1);
    for (let i = 1; i < PAL.length; i++) {
      if (t <= PAL[i][0]) {
        const a = PAL[i - 1], b = PAL[i], u = (t - a[0]) / (b[0] - a[0]);
        return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u];
      }
    }
    return PAL[PAL.length - 1].slice(1);
  }
  const LUT = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) { const c = palette(i / 255); LUT[i * 3] = c[0]; LUT[i * 3 + 1] = c[1]; LUT[i * 3 + 2] = c[2]; }
  const BANDS = 10;
  const BAND_RGB = Array.from({ length: BANDS }, (_, b) => palette((b + 0.5) / BANDS).map(Math.round));
  const OVER_RGB = [150, 14, 52];
  const NICE = [50, 100, 150, 200, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000];

  const DEFAULT_SETTINGS = { ceiling: 2.8, workplane: 0.75, reflect: 0.5, mf: 0.8, voltage: 220, detail: 'normal', autoWalls: true, wallSens: 0.6 };
  const DEFAULT_VIEW = { mode: 'lux', opacity: 0.85, scaleMax: 'auto', bands: true, exposure: 1, showWalls: false, dim: '2d', cutWalls: false, showFurniture: true };
  const DEFAULT_TEMPLATE = { type: 'downlight', watts: 9, efficacy: 90, lumens: 810, beam: 60, height: 2.8, cct: 3000 };
  const fixtureOf = (L) => ({
    type: L.type, watts: L.watts, efficacy: L.efficacy, lumens: L.lumens, beam: L.beam, height: L.height, cct: L.cct,
    length: L.length || 0, angle: L.angle || 0,
  });

  // ---------- State ----------
  const state = {
    plan: null, // { src, w, h, name } — coordinates everywhere are plan-image pixels
    pxPerM: 80,
    scaleSet: false,
    settings: { ...DEFAULT_SETTINGS },
    view: { ...DEFAULT_VIEW },
    lights: [],
    walls: [],
    zones: [],
    furniture: [], // { id, x, y, w, h (plan px), shape: 'box' | 'round', kind, height (m) }
    template: { ...DEFAULT_TEMPLATE },
    furnTemplate: { kind: 'table', shape: 'box', height: 0.75 },
    wallThick: 0.15,
  };
  // Per-browser display preferences (not part of the project file).
  const UI_KEY = 'light-simulator.ui';
  const ui = { options: false, hints: true, legend: true, labels: true };
  try { Object.assign(ui, JSON.parse(localStorage.getItem(UI_KEY) || '{}')); } catch (e) { /* storage blocked */ }
  function setUi(patch) {
    Object.assign(ui, patch);
    try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (e) { /* storage blocked */ }
    requestUI();
  }
  let tool = 'select';
  let selection = null; // { kind: 'light' | 'wall' | 'zone', id }
  let focusZoneId = null; // a room shown on its own (2D and 3D)
  let planImg = null;
  let planToken = 0;
  const cam = { x: 0, y: 0, s: 1 };

  // ---------- DOM ----------
  const canvas = $('#canvas');
  const ctx = canvas.getContext('2d');
  const stage = $('#stage');
  const heatCanvas = document.createElement('canvas');
  const heatCtx = heatCanvas.getContext('2d');
  const lightCanvas = document.createElement('canvas');
  const lightCtx = lightCanvas.getContext('2d');
  const wallCanvas = document.createElement('canvas');
  const wallCtx = wallCanvas.getContext('2d');

  // ---------- Calculation grid ----------
  let grid = null; // { nx, ny, N, cs (m per cell), cellPx, dark, wall }
  let total = null, rgb = null, visScratch = null, heatImg = null, lightImg = null;
  const cache = new Map(); // light id -> { key, field }
  let version = 0;
  let scaleMax = 500;
  const zoneStats = new Map();
  const applied = { g: null, w: null, c: null };
  let composeNeeded = false;
  let calcPending = 0;
  let dataVersion = 0; // bumps whenever the light result changes (used by the 3D view)
  let geomVersion = 0; // bumps whenever the wall mask changes

  function buildGrid() {
    const { w, h } = state.plan;
    const ppm = state.pxPerM;
    const area = (w / ppm) * (h / ppm);
    const target = { draft: 12000, normal: 35000, fine: 90000 }[state.settings.detail] || 35000;
    const cs = Math.max(0.02, Math.ceil(Math.sqrt(area / target) * 100) / 100);
    const cellPx = cs * ppm;
    const nx = Math.max(1, Math.ceil(w / cellPx));
    const ny = Math.max(1, Math.ceil(h / cellPx));
    const N = nx * ny;

    // Average "ink" per cell: thick dark areas of the drawing are treated as walls.
    const c = document.createElement('canvas');
    c.width = nx; c.height = ny;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(planImg, 0, 0, w / cellPx, h / cellPx);
    const d = g.getImageData(0, 0, nx, ny).data;
    const dark = new Uint8Array(N);
    for (let k = 0; k < N; k++) {
      const a = d[k * 4 + 3] / 255;
      const lum = (0.299 * d[k * 4] + 0.587 * d[k * 4 + 1] + 0.114 * d[k * 4 + 2]) / 255;
      dark[k] = Math.round(a * (1 - lum) * 255);
    }

    const U = N > 60000 ? 2 : 3; // the lux map is drawn at U× the grid resolution for smooth contours
    grid = { nx, ny, N, cs, cellPx, dark, wall: new Uint8Array(N), U };
    total = new Float32Array(N);
    rgb = new Float32Array(N * 3);
    visScratch = new Uint8Array(N);
    for (const cv of [lightCanvas, wallCanvas]) { cv.width = nx; cv.height = ny; }
    heatCanvas.width = nx * U;
    heatCanvas.height = ny * U;
    heatImg = heatCtx.createImageData(nx * U, ny * U);
    lightImg = lightCtx.createImageData(nx, ny);
    cache.clear();
  }

  function buildWallMask() {
    const { nx, ny, N, cs, cellPx, dark, wall } = grid;
    const S = state.settings;
    const thr = Math.round((0.9 - 0.6 * S.wallSens) * 255);
    for (let k = 0; k < N; k++) wall[k] = S.autoWalls && dark[k] >= thr ? 1 : 0;
    for (const W of state.walls) {
      const ax = W.x1 / cellPx, ay = W.y1 / cellPx, bx = W.x2 / cellPx, by = W.y2 / cellPx;
      const r = Math.max(W.thick / cs / 2, 0.75);
      const i0 = Math.max(0, Math.floor(Math.min(ax, bx) - r)), i1 = Math.min(nx - 1, Math.ceil(Math.max(ax, bx) + r));
      const j0 = Math.max(0, Math.floor(Math.min(ay, by) - r)), j1 = Math.min(ny - 1, Math.ceil(Math.max(ay, by) + r));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) if (distSeg(i + 0.5, j + 0.5, ax, ay, bx, by) <= r) wall[j * nx + i] = 1;
      }
    }
    const img = wallCtx.createImageData(nx, ny);
    for (let k = 0; k < N; k++) {
      if (!wall[k]) continue;
      img.data[k * 4] = 255; img.data[k * 4 + 1] = 70; img.data[k * 4 + 2] = 90; img.data[k * 4 + 3] = 255;
    }
    wallCtx.putImageData(img, 0, 0);
    geomVersion++;
  }

  // Grid traversal (Amanatides–Woo): is the straight path between two cells free of walls?
  function lineOfSight(x0, y0, x1, y1) {
    const { nx, ny, wall } = grid;
    let ix = Math.floor(x0), iy = Math.floor(y0);
    const tx = Math.floor(x1), ty = Math.floor(y1);
    if (ix === tx && iy === ty) return true;
    const dx = x1 - x0, dy = y1 - y0;
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    let tmx = dx !== 0 ? (dx > 0 ? ix + 1 - x0 : x0 - ix) * tdx : Infinity;
    let tmy = dy !== 0 ? (dy > 0 ? iy + 1 - y0 : y0 - iy) * tdy : Infinity;
    let guard = Math.abs(tx - ix) + Math.abs(ty - iy) + 2;
    while (guard-- > 0) {
      if (tmx < tmy) { ix += sx; tmx += tdx; } else { iy += sy; tmy += tdy; }
      if (ix === tx && iy === ty) return true;
      if (ix >= 0 && iy >= 0 && ix < nx && iy < ny && wall[iy * nx + ix]) return false;
    }
    return true;
  }

  // Beam angle (full angle at half intensity) -> exponent of a cos^m intensity distribution.
  function beamExponent(beam) {
    const half = (clamp(beam, 5, 170) / 2) * (Math.PI / 180);
    return Math.max(0.05, Math.log(0.5) / Math.log(Math.cos(half)));
  }

  const lightKey = (L) => `${version}|${L.x}|${L.y}|${L.lumens}|${L.beam}|${L.height}|${L.length || 0}|${L.angle || 0}`;

  // Where a fixture emits light, in plan px. A linear fixture (length > 0) is split into short
  // segments along its length, each carrying its share of the lumens.
  function lightPoints(L) {
    if (!(L.length > 0)) return [{ x: L.x, y: L.y, lm: L.lumens }];
    const len = L.length * state.pxPerM;
    const n = clamp(Math.ceil(L.length / 0.15), 2, 16);
    const a = ((L.angle || 0) * Math.PI) / 180, ux = Math.cos(a), uy = Math.sin(a);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const t = ((i + 0.5) / n - 0.5) * len;
      pts.push({ x: L.x + ux * t, y: L.y + uy * t, lm: L.lumens / n });
    }
    return pts;
  }
  function lightEnds(L) {
    const half = ((L.length || 0) * state.pxPerM) / 2;
    const a = ((L.angle || 0) * Math.PI) / 180, ux = Math.cos(a), uy = Math.sin(a);
    return [L.x - ux * half, L.y - uy * half, L.x + ux * half, L.y + uy * half];
  }

  function computeLight(L, key) {
    const { nx, ny, N, cs, cellPx, wall } = grid;
    const S = state.settings;
    let entry = cache.get(L.id);
    if (!entry || entry.field.length !== N) { entry = { key, field: new Float32Array(N) }; cache.set(L.id, entry); }
    entry.key = key;
    entry.eInd = 0;
    const field = entry.field;
    field.fill(0);
    const dh = L.height - S.workplane;
    if (dh <= 0.02 || !(L.lumens > 0)) return;

    const lx = L.x / cellPx, ly = L.y / cellPx; // walls are tested from the fixture's centre
    const m = beamExponent(L.beam);
    const pw = m + 1, dh2 = dh * dh, cs2 = cs * cs;
    // Peak intensity (cd) of each emitting point, so its total flux equals its lumens.
    const pts = lightPoints(L).map((p) => ({ x: p.x / cellPx, y: p.y / cellPx, i0: (p.lm * (m + 1)) / (2 * Math.PI) }));
    const np = pts.length;
    const vis = visScratch;
    vis.fill(0);
    let count = 0;
    for (let j = 0; j < ny; j++) {
      const cy = j + 0.5;
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (wall[k]) continue;
        const cx = i + 0.5;
        if (!lineOfSight(lx, ly, cx, cy)) continue;
        vis[k] = 1;
        count++;
        // Point-source illuminance on a horizontal plane: E = I(θ)·cosθ / d²
        let e = 0;
        for (let q = 0; q < np; q++) {
          const P = pts[q];
          const dx = cx - P.x, dy = cy - P.y;
          const d2 = (dx * dx + dy * dy) * cs2 + dh2;
          e += (P.i0 * Math.pow(dh / Math.sqrt(d2), pw)) / d2;
        }
        field[k] = e;
      }
    }
    // Reflected light: integrating-sphere estimate over the area this fixture can see.
    const floor = count * cs2;
    const surfaces = 2 * floor + 4 * Math.sqrt(floor) * S.ceiling;
    const rho = S.reflect;
    const eInd = surfaces > 0 ? (L.lumens * rho) / (surfaces * (1 - rho)) : 0;
    entry.eInd = eInd; // reused by the 3D view for wall surfaces
    const mf = S.mf;
    for (let k = 0; k < N; k++) if (vis[k]) field[k] = (field[k] + eInd) * mf;
  }

  function compose() {
    const { N } = grid;
    total.fill(0);
    rgb.fill(0);
    const alive = new Set();
    for (const L of state.lights) {
      const c = cache.get(L.id);
      if (!c) continue;
      alive.add(L.id);
      const f = c.field;
      const [cr, cg, cb] = cctNorm(L.cct);
      for (let k = 0, j = 0; k < N; k++, j += 3) {
        const v = f[k];
        if (v) { total[k] += v; rgb[j] += v * cr; rgb[j + 1] += v * cg; rgb[j + 2] += v * cb; }
      }
    }
    for (const id of cache.keys()) if (!alive.has(id)) cache.delete(id);
    computeZoneStats();
    computeScaleMax();
    paintHeat();
    paintLight();
    dataVersion++;
  }

  function computeScaleMax() {
    const sm = state.view.scaleMax;
    if (sm !== 'auto') { scaleMax = +sm; return; }
    if (drag && drag.type !== 'pan') return; // keep colours stable while dragging
    const { N, wall } = grid;
    const sample = [];
    for (let k = 0; k < N; k += 3) if (!wall[k] && total[k] > 0.5) sample.push(total[k]);
    if (!sample.length) { scaleMax = 500; return; }
    const arr = Float32Array.from(sample).sort();
    const p = arr[Math.floor(arr.length * 0.97)];
    scaleMax = NICE.find((v) => v >= p) || NICE[NICE.length - 1];
  }

  // Bilinear upsampling of the lux grid (ignoring wall cells), then colour mapping.
  function paintHeat() {
    const { nx, ny, wall, U } = grid;
    const W = nx * U, H = ny * U;
    const d = heatImg.data;
    const bands = state.view.bands;
    for (let y = 0, p = 0; y < H; y++) {
      const fy = (y + 0.5) / U - 0.5;
      const jf = Math.floor(fy), ty = fy - jf;
      const j0 = Math.max(jf, 0), j1 = Math.min(jf + 1, ny - 1);
      const jc = Math.min(ny - 1, Math.floor((y + 0.5) / U));
      for (let x = 0; x < W; x++, p += 4) {
        const ic = Math.min(nx - 1, Math.floor((x + 0.5) / U));
        if (wall[jc * nx + ic]) { d[p + 3] = 0; continue; }
        const fx = (x + 0.5) / U - 0.5;
        const iff = Math.floor(fx), tx = fx - iff;
        const i0 = Math.max(iff, 0), i1 = Math.min(iff + 1, nx - 1);
        const k00 = j0 * nx + i0, k10 = j0 * nx + i1, k01 = j1 * nx + i0, k11 = j1 * nx + i1;
        const w00 = wall[k00] ? 0 : (1 - tx) * (1 - ty);
        const w10 = wall[k10] ? 0 : tx * (1 - ty);
        const w01 = wall[k01] ? 0 : (1 - tx) * ty;
        const w11 = wall[k11] ? 0 : tx * ty;
        const ws = w00 + w10 + w01 + w11;
        const v = ws > 0 ? (total[k00] * w00 + total[k10] * w10 + total[k01] * w01 + total[k11] * w11) / ws : total[jc * nx + ic];
        paintPixel(d, p, v / scaleMax, bands);
      }
    }
    heatCtx.putImageData(heatImg, 0, 0);
  }

  function paintPixel(d, p, t, bands) {
    if (bands) {
      const c = t >= 1 ? OVER_RGB : BAND_RGB[Math.floor(t * BANDS)];
      d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2];
    } else {
      const li = Math.min(255, Math.round(t * 255)) * 3;
      d[p] = LUT[li]; d[p + 1] = LUT[li + 1]; d[p + 2] = LUT[li + 2];
    }
    d[p + 3] = 255;
  }

  // Realistic view: maps illuminance to perceived brightness (0–255).
  const AMBIENT = 0.03;
  const toneK = () => ((2 * Math.LN2) / 400) * state.view.exposure; // 400 lx → 75 % brightness at exposure 1
  const tone = (e, k) => 255 * (AMBIENT + (1 - AMBIENT) * (1 - Math.exp(-e * k)));

  function paintLight() {
    const { N, wall } = grid;
    const d = lightImg.data;
    const k = toneK();
    for (let i = 0, j = 0, p = 0; i < N; i++, j += 3, p += 4) {
      if (wall[i]) { d[p] = d[p + 1] = d[p + 2] = 24; d[p + 3] = 255; continue; }
      d[p] = tone(rgb[j], k);
      d[p + 1] = tone(rgb[j + 1], k);
      d[p + 2] = tone(rgb[j + 2], k);
      d[p + 3] = 255;
    }
    lightCtx.putImageData(lightImg, 0, 0);
  }

  // Single-colour versions of the two views, for surfaces the 3D view colours itself.
  const tmpRgb = [0, 0, 0, 255];
  function luxColor(v) {
    paintPixel(tmpRgb, 0, v / scaleMax, state.view.bands);
    return tmpRgb;
  }
  function toneRgb(r, g, b) {
    const k = toneK();
    tmpRgb[0] = tone(r, k); tmpRgb[1] = tone(g, k); tmpRgb[2] = tone(b, k);
    return tmpRgb;
  }

  function lightsInZone(Z) {
    return state.lights.filter((L) => L.x >= Z.x && L.x <= Z.x + Z.w && L.y >= Z.y && L.y <= Z.y + Z.h);
  }

  function computeZoneStats() {
    zoneStats.clear();
    const { nx, ny, cellPx, wall } = grid;
    const ppm = state.pxPerM;
    for (const Z of state.zones) {
      const i0 = Math.max(0, Math.ceil(Z.x / cellPx - 0.5)), i1 = Math.min(nx - 1, Math.floor((Z.x + Z.w) / cellPx - 0.5));
      const j0 = Math.max(0, Math.ceil(Z.y / cellPx - 0.5)), j1 = Math.min(ny - 1, Math.floor((Z.y + Z.h) / cellPx - 0.5));
      let sum = 0, n = 0, min = Infinity, max = 0;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const k = j * nx + i;
          if (wall[k]) continue;
          const v = total[k];
          sum += v; n++;
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
      const inside = lightsInZone(Z);
      const watts = inside.reduce((a, L) => a + L.watts, 0);
      const lumens = inside.reduce((a, L) => a + L.lumens, 0);
      const area = (Z.w / ppm) * (Z.h / ppm);
      const avg = n ? sum / n : 0;
      if (!n) min = 0;
      const u0 = avg > 0 ? min / avg : 0;
      let status = 'na';
      if (n && state.lights.length) {
        if (avg < Z.target) status = 'low';
        else if (Z.u0 > 0 && u0 < Z.u0) status = 'uneven';
        else if (avg > Z.target * 2) status = 'high';
        else status = 'ok';
      }
      zoneStats.set(Z.id, { avg, min, max, u0, n, area, watts, lumens, count: inside.length, lpd: area > 0 ? watts / area : 0, status });
    }
  }

  // ---------- Furniture detection ----------
  // Furniture on a plan is usually drawn as small closed outlines of thin lines. Every white area
  // fully enclosed by lines that is too small to be a room, and not boxed in by walls, becomes a
  // piece of furniture. Needs the scale, because the size limits are in metres.
  function detectFurniture() {
    if (!planImg || !grid) return [];
    const { w, h } = state.plan;
    const ppm = state.pxPerM;
    const res = Math.max(0.02, 1 / ppm, Math.sqrt(((w / ppm) * (h / ppm)) / 1.2e6)); // metres per analysis pixel
    const block = res * ppm; // plan pixels per analysis pixel (≥ 1)
    const ax = Math.ceil(w / block), ay = Math.ceil(h / block), AN = ax * ay;

    // Ink mask: an analysis pixel is ink if any plan pixel in it is dark, so thin lines stay closed.
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
    g.drawImage(planImg, 0, 0);
    const d = g.getImageData(0, 0, w, h).data;
    const ink = new Uint8Array(AN);
    for (let y = 0; y < h; y++) {
      const row = Math.min(ay - 1, Math.floor(y / block)) * ax;
      for (let x = 0, p = y * w * 4; x < w; x++, p += 4) {
        if (d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114 < 180) ink[row + Math.min(ax - 1, Math.floor(x / block))] = 1;
      }
    }
    const { nx, ny, cellPx, wall } = grid;
    const wallA = new Uint8Array(AN);
    for (let y = 0; y < ay; y++) {
      const j = Math.min(ny - 1, Math.floor(((y + 0.5) * block) / cellPx));
      for (let x = 0; x < ax; x++) wallA[y * ax + x] = wall[j * nx + Math.min(nx - 1, Math.floor(((x + 0.5) * block) / cellPx))];
    }

    // Label the white areas (4-connected).
    const label = new Int32Array(AN).fill(-1);
    const stack = new Int32Array(AN);
    const regions = [];
    for (let s0 = 0; s0 < AN; s0++) {
      if (ink[s0] || label[s0] >= 0) continue;
      const id = regions.length;
      const R = { n: 0, x0: ax, y0: ay, x1: 0, y1: 0, border: false };
      let sp = 0;
      stack[sp++] = s0;
      label[s0] = id;
      while (sp) {
        const q = stack[--sp];
        const qx = q % ax, qy = (q - qx) / ax;
        R.n++;
        if (qx < R.x0) R.x0 = qx;
        if (qx > R.x1) R.x1 = qx;
        if (qy < R.y0) R.y0 = qy;
        if (qy > R.y1) R.y1 = qy;
        if (qx === 0 || qy === 0 || qx === ax - 1 || qy === ay - 1) { R.border = true; }
        if (qx > 0 && !ink[q - 1] && label[q - 1] < 0) { label[q - 1] = id; stack[sp++] = q - 1; }
        if (qx < ax - 1 && !ink[q + 1] && label[q + 1] < 0) { label[q + 1] = id; stack[sp++] = q + 1; }
        if (qy > 0 && !ink[q - ax] && label[q - ax] < 0) { label[q - ax] = id; stack[sp++] = q - ax; }
        if (qy < ay - 1 && !ink[q + ax] && label[q + ax] < 0) { label[q + ax] = id; stack[sp++] = q + ax; }
      }
      regions.push(R);
    }

    const near = Math.max(1, Math.round(0.15 / res)) + 1; // "against a wall" distance in analysis pixels
    const cands = [];
    regions.forEach((R, id) => {
      if (R.border) return; // the outside of the drawing
      const area = R.n * res * res;
      if (area < 0.08 || area > 6) return; // text holes or whole rooms
      const bw = (R.x1 - R.x0 + 1) * res, bh = (R.y1 - R.y0 + 1) * res;
      const a = Math.min(bw, bh), b = Math.max(bw, bh);
      if (a < 0.25 || b / a > 12) return; // slivers inside walls, windows, hollow-wall gaps
      // Share of the bounding box edge that runs along a wall: an area boxed in by walls is a
      // space (a small room shut off by a door leaf, a shaft), not furniture.
      const wallNear = (x, y, dx, dy) => {
        for (let k = 1; k <= near; k++) {
          const xx = x + dx * k, yy = y + dy * k;
          if (xx < 0 || yy < 0 || xx >= ax || yy >= ay) return false;
          if (wallA[yy * ax + xx]) return true;
        }
        return false;
      };
      let edge = 0, onWall = 0;
      for (let x = R.x0; x <= R.x1; x++) { edge += 2; onWall += wallNear(x, R.y0, 0, -1) + wallNear(x, R.y1, 0, 1); }
      for (let y = R.y0; y <= R.y1; y++) { edge += 2; onWall += wallNear(R.x0, y, -1, 0) + wallNear(R.x1, y, 1, 0); }
      const wallShare = onWall / edge;
      if (wallShare > 0.6) return;
      // Bounding-box corners (12 % in): all empty means an ellipse, otherwise treat it as a box.
      const cw = R.x1 - R.x0, ch = R.y1 - R.y0;
      let corners = 0;
      for (const [fx, fy] of [[0.12, 0.12], [0.88, 0.12], [0.12, 0.88], [0.88, 0.88]]) {
        if (label[Math.round(R.y0 + ch * fy) * ax + Math.round(R.x0 + cw * fx)] === id) corners++;
      }
      const fill = R.n / ((cw + 1) * (ch + 1));
      cands.push({
        // grow by about one outline width so the piece covers its drawn lines
        x: (R.x0 - 1) * block, y: (R.y0 - 1) * block, w: (cw + 3) * block, h: (ch + 3) * block,
        a: a + 2 * res, b: b + 2 * res, round: corners === 0 && fill > 0.6 && fill < 0.88, wall: wallShare > 0.1,
      });
    });

    // An area holding three or more other pieces is a room (a bathroom with its fittings), and
    // pieces drawn inside a bigger piece are details of it (pillows on a bed, a sink in a counter).
    const within = (cd, k) => {
      const ix = Math.max(0, Math.min(cd.x + cd.w, k.x + k.w) - Math.max(cd.x, k.x));
      const iy = Math.max(0, Math.min(cd.y + cd.h, k.y + k.h) - Math.max(cd.y, k.y));
      return cd !== k && cd.w * cd.h < k.w * k.h && ix * iy > 0.6 * cd.w * cd.h;
    };
    const spaces = new Set(cands.filter((k) => cands.filter((cd) => within(cd, k)).length >= 3));
    cands.sort((p, q) => q.w * q.h - p.w * p.h);
    const kept = [];
    for (const cd of cands) {
      if (!spaces.has(cd) && !kept.some((k) => within(cd, k))) kept.push(cd);
    }
    return kept.map((cd) => {
      const kind = guessFurnitureKind(cd);
      return { id: uid('F'), x: cd.x, y: cd.y, w: cd.w, h: cd.h, shape: cd.round ? 'round' : 'box', kind, height: FURNITURE[kind].height };
    });
  }

  // A first guess from the footprint (a = short side, b = long side, in metres).
  function guessFurnitureKind({ a, b, round, wall }) {
    if (round) return b >= 0.7 ? 'table' : 'chair';
    if (b <= 0.65) return 'chair';
    if (a >= 1.3 && b >= 1.8) return 'bed';
    if (a <= 0.7 && b >= 1.2 && wall) return 'counter';
    return 'table';
  }

  // ---------- Frame loop ----------
  let frameReq = 0, needSync = false, needDraw = false, needUI = false;
  // Background tabs get no animation frames, so fall back to a timer to let the calculation finish.
  const kick = () => { if (!frameReq) frameReq = document.hidden ? setTimeout(frame, 16) : requestAnimationFrame(frame); };
  function sync() { needSync = needDraw = needUI = true; kick(); queueAutosave(); }
  function requestDraw() { needDraw = true; kick(); }
  function requestUI() { needUI = true; kick(); }
  function refreshViz() { composeNeeded = needDraw = needUI = true; kick(); queueAutosave(); }

  function applyChanges() {
    if (!planImg) { grid = null; return; }
    const S = state.settings;
    const g = `${planToken}|${state.pxPerM}|${S.detail}`;
    if (g !== applied.g) { applied.g = g; buildGrid(); applied.w = null; }
    const w = `${S.autoWalls}|${S.wallSens}|${JSON.stringify(state.walls)}`;
    if (w !== applied.w) { applied.w = w; buildWallMask(); version++; }
    const c = `${S.workplane}|${S.ceiling}|${S.reflect}|${S.mf}`;
    if (c !== applied.c) { applied.c = c; version++; }
    composeNeeded = true;
  }

  function runCalc() {
    if (!grid) return 0;
    const t0 = performance.now();
    const budget = document.hidden ? 250 : 14; // ms per frame; background timers only fire about once a second
    let did = false, pending = 0;
    for (const L of state.lights) {
      const key = lightKey(L);
      const c = cache.get(L.id);
      if (c && c.key === key) continue;
      if (did && performance.now() - t0 > budget) { pending++; continue; }
      computeLight(L, key);
      did = true;
    }
    if (did || composeNeeded) { composeNeeded = false; compose(); needDraw = needUI = true; }
    if (pending !== calcPending) needUI = true;
    calcPending = pending;
    return pending;
  }

  function frame() {
    frameReq = 0;
    if (needSync) { needSync = false; applyChanges(); }
    const pending = runCalc();
    if (needUI) { needUI = false; refreshUI(); }
    if (needDraw) { needDraw = false; draw(); }
    if (pending) kick();
  }

  // ---------- History ----------
  const hist = { stack: [], idx: -1 };
  const snapshot = () => JSON.stringify({
    lights: state.lights, walls: state.walls, zones: state.zones, furniture: state.furniture,
    pxPerM: state.pxPerM, scaleSet: state.scaleSet, settings: state.settings,
  });
  function resetHistory() { hist.stack = [snapshot()]; hist.idx = 0; requestUI(); }
  function pushHistory() {
    const snap = snapshot();
    if (hist.stack[hist.idx] === snap) return;
    hist.stack.length = hist.idx + 1;
    hist.stack.push(snap);
    if (hist.stack.length > 200) hist.stack.shift();
    hist.idx = hist.stack.length - 1;
    requestUI();
  }
  function commit() { pushHistory(); sync(); }
  function restore(snap) {
    const d = JSON.parse(snap);
    Object.assign(state, d);
    if (!getSelected()) selection = null;
    sync();
  }
  function undo() { if (hist.idx > 0) { hist.idx--; restore(hist.stack[hist.idx]); } }
  function redo() { if (hist.idx < hist.stack.length - 1) { hist.idx++; restore(hist.stack[hist.idx]); } }

  // ---------- Selection & tools ----------
  function getSelected() {
    if (!selection) return null;
    const arr = { light: state.lights, wall: state.walls, zone: state.zones, furniture: state.furniture }[selection.kind];
    const obj = arr && byId(arr, selection.id);
    return obj ? { kind: selection.kind, obj } : null;
  }
  function select(kind, id) {
    selection = kind ? { kind, id } : null;
    if (kind === 'light') { const L = byId(state.lights, id); if (L) Object.assign(state.template, fixtureOf(L)); }
    requestUI(); requestDraw();
  }
  function setTool(t) {
    if (t !== 'select' && is3D()) setDim('2d'); // drawing tools work on the 2D plan
    tool = t;
    wallStart = null; scaleA = scaleB = null;
    const keep = { select: null, light: 'light', wall: 'wall', room: 'zone', furniture: 'furniture', scale: '', crop: '' }[t];
    if (selection && keep !== null && selection.kind !== keep) selection = null;
    updateCursor(hover);
    requestUI(); requestDraw();
  }
  function deleteSelection() {
    const sel = getSelected();
    if (!sel) return;
    const arr = { light: state.lights, wall: state.walls, zone: state.zones, furniture: state.furniture }[sel.kind];
    arr.splice(arr.indexOf(sel.obj), 1);
    selection = null;
    commit();
  }
  function duplicateLight() {
    const sel = getSelected();
    if (sel?.kind !== 'light') return;
    const L = { ...sel.obj, id: uid('L'), x: sel.obj.x + 0.6 * state.pxPerM };
    state.lights.push(L);
    select('light', L.id);
    commit();
  }

  // ---------- Camera ----------
  function toWorld(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left - cam.x) / cam.s, y: (e.clientY - r.top - cam.y) / cam.s };
  }
  let autoFit = true; // keep the plan fitted on window resize until the user pans or zooms
  function zoomAt(sx, sy, f) {
    const ns = clamp(cam.s * f, 0.03, 40);
    cam.x = sx - (sx - cam.x) * (ns / cam.s);
    cam.y = sy - (sy - cam.y) * (ns / cam.s);
    cam.s = ns;
    autoFit = false;
    requestDraw();
  }
  function fitView() {
    if (!state.plan) return;
    const r = stage.getBoundingClientRect();
    const padX = 60, padY = 70;
    // The whole plan, or just the room being shown on its own (with a little margin).
    const Z = focusZone(), m = 0.4 * state.pxPerM;
    const box = Z ? { x: Z.x - m, y: Z.y - m, w: Z.w + 2 * m, h: Z.h + 2 * m } : { x: 0, y: 0, w: state.plan.w, h: state.plan.h };
    cam.s = clamp(Math.min((r.width - padX * 2) / box.w, (r.height - padY * 2) / box.h), 0.03, 40);
    cam.x = (r.width - box.w * cam.s) / 2 - box.x * cam.s;
    cam.y = (r.height - box.h * cam.s) / 2 - box.y * cam.s;
    autoFit = true;
    requestDraw();
  }
  function resizeCanvas() {
    const r = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    canvas.style.width = `${r.width}px`;
    canvas.style.height = `${r.height}px`;
    if (autoFit) fitView();
    view3d?.resize();
    requestDraw();
  }

  // ---------- 3D view ----------
  let view3d = null; // created on first use (view3d.js)
  const is3D = () => state.view.dim === '3d' && !!view3d;
  const view3dApi = {
    canvas: $('#canvas3d'), stage, state, FONT, ACCENT, STATUS_COLOR, rr, fmtLux,
    grid: () => grid,
    planToken: () => planToken,
    geomVersion: () => geomVersion,
    dataVersion: () => dataVersion,
    lightField: (id) => cache.get(id),
    beamExponent, cctNorm, cctRgb, footprintRadius, paintSurface, luxColor, toneRgb, zoneStats,
    selectedLight: () => { const s = getSelected(); return s?.kind === 'light' ? s.obj : null; },
    selectLight: (id) => select(id ? 'light' : null, id),
    showReadout: (e, p) => updateReadout(e, p),
    hideReadout: () => { readout.style.display = 'none'; },
    spaceHeld: () => spaceHeld,
    showLabels: () => ui.labels,
    focusId: () => focusZoneId,
    focusRect: () => {
      const Z = focusZone();
      return Z ? { x0: Z.x / state.pxPerM, z0: Z.y / state.pxPerM, x1: (Z.x + Z.w) / state.pxPerM, z1: (Z.y + Z.h) / state.pxPerM } : null;
    },
    lightPoints,
    onError: (err) => { toast(`Couldn't open the 3D view: ${err.message}.`, 'error'); setDim('2d'); },
  };
  function setDim(d) {
    state.view.dim = d;
    stage.classList.toggle('is-3d', d === '3d');
    if (d === '3d') {
      if (!view3d) {
        view3d = window.createView3D(view3dApi);
        toast('Loading the 3D view…');
      }
      view3d.show();
    } else if (view3d) {
      view3d.hide();
    }
    readout.style.display = 'none';
    requestDraw(); requestUI(); queueAutosave();
  }
  function zoomBy(f) {
    if (is3D()) { view3d.zoom(f); return; }
    const r = stage.getBoundingClientRect();
    zoomAt(r.width / 2, r.height / 2, f);
  }
  const fitAny = () => (is3D() ? view3d.resetView() : fitView());

  const focusZone = () => (focusZoneId ? byId(state.zones, focusZoneId) || null : null);
  function focusRoom(id) {
    focusZoneId = id && byId(state.zones, id) ? id : null;
    if (focusZoneId) select('zone', focusZoneId);
    autoFit = true;
    fitAny();
    refreshViz(); // room labels in 3D
  }

  // ---------- Rendering ----------
  function tag(g, s, text, x, y, o = {}) {
    const fs = (o.size || 11.5) / s;
    g.font = `${o.weight || 600} ${fs}px ${FONT}`;
    const tw = g.measureText(text).width;
    const px = 6 / s, py = 4 / s, w = tw + px * 2, h = fs + py * 2;
    const bx = x - w / 2, by = y - h / 2;
    g.fillStyle = o.bg || 'rgba(12,14,18,0.88)';
    rr(g, bx, by, w, h, 4 / s);
    g.fill();
    g.fillStyle = o.color || '#e7e9ee';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(text, bx + px, by + h / 2 + 0.5 / s);
  }

  function drawGlow(g, L) {
    const r = 0.55 * state.pxPerM;
    const half = ((L.length || 0) * state.pxPerM) / 2;
    const c = cctRgb(L.cct);
    const a = clamp(L.lumens / 1500, 0.35, 1);
    g.save();
    g.translate(L.x, L.y);
    g.rotate(((L.angle || 0) * Math.PI) / 180);
    if (half) g.scale((half + r) / r, 1); // stretch the glow along a linear fixture
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, r);
    grd.addColorStop(0, `rgba(255,255,255,${a})`);
    grd.addColorStop(0.18, `rgba(${c},${a * 0.85})`);
    grd.addColorStop(1, `rgba(${c},0)`);
    g.fillStyle = grd;
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  function footprintRadius(L) {
    const dh = L.height - state.settings.workplane;
    if (dh <= 0) return 0;
    return Math.min(dh * Math.tan((clamp(L.beam, 5, 170) / 2) * (Math.PI / 180)), 30);
  }

  function drawFootprint(g, s, L, alpha) {
    const r = footprintRadius(L) * state.pxPerM;
    if (!r) return;
    const half = ((L.length || 0) * state.pxPerM) / 2;
    g.save();
    g.translate(L.x, L.y);
    g.rotate(((L.angle || 0) * Math.PI) / 180);
    g.setLineDash([5 / s, 4 / s]);
    g.beginPath();
    if (half) {
      g.arc(half, 0, r, -Math.PI / 2, Math.PI / 2);
      g.arc(-half, 0, r, Math.PI / 2, Math.PI * 1.5);
      g.closePath();
    } else {
      g.arc(0, 0, r, 0, Math.PI * 2);
    }
    g.lineWidth = 3 / s;
    g.strokeStyle = `rgba(0,0,0,${alpha * 0.5})`;
    g.stroke();
    g.lineWidth = 1.3 / s;
    g.strokeStyle = `rgba(255,255,255,${alpha})`;
    g.stroke();
    g.restore();
  }

  function drawFixture(g, s, L, o = {}) {
    const r = 6.5 / s;
    g.save();
    if (o.ghost) g.globalAlpha = 0.6;
    if (L.length > 0) {
      const len = L.length * state.pxPerM, w = Math.max(0.07 * state.pxPerM, 7 / s);
      g.translate(L.x, L.y);
      g.rotate(((L.angle || 0) * Math.PI) / 180);
      if (o.sel) {
        const p = 4.5 / s;
        rr(g, -len / 2 - p, -w / 2 - p, len + p * 2, w + p * 2, w / 2 + p);
        g.strokeStyle = ACCENT;
        g.lineWidth = 2 / s;
        g.stroke();
      }
      rr(g, -len / 2, -w / 2, len, w, w / 2);
      g.lineWidth = 1.5 / s;
      g.fillStyle = o.real ? `rgba(${cctRgb(L.cct)},0.95)` : '#ffffff';
      g.strokeStyle = o.real ? 'rgba(255,255,255,0.75)' : '#14171d';
      g.fill();
      g.stroke();
      if (!o.real && len > w * 2) {
        g.beginPath();
        g.moveTo(-len / 2 + w * 0.7, 0);
        g.lineTo(len / 2 - w * 0.7, 0);
        g.stroke();
      }
      g.restore();
      return;
    }
    if (o.sel) {
      g.beginPath();
      g.arc(L.x, L.y, r + 4.5 / s, 0, Math.PI * 2);
      g.strokeStyle = ACCENT;
      g.lineWidth = 2 / s;
      g.stroke();
    }
    g.lineWidth = 1.5 / s;
    g.fillStyle = o.real ? `rgba(${cctRgb(L.cct)},0.95)` : '#ffffff';
    g.strokeStyle = o.real ? 'rgba(255,255,255,0.75)' : '#14171d';
    g.beginPath();
    if (L.type === 'panel') g.rect(L.x - r, L.y - r, r * 2, r * 2);
    else g.arc(L.x, L.y, r, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    if (!o.real) {
      g.beginPath();
      if (L.type === 'spot') {
        g.arc(L.x, L.y, r * 0.38, 0, Math.PI * 2);
        g.fillStyle = '#14171d';
        g.fill();
      } else if (L.type === 'pendant' || L.type === 'chandelier') {
        g.arc(L.x, L.y, r * 0.5, 0, Math.PI * 2);
        if (L.type === 'chandelier') {
          g.moveTo(L.x + r * 0.25, L.y);
          g.arc(L.x, L.y, r * 0.25, 0, Math.PI * 2);
        }
        g.stroke();
      } else {
        const q = r * (L.type === 'panel' ? 0.75 : 0.62);
        g.moveTo(L.x - q, L.y - q); g.lineTo(L.x + q, L.y + q);
        g.moveTo(L.x + q, L.y - q); g.lineTo(L.x - q, L.y + q);
        g.stroke();
      }
    }
    g.restore();
  }

  function drawWalls(g, s) {
    const sel = selection?.kind === 'wall' ? selection.id : null;
    g.save();
    g.lineCap = 'butt';
    for (const W of state.walls) {
      const isSel = W.id === sel;
      g.beginPath();
      g.moveTo(W.x1, W.y1);
      g.lineTo(W.x2, W.y2);
      g.lineWidth = Math.max(W.thick * state.pxPerM, 2 / s);
      g.strokeStyle = isSel ? 'rgba(255,181,71,0.9)' : 'rgba(46,52,66,0.92)';
      g.stroke();
      if (isSel) {
        for (const [x, y] of [[W.x1, W.y1], [W.x2, W.y2]]) {
          g.fillStyle = '#fff'; g.strokeStyle = ACCENT; g.lineWidth = 1.5 / s;
          g.beginPath(); g.rect(x - 4 / s, y - 4 / s, 8 / s, 8 / s); g.fill(); g.stroke();
        }
      }
    }
    g.restore();
  }

  function drawZoneLabel(g, s, Z, st) {
    if (!ui.labels || Z.w * s < 70 || Z.h * s < 34) return;
    const fs = 12 / s, pad = 7 / s;
    const hasLights = state.lights.length > 0;
    const line1 = Z.name;
    const line2 = st && hasLights ? `${fmtLux(st.avg)} lx · target ${Z.target}` : `target ${Z.target} lx`;
    g.font = `650 ${fs}px ${FONT}`;
    const w1 = g.measureText(line1).width;
    g.font = `500 ${fs * 0.92}px ${FONT}`;
    const w2 = g.measureText(line2).width + 13 / s;
    const w = Math.max(w1, w2) + pad * 2, h = fs * 2.45 + pad * 1.2;
    const x = Z.x + 6 / s, y = Z.y + 6 / s;
    g.fillStyle = 'rgba(12,14,18,0.86)';
    rr(g, x, y, w, h, 5 / s);
    g.fill();
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = '#e7e9ee';
    g.font = `650 ${fs}px ${FONT}`;
    g.fillText(line1, x + pad, y + pad * 0.6 + fs * 0.62);
    const ly = y + pad * 0.6 + fs * 1.78;
    g.fillStyle = STATUS_COLOR[st && hasLights ? st.status : 'na'];
    g.beginPath();
    g.arc(x + pad + 3.5 / s, ly, 3.5 / s, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#b9bfca';
    g.font = `500 ${fs * 0.92}px ${FONT}`;
    g.fillText(line2, x + pad + 13 / s, ly);
  }

  function drawFurniture(g, s, o) {
    if (!o.ui) return;
    const selId = selection?.kind === 'furniture' ? selection.id : null;
    const all = tool === 'furniture';
    if (!all && !selId) return;
    for (const F of state.furniture) {
      const isSel = F.id === selId;
      if (!all && !isSel) continue;
      g.save();
      g.beginPath();
      if (F.shape === 'round') g.ellipse(F.x + F.w / 2, F.y + F.h / 2, F.w / 2, F.h / 2, 0, 0, Math.PI * 2);
      else g.rect(F.x, F.y, F.w, F.h);
      g.fillStyle = isSel ? 'rgba(255,181,71,0.24)' : 'rgba(255,181,71,0.1)';
      g.fill();
      g.lineWidth = (isSel ? 2 : 1.2) / s;
      g.strokeStyle = isSel ? ACCENT : 'rgba(255,181,71,0.8)';
      if (!isSel) g.setLineDash([5 / s, 3 / s]);
      g.stroke();
      g.restore();
      if (isSel) {
        for (const [x, y] of zoneCorners(F)) {
          g.fillStyle = '#fff'; g.strokeStyle = ACCENT; g.lineWidth = 1.5 / s;
          g.beginPath(); g.rect(x - 4 / s, y - 4 / s, 8 / s, 8 / s); g.fill(); g.stroke();
        }
        tag(g, s, `${FURNITURE[F.kind]?.label || 'Furniture'} · ${F.height} m`, F.x + F.w / 2, F.y - 14 / s);
      }
    }
  }

  // Darkens everything outside the room being shown on its own.
  function drawFocusMask(g) {
    const Z = focusZone();
    const big = 1e6;
    g.save();
    g.fillStyle = 'rgba(12,14,18,0.88)';
    g.beginPath();
    g.rect(-big, -big, big * 2, big * 2);
    g.rect(Z.x, Z.y, Z.w, Z.h);
    g.fill('evenodd');
    g.restore();
  }

  function drawZones(g, s, o) {
    const sel = selection?.kind === 'zone' ? selection.id : null;
    for (const Z of state.zones) {
      if (focusZoneId && Z.id !== focusZoneId) continue; // only the room on show
      const st = zoneStats.get(Z.id);
      const isSel = o.ui && Z.id === sel && !focusZoneId;
      const color = STATUS_COLOR[st && state.lights.length ? st.status : 'na'];
      g.save();
      g.lineWidth = 3.5 / s;
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.strokeRect(Z.x, Z.y, Z.w, Z.h);
      g.lineWidth = (isSel ? 2 : 1.4) / s;
      g.strokeStyle = isSel ? ACCENT : color;
      if (!isSel) g.setLineDash([7 / s, 4 / s]);
      g.strokeRect(Z.x, Z.y, Z.w, Z.h);
      g.restore();
      drawZoneLabel(g, s, Z, st);
      if (isSel) {
        for (const [x, y] of zoneCorners(Z)) {
          g.fillStyle = '#fff'; g.strokeStyle = ACCENT; g.lineWidth = 1.5 / s;
          g.beginPath(); g.rect(x - 4 / s, y - 4 / s, 8 / s, 8 / s); g.fill(); g.stroke();
        }
      }
    }
  }

  function drawLights(g, s, o) {
    const real = state.view.mode === 'real';
    const sel = selection?.kind === 'light' ? selection.id : null;
    for (const L of state.lights) {
      const isSel = o.ui && L.id === sel;
      const isHover = o.ui && L.id === hoverLightId;
      if (isSel || isHover) drawFootprint(g, s, L, isSel ? 0.9 : 0.55);
      drawFixture(g, s, L, { real, sel: isSel });
    }
    for (const L of state.lights) {
      if (o.ui && (L.id === sel || L.id === hoverLightId)) tag(g, s, `${fmtInt(L.lumens)} lm · ${L.watts} W`, L.x, L.y + 21 / s);
    }
  }

  // The plan with the lux map or realistic light baked in (also the 3D floor texture).
  function paintSurface(g) {
    const { w, h } = state.plan;
    g.save();
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(planImg, 0, 0, w, h);
    g.beginPath();
    g.rect(0, 0, w, h);
    g.clip();
    if (grid) {
      const gw = grid.nx * grid.cellPx, gh = grid.ny * grid.cellPx;
      if (state.view.mode === 'real') {
        g.globalCompositeOperation = 'multiply';
        g.drawImage(lightCanvas, 0, 0, gw, gh);
      } else if (state.lights.length) {
        g.globalCompositeOperation = 'multiply';
        g.globalAlpha = state.view.opacity;
        g.drawImage(heatCanvas, 0, 0, gw, gh);
      }
    }
    g.restore();
  }

  function renderScene(g, s, o = {}) {
    const { w, h } = state.plan;
    paintSurface(g);
    g.save();
    g.beginPath();
    g.rect(0, 0, w, h);
    g.clip();
    if (grid) {
      const gw = grid.nx * grid.cellPx, gh = grid.ny * grid.cellPx;
      if (state.view.mode === 'real') {
        g.globalCompositeOperation = 'screen';
        for (const L of state.lights) drawGlow(g, L);
        g.globalCompositeOperation = 'source-over';
      }
      if (state.view.showWalls) {
        g.imageSmoothingEnabled = false;
        g.globalAlpha = 0.55;
        g.drawImage(wallCanvas, 0, 0, gw, gh);
        g.globalAlpha = 1;
        g.imageSmoothingEnabled = true;
      }
    }
    g.restore();
    drawWalls(g, s);
    drawFurniture(g, s, o);
    drawZones(g, s, o);
    drawLights(g, s, o);
  }

  function drawToolOverlay(g, s) {
    const ppm = state.pxPerM;
    if (tool === 'light' && hover && !drag && !hoverLightId) {
      const ghost = { ...state.template, x: hover.x, y: hover.y };
      drawFootprint(g, s, ghost, 0.6);
      drawFixture(g, s, ghost, { real: state.view.mode === 'real', ghost: true });
    }
    if (tool === 'wall' && hover) {
      const q = snapWall(hover, wallStart, shiftHeld);
      if (wallStart) {
        g.save();
        g.strokeStyle = 'rgba(255,181,71,0.85)';
        g.lineWidth = Math.max(state.wallThick * ppm, 2 / s);
        g.beginPath(); g.moveTo(wallStart.x, wallStart.y); g.lineTo(q.x, q.y); g.stroke();
        g.restore();
        const len = Math.hypot(q.x - wallStart.x, q.y - wallStart.y) / ppm;
        tag(g, s, `${len.toFixed(2)} m`, (wallStart.x + q.x) / 2, (wallStart.y + q.y) / 2 - 16 / s);
      }
      g.beginPath();
      g.arc(q.x, q.y, (q.snap ? 6 : 3.5) / s, 0, Math.PI * 2);
      g.fillStyle = q.snap ? 'rgba(255,181,71,0.35)' : ACCENT;
      g.strokeStyle = ACCENT;
      g.lineWidth = 1.5 / s;
      g.fill(); g.stroke();
    }
    if (tool === 'scale' && scaleA) {
      const b = scaleB || hover;
      g.save();
      g.strokeStyle = ACCENT;
      g.lineWidth = 2 / s;
      if (b) {
        g.setLineDash([6 / s, 4 / s]);
        g.beginPath(); g.moveTo(scaleA.x, scaleA.y); g.lineTo(b.x, b.y); g.stroke();
        g.setLineDash([]);
      }
      for (const p of [scaleA, scaleB].filter(Boolean)) {
        g.beginPath(); g.arc(p.x, p.y, 5 / s, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.stroke();
      }
      g.restore();
      if (b) {
        const d = Math.hypot(b.x - scaleA.x, b.y - scaleA.y);
        tag(g, s, `${Math.round(d)} px`, (scaleA.x + b.x) / 2, (scaleA.y + b.y) / 2 - 16 / s);
      }
    }
    if (tool === 'crop') {
      const r = drag?.type === 'crop' ? cropFromDrag(drag) : cropRect;
      if (r) {
        g.save();
        g.fillStyle = 'rgba(8,10,14,0.62)';
        g.beginPath();
        g.rect(0, 0, state.plan.w, state.plan.h);
        g.rect(r.x, r.y, r.w, r.h);
        g.fill('evenodd');
        g.setLineDash([7 / s, 4 / s]);
        g.strokeStyle = ACCENT;
        g.lineWidth = 2 / s;
        g.strokeRect(r.x, r.y, r.w, r.h);
        g.restore();
      }
    }
    if (drag?.type === 'zone-new' || drag?.type === 'furn-new') {
      const x = Math.min(drag.x0, drag.x1), y = Math.min(drag.y0, drag.y1);
      const w = Math.abs(drag.x1 - drag.x0), h = Math.abs(drag.y1 - drag.y0);
      g.save();
      g.fillStyle = 'rgba(255,181,71,0.1)';
      g.fillRect(x, y, w, h);
      g.setLineDash([7 / s, 4 / s]);
      g.strokeStyle = ACCENT;
      g.lineWidth = 1.6 / s;
      g.strokeRect(x, y, w, h);
      g.restore();
      tag(g, s, `${(w / ppm).toFixed(1)} × ${(h / ppm).toFixed(1)} m`, x + w / 2, y + h / 2);
    }
  }

  function drawScaleBar(g, W, H) {
    const pxm = state.pxPerM * cam.s;
    const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200];
    const m = steps.find((v) => v * pxm >= 70) || 200;
    const len = m * pxm;
    const x1 = W - 140, x0 = x1 - len, y = H - 22;
    g.fillStyle = 'rgba(21,24,32,0.9)';
    rr(g, x0 - 10, y - 24, len + 20, 34, 8);
    g.fill();
    g.strokeStyle = '#e7e9ee';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x0, y - 4); g.lineTo(x0, y + 2); g.lineTo(x1, y + 2); g.lineTo(x1, y - 4);
    g.stroke();
    g.fillStyle = '#e7e9ee';
    g.font = `600 11px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.fillText(`${state.scaleSet ? '' : '≈ '}${m} m`, (x0 + x1) / 2, y - 7);
  }

  function draw() {
    if (is3D()) { view3d.render(); return; }
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!planImg) return;
    ctx.setTransform(dpr * cam.s, 0, 0, dpr * cam.s, dpr * cam.x, dpr * cam.y);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 28 * dpr;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, state.plan.w, state.plan.h);
    ctx.restore();
    renderScene(ctx, cam.s, { ui: true });
    if (focusZone()) drawFocusMask(ctx);
    drawToolOverlay(ctx, cam.s);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawScaleBar(ctx, canvas.width / dpr, canvas.height / dpr);
  }

  // ---------- Hit testing & snapping ----------
  function hitLight(p, s) {
    let best = null, bd = 11 / s;
    for (const L of state.lights) {
      const d = L.length > 0 ? distSeg(p.x, p.y, ...lightEnds(L)) : Math.hypot(L.x - p.x, L.y - p.y);
      if (d < bd) { bd = d; best = L; }
    }
    return best;
  }
  function hitWall(p, s) {
    let best = null, bd = Infinity;
    for (const W of state.walls) {
      const d = distSeg(p.x, p.y, W.x1, W.y1, W.x2, W.y2);
      if (d <= Math.max((W.thick * state.pxPerM) / 2, 6 / s) && d < bd) { bd = d; best = W; }
    }
    return best;
  }
  function hitWallEnd(W, p, s) {
    if (Math.hypot(W.x1 - p.x, W.y1 - p.y) < 9 / s) return 1;
    if (Math.hypot(W.x2 - p.x, W.y2 - p.y) < 9 / s) return 2;
    return 0;
  }
  const zoneCorners = (Z) => [[Z.x, Z.y], [Z.x + Z.w, Z.y], [Z.x + Z.w, Z.y + Z.h], [Z.x, Z.y + Z.h]];
  function hitHandle(Z, p, s) {
    const cs = zoneCorners(Z);
    for (let i = 0; i < 4; i++) if (Math.abs(cs[i][0] - p.x) < 8 / s && Math.abs(cs[i][1] - p.y) < 8 / s) return i;
    return -1;
  }
  function hitFurniture(p) {
    let best = null, ba = Infinity;
    for (const F of state.furniture) {
      const inside = F.shape === 'round'
        ? ((p.x - F.x - F.w / 2) / (F.w / 2)) ** 2 + ((p.y - F.y - F.h / 2) / (F.h / 2)) ** 2 <= 1
        : p.x >= F.x && p.x <= F.x + F.w && p.y >= F.y && p.y <= F.y + F.h;
      if (inside && F.w * F.h < ba) { ba = F.w * F.h; best = F; }
    }
    return best;
  }
  function hitZone(p) {
    let best = null, ba = Infinity;
    for (const Z of state.zones) {
      if (p.x >= Z.x && p.x <= Z.x + Z.w && p.y >= Z.y && p.y <= Z.y + Z.h && Z.w * Z.h < ba) { ba = Z.w * Z.h; best = Z; }
    }
    return best;
  }
  function snapWall(p, from, shift, exclude) {
    let best = null, bd = 10 / cam.s;
    for (const W of state.walls) {
      if (W === exclude) continue;
      for (const [x, y] of [[W.x1, W.y1], [W.x2, W.y2]]) {
        const d = Math.hypot(x - p.x, y - p.y);
        if (d < bd) { bd = d; best = { x, y, snap: true }; }
      }
    }
    if (best) return best;
    if (from) {
      const dx = p.x - from.x, dy = p.y - from.y;
      const len = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
      const step = shift ? Math.PI / 4 : Math.PI / 2;
      const a = Math.round(ang / step) * step;
      if (shift || Math.abs(a - ang) < (4 * Math.PI) / 180) return { x: from.x + Math.cos(a) * len, y: from.y + Math.sin(a) * len };
    }
    return { x: p.x, y: p.y };
  }

  // ---------- Pointer interaction ----------
  let drag = null, hover = null, hoverLightId = null;
  let spaceHeld = false, shiftHeld = false;
  let wallStart = null, scaleA = null, scaleB = null;
  let cropRect = null; // { x, y, w, h } in plan px while cropping

  function cropFromDrag(d) {
    const { w, h } = state.plan;
    const x0 = clamp(Math.min(d.x0, d.x1), 0, w), x1 = clamp(Math.max(d.x0, d.x1), 0, w);
    const y0 = clamp(Math.min(d.y0, d.y1), 0, h), y1 = clamp(Math.max(d.y0, d.y1), 0, h);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  // Keep only the chosen part of the drawing; everything already placed moves with it.
  async function applyCrop() {
    if (!cropRect || !planImg) return;
    const x = Math.round(cropRect.x), y = Math.round(cropRect.y);
    const w = Math.max(1, Math.round(cropRect.w)), h = Math.max(1, Math.round(cropRect.h));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
    g.drawImage(planImg, -x, -y);
    await setPlan(encodePlan(c), state.plan.name);
    for (const o of [...state.lights, ...state.zones, ...state.furniture]) { o.x -= x; o.y -= y; }
    for (const W of state.walls) { W.x1 -= x; W.y1 -= y; W.x2 -= x; W.y2 -= y; }
    if (!state.scaleSet) state.pxPerM = w / 15; // rough guess until the scale is set
    cropRect = null;
    resetHistory();
    fitView();
    setTool(state.scaleSet ? 'select' : 'scale');
    sync();
    toast(state.scaleSet ? 'Cropped.' : 'Cropped. Now set the scale: click two points whose real distance you know.');
  }
  function skipCrop() {
    cropRect = null;
    setTool(state.scaleSet ? 'select' : 'scale');
    if (!state.scaleSet) toast('Now set the scale: click two points whose real distance you know.');
  }

  function startPan(e) {
    drag = { type: 'pan', sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y, moved: false };
    canvas.style.cursor = 'grabbing';
  }

  function updateCursor(p) {
    let c = 'crosshair';
    if (spaceHeld) c = 'grab';
    else if (tool === 'select') {
      c = 'grab';
      if (p) {
        const sel = getSelected();
        if (hitLight(p, cam.s)) c = 'move';
        else if (sel?.kind === 'zone' && hitHandle(sel.obj, p, cam.s) >= 0) c = 'nwse-resize';
        else if (hitWall(p, cam.s)) c = 'pointer';
        else if (sel?.kind === 'zone' && hitZone(p) === sel.obj) c = 'move';
        else if (hitZone(p)) c = 'pointer';
      }
    } else if (tool === 'light' && p && hitLight(p, cam.s)) c = 'move';
    else if (tool === 'furniture' && p) {
      const sel = getSelected();
      if (sel?.kind === 'furniture' && hitHandle(sel.obj, p, cam.s) >= 0) c = 'nwse-resize';
      else if (hitFurniture(p)) c = 'move';
    }
    canvas.style.cursor = c;
  }

  const readout = $('#readout');
  function updateReadout(e, p) {
    if (!grid || !state.plan || !state.lights.length || !p || p.x < 0 || p.y < 0 || p.x >= state.plan.w || p.y >= state.plan.h || (drag && drag.type === 'pan')) {
      readout.style.display = 'none';
      return;
    }
    const i = Math.floor(p.x / grid.cellPx), j = Math.floor(p.y / grid.cellPx);
    const k = j * grid.nx + i;
    if (grid.wall[k]) { readout.style.display = 'none'; return; }
    const Z = hitZone(p);
    readout.innerHTML = `${fmtLux(total[k])} lx${Z ? `<small>${esc(Z.name)}</small>` : ''}`;
    const r = stage.getBoundingClientRect();
    readout.style.left = `${e.clientX - r.left + 16}px`;
    readout.style.top = `${e.clientY - r.top + 16}px`;
    readout.style.display = 'block';
  }

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    if (!planImg) return;
    canvas.setPointerCapture(e.pointerId);
    shiftHeld = e.shiftKey;
    const p = toWorld(e), s = cam.s;
    if (e.button === 1 || spaceHeld || (e.button === 2 && tool !== 'wall')) { startPan(e); return; }
    if (e.button === 2) { wallStart = null; requestUI(); requestDraw(); return; }

    if (tool === 'select') {
      const L = hitLight(p, s);
      if (L) { select('light', L.id); drag = { type: 'light', id: L.id, ox: p.x - L.x, oy: p.y - L.y }; return; }
      const sel = getSelected();
      if (sel?.kind === 'zone') {
        const c = hitHandle(sel.obj, p, s);
        if (c >= 0) { const f = zoneCorners(sel.obj)[(c + 2) % 4]; drag = { type: 'zone-resize', id: sel.obj.id, fx: f[0], fy: f[1] }; return; }
      }
      if (sel?.kind === 'wall') {
        const end = hitWallEnd(sel.obj, p, s);
        if (end) { drag = { type: 'wall-end', id: sel.obj.id, end }; return; }
      }
      const W = hitWall(p, s);
      if (W) { select('wall', W.id); drag = { type: 'wall-move', id: W.id, last: p }; return; }
      const Z = hitZone(p);
      if (Z && sel?.kind === 'zone' && sel.obj === Z) { drag = { type: 'zone-move', id: Z.id, last: p }; return; }
      startPan(e);
      drag.click = Z ? Z.id : 'none';
      return;
    }

    if (tool === 'light') {
      const L = hitLight(p, s);
      if (L) { select('light', L.id); drag = { type: 'light', id: L.id, ox: p.x - L.x, oy: p.y - L.y }; return; }
      if (p.x < 0 || p.y < 0 || p.x > state.plan.w || p.y > state.plan.h) return; // only on the drawing
      const nl = { id: uid('L'), x: p.x, y: p.y, ...fixtureOf(state.template) };
      state.lights.push(nl);
      select('light', nl.id);
      drag = { type: 'light', id: nl.id, ox: 0, oy: 0, moved: true };
      sync();
      return;
    }

    if (tool === 'wall') {
      const q = snapWall(p, wallStart, e.shiftKey);
      if (wallStart) {
        if (Math.hypot(q.x - wallStart.x, q.y - wallStart.y) > 0.05 * state.pxPerM) {
          state.walls.push({ id: uid('W'), x1: wallStart.x, y1: wallStart.y, x2: q.x, y2: q.y, thick: state.wallThick });
          commit();
          wallStart = { x: q.x, y: q.y };
        } else {
          wallStart = null; // clicking the same point again (double-click) finishes the wall
        }
      } else {
        wallStart = { x: q.x, y: q.y };
      }
      requestUI(); requestDraw();
      return;
    }

    if (tool === 'room') { drag = { type: 'zone-new', x0: p.x, y0: p.y, x1: p.x, y1: p.y }; return; }

    if (tool === 'crop') { drag = { type: 'crop', x0: p.x, y0: p.y, x1: p.x, y1: p.y }; return; }

    if (tool === 'furniture') {
      const sel = getSelected();
      if (sel?.kind === 'furniture') {
        const c = hitHandle(sel.obj, p, s);
        if (c >= 0) { const f = zoneCorners(sel.obj)[(c + 2) % 4]; drag = { type: 'furn-resize', id: sel.obj.id, fx: f[0], fy: f[1] }; return; }
      }
      const F = hitFurniture(p);
      if (F) { select('furniture', F.id); drag = { type: 'furn-move', id: F.id, last: p }; return; }
      drag = { type: 'furn-new', x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      return;
    }

    if (tool === 'scale') {
      if (!scaleA || scaleB) { scaleA = p; scaleB = null; } else { scaleB = p; openScaleDialog(); }
      requestUI(); requestDraw();
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!planImg) return;
    shiftHeld = e.shiftKey;
    const p = toWorld(e);
    hover = p;
    updateReadout(e, p);
    if (!drag) {
      const h = tool === 'select' || tool === 'light' ? hitLight(p, cam.s)?.id || null : null;
      if (h !== hoverLightId) { hoverLightId = h; requestDraw(); }
      if (tool !== 'select') requestDraw();
      updateCursor(p);
      return;
    }
    switch (drag.type) {
      case 'pan': {
        const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        if (drag.moved) autoFit = false;
        cam.x = drag.cx + dx;
        cam.y = drag.cy + dy;
        requestDraw();
        break;
      }
      case 'light': {
        const L = byId(state.lights, drag.id);
        if (!L) break;
        L.x = clamp(p.x - drag.ox, 0, state.plan.w);
        L.y = clamp(p.y - drag.oy, 0, state.plan.h);
        drag.moved = true;
        sync();
        break;
      }
      case 'wall-move': {
        const W = byId(state.walls, drag.id);
        if (!W) break;
        const dx = p.x - drag.last.x, dy = p.y - drag.last.y;
        W.x1 += dx; W.y1 += dy; W.x2 += dx; W.y2 += dy;
        drag.last = p;
        drag.moved = true;
        sync();
        break;
      }
      case 'wall-end': {
        const W = byId(state.walls, drag.id);
        if (!W) break;
        const other = drag.end === 1 ? { x: W.x2, y: W.y2 } : { x: W.x1, y: W.y1 };
        const q = snapWall(p, other, e.shiftKey, W);
        if (drag.end === 1) { W.x1 = q.x; W.y1 = q.y; } else { W.x2 = q.x; W.y2 = q.y; }
        drag.moved = true;
        sync();
        break;
      }
      case 'zone-move':
      case 'furn-move': {
        const Z = rectOf(drag);
        if (!Z) break;
        Z.x += p.x - drag.last.x; Z.y += p.y - drag.last.y;
        drag.last = p;
        drag.moved = true;
        sync();
        break;
      }
      case 'zone-resize':
      case 'furn-resize': {
        const Z = rectOf(drag);
        if (!Z) break;
        Z.x = Math.min(drag.fx, p.x); Z.y = Math.min(drag.fy, p.y);
        Z.w = Math.abs(p.x - drag.fx); Z.h = Math.abs(p.y - drag.fy);
        drag.moved = true;
        sync();
        break;
      }
      case 'zone-new':
      case 'furn-new':
      case 'crop':
        drag.x1 = p.x; drag.y1 = p.y;
        requestDraw();
        break;
    }
  });

  const rectOf = (d) => byId(d.type.startsWith('furn') ? state.furniture : state.zones, d.id);

  function endDrag() {
    const d = drag;
    drag = null;
    if (!d) return;
    if (d.type === 'crop') {
      const r = cropFromDrag(d);
      cropRect = r.w > 20 && r.h > 20 ? r : null;
      requestUI(); requestDraw();
      return;
    }
    if (d.type === 'furn-new') {
      const ppm = state.pxPerM;
      const w = Math.abs(d.x1 - d.x0), h = Math.abs(d.y1 - d.y0);
      if (w > 0.15 * ppm && h > 0.15 * ppm) {
        const F = { id: uid('F'), x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w, h, ...state.furnTemplate };
        state.furniture.push(F);
        select('furniture', F.id);
        commit();
      } else {
        select(null); // a click on empty space
      }
      requestDraw();
      return;
    }
    if (d.type === 'pan') {
      if (!d.moved && d.click) select(d.click === 'none' ? null : 'zone', d.click);
      updateCursor(hover);
      return;
    }
    if (d.type === 'zone-new') {
      const ppm = state.pxPerM;
      const w = Math.abs(d.x1 - d.x0), h = Math.abs(d.y1 - d.y0);
      if (w > 0.3 * ppm && h > 0.3 * ppm) {
        const t = ROOM_TYPES.living;
        const Z = { id: uid('Z'), x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w, h, name: `Room ${state.zones.length + 1}`, type: 'living', target: t.target, u0: t.u0 };
        state.zones.push(Z);
        select('zone', Z.id);
        commit();
      }
      requestDraw();
      return;
    }
    if (d.moved) commit();
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => {
    if (drag) return;
    hover = null;
    hoverLightId = null;
    readout.style.display = 'none';
    requestDraw();
  });

  // Trackpad: two-finger scroll pans, pinch (or ⌘/Ctrl + scroll) zooms.
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.01));
    else { cam.x -= e.deltaX; cam.y -= e.deltaY; autoFit = false; requestDraw(); }
  }, { passive: false });

  // ---------- Scale dialog ----------
  const dlg = $('#scale-dialog');
  function openScaleDialog() {
    const px = Math.hypot(scaleB.x - scaleA.x, scaleB.y - scaleA.y);
    if (px < 5) { scaleA = scaleB = null; toast('Those points are too close together. Try again.'); return; }
    $('#scale-px').textContent = `${Math.round(px)} px`;
    $('#scale-input').value = (px / state.pxPerM).toFixed(2);
    dlg.showModal();
    $('#scale-input').select();
  }
  $('#scale-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const m = num($('#scale-input'));
    if (!(m > 0) || !scaleA || !scaleB) return;
    const px = Math.hypot(scaleB.x - scaleA.x, scaleB.y - scaleA.y);
    const ratio = px / m / state.pxPerM;
    state.pxPerM = px / m;
    state.scaleSet = true;
    state.wallThick = state.wallThick || 0.15;
    for (const W of state.walls) W.thick = W.thick || 0.15;
    dlg.close();
    commit();
    let msg = Math.abs(ratio - 1) < 0.01 ? 'Scale confirmed.' : `Scale set: 1 m = ${state.pxPerM.toFixed(1)} px on the drawing. Now place your lights.`;
    if (!state.furniture.length) {
      const found = detectFurniture();
      if (found.length) {
        state.furniture = found;
        commit();
        msg += ` Found ${found.length} pieces of furniture for the 3D view.`;
      }
    }
    setTool(state.lights.length ? 'select' : 'light');
    toast(msg);
  });
  $('#scale-cancel').addEventListener('click', () => dlg.close());
  $('#crop-apply').addEventListener('click', applyCrop);
  $('#crop-skip').addEventListener('click', skipCrop);
  $('#scale-crop').addEventListener('click', () => setTool('crop'));
  dlg.addEventListener('close', () => { scaleA = scaleB = null; requestDraw(); requestUI(); });

  // ---------- Panels ----------
  const F = {
    type: $('#f-type'), watts: $('#f-watts'), eff: $('#f-eff'), lumens: $('#f-lumens'),
    beam: $('#f-beam'), height: $('#f-height'), cct: $('#f-cct'), length: $('#f-length'), angle: $('#f-angle'),
  };
  const ZF = { name: $('#z-name'), type: $('#z-type'), target: $('#z-target'), u0: $('#z-u0') };
  const UF = { kind: $('#u-kind'), shape: $('#u-shape'), height: $('#u-height') };
  const SF = {
    ceiling: $('#s-ceiling'), workplane: $('#s-workplane'), reflect: $('#s-reflect'), mf: $('#s-mf'),
    voltage: $('#s-voltage'), detail: $('#s-detail'), autoWalls: $('#s-autowalls'), wallSens: $('#s-wallsens'), showWalls: $('#s-showwalls'),
  };
  F.type.innerHTML = Object.entries(PRESETS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('');
  F.cct.innerHTML = Object.keys(CCT_RGB).map((k) => `<option value="${k}">${CCT_LABEL[k]}</option>`).join('');
  UF.kind.innerHTML = Object.entries(FURNITURE).map(([k, t]) => `<option value="${k}">${t.label}${k === 'custom' ? '' : ` · ${t.height} m`}</option>`).join('');
  ZF.type.innerHTML = Object.entries(ROOM_TYPES).map(([k, t]) => `<option value="${k}">${t.label}${k === 'custom' ? '' : ` · ${t.target} lx`}</option>`).join('');

  const setVal = (el, v) => { if (document.activeElement !== el) el.value = v; };

  function refreshHint() {
    const warn = state.plan && !state.scaleSet ? '<span class="warn">Scale not set</span>' : '';
    const hints = {
      select: '<b>Select</b> · click a light, wall or room to edit · drag to move · drag empty space or two-finger scroll to pan · pinch or ⌘ + scroll to zoom',
      light: '<b>Light</b> · click to place a fixture · drag to move it · the settings on the right apply to the next light',
      wall: wallStart
        ? '<b>Wall</b> · click to add the next corner · double-click, right-click or Esc to finish · Shift for 45°'
        : '<b>Wall</b> · click to start a wall where the plan\'s walls weren\'t detected · light can\'t pass through walls',
      room: '<b>Room</b> · drag a rectangle over a room to check its light level against recommendations',
      furniture: '<b>Furniture</b> · drag to add a piece · click one to edit it, drag to move · furniture shows up in 3D',
      crop: '<b>Crop</b> · drag a box around the floor plan to cut away titles, logos and QR codes · Enter to crop',
      scale: scaleA ? '<b>Scale</b> · now click the second point' : '<b>Scale</b> · click two points whose real distance you know, e.g. the ends of a dimension line',
    };
    $('#hint').innerHTML = is3D()
      ? '<b>3D</b> · drag to orbit · right-drag or Shift-drag to pan · scroll or pinch to zoom · click a light to edit it · pick a drawing tool to go back to 2D'
      : warn + hints[tool];
    $('#hint').hidden = !state.plan || !ui.hints;
  }

  function refreshEditor() {
    const sel = getSelected();
    let mode = 'none';
    if (sel) mode = sel.kind;
    else if (tool === 'light' || tool === 'wall' || tool === 'scale' || tool === 'furniture' || tool === 'crop') mode = tool;
    for (const id of ['none', 'light', 'zone', 'wall', 'scale', 'furniture', 'crop']) $(`#ed-${id}`).hidden = id !== mode;
    if (mode === 'crop') $('#crop-apply').disabled = !cropRect;

    if (mode === 'none') {
      $('#ed-none-text').innerHTML = tool === 'room'
        ? 'Drag a rectangle over a room on the plan. You\'ll see its average light level, the darkest spot and whether it meets the recommendation for that type of room.'
        : 'Pick the <b>Light</b> tool (L) and click on the plan to place fixtures, or select anything on the plan to edit it.';
    }

    if (mode === 'light') {
      const L = sel ? sel.obj : state.template;
      $('#ed-light-title').textContent = sel ? 'Selected light' : 'Next light';
      $('#ed-light-sub').textContent = sel ? `${PRESETS[L.type]?.label || 'Fixture'}` : 'Settings for the next light you place';
      $('#light-actions').hidden = !sel;
      setVal(F.type, L.type); setVal(F.watts, L.watts); setVal(F.eff, L.efficacy); setVal(F.lumens, L.lumens);
      setVal(F.beam, L.beam); setVal(F.height, L.height); setVal(F.cct, L.cct);
      const linear = L.length > 0;
      $('#f-shape').hidden = !linear;
      $('#f-width-field').hidden = !(L.width > 0);
      $('#f-rotate').hidden = !(sel && linear);
      if (linear) { setVal(F.length, L.length); setVal(F.angle, L.angle || 0); }
      const V = state.settings.voltage;
      const r = footprintRadius(L);
      const covers = linear
        ? `Beam covers about <b>${(L.length + 2 * r).toFixed(1)} × ${(2 * r).toFixed(1)} m</b> on the work plane (${fmtInt(L.lumens / L.length)} lm per metre). `
        : `Beam covers a circle about <b>Ø ${(2 * r).toFixed(1)} m</b> on the work plane. `;
      $('#f-note').innerHTML = (r ? covers : '<b>Mounted below the work plane</b>, so it won\'t light it. ')
        + `Draws <b>${(L.watts / V).toFixed(2)} A</b> at ${V} V. Brightness depends on lumens, not volts.`;
    }

    if (mode === 'zone') {
      const Z = sel.obj;
      const st = zoneStats.get(Z.id);
      setVal(ZF.name, Z.name); setVal(ZF.type, Z.type); setVal(ZF.target, Z.target); setVal(ZF.u0, Z.u0);
      const has = st && state.lights.length;
      const stat = (label, val, unit = '') => `<div class="stat"><span>${label}</span><b>${val}${unit ? `<small>${unit}</small>` : ''}</b></div>`;
      $('#z-stats').innerHTML = [
        stat('Average', has ? fmtLux(st.avg) : '—', 'lx'),
        stat('Darkest', has ? fmtLux(st.min) : '—', 'lx'),
        stat('Brightest', has ? fmtLux(st.max) : '—', 'lx'),
        stat('Uniformity', has ? st.u0.toFixed(2) : '—'),
        stat('Area', st ? st.area.toFixed(1) : '—', 'm²'),
        stat('Power', st ? st.lpd.toFixed(1) : '—', 'W/m²'),
      ].join('');
      const adv = $('#z-advice');
      adv.className = `advice ${has ? st.status : ''}`;
      adv.innerHTML = zoneAdvice(Z, st);
    }

    if (mode === 'wall') {
      const W = sel ? sel.obj : null;
      $('#ed-wall-title').textContent = W ? 'Selected wall' : 'New wall';
      $('#wall-actions').hidden = !W;
      setVal($('#w-thick'), W ? W.thick : state.wallThick);
      $('#w-note').innerHTML = W
        ? `Length <b>${(Math.hypot(W.x2 - W.x1, W.y2 - W.y1) / state.pxPerM).toFixed(2)} m</b>. Drag the wall to move it, or drag its ends.`
        : 'Most plans with solid black walls are detected automatically. Draw walls here when they aren\'t, e.g. walls drawn as two thin lines.';
    }

    if (mode === 'furniture') {
      const Fu = sel ? sel.obj : state.furnTemplate;
      const ppm = state.pxPerM;
      $('#ed-furn-title').textContent = sel ? 'Selected furniture' : 'New furniture';
      $('#ed-furn-sub').textContent = sel
        ? `${(Fu.w / ppm).toFixed(2)} × ${(Fu.h / ppm).toFixed(2)} m`
        : 'Drag on the plan to add a piece';
      $('#furn-actions').hidden = !sel;
      setVal(UF.kind, Fu.kind); setVal(UF.shape, Fu.shape); setVal(UF.height, Fu.height);
      const n = state.furniture.length;
      $('#u-note').innerHTML = `<b>${n}</b> ${n === 1 ? 'piece' : 'pieces'} on this plan. In 3D they're coloured by the light falling on them.`;
    }

    if (mode === 'scale') {
      $('#scale-note').innerHTML = `${state.scaleSet ? 'Current scale' : '<b>Estimated scale</b>'}: 1 m = <b>${state.pxPerM.toFixed(1)} px</b> on the drawing.<br><br>`
        + 'Click two points on the plan whose real distance you know, such as the ends of a dimension line or the length of a wall, then type that distance.';
    }
  }

  function zoneAdvice(Z, st) {
    const typeLabel = (ROOM_TYPES[Z.type]?.label || 'this room').toLowerCase();
    if (!st || !state.lights.length) return 'Place some lights to see results.';
    if (!st.n) return 'This area is entirely covered by walls.';
    if (st.status === 'low') {
      if (!st.lumens) return `No lights inside this room. It only gets <b>${fmtLux(st.avg)} lx</b> of spill light from next door, but ${typeLabel} needs ${Z.target} lx.`;
      const extra = st.lumens * (Z.target / Math.max(st.avg, 1) - 1);
      const each = st.lumens / st.count; // average fixture already used in this room
      const n = Math.ceil(extra / each);
      return `Average <b>${fmtLux(st.avg)} lx</b> is below the ${Z.target} lx recommended for ${typeLabel}. You need roughly <b>+${fmtInt(extra)} lm</b>, about ${n} more ${n === 1 ? 'fixture' : 'fixtures'} like the ${st.count === 1 ? 'one' : 'ones'} in this room (${fmtInt(each)} lm each).`;
    }
    if (st.status === 'uneven') {
      return `The average is fine, but the darkest spot is only <b>${fmtLux(st.min)} lx</b> (uniformity ${st.u0.toFixed(2)}, needs ${Z.u0}). Spread fixtures more evenly or use wider beams.`;
    }
    if (st.status === 'high') {
      const saving = st.watts * (1 - (Z.target * 1.2) / st.avg);
      return `About <b>${(st.avg / Z.target).toFixed(1)}×</b> the recommendation. Dimmer fixtures could save roughly <b>${fmtInt(Math.max(saving, 0))} W</b>.`;
    }
    return `Meets the ${Z.target} lx recommendation for ${typeLabel}${Z.u0 ? ` with uniformity ${st.u0.toFixed(2)}` : ''}.`;
  }

  let zoneListHtml = '';
  function refreshZoneList() {
    $('#zone-count').textContent = state.zones.length ? state.zones.length : '';
    const el = $('#zone-list');
    const selId = selection?.kind === 'zone' ? selection.id : null;
    const html = !state.zones.length
      ? '<p class="note">Use the <b>Room</b> tool (R) to draw an area and check it against recommended light levels.</p>'
      : state.zones.map((Z) => {
        const st = zoneStats.get(Z.id);
        const status = st && state.lights.length ? st.status : 'na';
        const val = status !== 'na' ? fmtLux(st.avg) : '—';
        return `<button class="zone-row${Z.id === selId ? ' selected' : ''}" data-id="${Z.id}">
          <span class="zr-dot ${status}"></span>
          <span class="zr-main"><span class="zr-name">${esc(Z.name)}</span><span class="zr-sub">${esc(ROOM_TYPES[Z.type]?.label || 'Custom')} · target ${Z.target} lx</span></span>
          <span class="zr-val"><b>${val}</b> lx<span class="chip ${status}">${STATUS_LABEL[status]}</span></span>
        </button>`;
      }).join('');
    // Only touch the DOM when something changed, so clicks aren't lost to a re-render.
    if (html !== zoneListHtml) { zoneListHtml = html; el.innerHTML = html; }
  }

  function refreshSettings() {
    const S = state.settings;
    setVal(SF.ceiling, S.ceiling); setVal(SF.workplane, S.workplane); setVal(SF.reflect, String(S.reflect));
    setVal(SF.mf, S.mf); setVal(SF.voltage, S.voltage); setVal(SF.detail, S.detail);
    SF.autoWalls.checked = S.autoWalls;
    setVal(SF.wallSens, S.wallSens);
    SF.wallSens.disabled = !S.autoWalls;
    SF.showWalls.checked = state.view.showWalls;
    $('#s-note').innerHTML = state.plan
      ? `Scale 1 m = ${state.pxPerM.toFixed(1)} px${state.scaleSet ? '' : ' <b>(estimated, set it with the Scale tool)</b>'}`
        + (grid ? ` · calculation grid ${Math.round(grid.cs * 100)} cm (${grid.nx}×${grid.ny} points)` : '')
      : '';
  }

  function refreshView() {
    const V = state.view;
    $$('#dim-seg button').forEach((b) => b.classList.toggle('active', b.dataset.dim === V.dim));
    $('#zoom-fit').textContent = V.dim === '3d' ? 'Reset' : 'Fit';
    $$('#mode-seg button').forEach((b) => b.classList.toggle('active', b.dataset.mode === V.mode));
    $('#opts-lux').hidden = V.mode !== 'lux';
    $('#opts-real').hidden = V.mode !== 'real';
    $('#opts-3d').hidden = V.dim !== '3d';
    $('#view-panels').hidden = !ui.options;
    $('#btn-opts').classList.toggle('active', ui.options);
    $('#btn-opts').setAttribute('aria-pressed', String(ui.options));
    $('#ui-hints').checked = ui.hints;
    $('#ui-legend').checked = ui.legend;
    $('#ui-labels').checked = ui.labels;
    $('#v-cut').checked = !!V.cutWalls;
    $('#v-furn').checked = V.showFurniture !== false;
    setVal($('#v-opacity'), V.opacity);
    setVal($('#v-scale'), String(V.scaleMax));
    $('#v-bands').checked = V.bands;
    setVal($('#v-exposure'), V.exposure);
  }

  function refreshTotals() {
    const n = state.lights.length;
    const W = state.lights.reduce((a, L) => a + L.watts, 0);
    const lm = state.lights.reduce((a, L) => a + L.lumens, 0);
    const V = state.settings.voltage;
    $('#totals').innerHTML = state.plan
      ? `<b>${n}</b> ${n === 1 ? 'light' : 'lights'} · <b>${fmtInt(W)}</b> W · <b>${(W / V).toFixed(2)}</b> A @ ${V} V · <b>${fmtInt(lm)}</b> lm`
      : '';
  }

  let legendSig = '';
  function refreshLegend() {
    const el = $('#legend');
    const show = ui.legend && !!state.plan && state.view.mode === 'lux' && state.lights.length > 0;
    el.hidden = !show;
    if (!show) return;
    const sig = `${scaleMax}|${state.view.bands}`;
    if (sig === legendSig) return;
    legendSig = sig;
    const bar = state.view.bands
      ? BAND_RGB.map((c) => `<span style="background:rgb(${c.join(',')})"></span>`).join('')
      : `<span style="background:linear-gradient(90deg,${PALETTE.map(([t, h]) => `${h} ${t * 100}%`).join(',')})"></span>`;
    const ticks = Array.from({ length: 6 }, (_, i) => `<span>${fmtInt((scaleMax * i) / 5)}</span>`).join('');
    el.innerHTML = `<div class="legend-title">Illuminance on the work plane (lux)</div><div class="legend-bar">${bar}</div><div class="legend-ticks">${ticks}</div>`;
  }

  function refreshCalcStatus() {
    $('#calc-status').innerHTML = calcPending
      ? `<span class="spinner"></span>Calculating…`
      : '';
  }

  function refreshUI() {
    $$('.tool[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
    $('#btn-undo').disabled = hist.idx <= 0;
    $('#btn-redo').disabled = hist.idx >= hist.stack.length - 1;
    $('#empty').hidden = !!planImg;
    if (focusZoneId && !focusZone()) focusZoneId = null; // the room was deleted
    $('#focus-chip').hidden = !focusZoneId;
    if (focusZoneId) $('#focus-name').textContent = focusZone().name;
    refreshHint();
    refreshEditor();
    refreshZoneList();
    refreshSettings();
    refreshView();
    refreshTotals();
    refreshLegend();
    refreshCalcStatus();
  }

  // ---------- Panel bindings ----------
  function editLight(fn) {
    const sel = getSelected();
    const L = sel?.kind === 'light' ? sel.obj : state.template;
    fn(L);
    if (L !== state.template) Object.assign(state.template, fixtureOf(L));
    sync();
  }
  F.type.addEventListener('change', () => {
    editLight((L) => {
      L.type = F.type.value;
      if (L.type === 'custom') return;
      const p = PRESETS[L.type];
      L.watts = p.watts; L.efficacy = p.efficacy; L.lumens = Math.round(p.watts * p.efficacy); L.beam = p.beam;
      L.height = Math.round((state.settings.ceiling - (p.drop || 0)) * 100) / 100;
      L.length = p.length || 0;
      L.angle = L.angle || 0;
    });
    pushHistory();
  });
  F.watts.addEventListener('input', () => editLight((L) => { const v = num(F.watts); if (v > 0) { L.watts = v; L.lumens = Math.round(v * L.efficacy); } }));
  F.eff.addEventListener('input', () => editLight((L) => { const v = num(F.eff); if (v > 0) { L.efficacy = v; L.lumens = Math.round(L.watts * v); } }));
  F.lumens.addEventListener('input', () => editLight((L) => { const v = num(F.lumens); if (v > 0) { L.lumens = v; L.efficacy = Math.round((v / L.watts) * 10) / 10; } }));
  F.beam.addEventListener('input', () => editLight((L) => { const v = num(F.beam); if (v >= 5) L.beam = clamp(v, 5, 170); }));
  F.height.addEventListener('input', () => editLight((L) => { const v = num(F.height); if (v > 0) L.height = clamp(v, 0.1, 50); }));
  F.cct.addEventListener('change', () => { editLight((L) => { L.cct = +F.cct.value; }); pushHistory(); });
  F.length.addEventListener('input', () => editLight((L) => { const v = num(F.length); if (v > 0) L.length = clamp(v, 0.1, 20); }));
  F.angle.addEventListener('input', () => editLight((L) => { const v = num(F.angle); if (Number.isFinite(v)) L.angle = v; }));
  $('#f-rotate').addEventListener('click', () => { editLight((L) => { L.angle = (((L.angle || 0) + 90) % 180 + 180) % 180; }); pushHistory(); });
  for (const el of [F.watts, F.eff, F.lumens, F.beam, F.height, F.length, F.angle]) el.addEventListener('change', () => { pushHistory(); requestUI(); });

  function editZone(fn) { const sel = getSelected(); if (sel?.kind === 'zone') { fn(sel.obj); sync(); } }
  ZF.name.addEventListener('input', () => editZone((Z) => { Z.name = ZF.name.value || 'Room'; }));
  ZF.type.addEventListener('change', () => {
    editZone((Z) => { const t = ROOM_TYPES[ZF.type.value]; Z.type = ZF.type.value; Z.target = t.target; Z.u0 = t.u0; if (/^Room \d+$/.test(Z.name) && Z.type !== 'custom') Z.name = t.label; });
    pushHistory();
  });
  ZF.target.addEventListener('input', () => editZone((Z) => { const v = num(ZF.target); if (v > 0) Z.target = v; }));
  ZF.u0.addEventListener('input', () => editZone((Z) => { const v = num(ZF.u0); if (v >= 0 && v <= 1) Z.u0 = v; }));
  for (const el of [ZF.name, ZF.target, ZF.u0]) el.addEventListener('change', () => { pushHistory(); requestUI(); });

  $('#w-thick').addEventListener('input', () => {
    const v = num($('#w-thick'));
    if (!(v > 0)) return;
    const sel = getSelected();
    if (sel?.kind === 'wall') sel.obj.thick = clamp(v, 0.02, 2);
    state.wallThick = clamp(v, 0.02, 2);
    sync();
  });
  $('#w-thick').addEventListener('change', () => pushHistory());

  function editFurniture(fn) {
    const sel = getSelected();
    const Fu = sel?.kind === 'furniture' ? sel.obj : state.furnTemplate;
    fn(Fu);
    if (Fu !== state.furnTemplate) Object.assign(state.furnTemplate, { kind: Fu.kind, shape: Fu.shape, height: Fu.height });
    sync();
  }
  UF.kind.addEventListener('change', () => {
    editFurniture((Fu) => { Fu.kind = UF.kind.value; if (Fu.kind !== 'custom') Fu.height = FURNITURE[Fu.kind].height; });
    pushHistory();
  });
  UF.shape.addEventListener('change', () => { editFurniture((Fu) => { Fu.shape = UF.shape.value; }); pushHistory(); });
  UF.height.addEventListener('input', () => editFurniture((Fu) => { const v = num(UF.height); if (v > 0) Fu.height = clamp(v, 0.05, 6); }));
  UF.height.addEventListener('change', () => { pushHistory(); requestUI(); });
  $('#furn-del').addEventListener('click', deleteSelection);
  $('#furn-detect').addEventListener('click', () => {
    if (!state.plan) return;
    if (state.furniture.length && !confirm('Replace the current furniture with what can be found on the plan?')) return;
    const found = detectFurniture();
    state.furniture = found;
    if (selection?.kind === 'furniture') selection = null;
    commit();
    toast(found.length
      ? `Found ${found.length} pieces of furniture. Check their type and height with the Furniture tool.`
      : 'No furniture outlines found on this plan. Drag with the Furniture tool to add pieces.');
  });
  $('#furn-clear').addEventListener('click', () => {
    if (!state.furniture.length) return;
    state.furniture = [];
    if (selection?.kind === 'furniture') selection = null;
    commit();
    toast('Furniture removed. Undo (⌘Z) brings it back.');
  });

  $('#light-dup').addEventListener('click', duplicateLight);
  $('#light-del').addEventListener('click', deleteSelection);
  $('#zone-del').addEventListener('click', deleteSelection);
  $('#wall-del').addEventListener('click', deleteSelection);

  // Clicking a room in the list shows that room on its own; clicking it again shows all rooms.
  $('#zone-list').addEventListener('click', (e) => {
    const row = e.target.closest('.zone-row');
    if (!row) return;
    if (tool !== 'select') setTool('select');
    focusRoom(focusZoneId === row.dataset.id ? null : row.dataset.id);
  });
  $('#focus-exit').addEventListener('click', () => focusRoom(null));

  SF.ceiling.addEventListener('input', () => {
    const v = num(SF.ceiling);
    if (!(v >= 1)) return;
    const old = state.settings.ceiling;
    // Ceiling-mounted fixtures follow the ceiling.
    for (const L of [...state.lights, state.template]) if (Math.abs(L.height - old) < 1e-6) L.height = v;
    state.settings.ceiling = v;
    sync();
  });
  SF.workplane.addEventListener('input', () => { const v = num(SF.workplane); if (v >= 0) { state.settings.workplane = v; sync(); } });
  SF.reflect.addEventListener('change', () => { state.settings.reflect = +SF.reflect.value; commit(); });
  SF.mf.addEventListener('input', () => { const v = num(SF.mf); if (v > 0 && v <= 1) { state.settings.mf = v; sync(); } });
  SF.voltage.addEventListener('input', () => { const v = num(SF.voltage); if (v > 0) { state.settings.voltage = v; sync(); } });
  SF.detail.addEventListener('change', () => { state.settings.detail = SF.detail.value; commit(); });
  SF.autoWalls.addEventListener('change', () => { state.settings.autoWalls = SF.autoWalls.checked; commit(); });
  SF.wallSens.addEventListener('input', () => { state.settings.wallSens = num(SF.wallSens); sync(); });
  SF.showWalls.addEventListener('change', () => { state.view.showWalls = SF.showWalls.checked; requestDraw(); queueAutosave(); });
  for (const el of [SF.ceiling, SF.workplane, SF.mf, SF.voltage, SF.wallSens]) el.addEventListener('change', () => { pushHistory(); requestUI(); });

  $$('#mode-seg button').forEach((b) => b.addEventListener('click', () => { state.view.mode = b.dataset.mode; refreshViz(); }));
  $('#v-opacity').addEventListener('input', (e) => { state.view.opacity = num(e.target); refreshViz(); });
  $('#v-scale').addEventListener('change', (e) => { state.view.scaleMax = e.target.value === 'auto' ? 'auto' : +e.target.value; refreshViz(); });
  $('#v-bands').addEventListener('change', (e) => { state.view.bands = e.target.checked; refreshViz(); });
  $('#v-exposure').addEventListener('input', (e) => { state.view.exposure = num(e.target); refreshViz(); });
  $('#v-cut').addEventListener('change', (e) => { state.view.cutWalls = e.target.checked; requestDraw(); queueAutosave(); });
  $('#v-furn').addEventListener('change', (e) => { state.view.showFurniture = e.target.checked; requestDraw(); queueAutosave(); });

  $$('.tool[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
  $('#btn-undo').addEventListener('click', undo);
  $('#btn-redo').addEventListener('click', redo);
  $('#zoom-in').addEventListener('click', () => zoomBy(1.25));
  $('#zoom-out').addEventListener('click', () => zoomBy(0.8));
  $('#zoom-fit').addEventListener('click', fitAny);
  $('#view-top').addEventListener('click', () => view3d?.resetView(true));
  $$('#dim-seg button').forEach((b) => b.addEventListener('click', () => setDim(b.dataset.dim)));
  $('#btn-opts').addEventListener('click', () => setUi({ options: !ui.options }));
  $('#ui-hints').addEventListener('change', (e) => setUi({ hints: e.target.checked }));
  $('#ui-legend').addEventListener('change', (e) => setUi({ legend: e.target.checked }));
  $('#ui-labels').addEventListener('change', (e) => { setUi({ labels: e.target.checked }); refreshViz(); });

  // ---------- Files ----------
  const toastEl = $('#toast');
  let toastTimer = 0;
  function toast(msg, kind = '') {
    toastEl.textContent = msg;
    toastEl.className = `toast show ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.className = 'toast'; }, 3600);
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  const baseName = () => (state.plan?.name || 'lighting-project').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'lighting-project';

  function projectData() {
    return {
      app: 'light-simulator', version: 1,
      plan: state.plan, pxPerM: state.pxPerM, scaleSet: state.scaleSet,
      settings: state.settings, view: state.view, template: state.template, wallThick: state.wallThick,
      lights: state.lights, walls: state.walls, zones: state.zones, furniture: state.furniture, furnTemplate: state.furnTemplate,
    };
  }

  let saveTimer = 0;
  function queueAutosave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!state.plan) return;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(projectData())); } catch (e) { /* storage full or blocked: use Save instead */ }
    }, 800);
  }

  function setPlan(src, name) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        planImg = img;
        state.plan = { src, w: img.naturalWidth, h: img.naturalHeight, name: name || 'Plan' };
        planToken++;
        cache.clear();
        resolve();
      };
      img.onerror = () => reject(new Error('the image could not be read'));
      img.src = src;
    });
  }

  function bumpIds() {
    let max = 0;
    for (const o of [...state.lights, ...state.walls, ...state.zones, ...state.furniture]) {
      const n = parseInt(String(o.id).replace(/\D/g, ''), 10);
      if (n > max) max = n;
    }
    idCounter = max + 1;
  }

  async function loadProject(data) {
    if (!data || !data.plan || !data.plan.src) throw new Error('this is not a Light Simulator project');
    await setPlan(data.plan.src, data.plan.name);
    state.pxPerM = data.pxPerM || 80;
    state.scaleSet = !!data.scaleSet;
    state.settings = { ...DEFAULT_SETTINGS, ...data.settings };
    state.view = { ...DEFAULT_VIEW, ...data.view };
    state.template = { ...DEFAULT_TEMPLATE, ...data.template };
    state.wallThick = data.wallThick || 0.15;
    state.lights = data.lights || [];
    state.walls = data.walls || [];
    state.zones = data.zones || [];
    state.furniture = data.furniture || [];
    state.furnTemplate = { kind: 'table', shape: 'box', height: 0.75, ...data.furnTemplate };
    bumpIds();
    selection = null;
    resetHistory();
    fitView();
    setDim(state.view.dim);
    sync();
  }

  const readAs = (file, how) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('the file could not be read'));
    r[how](file);
  });

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('the PDF reader could not be loaded (are you online?)'));
      document.head.appendChild(s);
    });
  }

  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';
  async function pdfToDataURL(file) {
    if (!window.pdfjsLib) {
      await loadScript(`${PDFJS}/pdf.min.js`);
      try {
        // Load the worker through a blob URL so it also works when the page is opened as a local file.
        const src = await (await fetch(`${PDFJS}/pdf.worker.min.js`)).text();
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      } catch (e) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS}/pdf.worker.min.js`;
      }
    }
    const doc = await window.pdfjsLib.getDocument({ data: await readAs(file, 'readAsArrayBuffer') }).promise;
    const n = await choosePdfPage(doc);
    if (!n) return null; // cancelled
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    // Large, because presentations often use only part of the page for the plan (cropped next).
    const viewport = page.getViewport({ scale: Math.min(8, 4000 / Math.max(base.width, base.height)) });
    const c = document.createElement('canvas');
    c.width = Math.round(viewport.width);
    c.height = Math.round(viewport.height);
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, viewport }).promise;
    return c.toDataURL('image/png');
  }

  // Multi-page PDFs (presentations, drawing sets): let the user pick the page with the plan.
  function choosePdfPage(doc) {
    return new Promise((resolve) => {
      if (doc.numPages === 1) { resolve(1); return; }
      const pdlg = $('#page-dialog'), grid = $('#page-grid');
      $('#page-count').textContent = doc.numPages;
      grid.innerHTML = '';
      let done = false;
      const finish = (n) => { if (done) return; done = true; if (pdlg.open) pdlg.close(); resolve(n); };
      for (let i = 1; i <= doc.numPages; i++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'page-thumb';
        btn.innerHTML = `<canvas></canvas><span>Page ${i}</span>`;
        btn.addEventListener('click', () => finish(i));
        grid.appendChild(btn);
      }
      $('#page-cancel').onclick = () => finish(0);
      pdlg.onclose = () => finish(0); // Esc
      pdlg.showModal();
      (async () => {
        for (let i = 1; i <= doc.numPages && !done; i++) {
          const page = await doc.getPage(i);
          const vp = page.getViewport({ scale: 1 });
          const view = page.getViewport({ scale: 240 / vp.width });
          const cv = grid.children[i - 1].querySelector('canvas');
          cv.width = Math.round(view.width);
          cv.height = Math.round(view.height);
          await page.render({ canvasContext: cv.getContext('2d'), viewport: view }).promise;
        }
      })().catch((e) => console.warn(e));
    });
  }

  // PNG, unless it gets too big for the browser's autosave; then a high-quality JPEG.
  function encodePlan(c) {
    const png = c.toDataURL('image/png');
    return png.length > 3_500_000 ? c.toDataURL('image/jpeg', 0.92) : png;
  }

  // Flatten onto white and cap the size so the calculation and autosave stay fast.
  function normalizeImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 4000 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * k));
        c.height = Math.max(1, Math.round(img.naturalHeight * k));
        const g = c.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, c.width, c.height);
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, 0, 0, c.width, c.height);
        resolve(encodePlan(c));
      };
      img.onerror = () => reject(new Error('this file type isn\'t supported. Use PNG, JPG or PDF'));
      img.src = src;
    });
  }

  const isSample = () => state.plan?.name === 'Sample apartment';

  async function handlePlanFile(file) {
    if (!file) return;
    if (/\.json$/i.test(file.name) || file.type === 'application/json') { openProjectFile(file); return; }
    if (state.lights.length && !isSample() && !confirm('Start a new project with this plan? Unsaved changes to the current project will be lost.')) return;
    try {
      toast('Loading plan…');
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      const raw = isPdf ? await pdfToDataURL(file) : await readAs(file, 'readAsDataURL');
      if (!raw) { toast('Upload cancelled.'); return; }
      const src = await normalizeImage(raw);
      await setPlan(src, file.name.replace(/\.[^.]+$/, ''));
      state.pxPerM = state.plan.w / 15; // rough guess until the scale is set
      state.scaleSet = false;
      state.lights = []; state.walls = []; state.zones = []; state.furniture = [];
      selection = null;
      resetHistory();
      fitView();
      setTool('crop');
      sync();
      toast('Plan loaded. Drag a box around the floor plan to cut away everything else, or press Skip.');
    } catch (err) {
      console.error(err);
      toast(`Couldn't open that file: ${err.message}.`, 'error');
    }
  }

  async function openProjectFile(file) {
    try {
      await loadProject(JSON.parse(await readAs(file, 'readAsText')));
      setTool('select');
      toast(`Opened “${state.plan.name}”.`);
    } catch (err) {
      console.error(err);
      toast(`Couldn't open that project: ${err.message}.`, 'error');
    }
  }

  function saveProject() {
    if (!state.plan) { toast('Nothing to save yet.'); return; }
    download(new Blob([JSON.stringify(projectData())], { type: 'application/json' }), `${baseName()}.lightsim.json`);
    toast('Project saved to your Downloads.');
  }

  function drawLegendCanvas(g, x, y, w) {
    g.textAlign = 'left';
    g.textBaseline = 'top';
    g.fillStyle = '#e7e9ee';
    g.font = `600 12px ${FONT}`;
    g.fillText('Illuminance on the work plane (lux)', x, y);
    const by = y + 20, bh = 10;
    if (state.view.bands) {
      BAND_RGB.forEach((c, b) => { g.fillStyle = `rgb(${c.join(',')})`; g.fillRect(x + (b * w) / BANDS, by, w / BANDS + 0.5, bh); });
    } else {
      const grd = g.createLinearGradient(x, 0, x + w, 0);
      for (const [t, h] of PALETTE) grd.addColorStop(t, h);
      g.fillStyle = grd;
      g.fillRect(x, by, w, bh);
    }
    g.fillStyle = '#8c94a3';
    g.font = `500 11px ${FONT}`;
    for (let i = 0; i <= 5; i++) {
      g.textAlign = i === 0 ? 'left' : i === 5 ? 'right' : 'center';
      g.fillText(fmtInt((scaleMax * i) / 5), x + (w * i) / 5, by + bh + 5);
    }
  }

  function exportPNG() {
    if (!planImg) return;
    const { w, h } = state.plan;
    const shot = is3D() ? view3d.snapshot() : null; // the current 3D view, as a canvas
    const FZ = focusZone(), fm = 0.4 * state.pxPerM;
    const area = FZ ? { x: FZ.x - fm, y: FZ.y - fm, w: FZ.w + 2 * fm, h: FZ.h + 2 * fm } : { x: 0, y: 0, w, h };
    const k = clamp(2400 / Math.max(area.w, area.h), 1, 3);
    const bodyW = shot ? shot.width : Math.round(area.w * k);
    const bodyH = shot ? shot.height : Math.round(area.h * k);
    const ui = Math.max(1.4, bodyW / 1300); // labels and footer scale with the image
    const footer = Math.round(64 * ui);
    const c = document.createElement('canvas');
    c.width = bodyW;
    c.height = bodyH + footer;
    const g = c.getContext('2d');
    g.fillStyle = '#0e1014';
    g.fillRect(0, 0, c.width, c.height);
    if (shot) {
      g.drawImage(shot, 0, 0);
    } else {
      g.setTransform(k, 0, 0, k, -area.x * k, -area.y * k);
      renderScene(g, k / ui, { ui: false });
      if (FZ) drawFocusMask(g);
    }
    g.setTransform(ui, 0, 0, ui, 0, bodyH);
    const fw = c.width / ui;
    if (state.view.mode === 'lux' && state.lights.length) drawLegendCanvas(g, 16, 12, Math.min(320, fw * 0.45));
    const n = state.lights.length;
    const W = state.lights.reduce((a, L) => a + L.watts, 0);
    const lm = state.lights.reduce((a, L) => a + L.lumens, 0);
    g.textAlign = 'right';
    g.textBaseline = 'top';
    g.fillStyle = '#e7e9ee';
    g.font = `600 12px ${FONT}`;
    g.fillText(`${n} ${n === 1 ? 'light' : 'lights'} · ${fmtInt(W)} W · ${fmtInt(lm)} lm`, fw - 16, 14);
    g.fillStyle = '#8c94a3';
    g.font = `500 11px ${FONT}`;
    g.fillText(`Ceiling ${state.settings.ceiling} m · work plane ${state.settings.workplane} m · indicative calculation`, fw - 16, 34);
    const suffix = `${state.view.mode === 'lux' ? 'lux-map' : 'preview'}${shot ? '-3d' : ''}`;
    c.toBlob((b) => { download(b, `${baseName()}-${suffix}.png`); toast('Image saved to your Downloads.'); });
  }

  $('#btn-upload').addEventListener('click', () => $('#file-plan').click());
  $('#file-plan').addEventListener('change', (e) => { handlePlanFile(e.target.files[0]); e.target.value = ''; });
  $('#btn-open').addEventListener('click', () => $('#file-project').click());
  $('#file-project').addEventListener('change', (e) => { if (e.target.files[0]) openProjectFile(e.target.files[0]); e.target.value = ''; });
  $('#btn-save').addEventListener('click', saveProject);
  $('#btn-export').addEventListener('click', exportPNG);

  const clearDlg = $('#clear-dialog');
  $('#btn-clear').addEventListener('click', () => { if (state.plan) clearDlg.showModal(); });
  $('#clear-cancel').addEventListener('click', () => clearDlg.close());
  $$('#clear-dialog [data-clear]').forEach((b) => b.addEventListener('click', () => clearProject(b.dataset.clear)));
  function clearProject(what) {
    clearDlg.close();
    if (what === 'lights' || what === 'items') {
      const n = state.lights.length;
      state.lights = [];
      if (what === 'items') { state.zones = []; state.walls = []; state.furniture = []; }
      selection = null;
      commit();
      toast(what === 'lights' ? `Removed ${n} ${n === 1 ? 'light' : 'lights'}. Undo with ⌘Z.` : 'Removed everything you added. Undo with ⌘Z.');
      return;
    }
    // Start over: an empty project, back at the upload screen.
    if (state.view.dim === '3d') setDim('2d');
    planImg = null;
    state.plan = null;
    planToken++;
    state.lights = []; state.zones = []; state.walls = []; state.furniture = [];
    state.pxPerM = 80;
    state.scaleSet = false;
    state.settings = { ...DEFAULT_SETTINGS };
    state.template = { ...DEFAULT_TEMPLATE };
    selection = null;
    cache.clear();
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* storage blocked */ }
    resetHistory();
    setTool('select');
    sync();
    toast('Started over. Upload a plan to begin.');
  }
  $('#btn-sample').addEventListener('click', () => {
    if (state.lights.length && !isSample() && !confirm('Replace the current project with the sample apartment? Save first if you want to keep it.')) return;
    loadSample();
  });
  $$('#empty [data-action]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.action === 'upload') $('#file-plan').click(); else loadSample();
  }));

  let dragDepth = 0;
  stage.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('#drop').classList.add('show'); });
  stage.addEventListener('dragover', (e) => e.preventDefault());
  stage.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#drop').classList.remove('show'); } });
  stage.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    $('#drop').classList.remove('show');
    handlePlanFile(e.dataTransfer.files[0]);
  });

  // ---------- Keyboard ----------
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    const typing = (t.tagName === 'INPUT' && !['range', 'checkbox'].includes(t.type)) || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA';
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && key === 's') { e.preventDefault(); saveProject(); return; }
    if (typing || document.querySelector('dialog[open]')) return;
    if (e.key === 'Enter' && tool === 'crop' && cropRect) { e.preventDefault(); applyCrop(); return; }
    if (mod && key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && key === 'y') { e.preventDefault(); redo(); return; }
    if (mod && key === 'd') { e.preventDefault(); duplicateLight(); return; }
    if (mod) return;
    if (e.key === ' ') { e.preventDefault(); if (!spaceHeld) { spaceHeld = true; updateCursor(hover); } return; }
    if (e.key === 'Shift') { shiftHeld = true; requestDraw(); }
    if (key === 'o') { setUi({ options: !ui.options }); return; }
    const tools = { v: 'select', l: 'light', w: 'wall', r: 'room', b: 'furniture', s: 'scale' };
    if (tools[key]) { setTool(tools[key]); return; }
    if (key === 'f') { fitAny(); return; }
    if (e.key === '+' || e.key === '=') { zoomBy(1.25); return; }
    if (e.key === '-' || e.key === '_') { zoomBy(0.8); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); return; }
    if (e.key === 'Escape') {
      if (focusZoneId && !drag && !wallStart && !scaleA) { focusRoom(null); return; }
      if (drag?.type === 'zone-new' || drag?.type === 'furn-new' || drag?.type === 'crop') { drag = null; requestDraw(); }
      else if (tool === 'crop' && cropRect) { cropRect = null; requestUI(); requestDraw(); }
      else if (wallStart) { wallStart = null; requestUI(); requestDraw(); }
      else if (scaleA) { scaleA = scaleB = null; requestUI(); requestDraw(); }
      else select(null);
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === ' ') { spaceHeld = false; updateCursor(hover); }
    if (e.key === 'Shift') { shiftHeld = false; requestDraw(); }
  });

  // ---------- Sample apartment ----------
  // The sample's furniture with proper types and heights (uploaded plans use detectFurniture).
  function sampleFurniture(X, Y, Lm) {
    const f = (kind, x, y, w, h, o = {}) => ({
      id: uid('F'), x: X(x), y: Y(y), w: Lm(w), h: Lm(h), shape: o.round ? 'round' : 'box', kind, height: o.height ?? FURNITURE[kind].height,
    });
    return [
      f('sofa', 0.9, 4.2, 3.2, 0.9),
      f('low', 1.8, 3.0, 1.4, 0.65),
      f('sofa', 4.15, 2.4, 0.9, 0.9),
      f('low', 1.3, 0.3, 2.6, 0.38, { height: 0.5 }),
      f('table', 5.75, 2.15, 1.1, 1.1, { round: true }),
      ...[[6.3, 1.85], [6.3, 3.55], [5.45, 2.7], [7.15, 2.7]].map(([cx, cy]) => f('chair', cx - 0.22, cy - 0.22, 0.44, 0.44)),
      f('counter', 8.2, 0.25, 5.55, 0.62),
      f('counter', 13.13, 0.87, 0.62, 3.0),
      f('counter', 9.6, 2.4, 2.4, 0.9),
      f('tall', 8.2, 4.55, 0.75, 0.75, { height: 1.85 }),
      f('bed', 1.0, 6.4, 1.8, 2.1),
      f('low', 0.4, 6.45, 0.45, 0.45, { height: 0.5 }),
      f('low', 2.95, 6.45, 0.45, 0.45, { height: 0.5 }),
      f('tall', 3.75, 7.3, 0.58, 1.95),
      f('counter', 6.95, 7.4, 0.38, 1.6),
      f('low', 7.75, 8.55, 2.05, 0.75, { height: 0.55 }),
      f('counter', 8.95, 5.72, 0.8, 0.45, { height: 0.85 }),
      f('chair', 9.07, 7.15, 0.56, 0.4, { round: true, height: 0.4 }),
      f('custom', 9.62, 7.1, 0.18, 0.5, { height: 0.8 }),
      f('table', 10.7, 8.6, 2.2, 0.68),
      f('chair', 11.53, 7.88, 0.54, 0.54, { round: true }),
      f('tall', 10.12, 7.0, 0.35, 2.0),
    ];
  }
  function makeSample() {
    const M = 80, O = 1, BW = 14, BH = 9.5;
    const w = (BW + 2 * O) * M, h = (BH + 2 * O) * M;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    const X = (v) => (v + O) * M, Y = (v) => (v + O) * M, Lm = (v) => v * M;
    const INK = '#20242c', THIN = '#6f7784';
    const EXT = 0.25, INT = 0.12;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);

    const line = (x0, y0, x1, y1, color = THIN, lw = 1.5) => {
      g.strokeStyle = color; g.lineWidth = lw;
      g.beginPath(); g.moveTo(X(x0), Y(y0)); g.lineTo(X(x1), Y(y1)); g.stroke();
    };
    const box = (x, y, bw, bh, r = 0.05) => { g.strokeStyle = THIN; g.lineWidth = 1.5; rr(g, X(x), Y(y), Lm(bw), Lm(bh), Lm(r)); g.stroke(); };
    const circle = (x, y, r) => { g.strokeStyle = THIN; g.lineWidth = 1.5; g.beginPath(); g.arc(X(x), Y(y), Lm(r), 0, Math.PI * 2); g.stroke(); };
    function wall(x0, y0, x1, y1, t, gaps = []) {
      const horiz = y0 === y1;
      const a0 = (horiz ? x0 : y0) - t / 2, a1 = (horiz ? x1 : y1) + t / 2;
      const piece = (p0, p1) => {
        if (p1 <= p0) return;
        g.fillStyle = INK;
        if (horiz) g.fillRect(X(p0), Y(y0 - t / 2), Lm(p1 - p0), Lm(t));
        else g.fillRect(X(x0 - t / 2), Y(p0), Lm(t), Lm(p1 - p0));
      };
      let s = a0;
      for (const [p0, p1, kind, dir] of gaps) {
        piece(s, p0);
        s = p1;
        if (kind === 'win') {
          for (const off of [-t / 2, 0, t / 2]) {
            if (horiz) line(p0, y0 + off, p1, y0 + off, INK, 1.2); else line(x0 + off, p0, x0 + off, p1, INK, 1.2);
          }
        } else if (kind === 'door') {
          const len = p1 - p0;
          g.strokeStyle = THIN; g.lineWidth = 1.5;
          if (horiz) {
            line(p0, y0, p0, y0 + dir * len);
            g.beginPath(); g.arc(X(p0), Y(y0), Lm(len), dir > 0 ? 0 : -Math.PI / 2, dir > 0 ? Math.PI / 2 : 0); g.stroke();
          } else {
            line(x0, p0, x0 + dir * len, p0);
            g.beginPath(); g.arc(X(x0), Y(p0), Lm(len), dir > 0 ? 0 : Math.PI / 2, dir > 0 ? Math.PI / 2 : Math.PI); g.stroke();
          }
        }
      }
      piece(s, a1);
    }

    // Furniture first, walls on top.
    box(0.9, 4.2, 3.2, 0.9, 0.12); line(0.9, 4.85, 4.1, 4.85);
    box(1.8, 3.0, 1.4, 0.65, 0.08);
    box(4.15, 2.4, 0.9, 0.9, 0.15);
    box(1.3, 0.3, 2.6, 0.38, 0.03);
    circle(6.3, 2.7, 0.55);
    for (const [cx, cy] of [[6.3, 1.85], [6.3, 3.55], [5.45, 2.7], [7.15, 2.7]]) box(cx - 0.22, cy - 0.22, 0.44, 0.44, 0.06);
    box(8.2, 0.25, 5.55, 0.62, 0.02); box(13.13, 0.87, 0.62, 3.0, 0.02);
    circle(10.2, 0.56, 0.2); circle(12.0, 0.56, 0.12); circle(12.45, 0.56, 0.12);
    box(9.6, 2.4, 2.4, 0.9, 0.05);
    box(8.2, 4.55, 0.75, 0.75, 0.03);
    box(1.0, 6.4, 1.8, 2.1, 0.06); box(1.1, 6.5, 0.72, 0.38, 0.08); box(1.98, 6.5, 0.72, 0.38, 0.08); line(1.0, 7.1, 2.8, 7.1);
    box(0.4, 6.45, 0.45, 0.45, 0.04); box(2.95, 6.45, 0.45, 0.45, 0.04);
    box(3.75, 7.3, 0.58, 1.95, 0.02);
    box(6.95, 7.4, 0.38, 1.6, 0.02);
    box(7.75, 8.55, 2.05, 0.75, 0.15); box(7.85, 8.65, 1.85, 0.55, 0.22);
    box(8.95, 5.72, 0.8, 0.45, 0.08); circle(9.35, 5.95, 0.14);
    g.beginPath(); g.ellipse(X(9.35), Y(7.35), Lm(0.28), Lm(0.2), 0, 0, Math.PI * 2); g.stroke();
    box(9.62, 7.1, 0.18, 0.5, 0.03);
    box(10.7, 8.6, 2.2, 0.68, 0.03); circle(11.8, 8.15, 0.27); box(10.12, 7.0, 0.35, 2.0, 0.02);

    wall(0, 0, BW, 0, EXT, [[2, 4.5, 'win'], [9.5, 12, 'win']]);
    wall(0, BH, BW, BH, EXT, [[1, 3.5, 'win'], [5.5, 6.5, 'door', -1], [11, 13, 'win']]);
    wall(0, 0, 0, BH, EXT, [[1.5, 3.8, 'win']]);
    wall(BW, 0, BW, BH, EXT, [[1.5, 3.5, 'win'], [6.5, 8.3, 'win']]);
    wall(0, 5.5, BW, 5.5, INT, [[5.0, 7.0, 'open'], [10.4, 11.3, 'door', 1]]);
    wall(8, 0, 8, 5.5, INT, [[1.6, 3.8, 'open']]);
    wall(4.5, 5.5, 4.5, BH, INT, [[6.0, 6.9, 'door', -1]]);
    wall(7.5, 5.5, 7.5, BH, INT, [[6.0, 6.9, 'door', 1]]);
    wall(10, 5.5, 10, BH, INT);

    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const label = (t, area, x, y) => {
      g.fillStyle = '#9098a5'; g.font = `600 ${Lm(0.19)}px ${FONT}`; g.fillText(t.toUpperCase(), X(x), Y(y));
      g.fillStyle = '#aab0bc'; g.font = `500 ${Lm(0.155)}px ${FONT}`; g.fillText(`${area.toFixed(1)} m²`, X(x), Y(y + 0.27));
    };
    label('Living room', 44, 2.6, 1.55);
    label('Kitchen', 33, 11.0, 4.35);
    label('Bedroom', 18, 2.0, 8.8);
    label('Hall', 12, 6.0, 7.9);
    label('Bath', 10, 8.55, 7.6);
    label('Study', 16, 12.0, 6.6);
    g.textAlign = 'left';
    g.fillStyle = '#aab0bc';
    g.font = `500 12px ${FONT}`;
    g.fillText('SAMPLE APARTMENT · 1:100 · ceiling 2.8 m', X(0), Y(BH + 0.62));

    const mk = (type, x, y, o = {}) => {
      const p = PRESETS[type];
      const watts = o.watts ?? p.watts, efficacy = o.efficacy ?? p.efficacy;
      return { id: uid('L'), x: X(x), y: Y(y), type, watts, efficacy, lumens: Math.round(watts * efficacy), beam: o.beam ?? p.beam, height: o.height ?? 2.8 - (p.drop || 0), cct: o.cct ?? 3000 };
    };
    const lights = [
      ...[[1.5, 1.5], [3.9, 1.5], [1.5, 3.9], [3.9, 3.9]].map(([x, y]) => mk('downlight', x, y, { watts: 10 })),
      mk('pendant', 6.3, 2.7, { watts: 15, cct: 2700 }),
      mk('downlight', 6.3, 4.6, { watts: 10 }),
      mk('downlight', 6.3, 0.8, { watts: 10 }),
      mk('panel', 9.9, 2.75, { cct: 4000 }),
      mk('panel', 12.3, 2.75, { cct: 4000 }),
      mk('ceiling', 2.25, 7.5, { watts: 30, cct: 2700 }),
      mk('spot', 6.0, 6.5),
      mk('spot', 6.0, 8.6),
      mk('downlight', 8.75, 6.6, { cct: 4000 }),
      mk('downlight', 8.75, 8.3, { cct: 4000 }),
      mk('panel', 12.0, 7.5, { cct: 4000 }),
    ];
    const zone = (name, type, x0, y0, x1, y1) => ({
      id: uid('Z'), name, type, target: ROOM_TYPES[type].target, u0: ROOM_TYPES[type].u0,
      x: X(x0), y: Y(y0), w: Lm(x1 - x0), h: Lm(y1 - y0),
    });
    const zones = [
      zone('Living room', 'living', 0.25, 0.25, 7.8, 5.3),
      zone('Kitchen', 'kitchen', 8.2, 0.25, 13.75, 5.3),
      zone('Bedroom', 'bedroom', 0.25, 5.7, 4.3, 9.25),
      zone('Hall', 'hall', 4.7, 5.7, 7.3, 9.25),
      zone('Bathroom', 'bathroom', 7.7, 5.7, 9.8, 9.25),
      zone('Study', 'study', 10.2, 5.7, 13.75, 9.25),
    ];
    return { src: c.toDataURL('image/png'), pxPerM: M, lights, zones, furniture: sampleFurniture(X, Y, Lm) };
  }

  async function loadSample() {
    const smp = makeSample();
    await setPlan(smp.src, 'Sample apartment');
    state.pxPerM = smp.pxPerM;
    state.scaleSet = true;
    state.settings = { ...DEFAULT_SETTINGS };
    state.view = { ...DEFAULT_VIEW, dim: state.view.dim };
    state.template = { ...DEFAULT_TEMPLATE };
    state.wallThick = 0.15;
    state.lights = smp.lights;
    state.walls = [];
    state.zones = smp.zones;
    state.furniture = smp.furniture;
    selection = null;
    resetHistory();
    fitView();
    setTool('select');
    setDim(state.view.dim);
    sync();
  }

  // ---------- Init ----------
  async function init() {
    new ResizeObserver(resizeCanvas).observe(stage);
    resizeCanvas();
    let restored = false;
    const openParam = new URLSearchParams(location.search).get('open');
    if (openParam) {
      try {
        await loadProject(await (await fetch(openParam, { cache: 'no-store' })).json());
        restored = true;
        history.replaceState(null, '', location.pathname); // a refresh then keeps the user's edits
      } catch (e) { console.warn('Could not open', openParam, e); }
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!restored && raw) { await loadProject(JSON.parse(raw)); restored = true; }
    } catch (e) { console.warn('Could not restore the last session', e); }
    if (!restored) await loadSample();
    setTool('select');
    requestUI();
  }
  init();
})();
