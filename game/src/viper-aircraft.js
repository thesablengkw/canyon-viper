// viper-aircraft.js — the VF-9 Viper, modelled from frustum sections.
// Twin canted tails, swept wings with glowing cyan wingtip lights, a lit canopy
// over a detailed cockpit (three MFDs with drawn instrument graphics: radar
// arcs, pitch ladder, engine bars), twin afterburner plumes that grow with
// throttle, and landing gear as a SEPARATE mesh so "gear up" is truly clean.
// Metalness/roughness + the procedural metal texture give it a PBR sheen.
'use strict';

const HULL = [0.85, 0.9, 0.95], TRIM = [0.26, 0.31, 0.38], CYAN = [0.25, 0.95, 1.0];
const GLASS = [0.3, 0.75, 0.95], AMBER = [1.0, 0.62, 0.15];

function buildJet(gl, metalTex) {
  const b = new GeoBuilder();
  const M = { texScale: 2.2, rough: 0.38, metal: 0.75 };
  // Fuselage: nose tip -> intake -> cabin -> tail, each station a frustum.
  b.frustum(-7.6, 0.24, 0.24, -5.4, 0.95, 0.8, 0.1, 0.12, HULL, M);
  b.frustum(-5.4, 0.95, 0.8, -2.6, 1.5, 1.25, 0.12, 0.18, HULL, M);
  b.frustum(-2.6, 1.5, 1.25, 0.8, 1.7, 1.45, 0.18, 0.22, HULL, M);
  b.frustum(0.8, 1.7, 1.45, 4.2, 1.45, 1.3, 0.22, 0.2, HULL, M);
  b.frustum(4.2, 1.45, 1.3, 6.6, 1.05, 0.95, 0.2, 0.16, TRIM, M);
  // Spine + nose probe.
  b.box(0, 0.95, -0.6, 0.5, 0.34, 6.4, TRIM, M);
  b.box(0, 0.1, -8.3, 0.07, 0.07, 1.5, TRIM, M);
  // Canopy: tinted glass frustum with emissive instrument spill.
  b.frustum(-3.4, 0.95, 0.5, -1.9, 1.15, 0.72, 0.88, 0.92, GLASS, { rough: 0.08, metal: 0.9, emissive: 0.22 });
  b.frustum(-1.9, 1.15, 0.72, -0.5, 0.8, 0.4, 0.92, 0.8, GLASS, { rough: 0.08, metal: 0.9, emissive: 0.22 });
  // Wings with REAL chord thickness: a slab() is a top face in bright
  // silver-slate, a darker underside, and bevelled leading/trailing/tip
  // edges — so from behind the wing reads as solid metal, never a razor.
  const SLATE = [0.98, 1.0, 1.05], UNDER = [0.32, 0.37, 0.44];
  const slab = (a, bq, c, d, t, opt) => {
    const dn = (p) => [p[0], p[1] - t, p[2]];
    b.quad(a, bq, c, d, SLATE, opt);
    b.quad(dn(d), dn(c), dn(bq), dn(a), UNDER, opt);
    b.quad(dn(a), dn(bq), bq, a, SLATE, opt);
    b.quad(dn(c), dn(d), d, c, SLATE, opt);
    b.quad(dn(bq), dn(c), c, bq, SLATE, opt);
  };
  for (const s of [-1, 1]) {
    // Main delta wing (root chord 1.7 m, tip chord 0.9 m, 0.17 m thick).
    slab([s * 0.7, -0.02, -0.7], [s * 4.9, -0.48, 1.8], [s * 4.9, -0.42, 2.7], [s * 0.7, 0.04, 1.0], 0.17, M);
    b.box(s * 4.98, -0.45, 2.25, 0.3, 0.18, 0.8, CYAN, { emissive: 1.0 });
    b.halo(s * 5.1, -0.45, 2.25, 1.1, [0.3, 0.9, 1.0]);
    // Horizontal tailplane, also a slab.
    slab([s * 0.55, 0.12, 4.6], [s * 2.75, 0.04, 5.9], [s * 2.75, 0.08, 6.45], [s * 0.55, 0.18, 5.6], 0.12, M);
    // Twin fins: tapered, canted ~18° outward (top leans away from centre),
    // built as two faces + a cap so they have thickness from behind.
    const fin = [[s * 0.60, 0.30, 4.25], [s * 1.06, 2.2, 5.5], [s * 1.28, 2.26, 6.3], [s * 0.72, 0.35, 5.95]];
    const off = (p) => [p[0] + s * 0.1, p[1], p[2]];
    b.quad(fin[0], fin[1], fin[2], fin[3], TRIM, M);
    b.quad(off(fin[3]), off(fin[2]), off(fin[1]), off(fin[0]), TRIM, M);
    b.quad(fin[1], off(fin[1]), off(fin[2]), fin[2], TRIM, M);
    b.box(s * 1.19, 2.28, 5.9, 0.34, 0.16, 0.75, AMBER, { emissive: 0.9 });
    // Under-wing stores: an outboard missile and an inboard drop tank,
    // authored around the origin then absorbed at their outboard stations.
    b.box(s * 3.1, -0.72, 1.6, 0.14, 0.3, 0.5, TRIM, M);
    b.box(s * 1.7, -0.7, 1.5, 0.14, 0.28, 0.5, TRIM, M);
    const missile = new GeoBuilder();
    missile.frustum(0.3, 0.3, 0.3, 2.2, 0.3, 0.3, -0.95, -0.95, SLATE, M);
    missile.frustum(-0.55, 0.04, 0.04, 0.3, 0.3, 0.3, -0.95, -0.95, [0.9, 0.3, 0.15], M); // nose cone, forward
    missile.box(0, -0.95, 1.95, 0.52, 0.16, 0.1, TRIM, M);   // rear fins
    missile.box(0, -0.95, 1.95, 0.1, 0.52, 0.16, TRIM, M);
    b.absorb(missile, s * 3.1, 0, 0);
    const tank = new GeoBuilder();
    tank.frustum(-0.15, 0.1, 0.1, 0.5, 0.46, 0.46, -0.92, -0.92, UNDER, M);  // rounded nose
    tank.frustum(0.5, 0.46, 0.46, 2.4, 0.4, 0.4, -0.92, -0.92, UNDER, M);
    tank.frustum(2.4, 0.4, 0.4, 2.9, 0.1, 0.1, -0.92, -0.92, UNDER, M);
    b.absorb(tank, s * 1.7, 0, 0);
  }
  // Intakes under the wing roots.
  for (const s of [-1, 1]) b.box(s * 1.05, -0.55, 0.4, 0.8, 0.55, 3.4, TRIM, M);
  // Twin burner cans + circular metallic exhaust nozzles with a hot core.
  for (const s of [-1, 1]) {
    b.box(s * 0.42, 0.12, 6.7, 0.6, 0.6, 0.45, [0.1, 0.1, 0.12], { rough: 0.4, metal: 0.8 });
    const cx = s * 0.42, cy = 0.12, seg = 10;
    const P = (z, r, a) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r, z];
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
      b.quad(P(6.85, 0.35, a0), P(6.85, 0.35, a1), P(7.2, 0.28, a1), P(7.2, 0.28, a0), [0.6, 0.64, 0.68], { rough: 0.28, metal: 0.95 });
      b._tri([cx, cy, 7.18], P(7.18, 0.21, a0), P(7.18, 0.21, a1), [1.0, 0.55, 0.16], { emissive: 0.85 });
    }
  }

  // Gear is its own mesh: struts + wheels, drawn only when gear is down.
  const g = new GeoBuilder();
  const STRUT = [0.75, 0.78, 0.8], TYRE = [0.08, 0.08, 0.09];
  g.box(0, -1.05, -4.4, 0.16, 1.1, 0.16, STRUT, { rough: 0.4, metal: 0.7 });
  g.box(0, -1.62, -4.4, 0.5, 0.55, 0.5, TYRE, { rough: 0.9 });
  for (const s of [-1, 1]) {
    g.box(s * 1.15, -1.0, 3.4, 0.18, 1.0, 0.18, STRUT, { rough: 0.4, metal: 0.7 });
    g.box(s * 1.15, -1.58, 3.4, 0.55, 0.62, 0.55, TYRE, { rough: 0.9 });
  }
  return { hull: b.build(gl), gear: g.build(gl), hullHalos: b.halos, tex: metalTex };
}

// Afterburner plume: two TIGHT concentric cones per nozzle — a short
// cyan-blue sheath around a crisp orange core — rebuilt per frame from
// throttle/boost. Deliberately small: the tail must never sit in a white blob.
function buildPlume(gl, throttle, boost) {
  const b = new GeoBuilder();
  const len = 0.85 + throttle * 1.25 + (boost ? 1.05 : 0);
  const flicker = 0.94 + Math.random() * 0.12;
  for (const s of [-1, 1]) {
    const plume = new GeoBuilder();
    plume.frustum(7.18, 0.27, 0.27, 7.18 + len * 0.62, 0.13, 0.13, 0.12, 0.12, [0.38, 0.62, 1.0], { emissive: 0.7 });
    plume.frustum(7.18, 0.155, 0.155, 7.18 + len * flicker, 0.03, 0.03, 0.12, 0.12, [1.0, 0.6, 0.16], { emissive: 1.0 });
    plume.halo(0, 0.12, 7.3 + len * 0.3, 0.8, [0.95, 0.5, 0.18]);
    b.absorb(plume, s * 0.42, 0, 0);
  }
  return { mesh: b.build(gl), halos: b.halos };
}

// Cockpit interior for the pilot camera. The dash is a STEPPED console of
// three horizontal shelves, so the three MFD screens lie almost flat, facing
// up at the pilot — readable at a glance. Each screen carries DRAWN
// instruments (not flat fills): left = radar arcs + sweep + blips, centre =
// artificial-horizon pitch ladder, right = engine bars + telemetry ticks.
// Screen-space (u right, v toward the nose) maps onto the shelf plane.
function buildCockpit(gl) {
  const b = new GeoBuilder();
  const PANEL = [0.1, 0.12, 0.15], FRAME = [0.22, 0.25, 0.3];
  // Stepped shelves (front = farthest from pilot) + side cheeks + console.
  b.box(0, -0.28, -2.55, 3.3, 0.22, 0.8, PANEL, { rough: 0.7 });   // top shelf / glareshield base
  b.box(0, -0.62, -1.95, 3.3, 0.22, 0.55, PANEL, { rough: 0.7 });  // MFD shelf
  b.box(0, -1.0, -1.35, 2.4, 0.22, 0.7, PANEL, { rough: 0.7 });    // lower console shelf
  for (const s of [-1, 1]) b.box(s * 1.62, -0.6, -1.95, 0.18, 1.1, 1.9, PANEL, { rough: 0.7 });
  // One MFD laid on the MFD shelf: frame, dark glass, then drawn instruments.
  const mfd = (cx, draw) => {
    const Y = -0.5, Z = -1.95;                       // shelf top surface
    b.box(cx, Y - 0.03, Z, 0.98, 0.05, 0.6, FRAME, { rough: 0.5, metal: 0.4 });
    b.box(cx, Y - 0.005, Z, 0.86, 0.012, 0.5, [0.03, 0.1, 0.12], { emissive: 0.35 });
    const pt = (u, v) => [cx + u, Y + 0.004, Z - v];
    const seg = (u0, v0, u1, v1, col, w = 0.03) => {
      const [ax, ay, az] = pt(u0, v0), [bx, by, bz] = pt(u1, v1);
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 0.001;
      const px = -dz / len * w / 2, pz = dx / len * w / 2;
      b.quad([mx - dx / 2 - px, ay, mz - dz / 2 - pz], [mx + dx / 2 - px, ay, mz + dz / 2 - pz],
             [mx + dx / 2 + px, ay, mz + dz / 2 + pz], [mx - dx / 2 + px, ay, mz - dz / 2 + pz], col, { emissive: 0.95 });
    };
    const dot = (u, v, col, s = 0.045) => { const [x, y, z] = pt(u, v); b.box(x, y, z, s, 0.012, s, col, { emissive: 1.0 }); };
    draw(seg, dot, pt);
  };
  // LEFT MFD — radar: concentric rings, sweep, blips.
  mfd(-1.08, (seg, dot) => {
    for (const r of [0.08, 0.15, 0.22]) for (let i = 0; i < 12; i++) {
      const a0 = i / 12 * Math.PI * 2, a1 = (i + 0.72) / 12 * Math.PI * 2;
      seg(Math.cos(a0) * r, Math.sin(a0) * r * 0.62, Math.cos(a1) * r, Math.sin(a1) * r * 0.62, [0.2, 0.95, 0.6], 0.016);
    }
    seg(0, 0, 0.16, -0.1, [0.4, 1.0, 0.7], 0.026);
    dot(0.12, -0.07, [1.0, 0.75, 0.25]); dot(-0.15, 0.05, [1.0, 0.75, 0.25]); dot(0.04, 0.13, [0.5, 1, 0.9]);
  });
  // CENTRE MFD — artificial horizon: sky/ground halves + pitch ladder.
  mfd(0, (seg, dot, pt) => {
    const [sx, sy, sz] = pt(0, -0.12);
    b.box(sx, sy - 0.002, sz, 0.8, 0.008, 0.2, [0.25, 0.6, 0.95], { emissive: 0.5 });
    const [gx, gy, gz] = pt(0, 0.12);
    b.box(gx, gy - 0.002, gz, 0.8, 0.008, 0.2, [0.55, 0.38, 0.2], { emissive: 0.4 });
    seg(-0.4, 0, 0.4, 0, [1, 1, 1], 0.028);
    for (const dv of [-0.16, -0.08, 0.08, 0.16]) seg(-0.13, dv, 0.13, dv, [0.9, 0.95, 1], 0.018);
    seg(-0.2, 0, -0.06, 0, [1.0, 0.8, 0.2], 0.04); seg(0.06, 0, 0.2, 0, [1.0, 0.8, 0.2], 0.04);
    dot(0, 0, [1.0, 0.8, 0.2], 0.05);
  });
  // RIGHT MFD — engine bars (N1 / N2 / EGT) + telemetry tick rows.
  mfd(1.08, (seg, dot, pt) => {
    const bars = [[-0.13, 0.82, [0.3, 0.95, 1]], [-0.02, 0.68, [0.3, 0.95, 1]], [0.09, 0.45, [1, 0.65, 0.2]]];
    for (const [v, frac, col] of bars) {
      const [x, y, z] = pt(-0.32 + 0.32 * frac, v);
      b.box(x, y, z, 0.64 * frac, 0.01, 0.055, col, { emissive: 0.85 });
    }
    for (let r = 0; r < 2; r++) for (let i = 0; i < 6; i++) dot(-0.3 + i * 0.12, 0.17 + r * 0.07, [0.35, 0.9, 0.8], 0.055);
  });
  // Canopy uprights + a small HUD glass with reticle, up in the sight line.
  for (const s of [-1, 1]) b.box(s * 1.5, 0.5, -1.35, 0.15, 1.6, 0.15, FRAME, { rough: 0.5, metal: 0.4 });
  b.box(-0.09, 0.72, -1.77, 0.18, 0.022, 0.01, [0.5, 1, 0.9], { emissive: 0.9 });
  b.box(0.09, 0.72, -1.77, 0.18, 0.022, 0.01, [0.5, 1, 0.9], { emissive: 0.9 });
  b.box(0, 0.72, -1.77, 0.022, 0.16, 0.01, [0.5, 1, 0.9], { emissive: 0.9 });
  return b.build(gl);
}
