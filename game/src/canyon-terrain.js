// canyon-terrain.js — Viper Gorge and Viper Field, built procedurally.
// The gorge S-curves north from the airbase; canyon walls are strata-textured
// frustum segments, the river is a specular ribbon on the floor, and the field
// sits on the southern plateau: marked runway, amber edge lights, green
// approach gantry, tower and hangars. Also owns the heightfield queries the
// physics uses (ground height + wall clearance for scrape damage).
'use strict';

const GORGE_START = 60, GORGE_END = -1520, PLATEAU_Z = 300, RUNWAY_Z0 = 300, RUNWAY_Z1 = 610;

// The gorge centreline wanders like the river it carved.
function gorgeCentreX(z) {
  if (z > GORGE_START) return 0;
  const t = (GORGE_START - z) / 900;
  return Math.sin(t * 2.6) * 34 * Math.min(1, t + 0.25);
}
function gorgeHalfWidth(z) { return z > GORGE_START ? 400 : 62 + Math.sin(z * 0.011) * 9; }
function groundHeight(x, z) {
  if (z > GORGE_START) {
    // Southern plateau / airbase apron, with soft dunes far out.
    const dune = Math.max(0, Math.hypot(x, z - 700) - 260) * 0.05;
    return 14 + dune;
  }
  const cx = gorgeCentreX(z), hw = gorgeHalfWidth(z);
  const d = Math.abs(x - cx);
  if (d < hw) return 8;                                   // gorge floor
  const over = d - hw;
  return 8 + Math.min(120, over * 1.15);                  // walls rise steeply
}
function wallClearance(x, z) {
  if (z > GORGE_START) return 999;
  return gorgeHalfWidth(z) - Math.abs(x - gorgeCentreX(z));
}

function buildWorld(gl, textures) {
  const rock = new GeoBuilder(), ground = new GeoBuilder(), water = new GeoBuilder(), field = new GeoBuilder(), slab = new GeoBuilder();
  const ROCK = [0.78, 0.52, 0.34], ROCK_D = [0.62, 0.38, 0.24], SAND = [1, 1, 1], FLOOR = [0.84, 0.62, 0.38];

  // --- canyon walls: stepped strata segments marching down the gorge ---
  const step = 76;
  for (let z = GORGE_START; z > GORGE_END; z -= step) {
    const cx0 = gorgeCentreX(z), cx1 = gorgeCentreX(z - step);
    const hw0 = gorgeHalfWidth(z), hw1 = gorgeHalfWidth(z - step);
    for (const s of [-1, 1]) {
      const shade = 0.92 + ((z / step | 0) % 3) * 0.05;
      const col = [ROCK[0] * shade, ROCK[1] * shade, ROCK[2] * shade];
      const x0i = cx0 + s * hw0, x1i = cx1 + s * hw1;
      const x0o = cx0 + s * (hw0 + 430), x1o = cx1 + s * (hw1 + 430);
      // inner wall face (floor -> rim) and rim plateau strip
      rock.quad([x0i, 8, z], [x1i, 8, z - step], [x1i, 128, z - step], [x0i, 128, z], col, { texScale: 2.2, rough: 0.95 });
      rock.quad([x0i, 128, z], [x1i, 128, z - step], [x1o, 134, z - step], [x0o, 134, z], ROCK_D, { texScale: 2.2, rough: 0.95 });
      // outer skirt: the high rim plateau drops to the desert floor far out
      rock.quad([x0o, 134, z], [x1o, 134, z - step], [x1o, 12, z - step], [x0o, 12, z], ROCK_D, { texScale: 2.2, rough: 0.95 });
      ground.quad([cx0 - hw0, 8, z], [cx0 + hw0, 8, z], [cx1 + hw1, 8, z - step], [cx1 - hw1, 8, z - step], FLOOR, { texScale: 6, rough: 0.9 });
    }
  }
  // --- southern plateau + northern cap ---
  ground.quad([-700, 14, 980], [700, 14, 980], [700, 14, GORGE_START], [-700, 14, GORGE_START], SAND, { texScale: 26, rough: 0.95 });
  ground.quad([-500, 10, GORGE_END + 40], [500, 10, GORGE_END + 40], [500, 10, GORGE_END - 260], [-500, 10, GORGE_END - 260], FLOOR, { texScale: 16, rough: 0.95 });

  // --- river: a specular ribbon following the centreline (sun glints) ---
  const rw = 15;
  for (let z = GORGE_START - 20; z > GORGE_END; z -= step) {
    const cx0 = gorgeCentreX(z), cx1 = gorgeCentreX(z - step);
    water.quad([cx0 - rw, 8.6, z], [cx0 + rw, 8.6, z], [cx1 + rw, 8.6, z - step], [cx1 - rw, 8.6, z - step],
      [0.16, 0.38, 0.52], { rough: 0.05, metal: 0.9, texScale: 3 });
  }

  // --- mesas: stepped strata towers (three stacked, tapering boxes each) ---
  const mesas = [[-330, -260, 120, 74], [330, -520, 150, 88], [-360, -860, 130, 66], [350, -1150, 165, 96], [-300, -1420, 120, 70], [290, -120, 105, 58]];
  for (const [mx, mz, mw, mh] of mesas) {
    const tiers = [[1.0, 0.45], [0.78, 0.35], [0.55, 0.2]];
    let base = 8;
    for (const [scale, frac] of tiers) {
      const h = mh * frac;
      rock.box(mx, base + h / 2, mz, mw * scale, h, mw * scale, ROCK, { texScale: 3, rough: 0.95 });
      base += h;
    }
  }
  // boulders + scrub dots on the plateau for speed reference
  for (let i = 0; i < 46; i++) {
    const bx = (Math.sin(i * 37.7) * 0.5 + 0.5) * 900 - 450, bz = 120 + ((i * 53) % 780);
    if (Math.abs(bx) < 46 && bz > 260 && bz < 660) continue;
    const s = 1.6 + (i % 5) * 0.8;
    rock.box(bx, 14 + s / 2, bz, s, s, s, ROCK_D, { rough: 0.95 });
    if (i % 3 === 0) ground.box(bx + 6, 14.8, bz + 4, 2.6, 1.6, 2.6, [0.32, 0.42, 0.2], { rough: 1 });
  }

  // --- Viper Field: runway slab, markings, lights, buildings ---
  const ASPH = [1, 1, 1], WHITE = [0.92, 0.93, 0.94], AMBER = [1.0, 0.62, 0.12];
  slab.box(0, 14.25, (RUNWAY_Z0 + RUNWAY_Z1) / 2, 44, 0.5, RUNWAY_Z1 - RUNWAY_Z0, ASPH, { texScale: 12, rough: 0.55 });
  for (let z = RUNWAY_Z0 + 26; z < RUNWAY_Z1 - 10; z += 34) field.box(0, 14.56, z, 1.4, 0.06, 17, WHITE, { emissive: 0.12 });
  for (const sx of [-19, 19]) for (let i = 0; i < 6; i++) field.box(sx, 14.56, RUNWAY_Z0 + 8 + i * 5.2, 2.6, 0.06, 3.4, WHITE, { emissive: 0.12 });
  field.box(0, 14.56, RUNWAY_Z0 + 3, 30, 0.06, 1.6, WHITE, { emissive: 0.15 });
  const halos = [];
  for (let z = RUNWAY_Z0; z <= RUNWAY_Z1; z += 31) for (const sx of [-23.5, 23.5]) {
    field.box(sx, 15.1, z, 0.7, 1.1, 0.7, AMBER, { emissive: 1.0 });
    halos.push({ p: [sx, 15.4, z], size: 3.4, col: [1.0, 0.6, 0.15] });
  }
  // approach gantry: green threshold bar + sequenced lead-in lights
  for (let i = -4; i <= 4; i++) {
    field.box(i * 4.6, 15.2, RUNWAY_Z0 - 8, 1.1, 1.6, 1.1, [0.2, 1.0, 0.45], { emissive: 1.0 });
    halos.push({ p: [i * 4.6, 15.6, RUNWAY_Z0 - 8], size: 3.8, col: [0.25, 1.0, 0.45] });
  }
  for (let i = 1; i <= 4; i++) {
    field.box(0, 15.0, RUNWAY_Z0 - 8 - i * 26, 0.9, 1.3, 0.9, [0.2, 1.0, 0.45], { emissive: 0.9 });
    halos.push({ p: [0, 15.4, RUNWAY_Z0 - 8 - i * 26], size: 3.2, col: [0.25, 1.0, 0.45] });
  }
  // tower + hangars + windsock pole
  const CONC = [0.76, 0.74, 0.7], DARK = [0.2, 0.23, 0.27];
  field.box(52, 24, 430, 7, 20, 7, CONC, { rough: 0.8 });
  field.box(52, 36, 430, 10, 4.5, 10, [0.35, 0.75, 0.9], { rough: 0.15, metal: 0.7, emissive: 0.25 });
  field.box(52, 39.4, 430, 11, 0.5, 11, DARK, {});
  for (const hx of [-58, 62]) {
    field.box(hx, 19, 520, 30, 10, 20, [0.55, 0.5, 0.46], { rough: 0.85 });
    field.box(hx, 24.4, 520, 32, 1.2, 22, DARK, {});
  }
  field.box(-40, 19, 380, 0.5, 10, 0.5, DARK, {});
  field.box(-38.6, 23.4, 380, 3.2, 1.1, 1.4, [0.95, 0.45, 0.1], { emissive: 0.3 });

  return {
    draws: [
      { mesh: rock.build(gl), tex: textures.rock, model: mat4Identity() },
      { mesh: ground.build(gl), tex: textures.sand, model: mat4Identity() },
      { mesh: water.build(gl), tex: null, model: mat4Identity() },
      { mesh: slab.build(gl), tex: textures.asphalt, model: mat4Identity() },
      { mesh: field.build(gl), tex: null, model: mat4Identity() },
    ],
    halos,
  };
}
