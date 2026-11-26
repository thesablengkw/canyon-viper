// Canyon Viper — the world: "Viper Gorge", a sunlit red-rock canyon with a
// winding river, mesa plateaus, and Viper Field, a marked desert airbase.
// All geometry is procedural and deterministic (seeded), built once into a
// single static buffer so the game runs fully offline with no assets.

import { GeoBuilder, mulberry, clamp, lerp } from './math3d.js';

export const WORLD = {
  zStart: 920,          // south end: Viper Field runway and its approach plain
  zEnd: -2500,          // north end of the gorge
  floorHalf: 58,        // flat canyon floor half-width
  wallTop: 128,         // plateau height
};

export function canyonCenterX(z) {
  return 95 * Math.sin(z * 0.0038) + 42 * Math.sin(z * 0.0105 + 1.7);
}

function hashNoise(x, z) {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

// Height of the terrain at a world point. The floor is flat river plain,
// the walls climb in benches, the plateau rolls gently.
export function terrainHeight(x, z) {
  const d = Math.abs(x - canyonCenterX(z));
  const n = hashNoise(Math.floor(x / 37), Math.floor(z / 37));
  if (d < WORLD.floorHalf) return 0;
  const t = (d - WORLD.floorHalf) / 190;
  if (t >= 1) return WORLD.wallTop + n * 10 + Math.sin(x * 0.01 + z * 0.013) * 5;
  const bench = Math.pow(t, 1.6);
  return bench * WORLD.wallTop + Math.sin(t * 21 + z * 0.02) * 4.5 * t + n * 6 * t;
}

const STRATA = [
  [0.62, 0.30, 0.16], [0.72, 0.38, 0.20], [0.80, 0.47, 0.26],
  [0.66, 0.33, 0.18], [0.85, 0.55, 0.32], [0.58, 0.27, 0.14],
];
function rockColor(y, x, z) {
  const band = Math.abs(Math.floor((y + hashNoise(x, z) * 3) / 13)) % STRATA.length;
  const c = STRATA[band];
  const shade = 0.92 + hashNoise(Math.floor(x / 19), Math.floor(z / 19)) * 0.16;
  return [c[0] * shade, c[1] * shade, c[2] * shade];
}

export const RUNWAY = { x: 0, z0: 300, z1: 610, width: 34, y: 0.25 };
RUNWAY.cx = canyonCenterX(455); // runway sits on the floor plain, centred on the gorge axis

export const RINGS = [];
{
  // Golden target rings threaded down the gorge: (z, height, lateral offset)
  const plan = [
    [-60, 26, 0], [-260, 34, 14], [-470, 22, -16], [-680, 44, 8], [-900, 30, -10],
    [-1130, 52, 18], [-1360, 28, 0], [-1590, 40, -18], [-1830, 24, 10], [-2080, 48, 0],
  ];
  for (const [z, y, off] of plan) RINGS.push({ x: canyonCenterX(z) + off, y, z, r: 17, passed: false });
}

export function buildWorld() {
  const g = new GeoBuilder();
  const rnd = mulberry(20261126);

  // --- Canyon terrain: cross-sections swept along Z -----------------------
  const cross = [];
  for (let d = -430; d <= 430; d += 24) cross.push(d);
  const zStep = 34;
  for (let z = WORLD.zStart; z > WORLD.zEnd; z -= zStep) {
    const z2 = z - zStep;
    for (let i = 0; i < cross.length - 1; i++) {
      const d0 = cross[i], d1 = cross[i + 1];
      const x00 = canyonCenterX(z) + d0, x01 = canyonCenterX(z) + d1;
      const x10 = canyonCenterX(z2) + d0, x11 = canyonCenterX(z2) + d1;
      const runFlat = (zz) => zz > RUNWAY.z0 - 30 && zz < RUNWAY.z1 + 30;
      const h = (x, zz, d) => (runFlat(zz) && Math.abs(d) < 120) ? 0 : terrainHeight(x, zz);
      const y00 = h(x00, z, d0), y01 = h(x01, z, d1), y10 = h(x10, z2, d0), y11 = h(x11, z2, d1);
      const midY = (y00 + y01 + y10 + y11) / 4;
      const col = rockColor(midY, (x00 + x11) / 2, (z + z2) / 2);
      const sand = [0.83, 0.62, 0.38];
      const c = midY < 2 ? sand : col;
      g.quad([x00, y00, z], [x10, y10, z2], [x11, y11, z2], [x01, y01, z], c);
    }
  }

  // --- The river: a bright ribbon winding down the floor ------------------
  for (let z = WORLD.zStart; z > WORLD.zEnd + 30; z -= 30) {
    const z2 = z - 30;
    if (z < RUNWAY.z1 + 44 && z > RUNWAY.z0 - 44) continue; // river dives under the airfield culvert
    const cx = canyonCenterX(z), cx2 = canyonCenterX(z2);
    const w = 15 + Math.sin(z * 0.01) * 3;
    const water = [0.13, 0.42, 0.55], glint = [0.35, 0.65, 0.75];
    const c = (Math.floor(z / 30) % 2 === 0) ? water : glint;
    g.quad([cx - w, 0.55, z], [cx2 - w, 0.55, z2], [cx2 + w, 0.55, z2], [cx + w, 0.55, z], c, 0.12);
  }

  // --- Mesa plateaus: flat-topped towers on both rims ---------------------
  const mesaSpots = [
    [-330, -420, 90, 60], [330, -760, 120, 80], [-360, -1150, 80, 55],
    [350, -1520, 130, 90], [-320, -1900, 100, 70], [330, -2240, 90, 60],
    [-300, -180, 70, 48], [310, -2050, 76, 52],
  ];
  for (const [mx, mz, mw, md] of mesaSpots) {
    const cx = canyonCenterX(mz) + mx, base = WORLD.wallTop - 6, top = base + 34 + rnd() * 16;
    for (let s = 0; s < 4; s++) {
      const y = base + (top - base) * (s / 4), y2 = base + (top - base) * ((s + 1) / 4);
      const shrink = 1 - s * 0.07, shrink2 = 1 - (s + 1) * 0.07;
      const c = STRATA[(s + Math.floor(rnd() * 3)) % STRATA.length];
      g.box(cx, (y + y2) / 2, mz, mw * (shrink + shrink2) / 2, (y2 - y) + 0.4, md * (shrink + shrink2) / 2, c);
    }
    g.box(cx, top + 1, mz, mw * 0.72, 2.4, md * 0.72, [0.86, 0.58, 0.33]);
  }

  // --- Scattered boulders and desert scrub on the floor -------------------
  for (let i = 0; i < 130; i++) {
    const z = WORLD.zStart - rnd() * (WORLD.zStart - WORLD.zEnd);
    const side = rnd() > 0.5 ? 1 : -1;
    const d = WORLD.floorHalf + 12 + rnd() * 60;
    const x = canyonCenterX(z) + side * d;
    const y = terrainHeight(x, z);
    const s = 1.5 + rnd() * 4.5;
    if (y > 60) continue;
    g.box(x, y + s * 0.3, z, s, s * 0.8, s * 0.9, rockColor(y + 8, x, z));
  }
  for (let i = 0; i < 90; i++) { // scrub bushes: dark olive crosses
    const z = WORLD.zStart - rnd() * (WORLD.zStart - WORLD.zEnd);
    const d = (rnd() - 0.5) * 90;
    if (Math.abs(d) < 20) continue;
    const x = canyonCenterX(z) + d;
    const c = [0.25 + rnd() * 0.08, 0.36, 0.16];
    g.box(x, 0.8, z, 2.6, 1.6, 0.5, c); g.box(x, 0.8, z, 0.5, 1.6, 2.6, c);
  }

  // --- Viper Field: runway, markings, approach lights, tower --------------
  const rx = RUNWAY.cx;
  g.box(rx, RUNWAY.y, (RUNWAY.z0 + RUNWAY.z1) / 2, RUNWAY.width, 0.5, RUNWAY.z1 - RUNWAY.z0, [0.16, 0.16, 0.18]);
  for (let z = RUNWAY.z0 + 14; z < RUNWAY.z1 - 10; z += 26) // centreline dashes
    g.box(rx, RUNWAY.y + 0.3, z, 1.1, 0.06, 13, [0.95, 0.95, 0.92], 0.25);
  for (const zz of [RUNWAY.z0 + 4, RUNWAY.z1 - 4]) // threshold bars
    for (let k = -3; k <= 3; k++) g.box(rx + k * 4.2, RUNWAY.y + 0.3, zz, 2.4, 0.06, 3.2, [0.95, 0.95, 0.92], 0.25);
  for (let z = RUNWAY.z0; z <= RUNWAY.z1; z += 22) { // edge + approach lights (emissive amber)
    g.box(rx - RUNWAY.width / 2 - 2, 0.9, z, 0.7, 0.7, 0.7, [1.0, 0.72, 0.25], 1.0);
    g.box(rx + RUNWAY.width / 2 + 2, 0.9, z, 0.7, 0.7, 0.7, [1.0, 0.72, 0.25], 1.0);
  }
  for (let i = 1; i <= 6; i++) // approach light gantry south of the threshold
    g.box(rx, 0.9, RUNWAY.z1 + i * 16, 0.8, 0.8, 0.8, [0.35, 0.95, 0.55], 1.0);
  // Tower + hangars on the east apron
  const tx = rx + 62;
  g.box(tx, 7, 470, 10, 14, 10, [0.78, 0.70, 0.58]);
  g.box(tx, 15.4, 470, 12, 2.6, 12, [0.20, 0.45, 0.55], 0.55); // glass cab, lit
  g.box(tx, 18.6, 470, 1, 4, 1, [0.3, 0.3, 0.3]);
  g.box(tx, 20.8, 470, 0.9, 0.9, 0.9, [1, 0.25, 0.2], 1.0); // beacon
  g.box(rx + 58, 3.4, 380, 26, 6.8, 16, [0.55, 0.42, 0.30]);
  g.box(rx + 58, 7.2, 380, 27, 0.8, 17, [0.35, 0.25, 0.18]);
  g.box(rx - 58, 3.4, 540, 22, 6.8, 14, [0.60, 0.46, 0.33]);

  // --- Target rings: golden torus + inner chevrons -------------------------
  for (const r of RINGS) {
    g.ring(r.x, r.y, r.z, r.r, r.r - 2.2, [1.0, 0.78, 0.22], 0.95);
    g.ring(r.x, r.y, r.z, r.r - 3.4, r.r - 4.1, [1.0, 0.92, 0.55], 0.7);
    g.box(r.x, r.y + r.r + 2.5, r.z, 1.2, 3.4, 1.2, [1.0, 0.78, 0.22], 0.8);
  }
  return g.build();
}
