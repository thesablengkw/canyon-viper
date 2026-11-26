// Canyon Viper — small 3D math kit and geometry builder (no dependencies).
// Everything the renderer needs: column-major 4x4 matrices, quaternion-free
// Euler composition for the jet, and a push-style geometry builder that
// accumulates coloured triangles into one static buffer.

export function matIdentity() {
  return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
}

export function matMultiply(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}

export function matPerspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2), o = new Float32Array(16);
  o[0] = f / aspect; o[5] = f; o[10] = (far + near) / (near - far);
  o[11] = -1; o[14] = (2 * far * near) / (near - far);
  return o;
}

export function matTranslation(x, y, z) {
  const o = matIdentity(); o[12] = x; o[13] = y; o[14] = z; return o;
}

export function matScale(x, y, z) {
  const o = matIdentity(); o[0] = x; o[5] = y; o[10] = z; return o;
}

export function matRotX(a) {
  const c = Math.cos(a), s = Math.sin(a), o = matIdentity();
  o[5] = c; o[6] = s; o[9] = -s; o[10] = c; return o;
}

export function matRotY(a) {
  const c = Math.cos(a), s = Math.sin(a), o = matIdentity();
  o[0] = c; o[2] = -s; o[8] = s; o[10] = c; return o;
}

export function matRotZ(a) {
  const c = Math.cos(a), s = Math.sin(a), o = matIdentity();
  o[0] = c; o[1] = s; o[4] = -s; o[5] = c; return o;
}

// Yaw (heading) -> pitch -> roll, the order a pilot feels.
export function matEulerYXZ(yaw, pitch, roll) {
  return matMultiply(matRotY(yaw), matMultiply(matRotX(pitch), matRotZ(roll)));
}

export function matLookAt(eye, target, up) {
  let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  const o = new Float32Array(16);
  o[0] = xx; o[1] = yx; o[2] = zx; o[4] = xy; o[5] = yy; o[6] = zy;
  o[8] = xz; o[9] = yz; o[10] = zz;
  o[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  o[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  o[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  o[15] = 1;
  return o;
}

export function transformPoint(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

export function forwardOf(yaw, pitch) {
  return [
    -Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch),
  ];
}

// Geometry builder: positions + RGB colour + emissive weight per vertex.
export class GeoBuilder {
  constructor() { this.pos = []; this.col = []; this.emi = []; this.nor = []; }
  tri(a, b, c, color, emissive = 0) {
    const ux = b[0]-a[0], uy = b[1]-a[1], uz = b[2]-a[2];
    const vx = c[0]-a[0], vy = c[1]-a[1], vz = c[2]-a[2];
    let nx = uy*vz-uz*vy, ny = uz*vx-ux*vz, nz = ux*vy-uy*vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx/=l; ny/=l; nz/=l;
    for (const p of [a, b, c]) {
      this.pos.push(p[0], p[1], p[2]);
      this.col.push(color[0], color[1], color[2]);
      this.emi.push(emissive);
      this.nor.push(nx, ny, nz);
    }
  }
  quad(a, b, c, d, color, emissive = 0) { this.tri(a, b, c, color, emissive); this.tri(a, c, d, color, emissive); }
  // Axis-aligned box centred at (cx,cy,cz), optionally pre-rotated by matrix m.
  box(cx, cy, cz, sx, sy, sz, color, emissive = 0, m = null) {
    const x0=cx-sx/2, x1=cx+sx/2, y0=cy-sy/2, y1=cy+sy/2, z0=cz-sz/2, z1=cz+sz/2;
    const P = (x,y,z) => m ? transformPoint(m, x, y, z) : [x,y,z];
    this.quad(P(x0,y1,z1),P(x1,y1,z1),P(x1,y1,z0),P(x0,y1,z0),color,emissive);
    this.quad(P(x0,y0,z0),P(x1,y0,z0),P(x1,y0,z1),P(x0,y0,z1),color,emissive);
    this.quad(P(x1,y0,z1),P(x1,y1,z1),P(x1,y1,z0),P(x1,y0,z0),color,emissive);
    this.quad(P(x0,y0,z0),P(x0,y1,z0),P(x0,y1,z1),P(x0,y0,z1),color,emissive);
    this.quad(P(x0,y0,z1),P(x1,y0,z1),P(x1,y1,z1),P(x0,y1,z1),color,emissive);
    this.quad(P(x0,y0,z0),P(x0,y1,z0),P(x1,y1,z0),P(x1,y0,z0),color,emissive);
  }
  // Tapered prism (frustum) along local Z: front/back rectangles, for fuselage sections.
  frustum(cx, cy, cz, w0, h0, w1, h1, len, color, emissive = 0, m = null) {
    const z0 = cz - len/2, z1 = cz + len/2;
    const P = (x,y,z) => m ? transformPoint(m, x, y, z) : [x,y,z];
    const a=P(cx-w0/2,cy-h0/2,z0), b=P(cx+w0/2,cy-h0/2,z0), c=P(cx+w0/2,cy+h0/2,z0), d=P(cx-w0/2,cy+h0/2,z0);
    const e=P(cx-w1/2,cy-h1/2,z1), f=P(cx+w1/2,cy-h1/2,z1), g=P(cx+w1/2,cy+h1/2,z1), h=P(cx-w1/2,cy+h1/2,z1);
    this.quad(d,c,g,h,color,emissive); this.quad(a,e,f,b,color,emissive);
    this.quad(b,f,g,c,color,emissive); this.quad(e,a,d,h,color,emissive);
    this.quad(e,h,g,f,color,emissive); this.quad(a,b,c,d,color,emissive);
  }
  cylinder(cx, cy, cz, r, len, seg, color, emissive = 0, axis = 'z', m = null) {
    const P = (x,y,z) => m ? transformPoint(m, x, y, z) : [x,y,z];
    for (let i = 0; i < seg; i++) {
      const a0 = (i/seg)*Math.PI*2, a1 = ((i+1)/seg)*Math.PI*2;
      const ring = (t, s) => axis === 'z'
        ? P(cx + Math.cos(t)*r, cy + Math.sin(t)*r, cz + s*len/2)
        : P(cx + s*len/2, cy + Math.sin(t)*r, cz + Math.cos(t)*r);
      this.quad(ring(a0,-1), ring(a1,-1), ring(a1,1), ring(a0,1), color, emissive);
    }
  }
  // Flat ring (annulus) facing +Z in local space, transformed by m.
  ring(cx, cy, cz, rOut, rIn, color, emissive = 0, m = null, seg = 28) {
    const P = (x,y,z) => m ? transformPoint(m, x, y, z) : [x,y,z];
    for (let i = 0; i < seg; i++) {
      const a0 = (i/seg)*Math.PI*2, a1 = ((i+1)/seg)*Math.PI*2;
      const o0=P(cx+Math.cos(a0)*rOut, cy+Math.sin(a0)*rOut, cz), o1=P(cx+Math.cos(a1)*rOut, cy+Math.sin(a1)*rOut, cz);
      const i0=P(cx+Math.cos(a0)*rIn, cy+Math.sin(a0)*rIn, cz), i1=P(cx+Math.cos(a1)*rIn, cy+Math.sin(a1)*rIn, cz);
      this.quad(o0,o1,i1,i0,color,emissive);
      this.quad(i0,i1,o1,o0,color,emissive);
    }
  }
  build() {
    return {
      position: new Float32Array(this.pos),
      color: new Float32Array(this.col),
      emissive: new Float32Array(this.emi),
      normal: new Float32Array(this.nor),
      count: this.pos.length / 3,
    };
  }
}

export function mulberry(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
