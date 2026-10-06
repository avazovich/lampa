'use strict';

// 3D "dollhouse" view. The floor shows the calculated light (lux map or realistic), walls are
// raised from the plan's wall mask and coloured by the light that reaches them. Three.js is
// loaded from a CDN the first time the view is opened.
window.createView3D = function createView3D(api) {
  const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
  const canvas = api.canvas;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  let T = null; // the THREE namespace once loaded
  let loading = null;
  let renderer, scene, camera, raycaster, ndc, tmpV;
  let floorMesh = null, floorTex = null, wallMesh = null, topMesh = null, furnMesh = null, furnLines = null;
  let dynGroup, selGroup, geo, mat;
  const floorCanvas = document.createElement('canvas');
  const sharedRes = new WeakSet(); // geometries/materials/textures reused across rebuilds (never disposed)
  // Per vertex of a lit surface: x, y, z, normal x/y/z, and the floor cell used to test whether a
  // fixture can see that spot (−1 = none).
  let wallInfo = null, furnInfo = null;
  const WALL_TINT = [0.9, 0.9, 0.9];
  const FURN_TINT = [0.85, 0.78, 0.68]; // furniture reads slightly warm in the realistic view
  const seen = { geom: '', furn: '', data: -1, sel: null, plan: -1, focus: '' };
  const orbit = { tx: 0, ty: 0, tz: 0, r: 20, theta: 0.35, phi: 0.95 };
  let fitR = 20;
  let autoFit = true; // keep re-fitting on resize until the user moves the camera
  let fitTop = false;
  let active = false;
  let frameReq = 0;
  let drag = null;

  // ---------- Setup ----------
  function load() {
    if (T) return Promise.resolve();
    if (!loading) {
      loading = new Promise((resolve, reject) => {
        if (window.THREE) { resolve(); return; }
        const s = document.createElement('script');
        s.src = THREE_URL;
        s.onload = resolve;
        s.onerror = () => reject(new Error('the 3D engine could not be downloaded (are you online?)'));
        document.head.appendChild(s);
      }).then(setup, (err) => { loading = null; throw err; });
    }
    return loading;
  }

  function setup() {
    T = window.THREE;
    renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setClearColor(0x000000, 0);
    scene = new T.Scene();
    camera = new T.PerspectiveCamera(42, 1, 0.05, 5000);
    raycaster = new T.Raycaster();
    ndc = new T.Vector2();
    tmpV = new T.Vector3();
    dynGroup = new T.Group();
    selGroup = new T.Group();
    scene.add(dynGroup, selGroup);

    const shared = (g) => { sharedRes.add(g); return g; };
    const flat = (g) => shared(g.rotateX(Math.PI / 2)); // lie flat, facing down
    geo = {
      disc: flat(new T.CircleGeometry(0.12, 24)),
      rim: flat(new T.RingGeometry(0.12, 0.16, 24)),
      spot: flat(new T.CircleGeometry(0.08, 20)),
      spotRim: flat(new T.RingGeometry(0.08, 0.11, 20)),
      panel: flat(new T.PlaneGeometry(0.6, 0.6)),
      panelRim: flat(new T.PlaneGeometry(0.68, 0.68)),
      sel: flat(new T.RingGeometry(0.22, 0.29, 32)),
      chandelier: flat(new T.CircleGeometry(0.3, 32)),
      chandelierRim: flat(new T.RingGeometry(0.3, 0.35, 32)),
    };
    const sharedMat = shared;
    mat = {
      rim: sharedMat(new T.MeshBasicMaterial({ color: 0x14171d, side: T.DoubleSide })),
      sel: sharedMat(new T.MeshBasicMaterial({ color: api.ACCENT, side: T.DoubleSide, depthTest: false })),
      cord: sharedMat(new T.LineBasicMaterial({ color: 0x8c94a3 })),
      rimLine: sharedMat(new T.LineBasicMaterial({ color: 0x14171d })),
      glow: null,
    };
    const g = document.createElement('canvas');
    g.width = g.height = 128;
    const c = g.getContext('2d');
    const grd = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.2, 'rgba(255,255,255,0.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = grd;
    c.fillRect(0, 0, 128, 128);
    mat.glowTex = shared(new T.CanvasTexture(g));
    resize();
  }

  function disposeObject(o) {
    if (o.geometry && !sharedRes.has(o.geometry)) o.geometry.dispose();
    if (o.material && !sharedRes.has(o.material)) {
      if (o.material.map && !sharedRes.has(o.material.map)) o.material.map.dispose();
      o.material.dispose();
    }
  }
  function clearGroup(grp) {
    for (const o of [...grp.children]) { grp.remove(o); disposeObject(o); }
  }

  // ---------- Camera ----------
  function placeCamera() {
    const { r, theta, phi } = orbit;
    camera.position.set(
      orbit.tx + r * Math.sin(phi) * Math.sin(theta),
      orbit.ty + r * Math.cos(phi),
      orbit.tz + r * Math.sin(phi) * Math.cos(theta),
    );
    camera.lookAt(orbit.tx, orbit.ty, orbit.tz);
  }

  function resetView(top = false) {
    const st = api.state;
    autoFit = true;
    fitTop = top;
    if (!st.plan || !camera) return;
    const box = api.stage.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) return; // not laid out yet; resize() fits once it is
    // Frame the whole plan, or just the room shown on its own.
    const fr = api.focusRect(), m = 0.4;
    const bx0 = fr ? fr.x0 - m : 0, bz0 = fr ? fr.z0 - m : 0;
    const W = fr ? fr.x1 - fr.x0 + 2 * m : st.plan.w / st.pxPerM, D = fr ? fr.z1 - fr.z0 + 2 * m : st.plan.h / st.pxPerM;
    const tv = Math.tan((camera.fov * Math.PI) / 360);
    fitR = Math.max(W / (2 * tv * camera.aspect), D / (2 * tv)) * 1.08 + st.settings.ceiling;
    orbit.tx = bx0 + W / 2; orbit.ty = 0; orbit.tz = bz0 + D / 2;
    orbit.r = fitR;
    orbit.theta = top ? 0 : 0.35;
    orbit.phi = top ? 0.001 : 0.95;
    requestRender();
  }

  function zoom(f) {
    autoFit = false;
    orbit.r = clamp(orbit.r / f, fitR * 0.04, fitR * 4);
    requestRender();
  }

  function pan(dx, dy) {
    autoFit = false;
    const s = (2 * orbit.r * Math.tan((camera.fov * Math.PI) / 360)) / (canvas.clientHeight || 1);
    const ct = Math.cos(orbit.theta), sn = Math.sin(orbit.theta);
    const fwd = (dy * s) / Math.max(Math.cos(orbit.phi), 0.35); // ground is foreshortened when tilted
    // right = (cosθ, 0, −sinθ), forward along the ground = (−sinθ, 0, −cosθ)
    orbit.tx += -dx * s * ct - fwd * sn;
    orbit.tz += dx * s * sn - fwd * ct;
  }

  function resize() {
    if (!renderer) return;
    const r = api.stage.getBoundingClientRect();
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(Math.max(1, r.width), Math.max(1, r.height), false);
    camera.aspect = Math.max(1, r.width) / Math.max(1, r.height);
    camera.updateProjectionMatrix();
    if (autoFit) resetView(fitTop);
    requestRender();
  }

  // ---------- Static geometry: floor and walls ----------
  function buildStatic() {
    for (const m of [floorMesh, wallMesh, topMesh]) if (m) { scene.remove(m); disposeObject(m); }
    if (floorTex) floorTex.dispose();
    floorMesh = wallMesh = topMesh = floorTex = null;
    wallInfo = null;
    const st = api.state, grid = api.grid();
    if (!st.plan || !grid) return;
    const ppm = st.pxPerM, W = st.plan.w / ppm, D = st.plan.h / ppm;
    const H = st.view.cutWalls ? Math.min(1.2, st.settings.ceiling) : st.settings.ceiling; // wall height

    // Floor: the plan with the light baked in (redrawn on every data change).
    const f = Math.min(1, 2048 / Math.max(st.plan.w, st.plan.h));
    floorCanvas.width = Math.max(1, Math.round(st.plan.w * f));
    floorCanvas.height = Math.max(1, Math.round(st.plan.h * f));
    floorTex = new T.CanvasTexture(floorCanvas);
    floorTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const fg = new T.PlaneGeometry(W, D);
    fg.rotateX(-Math.PI / 2);
    fg.translate(W / 2, 0, D / 2);
    floorMesh = new T.Mesh(fg, new T.MeshBasicMaterial({ map: floorTex }));
    scene.add(floorMesh);

    // Walls: every exposed side of the wall cells becomes a vertical face, split into small
    // patches so the light on it can vary along and up the wall.
    const { nx, ny, cs, wall } = grid;
    const isWall = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && wall[j * nx + i] === 1;
    const rows = Math.max(3, Math.ceil(H / 0.3));
    const pos = [], info = [], idx = [];
    function face(ax, az, bx, bz, nX, nZ, cellAt) {
      const cols = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.25));
      const base = pos.length / 3;
      for (let r = 0; r <= rows; r++) {
        const y = (H * r) / rows;
        for (let c = 0; c <= cols; c++) {
          const x = ax + ((bx - ax) * c) / cols, z = az + ((bz - az) * c) / cols;
          pos.push(x, y, z);
          info.push(x, y, z, nX, 0, nZ, cellAt(x, z));
        }
      }
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const a = base + r * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1;
          idx.push(a, b, d, b, e, d);
        }
      }
    }
    // Faces looking north/south (−z/+z): runs along each row.
    for (let j = 0; j < ny; j++) {
      for (const dir of [-1, 1]) {
        const jn = j + dir;
        const front = jn >= 0 && jn < ny ? jn : -1;
        const z = (dir < 0 ? j : j + 1) * cs;
        let i = 0;
        while (i < nx) {
          if (!isWall(i, j) || isWall(i, jn)) { i++; continue; }
          const s = i;
          while (i < nx && isWall(i, j) && !isWall(i, jn)) i++;
          const e = i - 1;
          face(s * cs, z, i * cs, z, 0, dir, (x) => (front < 0 ? -1 : front * nx + clamp(Math.floor(x / cs), s, e)));
        }
      }
    }
    // Faces looking west/east (−x/+x): runs along each column.
    for (let i = 0; i < nx; i++) {
      for (const dir of [-1, 1]) {
        const iN = i + dir;
        const front = iN >= 0 && iN < nx ? iN : -1;
        const x = (dir < 0 ? i : i + 1) * cs;
        let j = 0;
        while (j < ny) {
          if (!isWall(i, j) || isWall(iN, j)) { j++; continue; }
          const s = j;
          while (j < ny && isWall(i, j) && !isWall(iN, j)) j++;
          const e = j - 1;
          face(x, s * cs, x, j * cs, dir, 0, (_, zz) => (front < 0 ? -1 : clamp(Math.floor(zz / cs), s, e) * nx + front));
        }
      }
    }
    if (pos.length) {
      const wg = new T.BufferGeometry();
      wg.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      wg.setAttribute('color', new T.Float32BufferAttribute(new Float32Array(pos.length), 3));
      wg.setIndex(idx);
      wallMesh = new T.Mesh(wg, new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide }));
      scene.add(wallMesh);
      wallInfo = new Float32Array(info);
    }

    // Wall tops: merge wall cells into rectangles (runs that repeat on the next row grow down).
    const tops = [];
    let prev = new Map();
    for (let j = 0; j < ny; j++) {
      const cur = new Map();
      let i = 0;
      while (i < nx) {
        if (!isWall(i, j)) { i++; continue; }
        const s = i;
        while (i < nx && isWall(i, j)) i++;
        const key = s * 1e6 + i;
        const rect = prev.get(key);
        if (rect) { rect.j1 = j + 1; cur.set(key, rect); } else { const nr = { i0: s, i1: i, j0: j, j1: j + 1 }; tops.push(nr); cur.set(key, nr); }
      }
      prev = cur;
    }
    if (tops.length) {
      const tp = [];
      const tIdx = [];
      for (const t of tops) {
        const b = tp.length / 3;
        const x0 = t.i0 * cs, x1 = t.i1 * cs, z0 = t.j0 * cs, z1 = t.j1 * cs;
        tp.push(x0, H, z0, x1, H, z0, x1, H, z1, x0, H, z1);
        tIdx.push(b, b + 2, b + 1, b, b + 3, b + 2);
      }
      const tg = new T.BufferGeometry();
      tg.setAttribute('position', new T.Float32BufferAttribute(tp, 3));
      tg.setIndex(tIdx);
      topMesh = new T.Mesh(tg, new T.MeshBasicMaterial({ color: 0x2a2f3a, side: T.DoubleSide }));
      scene.add(topMesh);
    }
  }

  // ---------- Furniture ----------
  function buildFurniture() {
    for (const m of [furnMesh, furnLines]) if (m) { scene.remove(m); disposeObject(m); }
    furnMesh = furnLines = null;
    furnInfo = null;
    const st = api.state, grid = api.grid();
    if (!st.plan || !grid || !st.furniture || !st.furniture.length) return;
    const ppm = st.pxPerM, { nx, ny, cs } = grid;
    const cellAt = (x, z) => {
      const i = Math.floor(x / cs), j = Math.floor(z / cs);
      return i >= 0 && j >= 0 && i < nx && j < ny ? j * nx + i : -1;
    };
    const out = cs * 0.6; // sides test visibility on the floor just outside the piece
    const pos = [], info = [], idx = [], edges = [];
    // A (cols+1)×(rows+1) grid of vertices; at(u, v) returns [x, y, z, nx, ny, nz, cell] for u, v in 0..1.
    function patch(cols, rows, at) {
      const base = pos.length / 3;
      for (let r = 0; r <= rows; r++) {
        for (let c = 0; c <= cols; c++) {
          const a = at(c / cols, r / rows);
          pos.push(a[0], a[1], a[2]);
          info.push(...a);
        }
      }
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const a = base + r * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1;
          idx.push(a, b, d, b, e, d);
        }
      }
    }
    const seg = (len) => Math.max(1, Math.ceil(len / 0.25));
    for (const F of st.furniture) {
      const H = clamp(F.height, 0.05, 6);
      const x0 = F.x / ppm, z0 = F.y / ppm, x1 = (F.x + F.w) / ppm, z1 = (F.y + F.h) / ppm;
      const rows = Math.max(1, Math.ceil(H / 0.3));
      const eh = H + 0.003; // outline sits just above the top
      if (F.shape === 'round') {
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, rx = (x1 - x0) / 2, rz = (z1 - z0) / 2;
        const S = 40;
        const pt = (u) => [Math.cos(u * Math.PI * 2), Math.sin(u * Math.PI * 2)];
        patch(S, 3, (u, v) => { const [c, sn] = pt(u); const x = cx + rx * v * c, z = cz + rz * v * sn; return [x, H, z, 0, 1, 0, cellAt(x, z)]; });
        patch(S, rows, (u, v) => {
          const [c, sn] = pt(u);
          let nX = c * rz, nZ = sn * rx; // outward normal of an ellipse
          const l = Math.hypot(nX, nZ) || 1;
          nX /= l; nZ /= l;
          const x = cx + rx * c, z = cz + rz * sn;
          return [x, H * v, z, nX, 0, nZ, cellAt(x + nX * out, z + nZ * out)];
        });
        for (let i = 0; i < S; i++) {
          const [c0, s0] = pt(i / S), [c1, s1] = pt((i + 1) / S);
          edges.push(cx + rx * c0, eh, cz + rz * s0, cx + rx * c1, eh, cz + rz * s1);
        }
      } else {
        patch(seg(x1 - x0), seg(z1 - z0), (u, v) => { const x = x0 + (x1 - x0) * u, z = z0 + (z1 - z0) * v; return [x, H, z, 0, 1, 0, cellAt(x, z)]; });
        const side = (ax, az, bx, bz, nX, nZ) => patch(seg(Math.hypot(bx - ax, bz - az)), rows, (u, v) => {
          const x = ax + (bx - ax) * u, z = az + (bz - az) * u;
          return [x, H * v, z, nX, 0, nZ, cellAt(x + nX * out, z + nZ * out)];
        });
        side(x0, z0, x1, z0, 0, -1);
        side(x1, z0, x1, z1, 1, 0);
        side(x1, z1, x0, z1, 0, 1);
        side(x0, z1, x0, z0, -1, 0);
        edges.push(x0, eh, z0, x1, eh, z0, x1, eh, z0, x1, eh, z1, x1, eh, z1, x0, eh, z1, x0, eh, z1, x0, eh, z0);
      }
    }
    const fg = new T.BufferGeometry();
    fg.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    fg.setAttribute('color', new T.Float32BufferAttribute(new Float32Array(pos.length), 3));
    fg.setIndex(idx);
    furnMesh = new T.Mesh(fg, new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide }));
    furnInfo = new Float32Array(info);
    scene.add(furnMesh);
    const eg = new T.BufferGeometry();
    eg.setAttribute('position', new T.Float32BufferAttribute(edges, 3));
    furnLines = new T.LineSegments(eg, new T.LineBasicMaterial({ color: 0x0c0e12, transparent: true, opacity: 0.55 }));
    scene.add(furnLines);
  }

  // ---------- Light-dependent colours ----------
  function prepLights() {
    const st = api.state, ppm = st.pxPerM;
    const prep = [];
    for (const L of st.lights) {
      const c = api.lightField(L.id);
      if (!c) continue;
      const m = api.beamExponent(L.beam);
      const pts = api.lightPoints(L); // one point, or segments along a linear fixture
      for (const p of pts) {
        prep.push({
          x: p.x / ppm, z: p.y / ppm, h: L.height, m, field: c.field, eInd: (c.eInd || 0) / pts.length, col: api.cctNorm(L.cct),
          I0: (p.lm * (m + 1)) / (2 * Math.PI),
        });
      }
    }
    return prep;
  }

  // Colours every vertex of a lit surface (walls or furniture) by the light arriving on it:
  // the same point-source model as the floor, for the vertex's height and facing direction.
  function colorSurface(mesh, info, prep, real, tint) {
    const mf = api.state.settings.mf;
    const col = mesh.geometry.attributes.color.array;
    const n = info.length / 7;
    for (let v = 0, o = 0; v < n; v++, o += 7) {
      const px = info[o], py = info[o + 1], pz = info[o + 2];
      const nX = info[o + 3], nY = info[o + 4], nZ = info[o + 5], k = info[o + 6];
      let E = 0, R = 0, G = 0, B = 0;
      if (k >= 0) {
        for (const L of prep) {
          if (!(L.field[k] > 0)) continue; // walls between the fixture and this spot
          const dx = L.x - px, dy = L.h - py, dz = L.z - pz;
          const d2 = dx * dx + dy * dy + dz * dz + 1e-6, d = Math.sqrt(d2);
          let e = L.eInd;
          const cosInc = (dx * nX + dy * nY + dz * nZ) / d; // light hitting the face, not its back
          if (cosInc > 0 && dy > 0) e += (L.I0 * Math.pow(dy / d, L.m) * cosInc) / d2;
          e *= mf;
          E += e; R += e * L.col[0]; G += e * L.col[1]; B += e * L.col[2];
        }
      }
      const c = real ? api.toneRgb(R * tint[0], G * tint[1], B * tint[2]) : api.luxColor(E);
      const shade = (nY > 0.5 ? 1 : 0.84 + 0.12 * Math.abs(nZ)) / 255; // gentle shading so edges read in 3D
      col[v * 3] = c[0] * shade; col[v * 3 + 1] = c[1] * shade; col[v * 3 + 2] = c[2] * shade;
    }
    mesh.geometry.attributes.color.needsUpdate = true;
  }

  function labelSprite(name, line2, color) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 132;
    const g = c.getContext('2d');
    g.font = `650 42px ${api.FONT}`;
    const w1 = g.measureText(name).width;
    g.font = `500 32px ${api.FONT}`;
    const w2 = g.measureText(line2).width + 34;
    const w = Math.min(504, Math.max(w1, w2) + 44), x = (512 - w) / 2;
    g.fillStyle = 'rgba(12,14,18,0.88)';
    api.rr(g, x, 4, w, 124, 18);
    g.fill();
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillStyle = '#e7e9ee';
    g.font = `650 42px ${api.FONT}`;
    g.fillText(name, x + 22, 42, w - 44);
    g.fillStyle = color;
    g.beginPath();
    g.arc(x + 31, 94, 9, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#b9bfca';
    g.font = `500 32px ${api.FONT}`;
    g.fillText(line2, x + 52, 94, w - 74);
    const tex = new T.CanvasTexture(c);
    tex.anisotropy = 4;
    // Constant size on screen (about 34 px tall) whatever the zoom.
    const sp = new T.Sprite(new T.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
    const hgt = (34 / Math.max(300, canvas.clientHeight || 800)) * 2 * Math.tan((camera.fov * Math.PI) / 360);
    sp.scale.set((hgt * 512) / 132, hgt, 1);
    sp.renderOrder = 10;
    return sp;
  }

  function rebuildDynamic(real) {
    clearGroup(dynGroup);
    const st = api.state, ppm = st.pxPerM, H = st.settings.ceiling;

    for (const L of st.lights) {
      const x = L.x / ppm, z = L.y / ppm, h = L.height;
      const tint = new T.Color(`rgb(${api.cctRgb(L.cct)})`);
      if (L.type === 'lib') { addCustom(L, x, z, h, H, tint, real); continue; }
      if (L.length > 0) { addLinear(L, x, z, h, H, tint, real); continue; }
      const kind = L.type === 'panel' ? 'panel' : L.type === 'spot' ? 'spot' : L.type === 'chandelier' ? 'chandelier' : 'disc';
      const body = new T.Mesh(geo[kind], new T.MeshBasicMaterial({ color: real ? tint : 0xffffff, side: T.DoubleSide }));
      body.position.set(x, h, z);
      dynGroup.add(body);
      if (!real) {
        const rim = new T.Mesh(geo[{ panel: 'panelRim', spot: 'spotRim', chandelier: 'chandelierRim' }[kind] || 'rim'], mat.rim);
        rim.position.set(x, h - (kind === 'panel' ? 0.004 : 0), z); // a hair below, so the panel stays in front when seen from above
        dynGroup.add(rim);
      }
      if (h < H - 0.05) { // pendant cord
        const cord = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(x, H, z), new T.Vector3(x, h, z)]), mat.cord);
        dynGroup.add(cord);
      }
      if (real) {
        const glow = new T.Sprite(new T.SpriteMaterial({ map: mat.glowTex, color: tint, blending: T.AdditiveBlending, transparent: true, depthWrite: false }));
        const size = 0.7 + Math.min(L.lumens, 5000) / 2500;
        glow.scale.set(size, size, 1);
        glow.position.set(x, h - 0.03, z);
        dynGroup.add(glow);
      }
    }

    for (const Z of st.zones) {
      if (api.focusId() && Z.id !== api.focusId()) continue; // only the room on show
      const s = api.zoneStats.get(Z.id);
      const status = s && st.lights.length ? s.status : 'na';
      const color = api.STATUS_COLOR[status];
      const x0 = Z.x / ppm, z0 = Z.y / ppm, x1 = (Z.x + Z.w) / ppm, z1 = (Z.y + Z.h) / ppm;
      const outline = new T.LineLoop(
        new T.BufferGeometry().setFromPoints([
          new T.Vector3(x0, 0.03, z0), new T.Vector3(x1, 0.03, z0), new T.Vector3(x1, 0.03, z1), new T.Vector3(x0, 0.03, z1),
        ]),
        new T.LineBasicMaterial({ color }),
      );
      dynGroup.add(outline);
      if (!api.showLabels()) continue;
      const line2 = status !== 'na' ? `${api.fmtLux(s.avg)} lx · target ${Z.target}` : `target ${Z.target} lx`;
      const label = labelSprite(Z.name, line2, color);
      label.position.set((x0 + x1) / 2, H + 0.5, (z0 + z1) / 2);
      dynGroup.add(label);
    }
  }

  function updateData() {
    const st = api.state;
    if (!st.plan || !floorTex) return;
    const real = st.view.mode === 'real';
    const fg = floorCanvas.getContext('2d');
    const f = floorCanvas.width / st.plan.w;
    fg.setTransform(f, 0, 0, f, 0, 0);
    api.paintSurface(fg);
    floorTex.needsUpdate = true;
    const prep = prepLights();
    if (wallMesh) colorSurface(wallMesh, wallInfo, prep, real, WALL_TINT);
    if (furnMesh) colorSurface(furnMesh, furnInfo, prep, real, FURN_TINT);
    if (topMesh) topMesh.material.color.set(real ? 0x121418 : 0x2a2f3a);
    rebuildDynamic(real);
  }

  // The studio's own fixture: its picture hanging at full size (always facing the viewer),
  // with glows spread over the area it lights from.
  const libTextures = new Map(); // fixture id -> { src, tex }
  function libTexture(id, img) {
    let t = libTextures.get(id);
    if (!t || t.src !== img.src) {
      if (t) t.tex.dispose();
      const tex = new T.Texture(img);
      tex.needsUpdate = true;
      sharedRes.add(tex);
      t = { src: img.src, tex };
      libTextures.set(id, t);
    }
    return t.tex;
  }
  function addCustom(L, x, z, h, H, tint, real) {
    const item = api.libItem(L.lib), img = api.libImage(L.lib);
    const len = L.length || 1, wid = L.width || len;
    if (img && img.complete && img.naturalWidth) {
      const bodyH = item && item.bodyHeight > 0 ? item.bodyHeight : (len * img.naturalHeight) / img.naturalWidth;
      const sp = new T.Sprite(new T.SpriteMaterial({ map: libTexture(L.lib, img), transparent: true, alphaTest: 0.05 }));
      sp.scale.set(Math.max(len, wid), bodyH, 1);
      sp.position.set(x, h, z);
      dynGroup.add(sp);
      const top = h + bodyH / 2;
      if (top < H - 0.02) dynGroup.add(new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(x, H, z), new T.Vector3(x, top, z)]), mat.cord));
    }
    if (real) {
      const pts = api.lightPoints(L);
      const step = Math.max(1, Math.ceil(pts.length / 8));
      const ppm = api.state.pxPerM;
      for (let i = 0; i < pts.length; i += step) {
        const glow = new T.Sprite(new T.SpriteMaterial({ map: mat.glowTex, color: tint, blending: T.AdditiveBlending, transparent: true, depthWrite: false }));
        const size = 0.8 + Math.min((L.lumens / pts.length) * step, 3000) / 2000;
        glow.scale.set(size, size, 1);
        glow.position.set(pts[i].x / ppm, h, pts[i].y / ppm);
        dynGroup.add(glow);
      }
    }
  }

  // A linear fixture: a slim bar along its length, hung on two cords when it's a pendant.
  function addLinear(L, x, z, h, H, tint, real) {
    const len = L.length, a = ((L.angle || 0) * Math.PI) / 180;
    const bar = new T.BoxGeometry(len, 0.04, 0.07);
    const body = new T.Mesh(bar, new T.MeshBasicMaterial({ color: real ? tint : 0xffffff }));
    body.position.set(x, h, z);
    body.rotation.y = -a; // plan angles turn from +x towards +y, which is +z here
    dynGroup.add(body);
    if (!real) {
      const edges = new T.LineSegments(new T.EdgesGeometry(bar), mat.rimLine);
      edges.position.copy(body.position);
      edges.rotation.copy(body.rotation);
      dynGroup.add(edges);
    }
    const ux = Math.cos(a), uz = Math.sin(a);
    if (h < H - 0.05) {
      for (const t of [-0.4, 0.4]) {
        const cx = x + ux * len * t, cz = z + uz * len * t;
        dynGroup.add(new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(cx, H, cz), new T.Vector3(cx, h, cz)]), mat.cord));
      }
    }
    if (real) {
      const n = Math.max(2, Math.round(len / 0.35));
      const size = 0.6 + Math.min(L.lumens / n, 2500) / 2500;
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n - 0.5;
        const glow = new T.Sprite(new T.SpriteMaterial({ map: mat.glowTex, color: tint, blending: T.AdditiveBlending, transparent: true, depthWrite: false }));
        glow.scale.set(size, size, 1);
        glow.position.set(x + ux * len * t, h - 0.03, z + uz * len * t);
        dynGroup.add(glow);
      }
    }
  }

  function updateSelection() {
    clearGroup(selGroup);
    const L = api.selectedLight();
    if (!L) return;
    const ppm = api.state.pxPerM, x = L.x / ppm, z = L.y / ppm;
    const ring = new T.Mesh(geo.sel, mat.sel);
    ring.position.set(x, L.height, z);
    ring.renderOrder = 5;
    selGroup.add(ring);
    const drop = new T.Line(
      new T.BufferGeometry().setFromPoints([new T.Vector3(x, L.height, z), new T.Vector3(x, 0.02, z)]),
      new T.LineDashedMaterial({ color: api.ACCENT, dashSize: 0.12, gapSize: 0.08 }),
    );
    drop.computeLineDistances();
    selGroup.add(drop);
    const r = api.footprintRadius(L);
    if (r > 0) {
      // A rounded box around the fixture: a circle, a capsule or a rounded rectangle.
      const hx = (L.length || 0) / 2, hz = (L.width || 0) / 2, ang = ((L.angle || 0) * Math.PI) / 180;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const pts = [];
      for (const [ox, oz, a0] of [[hx, hz, 0], [-hx, hz, Math.PI / 2], [-hx, -hz, Math.PI], [hx, -hz, Math.PI * 1.5]]) {
        for (let i = 0; i <= 16; i++) {
          const t = a0 + (i / 16) * (Math.PI / 2);
          const u = ox + r * Math.cos(t), v = oz + r * Math.sin(t);
          pts.push(new T.Vector3(x + u * ca - v * sa, 0.04, z + u * sa + v * ca));
        }
      }
      pts.push(pts[0].clone()); // close the outline
      const ring2 = new T.Line(new T.BufferGeometry().setFromPoints(pts), new T.LineDashedMaterial({ color: 0xffffff, dashSize: 0.15, gapSize: 0.1 }));
      ring2.computeLineDistances();
      selGroup.add(ring2);
    }
  }

  // ---------- Rendering ----------
  function requestRender() {
    if (frameReq || !renderer) return;
    frameReq = document.hidden ? setTimeout(doRender, 16) : requestAnimationFrame(doRender);
  }
  function doRender() {
    frameReq = 0;
    if (!active) return;
    placeCamera();
    renderer.render(scene, camera);
  }

  // Brings the scene up to date with the app (cheap when nothing changed), then renders.
  function render() {
    if (!active) return;
    if (!T) {
      load().then(() => { resize(); render(); }, (err) => api.onError(err));
      return;
    }
    const st = api.state;
    const key = `${api.planToken()}|${api.geomVersion()}|${st.settings.ceiling}|${!!st.view.cutWalls}`;
    if (key !== seen.geom) { seen.geom = key; buildStatic(); seen.data = -1; }
    const fKey = `${key}|${st.pxPerM}|${JSON.stringify(st.furniture || [])}`;
    if (fKey !== seen.furn) { seen.furn = fKey; buildFurniture(); seen.data = -1; }
    const showFurniture = st.view.showFurniture !== false;
    if (furnMesh) furnMesh.visible = showFurniture;
    if (furnLines) furnLines.visible = showFurniture;
    if (api.planToken() !== seen.plan) { seen.plan = api.planToken(); resetView(); }
    const fr = api.focusRect();
    const focusKey = fr ? `${api.focusId()}|${fr.x0}|${fr.z0}|${fr.x1}|${fr.z1}` : '';
    if (focusKey !== seen.focus) {
      seen.focus = focusKey;
      // Cut away everything outside the room (plus its walls).
      const m = 0.35;
      renderer.clippingPlanes = fr ? [
        new T.Plane(new T.Vector3(1, 0, 0), -(fr.x0 - m)),
        new T.Plane(new T.Vector3(-1, 0, 0), fr.x1 + m),
        new T.Plane(new T.Vector3(0, 0, 1), -(fr.z0 - m)),
        new T.Plane(new T.Vector3(0, 0, -1), fr.z1 + m),
      ] : [];
      seen.data = -1;
      resetView();
    }
    if (api.dataVersion() !== seen.data) { seen.data = api.dataVersion(); updateData(); seen.sel = null; }
    const sel = api.selectedLight();
    const selKey = sel ? `${sel.id}|${sel.x}|${sel.y}|${sel.height}|${sel.beam}|${sel.length || 0}|${sel.width || 0}|${sel.angle || 0}` : '';
    if (selKey !== seen.sel) { seen.sel = selKey; updateSelection(); }
    requestRender();
  }

  function snapshot() {
    placeCamera();
    renderer.render(scene, camera);
    return canvas;
  }

  // ---------- Interaction ----------
  function setRay(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    placeCamera();
    camera.updateMatrixWorld();
    raycaster.setFromCamera(ndc, camera);
  }

  // Nearest light to the pointer on screen (within 16 px).
  function lightAt(e) {
    const r = canvas.getBoundingClientRect();
    const st = api.state, ppm = st.pxPerM;
    let best = null, bd = 16;
    placeCamera();
    camera.updateMatrixWorld();
    for (const L of st.lights) {
      for (const p of api.lightPoints(L)) {
        tmpV.set(p.x / ppm, L.height, p.y / ppm).project(camera);
        if (tmpV.z > 1) continue;
        const sx = ((tmpV.x + 1) / 2) * r.width, sy = ((1 - tmpV.y) / 2) * r.height;
        const d = Math.hypot(sx - (e.clientX - r.left), sy - (e.clientY - r.top));
        if (d < bd) { bd = d; best = L; }
      }
    }
    return best;
  }

  function hover(e) {
    if (!floorMesh) return;
    const overLight = lightAt(e);
    canvas.style.cursor = overLight ? 'pointer' : 'grab';
    setRay(e);
    const hit = raycaster.intersectObjects([floorMesh, wallMesh, topMesh, furnMesh].filter((m) => m && m.visible))[0];
    if (!hit || hit.object !== floorMesh) { api.hideReadout(); return; }
    const ppm = api.state.pxPerM;
    api.showReadout(e, { x: hit.point.x * ppm, y: hit.point.z * ppm });
  }

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (!T) return;
    canvas.setPointerCapture(e.pointerId);
    const pan = e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey || api.spaceHeld();
    drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, pan, moved: false };
    canvas.style.cursor = 'grabbing';
    api.hideReadout();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!T) return;
    if (!drag) { hover(e); return; }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 3) drag.moved = true;
    if (drag.pan) pan(dx, dy);
    else {
      autoFit = false;
      orbit.theta -= dx * 0.006;
      orbit.phi = clamp(orbit.phi - dy * 0.006, 0.001, 1.48);
    }
    requestRender();
  });
  function endDrag(e) {
    if (!drag) return;
    const d = drag;
    drag = null;
    canvas.style.cursor = 'grab';
    if (!d.moved && e.type === 'pointerup' && e.button === 0) {
      const L = lightAt(e);
      api.selectLight(L ? L.id : null);
    }
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => { if (!drag) api.hideReadout(); });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!T) return;
    zoom(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
  }, { passive: false });

  return {
    show() { active = true; if (renderer) resize(); render(); },
    hide() { active = false; drag = null; api.hideReadout(); },
    render,
    resize,
    zoom: (f) => { if (T) zoom(f); },
    resetView: (top) => { if (T) resetView(top); },
    snapshot,
  };
};
