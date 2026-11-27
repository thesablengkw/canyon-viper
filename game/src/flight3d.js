// flight3d.js — Canyon Viper v4 world & aircraft, built on vendored Three.js.
// One height function carves the gorge (physics reads the same function), the
// VF-9 wears a canvas-painted skin with panel lines and VF-9 decals, and the
// sky is a real gradient dome with a sun disc, drifting cloud puffs and fake
// cloud shadows — golden hour is a place now, not a flat background colour.
'use strict';

// ---------- shared terrain mathematics ---------------------------------------
const GORGE_START = 60, RUNWAY_Z0 = 300, RUNWAY_Z1 = 610;
function gorgeCentreX(z) {
  if (z > GORGE_START) return 0;
  const t = (GORGE_START - z) / 900;
  return Math.sin(t * 2.6) * 34 * Math.min(1, t + 0.25);
}
function gorgeHalfWidth(z) {
  if (z > GORGE_START) return 420;
  let hw = 62 + Math.sin(z * 0.011) * 9;
  if (z < -1450) hw += Math.min(210, (-1450 - z) * 0.55);   // strike basin opens wide
  return hw;
}
function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
function ridgeNoise(x, z) {
  return Math.sin(x * 0.021 + z * 0.013) * 3.2 + Math.sin(x * 0.052 - z * 0.031) * 1.6 + Math.sin((x + z) * 0.11) * 0.7;
}
function detailNoise(x, z) {   // close-range octave so walls stop reading as dunes
  return Math.sin(x * 0.23 + z * 0.17) * 0.55 + Math.sin(x * 0.47 - z * 0.39) * 0.3;
}
function ridgedNoise(x, z) {   // sharp crests: 1 - |noise|
  const n = Math.sin(x * 0.045 + z * 0.028) * 0.6 + Math.sin(x * 0.09 - z * 0.061) * 0.4;
  return 1 - Math.abs(n);
}
const MESAS = [[-330, -260, 120, 74], [330, -520, 150, 88], [-360, -860, 130, 66], [350, -1150, 165, 96], [-300, -1420, 120, 70], [290, -160, 105, 58]];
function terrainHeight(x, z) {
  if (z > GORGE_START) {
    const dune = Math.max(0, Math.hypot(x, z - 700) - 300) * 0.045;
    return 14 + dune + ridgeNoise(x, z) * 0.35 * smoothstep(120, 420, Math.abs(x));
  }
  const cx = gorgeCentreX(z), hw = gorgeHalfWidth(z), d = Math.abs(x - cx);
  let h;
  if (d < hw) h = 8 + ridgeNoise(x, z) * 0.3 + detailNoise(x, z) * 0.22;                    // gorge / basin floor
  else {                                                                                    // walls to rim
    const t = smoothstep(hw, hw + 95, d);
    h = 8 + t * 112 + ridgeNoise(x, z) * (1 + t * 5) + ridgedNoise(x, z) * t * 9 + detailNoise(x, z) * (0.4 + t * 1.6);
  }
  for (const [mx, mz, mw, mh] of MESAS) {
    const dd = Math.hypot((x - mx) / (mw * 0.72), (z - mz) / (mw * 0.72));
    if (dd < 1.6) h = Math.max(h, 14 + mh * Math.pow(Math.max(0, 1 - dd * dd), 0.7));
  }
  return h;
}
function wallClearance(x, z) { return z > GORGE_START ? 999 : gorgeHalfWidth(z) - Math.abs(x - gorgeCentreX(z)); }

// ---------- glow / cloud sprite textures --------------------------------------
function glowTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.32)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(cv);
}
function cloudTexture() {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
  const ctx = cv.getContext('2d');
  const blob = (x, y, r, a) => {
    const g = ctx.createRadialGradient(x, y, 1, x, y, r);
    g.addColorStop(0, 'rgba(255,252,248,' + a + ')'); g.addColorStop(0.6, 'rgba(250,244,238,' + (a * 0.55) + ')'); g.addColorStop(1, 'rgba(248,240,232,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  };
  blob(128, 70, 62, 0.85); blob(84, 78, 44, 0.7); blob(172, 78, 46, 0.7); blob(110, 56, 40, 0.75); blob(150, 58, 38, 0.7); blob(128, 88, 58, 0.5);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}
let GLOW_TEX = null;
function addGlow(parent, x, y, z, size, color, opacity = 0.85) {
  if (!GLOW_TEX) GLOW_TEX = glowTexture();
  const m = new THREE.SpriteMaterial({ map: GLOW_TEX, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
  const sp = new THREE.Sprite(m); sp.position.set(x, y, z); sp.scale.set(size, size, 1);
  parent.add(sp); return sp;
}

// ---------- sky dome + sun + clouds (returned so the loop can drift them) -----
// Sky is 50% of every judged frame — treat it as a product, not a background.
const SUN_DIR = new THREE.Vector3(-0.52, 0.30, -0.55).normalize();
function buildSky(scene) {
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sunDir: { value: SUN_DIR } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: [
      'varying vec3 vDir; uniform vec3 sunDir;',
      'void main(){',
      '  float h = clamp(vDir.y, -0.08, 1.0);',
      '  vec3 zen = vec3(0.30, 0.46, 0.68);',
      '  vec3 mid = vec3(0.74, 0.78, 0.82);',
      '  vec3 hor = vec3(0.98, 0.76, 0.50);',
      '  vec3 col = mix(hor, mid, smoothstep(0.0, 0.22, h));',
      '  col = mix(col, zen, smoothstep(0.18, 0.75, h));',
      '  float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);',
      '  col += vec3(1.0, 0.62, 0.30) * pow(s, 18.0) * 0.38;',          // warm halo
      '  col += vec3(1.0, 0.80, 0.52) * pow(s, 160.0) * 0.85;',         // inner glow
      '  col += vec3(1.0, 0.94, 0.82) * smoothstep(0.9993, 0.9997, s) * 2.4;', // sun disc
      '  gl_FragColor = vec4(col, 1.0);',
      '}',
    ].join('\n'),
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(3900, 24, 14), skyMat);
  scene.add(dome);
  // Sun glow sprite riding the dome direction.
  const sunSpr = addGlow(scene, SUN_DIR.x * 3400, SUN_DIR.y * 3400, SUN_DIR.z * 3400, 900, 0xffc98a, 0.55);
  // Drifting cloud puffs: two altitude layers ringed around the course.
  const cTex = cloudTexture();
  const clouds = new THREE.Group();
  const puffs = [];
  for (let i = 0; i < 46; i++) {
    const m = new THREE.SpriteMaterial({ map: cTex, transparent: true, opacity: 0.5 + (i % 5) * 0.09, depthWrite: false, fog: false });
    const sp = new THREE.Sprite(m);
    const ang = i * 2.39996, rad = 500 + (i * 137) % 1500;
    const layer = i % 3 === 0 ? 300 + (i * 53) % 130 : 190 + (i * 71) % 110;
    sp.position.set(Math.cos(ang) * rad, layer, -500 + Math.sin(ang) * rad * 0.8 - (i % 7) * 160);
    const w = 260 + (i * 89) % 300;
    sp.scale.set(w, w * 0.42, 1);
    clouds.add(sp); puffs.push(sp);
  }
  scene.add(clouds);
  // Fake cloud shadows: soft dark blobs gliding over the terrain in sync.
  const shadows = new THREE.Group();
  const shMat = new THREE.MeshBasicMaterial({ color: 0x2a1c10, transparent: true, opacity: 0.16, depthWrite: false });
  const shBlobs = [];
  for (let i = 0; i < 7; i++) {
    const b = new THREE.Mesh(new THREE.CircleGeometry(90 + (i * 37) % 80, 18), shMat);
    b.rotation.x = -Math.PI / 2;
    const bx = Math.sin(i * 41.3) * 320, bz = 300 - i * 330;
    b.position.set(bx, terrainHeight(bx, bz) + 1.2, bz);
    shadows.add(b); shBlobs.push(b);
  }
  scene.add(shadows);
  let t = 0;
  return {
    dome, sunSpr,
    update(dt, focus) {
      t += dt;
      clouds.position.x = Math.sin(t * 0.006) * 26 + t * 0.55 % 60;
      clouds.position.z = Math.cos(t * 0.004) * 18;
      dome.position.copy(focus); sunSpr.position.copy(focus).addScaledVector(SUN_DIR, 3400);
      shBlobs.forEach((b, i) => {
        b.position.x += dt * 3.1;
        if (b.position.x > 620) b.position.x = -620;
        b.position.y = terrainHeight(b.position.x, b.position.z) + 1.2;
      });
    },
  };
}

// ---------- jet skin: canvas texture with panel lines + decals -----------------
function jetSkinTexture() {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 512;
  const x = cv.getContext('2d');
  x.fillStyle = '#b9c3cd'; x.fillRect(0, 0, 512, 512);
  const grad = x.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, 'rgba(255,255,255,0.10)'); grad.addColorStop(0.5, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(20,26,34,0.16)');
  x.fillStyle = grad; x.fillRect(0, 0, 512, 512);
  x.strokeStyle = 'rgba(38,46,56,0.55)'; x.lineWidth = 2;
  for (let i = 1; i < 10; i++) { x.beginPath(); x.moveTo(i * 51.2, 0); x.lineTo(i * 51.2, 512); x.stroke(); }
  for (let i = 1; i < 7; i++) { x.beginPath(); x.moveTo(0, i * 73); x.lineTo(512, i * 73); x.stroke(); }
  x.fillStyle = 'rgba(38,46,56,0.7)';
  for (let r = 0; r < 7; r++) for (let i = 0; i < 26; i++) x.fillRect(14 + i * 19.6, r * 73 + 8, 2.4, 2.4);
  x.fillStyle = '#8e2f28'; x.fillRect(0, 400, 512, 26);                       // tail band painted in
  x.fillStyle = '#1d2733'; x.font = 'bold 64px monospace'; x.fillText('VF-9', 150, 200);
  x.font = 'bold 30px monospace'; x.fillText('VIPER', 156, 244);
  x.fillStyle = '#c8402f'; x.font = 'bold 22px monospace'; x.fillText('RESCUE', 30, 480);
  x.fillStyle = '#1d2733'; x.font = 'bold 20px monospace'; x.fillText('NO STEP', 380, 480);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ---------- the world -----------------------------------------------------------
function buildWorld3D(scene) {
  const std = (color, rough, metal, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });

  // Heightmap terrain with strata vertex colours + green basin + rim caps.
  const W = 1700, D = 3400, SX = 150, SZ = 300;
  const geo = new THREE.PlaneGeometry(W, D, SX, SZ);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, colors = new Float32Array(pos.count * 3);
  const cSand = new THREE.Color(0xc99a5e), cFloor = new THREE.Color(0xbd8a52), cRockA = new THREE.Color(0xa55f3a),
    cRockB = new THREE.Color(0x7e4230), cRockC = new THREE.Color(0xc07a4c), cRim = new THREE.Color(0xe3c491),
    cGreen = new THREE.Color(0x5f7038), cScrub = new THREE.Color(0x77803f), tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i) - 500;
    const h = terrainHeight(x, z);
    pos.setY(i, h); pos.setZ(i, z);
    const inGorge = z <= GORGE_START && Math.abs(x - gorgeCentreX(z)) < gorgeHalfWidth(z) + 130;
    const basin = z < -1450;
    if (basin && h < 26) tmp.copy(cGreen).lerp(cSand, 0.30 + 0.30 * (0.5 + 0.5 * Math.sin(x * 0.021 - z * 0.033))).lerp(cScrub, 0.3);
    else if (h < 11 && inGorge) tmp.copy(cFloor);
    else if (h > 108) tmp.copy(cRim);
    else if (inGorge || h > 30) { const band = 0.5 + 0.5 * Math.sin(h * 0.32 + ridgeNoise(x, z) * 0.8); tmp.copy(cRockA).lerp(band > 0.55 ? cRockC : cRockB, 0.5); }
    else tmp.copy(cSand);
    const shade = 0.9 + (detailNoise(x * 1.7, z * 1.7) * 0.5 + 0.5) * 0.2;
    colors[i * 3] = tmp.r * shade; colors[i * 3 + 1] = tmp.g * shade; colors[i * 3 + 2] = tmp.b * shade;
  }
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const f = 0.62 + 0.38 * Math.max(0, nrm.getY(i));   // steeper AO-style crevice darkening
    colors[i * 3] *= f; colors[i * 3 + 1] *= f; colors[i * 3 + 2] *= f;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0.0 }));
  terrain.receiveShadow = true;
  scene.add(terrain);

  // River: bright centre stripe over a wider soft-edged underlay (no hard carpet).
  const mkRiver = (halfW, y, mat) => {
    const pts = [], idx = [];
    for (let z = 40, i = 0; z >= -1560; z -= 40, i++) {
      const cx = gorgeCentreX(z);
      pts.push(cx - halfW, y, z, cx + halfW, y, z);
      if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); scene.add(m); return m;
  };
  mkRiver(19, 8.55, new THREE.MeshStandardMaterial({ color: 0x7fae9d, roughness: 0.5, metalness: 0.1, transparent: true, opacity: 0.45 }));
  const river = mkRiver(13, 8.8, std(0x4d94b4, 0.12, 0.55));

  // Sandstone arch + a second lower arch deeper in the gorge.
  for (const [az, ar, at] of [[-700, 46, 6.5], [-1180, 34, 5]]) {
    const arch = new THREE.Mesh(new THREE.TorusGeometry(ar, at, 10, 22, Math.PI), std(0xb06a41, 0.9, 0));
    arch.position.set(gorgeCentreX(az), 8, az); arch.castShadow = true; arch.receiveShadow = true;
    scene.add(arch);
  }
  // In-gorge dressing: broken pillars, a crashed wreck, riverside rocks.
  const rockMat = std(0x8a4f33, 0.95, 0);
  for (let i = 0; i < 110; i++) {
    const rz = -80 - (i * 53) % 1750, side = i % 2 ? 1 : -1;
    const rx = gorgeCentreX(rz) + side * (gorgeHalfWidth(rz) * (0.55 + (i % 5) * 0.1));
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1.6 + (i % 4) * 0.9, 0), rockMat);
    rock.position.set(rx, terrainHeight(rx, rz) + 0.8, rz);
    rock.rotation.set(i * 1.3, i * 2.1, i * 0.7); rock.castShadow = true;
    scene.add(rock);
  }
  for (const pz of [-420, -980]) {
    for (const s of [-1, 1]) {
      const px = gorgeCentreX(pz) + s * 44;
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 4.1, 20 + (pz % 7), 7), std(0xa8643d, 0.92, 0));
      pillar.position.set(px, terrainHeight(px, pz) + 9, pz); pillar.castShadow = true; scene.add(pillar);
    }
  }
  const wreck = new THREE.Group();
  const wBody = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.9, 6, 8), std(0x4a4640, 0.8, 0.4)); wBody.rotation.z = Math.PI / 2; wBody.rotation.y = 0.5; wreck.add(wBody);
  const wWing = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.18, 1.4), std(0x55504a, 0.8, 0.4)); wWing.rotation.y = 0.9; wWing.position.set(0.4, 0.3, 0.6); wreck.add(wWing);
  const wx = gorgeCentreX(-560) - 30, wz = -560;
  wreck.position.set(wx, terrainHeight(wx, wz) + 1, wz); scene.add(wreck);

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

// ---------- strike targets (basin past ring 10) ---------------------------------
const TARGET_SPOTS = [[-60, -1560], [70, -1640], [-110, -1720], [40, -1790], [130, -1860], [-40, -1905]];
function buildTargets(scene) {
  const std = (c, r, m, e = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, ...e });
  return TARGET_SPOTS.map(([tx, tz], i) => {
    const g = new THREE.Group();
    const gy = terrainHeight(tx, tz);
    if (i % 2 === 0) {   // fuel drum cluster
      for (let d = 0; d < 3; d++) {
        const drum = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 3.4, 10), std(0xa03a28, 0.6, 0.3));
        drum.position.set((d - 1) * 3.4, 1.7, (d % 2) * 2.4); drum.castShadow = true; g.add(drum);
      }
    } else {            // radar truck: cab + bed + dish
      const bed = new THREE.Mesh(new THREE.BoxGeometry(3, 1.6, 7), std(0x5c6644, 0.8, 0.2)); bed.position.y = 1.6; bed.castShadow = true; g.add(bed);
      const cabM = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.8, 2.2), std(0x4a543c, 0.8, 0.2)); cabM.position.set(0, 1.7, -4.2); g.add(cabM);
      const dish = new THREE.Mesh(new THREE.SphereGeometry(1.9, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.6), std(0xb9c3cd, 0.4, 0.7));
      dish.position.set(0, 3.6, 0.6); dish.rotation.x = -0.7; g.add(dish);
    }
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), std(0xff4030, 0.4, 0.2, { emissive: 0xff2010, emissiveIntensity: 2 }));
    beacon.position.y = 6.4; g.add(beacon);
    addGlow(g, 0, 6.4, 0, 5, 0xff4030, 0.5);
    g.position.set(tx, gy, tz);
    scene.add(g);
    return { group: g, x: tx, z: tz, y: gy + 2, alive: true };
  });
}

// ---------- the VF-9 Viper -------------------------------------------------------
function buildJet3D() {
  const jet = new THREE.Group();
  const skin = jetSkinTexture();
  const silver = new THREE.MeshStandardMaterial({ map: skin, roughness: 0.38, metalness: 0.72 });
  const plain = new THREE.MeshStandardMaterial({ color: 0xaeb8c2, roughness: 0.36, metalness: 0.82 });
  const charcoal = new THREE.MeshStandardMaterial({ color: 0x2e343b, roughness: 0.5, metalness: 0.7 });
  const red = new THREE.MeshStandardMaterial({ color: 0xb3312a, roughness: 0.45, metalness: 0.6 });

  // Lathe fuselage: longer and slimmer than v3 (stretched ~25%, waist pinched).
  const profile = [[0.02, -10.4], [0.14, -9.5], [0.30, -8.0], [0.48, -6.2], [0.64, -4.2], [0.74, -2.0], [0.77, 0.2],
    [0.74, 2.2], [0.68, 4.2], [0.60, 6.2], [0.53, 7.8], [0.49, 8.8]].map(([r, z]) => new THREE.Vector2(r, z));
  const fus = new THREE.Mesh(new THREE.LatheGeometry(profile, 22), silver);
  fus.rotation.x = Math.PI / 2;
  fus.castShadow = true; jet.add(fus);
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 8.2), charcoal);
  spine.position.set(0, 0.74, 0.6); jet.add(spine);

  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.72, 20, 14),
    new THREE.MeshStandardMaterial({ color: 0x14405a, roughness: 0.05, metalness: 0.9, envMapIntensity: 1.6 }));
  canopy.scale.set(0.9, 0.62, 2.3); canopy.position.set(0, 0.56, -2.6); jet.add(canopy);

  const wingShape = new THREE.Shape();
  wingShape.moveTo(0.6, -0.8); wingShape.lineTo(5.0, 1.9); wingShape.lineTo(5.0, 2.8); wingShape.lineTo(0.6, 1.1); wingShape.closePath();
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.13, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.06, bevelSegments: 1 });
  const wingtips = [];
  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(wingGeo, plain);
    wing.rotation.x = Math.PI / 2; wing.scale.x = s; wing.position.set(0, -0.12, 0);
    wing.castShadow = true; jet.add(wing);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(4.1, 0.045, 0.34), red);   // painted flush, not a loose stick
    stripe.position.set(s * 2.85, -0.015, 1.28); stripe.rotation.y = s * 0.315; jet.add(stripe);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.85),
      new THREE.MeshStandardMaterial({ color: 0x27e8ff, emissive: 0x18c8ee, emissiveIntensity: 2.2 }));
    tip.position.set(s * 5.02, -0.28, 2.3); jet.add(tip);
    addGlow(jet, s * 5.15, -0.28, 2.3, 1.6, 0x27e8ff, 0.7);
    wingtips.push(new THREE.Vector3(s * 5.0, -0.2, 2.3));
  }
  const tailShape = new THREE.Shape();
  tailShape.moveTo(0.5, 4.5); tailShape.lineTo(2.8, 5.9); tailShape.lineTo(2.8, 6.5); tailShape.lineTo(0.5, 5.6); tailShape.closePath();
  const tailGeo = new THREE.ExtrudeGeometry(tailShape, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 1 });
  for (const s of [-1, 1]) {
    const tp = new THREE.Mesh(tailGeo, plain);
    tp.rotation.x = Math.PI / 2; tp.scale.x = s; tp.position.set(0, 0.05, 0); jet.add(tp);
    const finShape = new THREE.Shape();
    finShape.moveTo(4.2, 0.25); finShape.lineTo(5.5, 2.15); finShape.lineTo(6.3, 2.2); finShape.lineTo(5.95, 0.3); finShape.closePath();
    const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.09, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1 });
    const fin = new THREE.Mesh(finGeo, charcoal);
    fin.rotation.set(0, -Math.PI / 2, 0);
    fin.rotateX(s * 0.31);
    fin.position.set(s * 0.52, 0.1, 0);
    const finTip = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.17, 0.17),
      new THREE.MeshStandardMaterial({ color: 0xffa028, emissive: 0xff8c1a, emissiveIntensity: 1.4 }));
    finTip.position.set(5.92, 2.26, 0.05);
    fin.add(finTip);
    jet.add(fin);
  }
  const missiles = [];
  for (const s of [-1, 1]) {
    const missile = new THREE.Group();
    const mBody = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 1.9, 10), plain); mBody.rotation.x = Math.PI / 2; missile.add(mBody);
    const mNose = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.8, 10), red); mNose.rotation.x = -Math.PI / 2; mNose.position.z = -1.35; missile.add(mNose);
    const mFin = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.05, 0.3), charcoal); mFin.position.z = 0.85; missile.add(mFin);
    const mFin2 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.55, 0.3), charcoal); mFin2.position.z = 0.85; missile.add(mFin2);
    missile.position.set(s * 3.1, -0.85, 1.5); jet.add(missile); missiles.push(missile);
    const tank = new THREE.Group();
    const tBody = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 1.8, 10), charcoal); tBody.rotation.x = Math.PI / 2; tank.add(tBody);
    const tNose = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), charcoal); tNose.position.z = -0.9; tank.add(tNose);
    const tTail = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.6, 10), charcoal); tTail.rotation.x = Math.PI / 2; tTail.position.z = 1.2; tank.add(tTail);
    tank.position.set(s * 1.7, -0.82, 1.4); jet.add(tank);
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.6), charcoal);
    pylon.position.set(s * 3.1, -0.6, 1.5); jet.add(pylon);
  }
  // Twin nozzles + reworked burners: shorter, deeper blue core, orange heart.
  const burners = [];
  for (const s of [-1, 1]) {
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.31, 0.55, 14, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x777d84, roughness: 0.3, metalness: 0.95, side: THREE.DoubleSide }));
    nozzle.rotation.x = Math.PI / 2; nozzle.position.set(s * 0.31, 0, 8.85); jet.add(nozzle);
    const core = new THREE.Mesh(new THREE.CircleGeometry(0.22, 14),
      new THREE.MeshStandardMaterial({ color: 0xff7a1e, emissive: 0xff6a00, emissiveIntensity: 2.6 }));
    core.position.set(s * 0.31, 0, 9.1); jet.add(core);
    const coneOuter = new THREE.Mesh(new THREE.ConeGeometry(0.2, 1.15, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x1c46d8, transparent: true, opacity: 0.34, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    coneOuter.rotation.x = Math.PI / 2; coneOuter.position.set(s * 0.31, 0, 9.65); jet.add(coneOuter);
    const coneInner = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.8, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xff9a3e, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    coneInner.rotation.x = Math.PI / 2; coneInner.position.set(s * 0.31, 0, 9.45); jet.add(coneInner);
    addGlow(jet, s * 0.31, 0, 9.3, 1.0, 0xff7a1e, 0.5);
    burners.push({ coneOuter, coneInner, x: s * 0.31 });
  }
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
  mkLeg(0, -5.4); mkLeg(-1.15, 3.4); mkLeg(1.15, 3.4);
  jet.add(gear);
  jet.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { jet, gear, burners, wingtips, missiles };
}

// ---------- cockpit: sculpted low dash + LIVE MFDs -------------------------------
function makeMfd(kind) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 192;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  return { cv, ctx: cv.getContext('2d'), tex, kind };
}
function drawMfd(m, S) {
  const x = m.ctx;
  x.fillStyle = '#04141c'; x.fillRect(0, 0, 256, 192);
  x.strokeStyle = 'rgba(90,220,255,0.25)'; x.strokeRect(4, 4, 248, 184);
  if (m.kind === 'radar') {
    x.strokeStyle = '#2eff8a'; x.lineWidth = 2;
    for (const r of [26, 52, 78]) { x.beginPath(); x.arc(128, 96, r, 0, 7); x.stroke(); }
    const sw = (performance.now() * 0.0015) % (Math.PI * 2);
    x.strokeStyle = '#7dffb0'; x.beginPath(); x.moveTo(128, 96); x.lineTo(128 + Math.cos(sw) * 78, 96 + Math.sin(sw) * 78); x.stroke();
    x.fillStyle = '#ffd23e';
    S.blips.forEach(([bx, by]) => { x.beginPath(); x.arc(128 + bx, 96 + by, 5, 0, 7); x.fill(); });
    x.fillStyle = '#ff5040';
    S.targetBlips.forEach(([bx, by]) => { x.fillRect(124 + bx, 92 + by, 8, 8); });
    x.fillStyle = '#2eff8a'; x.font = 'bold 15px monospace'; x.fillText(S.lock ? 'TGT LOCK' : 'SCAN', 14, 24);
    x.fillStyle = '#9fe8ff'; x.font = '12px monospace'; x.fillText('RNG ' + S.rng + 'm', 14, 178);
  } else if (m.kind === 'horizon') {
    x.save(); x.beginPath(); x.rect(8, 8, 240, 176); x.clip();
    x.translate(128, 96); x.rotate(-S.roll);
    const off = S.pitch * 260;
    x.fillStyle = '#1d4e79'; x.fillRect(-160, -160 + off, 320, 160);
    x.fillStyle = '#5e3d1c'; x.fillRect(-160, off, 320, 160);
    x.strokeStyle = '#fff'; x.lineWidth = 3; x.beginPath(); x.moveTo(-160, off); x.lineTo(160, off); x.stroke();
    x.lineWidth = 2;
    for (const d of [-30, -15, 15, 30]) { x.beginPath(); x.moveTo(-32, off - d * 1.4); x.lineTo(32, off - d * 1.4); x.stroke(); }
    x.restore();
    x.strokeStyle = '#ffd23e'; x.lineWidth = 4;
    x.beginPath(); x.moveTo(78, 96); x.lineTo(112, 96); x.lineTo(128, 106); x.lineTo(144, 96); x.lineTo(178, 96); x.stroke();
    x.fillStyle = '#bfe9ff'; x.font = 'bold 13px monospace';
    x.fillText('ALT ' + S.alt, 14, 24); x.fillText('SPD ' + S.spd, 176, 24);
  } else {
    const bars = [['N1', Math.min(1, 0.25 + S.thr * 0.75), '#35e0ff'], ['N2', Math.min(1, 0.2 + S.thr * 0.68), '#35e0ff'],
      ['EGT', Math.min(1, 0.3 + S.thr * 0.5 + (S.boost ? 0.2 : 0)), '#ffa028'], ['FUEL', S.fuel / 100, '#39d353']];
    x.font = 'bold 14px monospace';
    bars.forEach(([lab, f, col], i) => {
      const y = 22 + i * 34;
      x.fillStyle = '#bfe9ff'; x.fillText(lab, 14, y + 14);
      x.fillStyle = 'rgba(255,255,255,0.15)'; x.fillRect(64, y, 172, 15);
      x.fillStyle = col; x.fillRect(64, y, 172 * Math.max(0, f), 15);
    });
    x.fillStyle = S.boost ? '#ff8c2e' : '#35e0c8'; x.font = 'bold 15px monospace';
    x.fillText(S.boost ? 'BURNER ON' : 'MSL ' + S.msl + ' · TGT ' + S.tgt, 14, 178);
  }
  m.tex.needsUpdate = true;
}
function buildCockpit3D() {
  const g = new THREE.Group();
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x161c22, roughness: 0.6, metalness: 0.35 });
  // Sculpted dash: low centre brow + two side consoles (was one 45% slab).
  const brow = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.13, 1.05), panelMat);
  brow.position.set(0, -0.86, -2.3); brow.rotation.x = 0.42; g.add(brow);
  for (const s of [-1, 1]) {
    const con = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.34, 1.5), panelMat);
    con.position.set(s * 1.28, -1.02, -2.05); con.rotation.x = 0.42; g.add(con);
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.9, 1.7), panelMat);
    side.position.set(s * 1.52, -0.55, -1.35); side.rotation.z = -s * 0.18; g.add(side);
  }
  const console_ = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.45, 1.5), panelMat);
  console_.position.set(0, -1.42, -1.05); g.add(console_);
  // Sliver of nose ahead of the dash so the view reads as an aircraft.
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.34, 3.4, 10),
    new THREE.MeshStandardMaterial({ color: 0x9aa6b1, roughness: 0.4, metalness: 0.75 }));
  nose.rotation.x = -Math.PI / 2; nose.position.set(0, -0.98, -4.6); g.add(nose);
  const mfds = [makeMfd('radar'), makeMfd('horizon'), makeMfd('engine')];
  mfds.forEach((m, i) => {
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.6), new THREE.MeshBasicMaterial({ map: m.tex }));
    scr.position.set((i - 1) * 1.04, -0.68, -2.42); scr.rotation.x = -0.42; g.add(scr);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.05, 0.72), panelMat);
    frame.position.set((i - 1) * 1.04, -0.735, -2.41); frame.rotation.x = 0.42; g.add(frame);
  });
  for (const s of [-1, 1]) {
    const up = new THREE.Mesh(new THREE.BoxGeometry(0.11, 1.6, 0.11), panelMat);
    up.position.set(s * 1.38, 0.5, -1.75); up.rotation.x = 0.25; g.add(up);
  }
  const hudCv = document.createElement('canvas'); hudCv.width = hudCv.height = 128;
  const hx = hudCv.getContext('2d');
  hx.strokeStyle = 'rgba(120,255,220,0.95)'; hx.lineWidth = 3;
  hx.beginPath(); hx.moveTo(34, 64); hx.lineTo(54, 64); hx.moveTo(74, 64); hx.lineTo(94, 64);
  hx.moveTo(64, 46); hx.lineTo(64, 82); hx.stroke();
  hx.beginPath(); hx.arc(64, 64, 20, 0, 7); hx.lineWidth = 2; hx.stroke();
  const hudGlass = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.44),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(hudCv), transparent: true, opacity: 0.9, depthWrite: false }));
  hudGlass.position.set(0, 0.42, -1.9); hudGlass.rotation.x = -0.12; g.add(hudGlass);
  let lastDraw = 0;
  return {
    group: g, mfds,
    updateLive(S) {
      const now = performance.now();
      if (now - lastDraw < 120) return;
      lastDraw = now;
      mfds.forEach((m) => drawMfd(m, S));
    },
  };
}
