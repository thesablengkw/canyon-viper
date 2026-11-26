// flight3d.js — Canyon Viper v3 world & aircraft, built on vendored Three.js.
// A single height function carves the gorge (physics reads the same function),
// the VF-9 is a lathe-turned fuselage with extruded bevelled wings, and every
// material is MeshStandardMaterial under an ACES-graded golden-hour rig.
'use strict';

// ---------- shared terrain mathematics ---------------------------------------
const GORGE_START = 60, RUNWAY_Z0 = 300, RUNWAY_Z1 = 610;
function gorgeCentreX(z) {
  if (z > GORGE_START) return 0;
  const t = (GORGE_START - z) / 900;
  return Math.sin(t * 2.6) * 34 * Math.min(1, t + 0.25);
}
function gorgeHalfWidth(z) { return z > GORGE_START ? 420 : 62 + Math.sin(z * 0.011) * 9; }
function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
function ridgeNoise(x, z) {
  return Math.sin(x * 0.021 + z * 0.013) * 3.2 + Math.sin(x * 0.052 - z * 0.031) * 1.6 + Math.sin((x + z) * 0.11) * 0.7;
}
const MESAS = [[-330, -260, 120, 74], [330, -520, 150, 88], [-360, -860, 130, 66], [350, -1150, 165, 96], [-300, -1420, 120, 70], [290, -160, 105, 58]];
function terrainHeight(x, z) {
  if (z > GORGE_START) {
    const dune = Math.max(0, Math.hypot(x, z - 700) - 300) * 0.045;
    return 14 + dune + ridgeNoise(x, z) * 0.35 * smoothstep(120, 420, Math.abs(x));
  }
  const cx = gorgeCentreX(z), hw = gorgeHalfWidth(z), d = Math.abs(x - cx);
  let h;
  if (d < hw) h = 8 + ridgeNoise(x, z) * 0.3;                                   // gorge floor
  else { const t = smoothstep(hw, hw + 95, d); h = 8 + t * 112 + ridgeNoise(x, z) * (1 + t * 5); } // walls to rim
  for (const [mx, mz, mw, mh] of MESAS) {
    const dd = Math.hypot((x - mx) / (mw * 0.72), (z - mz) / (mw * 0.72));
    if (dd < 1.6) h = Math.max(h, 14 + mh * Math.pow(Math.max(0, 1 - dd * dd), 0.7));
  }
  return h;
}
function wallClearance(x, z) { return z > GORGE_START ? 999 : gorgeHalfWidth(z) - Math.abs(x - gorgeCentreX(z)); }

// ---------- glow sprite texture (radial gradient, for light halos) -----------
function glowTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.32)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(cv);
}
let GLOW_TEX = null;
function addGlow(parent, x, y, z, size, color, opacity = 0.85) {
  if (!GLOW_TEX) GLOW_TEX = glowTexture();
  const m = new THREE.SpriteMaterial({ map: GLOW_TEX, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
  const sp = new THREE.Sprite(m); sp.position.set(x, y, z); sp.scale.set(size, size, 1);
  parent.add(sp); return sp;
}

// ---------- the world ---------------------------------------------------------
function buildWorld3D(scene) {
  const std = (color, rough, metal, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });

  // Heightmap terrain with strata vertex colours.
  const W = 1700, D = 3000, SX = 150, SZ = 264;
  const geo = new THREE.PlaneGeometry(W, D, SX, SZ);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, colors = new Float32Array(pos.count * 3);
  const cSand = new THREE.Color(0xc99a5e), cFloor = new THREE.Color(0xbd8a52), cRockA = new THREE.Color(0xa55f3a),
    cRockB = new THREE.Color(0x8a4a30), cRockC = new THREE.Color(0xc07a4c), cRim = new THREE.Color(0xd8ab6c), tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i) - 420;
    const h = terrainHeight(x, z);
    pos.setY(i, h); pos.setZ(i, z);
    const inGorge = z <= GORGE_START && Math.abs(x - gorgeCentreX(z)) < gorgeHalfWidth(z) + 130;
    if (h < 11 && inGorge) tmp.copy(cFloor);
    else if (h > 100) tmp.copy(cRim);
    else if (inGorge || h > 30) { const band = 0.5 + 0.5 * Math.sin(h * 0.32 + ridgeNoise(x, z) * 0.8); tmp.copy(cRockA).lerp(band > 0.55 ? cRockC : cRockB, 0.45); }
    else tmp.copy(cSand);
    const shade = 0.92 + (ridgeNoise(x * 2.3, z * 2.3) * 0.5 + 0.5) * 0.14;
    colors[i * 3] = tmp.r * shade; colors[i * 3 + 1] = tmp.g * shade; colors[i * 3 + 2] = tmp.b * shade;
  }
  geo.computeVertexNormals();
  // Slope shading: steep faces darken into shadowed rock, flats stay bright.
  const nrm = geo.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const f = 0.68 + 0.32 * Math.max(0, nrm.getY(i));
    colors[i * 3] *= f; colors[i * 3 + 1] *= f; colors[i * 3 + 2] *= f;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0.0 }));
  terrain.receiveShadow = true;
  scene.add(terrain);

  // River ribbon with sun-glint material.
  const riverPts = [];
  for (let z = 40; z >= -1560; z -= 40) riverPts.push(z);
  const rGeo = new THREE.BufferGeometry(), rPos = [], rIdx = [];
  riverPts.forEach((z, i) => {
    const cx = gorgeCentreX(z);
    rPos.push(cx - 14, 8.75, z, cx + 14, 8.75, z);
    if (i > 0) { const a = (i - 1) * 2; rIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  });
  rGeo.setAttribute('position', new THREE.Float32BufferAttribute(rPos, 3));
  rGeo.setIndex(rIdx); rGeo.computeVertexNormals();
  const river = new THREE.Mesh(rGeo, std(0x3d84a8, 0.14, 0.55));
  scene.add(river);

  // Sandstone arch bridge spanning the gorge.
  const arch = new THREE.Mesh(new THREE.TorusGeometry(46, 6.5, 10, 22, Math.PI), std(0xb06a41, 0.9, 0));
  arch.position.set(gorgeCentreX(-700), 8, -700); arch.rotation.z = 0; arch.castShadow = true; arch.receiveShadow = true;
  scene.add(arch);

  // --- Viper Field ---
  const field = new THREE.Group(); scene.add(field);
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 1024;
  const c2 = cv.getContext('2d');
  c2.fillStyle = '#3d3d40'; c2.fillRect(0, 0, 256, 1024);
  for (let i = 0; i < 9000; i++) { c2.fillStyle = ['#4a4a4e', '#333336', '#55555a'][i % 3]; c2.fillRect(Math.random() * 256, Math.random() * 1024, 2, 2); }
  c2.fillStyle = '#e8eaec';
  for (let y = 60; y < 1024; y += 128) c2.fillRect(124, y, 8, 62);
  c2.fillRect(28, 12, 200, 10); c2.fillRect(28, 980, 200, 10);
  for (let i = 0; i < 6; i++) { c2.fillRect(52, 30 + i * 26, 34, 14); c2.fillRect(170, 30 + i * 26, 34, 14); }
  const rwyTex = new THREE.CanvasTexture(cv);
  const runway = new THREE.Mesh(new THREE.PlaneGeometry(44, RUNWAY_Z1 - RUNWAY_Z0), new THREE.MeshStandardMaterial({ map: rwyTex, roughness: 0.6, metalness: 0.05 }));
  runway.rotation.x = -Math.PI / 2; runway.position.set(0, 14.32, (RUNWAY_Z0 + RUNWAY_Z1) / 2);
  runway.receiveShadow = true; field.add(runway);
  const amber = std(0xff9a1e, 0.4, 0.2, { emissive: 0xff8c1a, emissiveIntensity: 1.6 });
  const green = std(0x2eff7a, 0.4, 0.2, { emissive: 0x22ff66, emissiveIntensity: 1.6 });
  for (let z = RUNWAY_Z0; z <= RUNWAY_Z1; z += 31) for (const sx of [-23.5, 23.5]) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), amber);
    lamp.position.set(sx, 15.2, z); field.add(lamp); addGlow(field, sx, 15.2, z, 4.2, 0xffa028, 0.5);
  }
  for (let i = -4; i <= 4; i++) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 8), green);
    lamp.position.set(i * 4.6, 15.3, RUNWAY_Z0 - 8); field.add(lamp); addGlow(field, i * 4.6, 15.3, RUNWAY_Z0 - 8, 4.6, 0x2eff7a, 0.55);
  }
  for (let i = 1; i <= 4; i++) addGlow(field, 0, 15.2, RUNWAY_Z0 - 8 - i * 26, 3.8, 0x2eff7a, 0.5);
  // Tower, hangars, windsock.
  const conc = std(0xbdb8ae, 0.8, 0.05), dark = std(0x2c3138, 0.6, 0.4);
  const tower = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(7, 20, 7), conc); shaft.position.y = 10; shaft.castShadow = true; tower.add(shaft);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(10, 4.2, 10), std(0x9fd8e8, 0.08, 0.85)); cab.position.y = 22; tower.add(cab);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(11, 0.6, 11), dark); roof.position.y = 24.4; tower.add(roof);
  tower.position.set(52, 14, 430); field.add(tower);
  for (const hx of [-58, 62]) {
    const hangar = new THREE.Group();
    const walls = new THREE.Mesh(new THREE.BoxGeometry(30, 9, 20), std(0x8d8578, 0.85, 0.05)); walls.position.y = 4.5; walls.castShadow = true; hangar.add(walls);
    const hroof = new THREE.Mesh(new THREE.SphereGeometry(10.4, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), dark);
    hroof.scale.set(1.45, 0.72, 0.98); hroof.position.y = 9; hangar.add(hroof);
    hangar.position.set(hx, 14, 520); field.add(hangar);
  }
  // Scrub + palms: olive blobs and simple palms near the field and river mouth.
  const scrubMat = std(0x5a6e35, 0.95, 0), trunkMat = std(0x7a5c38, 0.9, 0), frondMat = std(0x3f7031, 0.9, 0);
  for (let i = 0; i < 60; i++) {
    const bx = Math.sin(i * 37.7) * 420, bz = 120 + ((i * 53) % 800);
    if (Math.abs(bx) < 48 && bz > 260 && bz < 660) continue;
    if (i % 4 === 0) {
      const palm = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, 6.4, 6), trunkMat); trunk.position.y = 3.2; trunk.rotation.z = 0.12; palm.add(trunk);
      for (let f = 0; f < 6; f++) {
        const frond = new THREE.Mesh(new THREE.ConeGeometry(0.5, 4.6, 5), frondMat);
        frond.position.set(Math.cos(f) * 1.6, 6.9, Math.sin(f) * 1.6);
        frond.rotation.set(Math.sin(f) * 1.1, 0, Math.cos(f) * 1.1 + Math.PI / 2.4);
        palm.add(frond);
      }
      palm.position.set(bx, terrainHeight(bx, bz), bz); field.add(palm);
    } else {
      const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1 + (i % 4) * 0.4, 0), scrubMat);
      bush.position.set(bx, terrainHeight(bx, bz) + 0.7, bz); bush.castShadow = true; field.add(bush);
    }
  }
  return { river };
}

// ---------- the VF-9 Viper -----------------------------------------------------
function buildJet3D() {
  const jet = new THREE.Group();
  const silver = new THREE.MeshStandardMaterial({ color: 0xb9c3cd, roughness: 0.34, metalness: 0.85 });
  const charcoal = new THREE.MeshStandardMaterial({ color: 0x2e343b, roughness: 0.5, metalness: 0.7 });
  const red = new THREE.MeshStandardMaterial({ color: 0xb3312a, roughness: 0.45, metalness: 0.6 });

  // Lathe-turned fuselage: pointed nose, swelling intake body, tapered tail.
  const profile = [[0.02, -8.2], [0.16, -7.4], [0.34, -6.2], [0.55, -4.8], [0.74, -3.2], [0.84, -1.4], [0.86, 0.2],
    [0.82, 1.8], [0.76, 3.4], [0.68, 5.0], [0.6, 6.4], [0.55, 7.0]].map(([r, z]) => new THREE.Vector2(r, z));
  const fus = new THREE.Mesh(new THREE.LatheGeometry(profile, 22), silver);
  fus.rotation.x = Math.PI / 2;   // lathe axis Y -> fuselage axis Z (nose toward -Z after rotation sign check in scene)
  fus.castShadow = true; jet.add(fus);
  // Charcoal spine stripe + red tail band.
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 6.8), charcoal);
  spine.position.set(0, 0.82, 0.4); jet.add(spine);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.585, 0.6, 0.5, 18), red);
  band.rotation.x = Math.PI / 2; band.position.set(0, 0, 6.2); jet.add(band);

  // Bubble canopy: scaled sphere, glossy tinted.
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.78, 20, 14),
    new THREE.MeshStandardMaterial({ color: 0x14405a, roughness: 0.05, metalness: 0.9 }));
  canopy.scale.set(0.92, 0.66, 2.1); canopy.position.set(0, 0.62, -2.2); jet.add(canopy);

  // Extruded delta wings with bevelled edges (mirrored pair).
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0.6, -0.8); wingShape.lineTo(5.0, 1.9); wingShape.lineTo(5.0, 2.8); wingShape.lineTo(0.6, 1.1); wingShape.closePath();
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.13, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.06, bevelSegments: 1 });
  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(wingGeo, silver);
    wing.rotation.x = Math.PI / 2; wing.scale.x = s; wing.position.set(0, -0.12, 0);
    wing.castShadow = true; jet.add(wing);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.85),
      new THREE.MeshStandardMaterial({ color: 0x27e8ff, emissive: 0x18c8ee, emissiveIntensity: 2.2 }));
    tip.position.set(s * 5.02, -0.28, 2.3); jet.add(tip);
    addGlow(jet, s * 5.15, -0.28, 2.3, 1.6, 0x27e8ff, 0.7);
    // Red leading-edge accent strip.
    const accent = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.06, 0.3), red);
    accent.position.set(s * 2.9, -0.05, 0.62); accent.rotation.y = s * 0.42; jet.add(accent);
  }
  // Tailplanes + canted twin fins (extruded profiles).
  const tailShape = new THREE.Shape();
  tailShape.moveTo(0.5, 4.5); tailShape.lineTo(2.8, 5.9); tailShape.lineTo(2.8, 6.5); tailShape.lineTo(0.5, 5.6); tailShape.closePath();
  const tailGeo = new THREE.ExtrudeGeometry(tailShape, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 1 });
  for (const s of [-1, 1]) {
    const tp = new THREE.Mesh(tailGeo, silver);
    tp.rotation.x = Math.PI / 2; tp.scale.x = s; tp.position.set(0, 0.05, 0); jet.add(tp);
    const finShape = new THREE.Shape();
    finShape.moveTo(4.2, 0.25); finShape.lineTo(5.5, 2.15); finShape.lineTo(6.3, 2.2); finShape.lineTo(5.95, 0.3); finShape.closePath();
    const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.09, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1 });
    const fin = new THREE.Mesh(finGeo, charcoal);
    fin.rotation.set(0, -Math.PI / 2, 0);       // shape X (body length) -> world Z
    fin.rotateX(s * 0.31);                       // ~18° outward cant about the body axis
    fin.position.set(s * 0.58, 0.1, 0);
    // Amber tip as a CHILD of the fin (shape-space coords) so it can never detach.
    const finTip = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.17, 0.17),
      new THREE.MeshStandardMaterial({ color: 0xffa028, emissive: 0xff8c1a, emissiveIntensity: 1.4 }));
    finTip.position.set(5.92, 2.26, 0.05);
    fin.add(finTip);
    jet.add(fin);
  }
  // Under-wing stores: missile (outboard) + drop tank (inboard) per side.
  for (const s of [-1, 1]) {
    const missile = new THREE.Group();
    const mBody = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 1.9, 10), silver); mBody.rotation.x = Math.PI / 2; missile.add(mBody);
    const mNose = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.8, 10), red); mNose.rotation.x = -Math.PI / 2; mNose.position.z = -1.35; missile.add(mNose);
    const mFin = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.05, 0.3), charcoal); mFin.position.z = 0.85; missile.add(mFin);
    const mFin2 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.55, 0.3), charcoal); mFin2.position.z = 0.85; missile.add(mFin2);
    missile.position.set(s * 3.1, -0.85, 1.5); jet.add(missile);
    const tank = new THREE.Group();
    const tBody = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 1.8, 10), charcoal); tBody.rotation.x = Math.PI / 2; tank.add(tBody);
    const tNose = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), charcoal); tNose.position.z = -0.9; tank.add(tNose);
    const tTail = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.6, 10), charcoal); tTail.rotation.x = Math.PI / 2; tTail.position.z = 1.2; tank.add(tTail);
    tank.position.set(s * 1.7, -0.82, 1.4); jet.add(tank);
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.6), charcoal);
    pylon.position.set(s * 3.1, -0.6, 1.5); jet.add(pylon);
  }
  // Twin nozzles + afterburner cones (scaled by throttle in the loop).
  const burners = [];
  for (const s of [-1, 1]) {
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.33, 0.55, 14, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x777d84, roughness: 0.3, metalness: 0.95, side: THREE.DoubleSide }));
    nozzle.rotation.x = Math.PI / 2; nozzle.position.set(s * 0.34, 0, 7.1); jet.add(nozzle);
    const core = new THREE.Mesh(new THREE.CircleGeometry(0.24, 14),
      new THREE.MeshStandardMaterial({ color: 0xff7a1e, emissive: 0xff6a00, emissiveIntensity: 2.4 }));
    core.position.set(s * 0.34, 0, 7.36); jet.add(core);
    const coneOuter = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.9, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x2a6cff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    coneOuter.rotation.x = Math.PI / 2; coneOuter.position.set(s * 0.34, 0, 8.3); jet.add(coneOuter);
    const coneInner = new THREE.Mesh(new THREE.ConeGeometry(0.12, 1.25, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xff8c2e, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    coneInner.rotation.x = Math.PI / 2; coneInner.position.set(s * 0.34, 0, 7.98); jet.add(coneInner);
    addGlow(jet, s * 0.34, 0, 7.6, 1.1, 0xff7a1e, 0.5);
    burners.push({ coneOuter, coneInner });
  }
  // Tricycle gear (own group so it can retract cleanly).
  const gear = new THREE.Group();
  const strutMat = new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.35, metalness: 0.85 });
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.9, metalness: 0 });
  const mkLeg = (x, z) => {
    const leg = new THREE.Group();
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.15, 8), strutMat); strut.position.y = -0.55; leg.add(strut);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 12), tyreMat);
    wheel.rotation.z = Math.PI / 2; wheel.position.y = -1.2; leg.add(wheel);
    leg.position.set(x, -0.5, z); gear.add(leg);
  };
  mkLeg(0, -4.6); mkLeg(-1.15, 3.2); mkLeg(1.15, 3.2);
  jet.add(gear);
  jet.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { jet, gear, burners };
}

// ---------- cockpit (pilot view): sloped dash + 3 canvas-texture MFDs ---------
function mfdTexture(kind) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 192;
  const x = cv.getContext('2d');
  x.fillStyle = '#04141c'; x.fillRect(0, 0, 256, 192);
  x.strokeStyle = 'rgba(90,220,255,0.25)'; x.strokeRect(4, 4, 248, 184);
  if (kind === 'radar') {
    x.strokeStyle = '#2eff8a'; x.lineWidth = 2;
    for (const r of [26, 52, 78]) { x.beginPath(); x.arc(128, 96, r, 0, 7); x.stroke(); }
    x.strokeStyle = '#7dffb0'; x.beginPath(); x.moveTo(128, 96); x.lineTo(178, 52); x.stroke();
    x.fillStyle = '#ffd23e';
    for (const [bx, by] of [[160, 70], [96, 120], [140, 140]]) { x.beginPath(); x.arc(bx, by, 5, 0, 7); x.fill(); }
    x.fillStyle = '#2eff8a'; x.font = 'bold 15px monospace'; x.fillText('TGT LOCK', 14, 24);
  } else if (kind === 'horizon') {
    x.fillStyle = '#1d4e79'; x.fillRect(8, 8, 240, 88);
    x.fillStyle = '#5e3d1c'; x.fillRect(8, 96, 240, 88);
    x.strokeStyle = '#fff'; x.lineWidth = 3; x.beginPath(); x.moveTo(8, 96); x.lineTo(248, 96); x.stroke();
    x.lineWidth = 2;
    for (const d of [-30, -15, 15, 30]) { x.beginPath(); x.moveTo(96, 96 + d); x.lineTo(160, 96 + d); x.stroke(); }
    x.strokeStyle = '#ffd23e'; x.lineWidth = 4;
    x.beginPath(); x.moveTo(78, 96); x.lineTo(112, 96); x.lineTo(128, 106); x.lineTo(144, 96); x.lineTo(178, 96); x.stroke();
  } else {
    const bars = [['N1', 0.82, '#35e0ff'], ['N2', 0.68, '#35e0ff'], ['EGT', 0.45, '#ffa028']];
    x.font = 'bold 14px monospace';
    bars.forEach(([lab, f, col], i) => {
      const y = 34 + i * 38;
      x.fillStyle = '#bfe9ff'; x.fillText(lab, 14, y + 14);
      x.fillStyle = 'rgba(255,255,255,0.15)'; x.fillRect(56, y, 180, 16);
      x.fillStyle = col; x.fillRect(56, y, 180 * f, 16);
    });
    x.fillStyle = '#35e0c8';
    for (let r = 0; r < 2; r++) for (let i = 0; i < 8; i++) x.fillRect(16 + i * 29, 152 + r * 20, 20, 10);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function buildCockpit3D() {
  const g = new THREE.Group();
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x141a20, roughness: 0.65, metalness: 0.35 });
  const dash = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.18, 1.5), panelMat);
  dash.position.set(0, -0.62, -2.15); dash.rotation.x = 0.5; g.add(dash);
  const glare = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.5, 0.16), panelMat);
  glare.position.set(0, -0.18, -2.72); glare.rotation.x = 0.5; g.add(glare);
  const console_ = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 1.6), panelMat);
  console_.position.set(0, -1.25, -1.1); g.add(console_);
  const kinds = ['radar', 'horizon', 'engine'];
  kinds.forEach((kind, i) => {
    const tex = mfdTexture(kind);
    const mfd = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 0.62),
      new THREE.MeshBasicMaterial({ map: tex }));
    mfd.position.set((i - 1) * 1.08, -0.38, -2.32);
    mfd.rotation.x = -0.5;   // flush with the sloped dash, facing up at the pilot
    g.add(mfd);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.06, 0.78), panelMat);
    frame.position.set((i - 1) * 1.08, -0.455, -2.31); frame.rotation.x = 0.5; g.add(frame);
  });
  // Canopy uprights + HUD glass with a drawn reticle.
  for (const s of [-1, 1]) {
    const up = new THREE.Mesh(new THREE.BoxGeometry(0.13, 1.7, 0.13), panelMat);
    up.position.set(s * 1.42, 0.55, -1.7); up.rotation.x = 0.25; g.add(up);
  }
  const hudCv = document.createElement('canvas'); hudCv.width = hudCv.height = 128;
  const hx = hudCv.getContext('2d');
  hx.strokeStyle = 'rgba(120,255,220,0.95)'; hx.lineWidth = 4;
  hx.beginPath(); hx.moveTo(24, 64); hx.lineTo(52, 64); hx.moveTo(76, 64); hx.lineTo(104, 64);
  hx.moveTo(64, 40); hx.lineTo(64, 88); hx.stroke();
  hx.beginPath(); hx.arc(64, 64, 30, 0, 7); hx.lineWidth = 2; hx.stroke();
  const hudGlass = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(hudCv), transparent: true, opacity: 0.9, depthWrite: false }));
  hudGlass.position.set(0, 0.55, -1.85); hudGlass.rotation.x = -0.12; g.add(hudGlass);
  return g;
}
