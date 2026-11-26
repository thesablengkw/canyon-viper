// engine3d.js — Canyon Viper's tiny hand-rolled WebGL1 engine (zero libraries).
// Architecture: column-major mat4 helpers, a triangle-soup geometry builder with
// per-vertex colour + UVs, procedural canvas textures, and one shader program
// that does hemisphere + directional "sun" lighting, distance fog, Blinn-style
// specular, and an ACES filmic tone-map approximation for a studio CGI feel.
'use strict';

// ---------- vector / matrix helpers (column-major, WebGL convention) ----------
function v3Sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function v3Cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function v3Len(a) { return Math.hypot(a[0], a[1], a[2]); }
function v3Norm(a) { const l = v3Len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

function mat4Perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}
function mat4LookAt(eye, center, up) {
  const z = v3Norm(v3Sub(eye, center)), x = v3Norm(v3Cross(up, z)), y = v3Cross(z, x);
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
    -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]),
    -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]),
    -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]), 1];
}
function mat4Identity() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
function mat4Translate(x, y, z) { const m = mat4Identity(); m[12] = x; m[13] = y; m[14] = z; return m; }
function mat4RotX(a) { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; }
function mat4RotY(a) { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; }
function mat4RotZ(a) { const c = Math.cos(a), s = Math.sin(a); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
function mat4Mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
// Aircraft orientation: yaw about Y, then pitch about X, then roll about Z.
function mat4FromYawPitchRoll(yaw, pitch, roll) {
  return mat4Mul(mat4Mul(mat4RotY(yaw), mat4RotX(pitch)), mat4RotZ(roll));
}
function mat4TransformPoint(m, p) {
  const x = p[0], y = p[1], z = p[2];
  return [m[0] * x + m[4] * y + m[8] * z + m[12],
          m[1] * x + m[5] * y + m[9] * z + m[13],
          m[2] * x + m[6] * y + m[10] * z + m[14]];
}

// ---------- procedural canvas textures (100% offline, generated at boot) ----
// A tiny deterministic value-noise so textures look hand-weathered, not flat.
function makeNoiseCanvas(size, painter) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  painter(cv.getContext('2d'), size);
  return cv;
}
function grain(ctx, size, base, flecks, n) {
  ctx.fillStyle = base; ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = flecks[(Math.random() * flecks.length) | 0];
    ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}
// Rock strata: many thin sediment bands + heavy grain so repeats read as
// weathered rock, never as wallpaper stripes. Kept near albedo-neutral so the
// vertex colours carry the hue.
function rockTexture() {
  return makeNoiseCanvas(256, (ctx, s) => {
    const bands = ['#c8c2bb', '#b7aea4', '#d2c9bf', '#a99f93', '#c0b6aa', '#b2a697'];
    let y = 0;
    while (y < s) { const h = 3 + Math.random() * 8; ctx.fillStyle = bands[(Math.random() * bands.length) | 0]; ctx.fillRect(0, y, s, h); y += h; }
    grain(ctx, s, 'rgba(0,0,0,0)', ['rgba(60,40,25,0.20)', 'rgba(255,240,215,0.16)', 'rgba(90,60,35,0.15)'], 5200);
  });
}
// Asphalt: dark speckle with faint tyre-wear streaks — runway surface.
function asphaltTexture() {
  return makeNoiseCanvas(256, (ctx, s) => {
    grain(ctx, s, '#3d3d40', ['#4a4a4e', '#333336', '#55555a', '#2e2e31'], 5200);
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    for (let i = 0; i < 7; i++) ctx.fillRect(Math.random() * s, 0, 3 + Math.random() * 6, s);
  });
}
// Brushed light gunmetal with panel seams — fuselage albedo/bump stand-in.
function metalTexture() {
  return makeNoiseCanvas(256, (ctx, s) => {
    grain(ctx, s, '#aeb9c0', ['#bcc6cc', '#9fabB4', '#c6cfd5'], 2400);
    ctx.strokeStyle = 'rgba(20,26,30,0.55)'; ctx.lineWidth = 2;
    for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(0, i * s / 4); ctx.lineTo(s, i * s / 4); ctx.stroke(); }
    ctx.fillStyle = 'rgba(15,20,24,0.7)';
    for (let x = 8; x < s; x += 16) for (let y = 8; y < s; y += 64) { ctx.beginPath(); ctx.arc(x, y, 1.6, 0, 7); ctx.fill(); }
  });
}
// Desert floor scrub speckle.
function sandTexture() {
  return makeNoiseCanvas(256, (ctx, s) => {
    grain(ctx, s, '#c99a5e', ['#d8ab6c', '#bb8a50', '#e2b878', '#a87c46'], 4200);
  });
}

// ---------- geometry builder -------------------------------------------------
// Accumulates coloured, UV-mapped triangles. Material flags per push:
// {tex: canvas|null, rough: 0..1 (specular width), metal: 0..1 (spec strength),
//  emissive: 0..1 (unlit glow), halo: sprite size for a bloom-like billboard}.
class GeoBuilder {
  constructor() { this.pos = []; this.col = []; this.uv = []; this.mat = []; this.halos = []; }
  _tri(a, b, c, col, opt, uvs) {
    const u = v3Sub(b, a), v = v3Sub(c, a);
    let n = v3Norm(v3Cross(u, v));
    if (n[1] === 0 && n[0] === 0 && n[2] === 0) n = [0, 1, 0];
    const pts = [a, b, c], ns = [n, n, n];
    for (let i = 0; i < 3; i++) {
      this.pos.push(pts[i][0], pts[i][1], pts[i][2]);
      this.col.push(col[0], col[1], col[2]);
      const t = uvs ? uvs[i] : [0, 0];
      this.uv.push(t[0], t[1]);
      this.mat.push(opt.rough ?? 0.85, opt.metal ?? 0.0, opt.emissive ?? 0.0);
      // normals ride in a parallel array via a second push below
      this._n = this._n || []; this._n.push(ns[i][0], ns[i][1], ns[i][2]);
    }
  }
  quad(a, b, c, d, col, opt = {}) {
    const s = opt.texScale || 6;
    const uv = [[0, 0], [s, 0], [s, s], [0, s]];
    this._tri(a, b, c, col, opt, [uv[0], uv[1], uv[2]]);
    this._tri(a, c, d, col, opt, [uv[0], uv[2], uv[3]]);
  }
  box(cx, cy, cz, sx, sy, sz, col, opt = {}) {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], col, opt);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], col, opt);
    this.quad([x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [x1, y0, z0], col, opt);
    this.quad([x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1], col, opt);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], col, opt);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], col, opt);
  }
  // Box sheared along Z between two stations — fuselage / mesa building block.
  frustum(z0, w0, h0, z1, w1, h1, cy0, cy1, col, opt = {}) {
    const a = [-w0 / 2, cy0 - h0 / 2, z0], b = [w0 / 2, cy0 - h0 / 2, z0], c = [w0 / 2, cy0 + h0 / 2, z0], d = [-w0 / 2, cy0 + h0 / 2, z0];
    const e = [-w1 / 2, cy1 - h1 / 2, z1], f = [w1 / 2, cy1 - h1 / 2, z1], g = [w1 / 2, cy1 + h1 / 2, z1], h = [-w1 / 2, cy1 + h1 / 2, z1];
    this.quad(d, c, g, h, col, opt); this.quad(b, a, e, f, col, opt);
    this.quad(a, d, h, e, col, opt); this.quad(c, b, f, g, col, opt);
    this.quad(e, f, g, h, col, opt); this.quad(b, c, d, a, col, opt);
  }
  // A glow sprite anchor: rendered later as an additive billboard (fake bloom).
  halo(x, y, z, size, col) { this.halos.push({ p: [x, y, z], size, col }); }
  build(gl) {
    const mk = (arr, itemSize) => {
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
      return { buf, itemSize };
    };
    return {
      position: mk(this.pos, 3), normal: mk(this._n || [], 3), color: mk(this.col, 3),
      uv: mk(this.uv, 2), material: mk(this.mat, 3),
      count: this.pos.length / 3, halos: this.halos,
    };
  }
}

// ---------- renderer ----------------------------------------------------------
const VSHADER = `
attribute vec3 aPos; attribute vec3 aNor; attribute vec3 aCol;
attribute vec2 aUv; attribute vec3 aMat;
uniform mat4 uMVP; uniform mat4 uModel;
varying vec3 vCol; varying vec3 vNor; varying vec3 vWorld; varying vec2 vUv; varying vec3 vMat;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz; vCol = aCol; vUv = aUv; vMat = aMat;
  vNor = normalize(mat3(uModel[0].xyz, uModel[1].xyz, uModel[2].xyz) * aNor);
  gl_Position = uMVP * vec4(aPos, 1.0);
}`;
const FSHADER = `
precision mediump float;
varying vec3 vCol; varying vec3 vNor; varying vec3 vWorld; varying vec2 vUv; varying vec3 vMat;
uniform vec3 uSunDir; uniform vec3 uCamPos; uniform sampler2D uTex; uniform float uUseTex;
uniform vec3 uFogColor; uniform vec3 uSkyColor;
// ACES filmic tone mapping (Krzysztof Narkowicz fit) — studio CGI contrast.
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
void main() {
  vec3 N = normalize(vNor);
  vec3 base = vCol * mix(vec3(1.0), texture2D(uTex, vUv).rgb, uUseTex);
  float rough = vMat.x, metal = vMat.y, emis = vMat.z;
  // Hemisphere bounce: sky colour from above, warm ground bounce from below.
  vec3 hemi = mix(vec3(0.42, 0.30, 0.20), vec3(0.55, 0.68, 0.85), N.y * 0.5 + 0.5);
  float sun = max(dot(N, uSunDir), 0.0);
  vec3 col = base * (hemi * 0.75 + vec3(1.25, 1.12, 0.92) * sun);
  // Blinn specular: tight hot glints on water / metal, broad sheen on rock.
  vec3 V = normalize(uCamPos - vWorld);
  vec3 H = normalize(uSunDir + V);
  float spec = pow(max(dot(N, H), 0.0), mix(90.0, 6.0, rough)) * mix(0.25, 1.4, metal);
  col += vec3(1.0, 0.96, 0.86) * spec;
  col += base * emis * 2.4;                       // emissive glow (rings, lights)
  float dist = length(uCamPos - vWorld);
  float fog = smoothstep(150.0, 1500.0, dist);    // atmospheric horizon haze
  col = mix(col, uFogColor, fog * 0.82);
  gl_FragColor = vec4(aces(col * 1.12), 1.0);
}`;
// Halo pass: additive radial-gradient billboards fake HDR bloom around glows.
const HALO_VSHADER = `
attribute vec3 aPos; attribute vec3 aCol; attribute float aSize; attribute vec2 aCorner;
uniform mat4 uVP; uniform vec3 uCamRight; uniform vec3 uCamUp;
varying vec3 vCol; varying vec2 vP;
void main() {
  vCol = aCol; vP = aCorner;
  vec3 w = aPos + (uCamRight * aCorner.x + uCamUp * aCorner.y) * aSize;
  gl_Position = uVP * vec4(w, 1.0);
}`;
const HALO_FSHADER = `
precision mediump float;
varying vec3 vCol; varying vec2 vP;
void main() {
  float d = length(vP);
  float a = pow(max(1.0 - d, 0.0), 2.6) * 0.55;
  gl_FragColor = vec4(vCol * a, a);
}`;

class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl', { antialias: true });
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl; this.canvas = canvas;
    this.prog = this._program(VSHADER, FSHADER);
    this.haloProg = this._program(HALO_VSHADER, HALO_FSHADER);
    gl.enable(gl.DEPTH_TEST); gl.clearColor(0.62, 0.76, 0.90, 1);
    this.textures = new Map();
  }
  _shader(type, src) {
    const gl = this.gl, sh = gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    return sh;
  }
  _program(vs, fs) {
    const gl = this.gl, p = gl.createProgram();
    gl.attachShader(p, this._shader(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, this._shader(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }
  texture(canvas) {
    if (this.textures.has(canvas)) return this.textures.get(canvas);
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.textures.set(canvas, t);
    return t;
  }
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(this.canvas.clientWidth * dpr), h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.gl.viewport(0, 0, w, h);
    return w / h;
  }
  // draws: [{mesh, model, tex}] — one texture per draw keeps materials honest.
  render(draws, halos, view, proj, camPos) {
    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.prog);
    const A = (n) => gl.getAttribLocation(this.prog, n), U = (n) => gl.getUniformLocation(this.prog, n);
    gl.uniform3fv(U('uSunDir'), [0.45, 0.72, 0.42]);
    gl.uniform3fv(U('uCamPos'), camPos);
    gl.uniform3fv(U('uFogColor'), [0.83, 0.78, 0.68]);
    gl.uniform3fv(U('uSkyColor'), [0.55, 0.68, 0.85]);
    for (const d of draws) {
      const vp = mat4Mul(proj, mat4Mul(view, d.model));
      gl.uniformMatrix4fv(U('uMVP'), false, new Float32Array(vp));
      gl.uniformMatrix4fv(U('uModel'), false, new Float32Array(d.model));
      const bind = (attr, name) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, attr.buf);
        const loc = A(name); gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, attr.itemSize, gl.FLOAT, false, 0, 0);
      };
      bind(d.mesh.position, 'aPos'); bind(d.mesh.normal, 'aNor'); bind(d.mesh.color, 'aCol');
      bind(d.mesh.uv, 'aUv'); bind(d.mesh.material, 'aMat');
      if (d.tex) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texture(d.tex)); gl.uniform1i(U('uTex'), 0); gl.uniform1f(U('uUseTex'), 1); }
      else gl.uniform1f(U('uUseTex'), 0);
      gl.drawArrays(gl.TRIANGLES, 0, d.mesh.count);
    }
    this._renderHalos(halos, view, proj, camPos);
  }
  _renderHalos(halos, view, proj, camPos) {
    if (!halos || !halos.length) return;
    const gl = this.gl;
    gl.useProgram(this.haloProg);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false);
    const U = (n) => gl.getUniformLocation(this.haloProg, n), A = (n) => gl.getAttribLocation(this.haloProg, n);
    // Camera basis from the view matrix rows.
    const right = [view[0], view[4], view[8]], up = [view[1], view[5], view[9]];
    gl.uniform3fv(U('uCamRight'), right); gl.uniform3fv(U('uCamUp'), up);
    gl.uniformMatrix4fv(U('uVP'), false, new Float32Array(mat4Mul(proj, view)));
    // Expand each halo into a camera-facing quad (6 verts) on the CPU.
    const pos = [], col = [], size = [], cnr = [];
    const quad = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
    for (const h of halos) for (const q of quad) {
      pos.push(h.p[0], h.p[1], h.p[2]); col.push(h.col[0], h.col[1], h.col[2]);
      size.push(h.size); cnr.push(q[0], q[1]);
    }
    const mk = (arr, n) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STREAM_DRAW); return { b, n }; };
    const bind = (o, name) => { gl.bindBuffer(gl.ARRAY_BUFFER, o.b); const l = A(name); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, o.n, gl.FLOAT, false, 0, 0); };
    bind(mk(pos, 3), 'aPos'); bind(mk(col, 3), 'aCol'); bind(mk(size, 1), 'aSize'); bind(mk(cnr, 2), 'aCorner');
    gl.drawArrays(gl.TRIANGLES, 0, halos.length * 6);
    gl.depthMask(true); gl.disable(gl.BLEND);
  }
}
