// BLACKWATER CIENAGA 3D — WebGL1 renderer (from scratch, no libraries) + world meshes.
// Part 1: math, shaders, mesh builders, static world, entity meshes.
import {
  WORLD, genWorld, isLand, clamp, dist2, fogDensity, skyColor,
} from './logic.js';

// ---------------------------------------------------------------- mat4 (column-major, like WebGL)
export function mIdentity() { return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }
export function mMul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    for (let k = 0; k < 4; k++) o[c*4+r] += a[k*4+r] * b[c*4+k];
  return o;
}
export function mPerspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return [f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,2*far*near*nf,0];
}
export function mLookAt(eye, center, up) {
  let zx = eye[0]-center[0], zy = eye[1]-center[1], zz = eye[2]-center[2];
  let l = Math.hypot(zx, zy, zz); zx/=l; zy/=l; zz/=l;
  let xx = up[1]*zz - up[2]*zy, xy = up[2]*zx - up[0]*zz, xz = up[0]*zy - up[1]*zx;
  l = Math.hypot(xx, xy, xz) || 1; xx/=l; xy/=l; xz/=l;
  const yx = zy*xz - zz*xy, yy = zz*xx - zx*xz, yz = zx*xy - zy*xx;
  return [xx,yx,zx,0, xy,yy,zy,0, xz,yz,zz,0, -(xx*eye[0]+xy*eye[1]+xz*eye[2]), -(yx*eye[0]+yy*eye[1]+yz*eye[2]), -(zx*eye[0]+zy*eye[1]+zz*eye[2]), 1];
}
export function mModel(x, y, z, yaw, sx = 1, sy = 1, sz = 1) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [c*sx,0,-s*sx,0, 0,sy,0,0, s*sz,0,c*sz,0, x,y,z,1];
}
export function mTranslate(m, x, y, z) {
  const o = m.slice();
  o[12] = m[0]*x + m[4]*y + m[8]*z + m[12];
  o[13] = m[1]*x + m[5]*y + m[9]*z + m[13];
  o[14] = m[2]*x + m[6]*y + m[10]*z + m[14];
  return o;
}

// ---------------------------------------------------------------- mesh builder
// color: [r,g,b,a]. Positions + normals + colors + indices.
export class MeshBuilder {
  constructor() { this.pos = []; this.col = []; this.nrm = []; this.idx = []; }
  vert(x, y, z, c, nx, ny, nz) {
    this.pos.push(x, y, z); this.col.push(c[0], c[1], c[2], c.length > 3 ? c[3] : 1);
    this.nrm.push(nx, ny, nz); return this.pos.length / 3 - 1;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  quad(p1, p2, p3, p4, c) {
    const u = [p2[0]-p1[0], p2[1]-p1[1], p2[2]-p1[2]];
    const v = [p3[0]-p1[0], p3[1]-p1[1], p3[2]-p1[2]];
    let n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1; n = [n[0]/l, n[1]/l, n[2]/l];
    const a = this.vert(p1[0], p1[1], p1[2], c, n[0], n[1], n[2]);
    const b = this.vert(p2[0], p2[1], p2[2], c, n[0], n[1], n[2]);
    const d = this.vert(p3[0], p3[1], p3[2], c, n[0], n[1], n[2]);
    const e = this.vert(p4[0], p4[1], p4[2], c, n[0], n[1], n[2]);
    this.tri(a, b, d); this.tri(a, d, e);
  }
  box(cx, cy, cz, sx, sy, sz, c, yaw = 0) {
    const hx = sx/2, hy = sy/2, hz = sz/2;
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    const rot = (x, z) => [cx + x*cs + z*sn, cz - x*sn + z*cs];
    const P = (x, y, z) => { const [rx, rz] = rot(x, z); return [rx, cy + y, rz]; };
    const T = P(-hx, hy, -hz), U = P(hx, hy, -hz), V = P(hx, hy, hz), W = P(-hx, hy, hz);
    const B1 = P(-hx, -hy, -hz), B2 = P(hx, -hy, -hz), B3 = P(hx, -hy, hz), B4 = P(-hx, -hy, hz);
    this.quad(T, U, V, W, c); this.quad(B2, B1, B4, B3, c);
    this.quad(B1, B2, U, T, c); this.quad(B2, B3, V, U, c);
    this.quad(B3, B4, W, V, c); this.quad(B4, B1, T, W, c);
  }
  // vertical prism with n sides (cylinder)
  cyl(cx, cy, cz, r, h, c, seg = 8, rTop = null) {
    const rt = rTop === null ? r : rTop;
    const top = [], bot = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      top.push(this.vert(cx + Math.cos(a)*rt, cy + h/2, cz + Math.sin(a)*rt, c, Math.cos(a), 0, Math.sin(a)));
      bot.push(this.vert(cx + Math.cos(a)*r, cy - h/2, cz + Math.sin(a)*r, c, Math.cos(a), 0, Math.sin(a)));
    }
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      this.tri(bot[i], top[i], top[j]); this.tri(bot[i], top[j], bot[j]);
    }
    const tc = this.vert(cx, cy + h/2, cz, c, 0, 1, 0);
    const bc = this.vert(cx, cy - h/2, cz, c, 0, -1, 0);
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      this.tri(tc, top[j], top[i]);
      this.tri(bc, bot[i], bot[j]);
    }
  }
  // flat disc (fan) in XZ plane
  disc(cx, cy, cz, r, c, seg = 20) {
    const cc = this.vert(cx, cy, cz, c, 0, 1, 0);
    const ring = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      ring.push(this.vert(cx + Math.cos(a)*r, cy, cz + Math.sin(a)*r, c, 0, 1, 0));
    }
    for (let i = 0; i < seg; i++) this.tri(cc, ring[(i+1)%seg], ring[i]);
  }
  // round disc in the XY plane, facing +Z (moon, signs)
  discXY(cx, cy, cz, r, c, seg = 28) {
    const cc = this.vert(cx, cy, cz, c, 0, 0, 1);
    const ring = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      ring.push(this.vert(cx + Math.cos(a)*r, cy + Math.sin(a)*r, cz, c, 0, 0, 1));
    }
    for (let i = 0; i < seg; i++) this.tri(cc, ring[i], ring[(i+1)%seg]);
  }
  // spotlight cone tilted forward (+Z): apex at origin, base ring pushed forward
  coneTilted(r, len, fwd, c, seg = 14) {
    const apex = this.vert(0, 0, 0, [c[0], c[1], c[2], 0.02], 0, -1, 0);
    const ring = [];
    const drop = Math.sqrt(Math.max(len*len - fwd*fwd, 1));
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      ring.push(this.vert(Math.cos(a)*r, -drop, fwd + Math.sin(a)*r, [c[0], c[1], c[2], 0.16], Math.cos(a)*0.4, -0.6, Math.sin(a)*0.4));
    }
    for (let i = 0; i < seg; i++) this.tri(apex, ring[i], ring[(i+1)%seg]);
  }
  // open cone: apex at origin pointing down (-Y), base radius r at y=-len
  coneDown(r, len, c, seg = 14) {
    const apex = this.vert(0, 0, 0, [c[0], c[1], c[2], 0.02], 0, -1, 0);
    const ring = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      ring.push(this.vert(Math.cos(a)*r, -len, Math.sin(a)*r, [c[0], c[1], c[2], 0.10], Math.cos(a)*0.4, -0.6, Math.sin(a)*0.4));
    }
    for (let i = 0; i < seg; i++) this.tri(apex, ring[i], ring[(i+1)%seg]);
  }
  build(gl) {
    const mesh = { count: this.idx.length };
    mesh.vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
    const verts = new Float32Array(this.pos.length * 3 + this.col.length * 4 / 3 * 0 + 0); // placeholder replaced below
    const n = this.pos.length / 3;
    const data = new Float32Array(n * 10);
    for (let i = 0; i < n; i++) {
      data[i*10+0] = this.pos[i*3]; data[i*10+1] = this.pos[i*3+1]; data[i*10+2] = this.pos[i*3+2];
      data[i*10+3] = this.col[i*4]; data[i*10+4] = this.col[i*4+1]; data[i*10+5] = this.col[i*4+2]; data[i*10+6] = this.col[i*4+3];
      data[i*10+7] = this.nrm[i*3]; data[i*10+8] = this.nrm[i*3+1]; data[i*10+9] = this.nrm[i*3+2];
    }
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    mesh.ibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(this.idx), gl.STATIC_DRAW);
    mesh.verts = n;
    return mesh;
  }
}

// ---------------------------------------------------------------- renderer
const VS = `
attribute vec3 aPos; attribute vec4 aCol; attribute vec3 aNrm;
uniform mat4 uProj; uniform mat4 uView; uniform mat4 uModel;
uniform float uTime; uniform highp float uWater;
varying vec4 vCol; varying vec3 vNrm; varying float vFog; varying vec3 vWorld;
void main(){
  vec4 world = uModel * vec4(aPos, 1.0);
  if (uWater > 0.5) world.y += sin(world.x * 0.08 + uTime * 1.3) * 0.06 + cos(world.z * 0.06 + uTime * 0.9) * 0.06;
  vWorld = world.xyz; vCol = aCol; vNrm = mat3(uModel) * aNrm;
  vec4 vp = uView * world; vFog = -vp.z;
  gl_Position = uProj * vp;
}`;
const FS = `
precision mediump float;
varying vec4 vCol; varying vec3 vNrm; varying float vFog; varying vec3 vWorld;
uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar; uniform float uFogAmt;
uniform vec3 uMoonDir; uniform vec3 uCamPos; uniform float uEmissive;
uniform vec3 uSpotPos; uniform float uSpotR; uniform highp float uWater; uniform highp float uTime;
void main(){
  vec3 n = normalize(vNrm);
  float diff = max(dot(n, normalize(uMoonDir)), 0.0);
  vec3 col = vCol.rgb * (0.55 + 0.5 * diff);
  if (uEmissive > 0.5) col = vCol.rgb * 1.35;
  else col += uFogColor * 0.10;
  if (uWater > 0.5) {
    float w = sin(vWorld.x * 0.35 + uTime * 1.6) * sin(vWorld.z * 0.28 - uTime * 1.1);
    col += vec3(0.01, 0.02, 0.02) * w;
    vec3 vd = normalize(uCamPos - vWorld);
    float spec = pow(max(dot(reflect(-normalize(uMoonDir), n), vd), 0.0), 24.0);
    col += vec3(0.55, 0.6, 0.55) * spec * 0.9;
  }
  if (uSpotR > 0.5) {
    float d = distance(vWorld.xz, uSpotPos.xz);
    if (d < uSpotR) col += vec3(1.0, 0.95, 0.7) * (1.0 - d / uSpotR) * 0.5;
  }
  float f = clamp((vFog - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0) * uFogAmt;
  col = mix(col, uFogColor, f);
  gl_FragColor = vec4(col, vCol.a);
}`;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', { antialias: true, alpha: false });
    const gl = this.gl;
    if (!gl) throw new Error('WebGL1 not available');
    gl.getExtension('OES_element_index_uint');
    const vs = gl.createShader(gl.VERTEX_SHADER); gl.shaderSource(vs, VS); gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER); gl.shaderSource(fs, FS); gl.compileShader(fs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) throw new Error('VS: ' + gl.getShaderInfoLog(vs));
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) throw new Error('FS: ' + gl.getShaderInfoLog(fs));
    this.prog = gl.createProgram();
    gl.attachShader(this.prog, vs); gl.attachShader(this.prog, fs); gl.linkProgram(this.prog);
    if (!gl.getProgramParameter(this.prog, gl.LINK_STATUS)) throw new Error('program link: ' + gl.getProgramInfoLog(this.prog));
    gl.useProgram(this.prog);
    this.loc = {};
    for (const name of ['uProj','uView','uModel','uTime','uWater','uFogColor','uFogNear','uFogFar','uFogAmt','uMoonDir','uCamPos','uEmissive','uSpotPos','uSpotR']) this.loc[name] = gl.getUniformLocation(this.prog, name);
    this.aPos = gl.getAttribLocation(this.prog, 'aPos');
    this.aCol = gl.getAttribLocation(this.prog, 'aCol');
    this.aNrm = gl.getAttribLocation(this.prog, 'aNrm');
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.05, 0.07, 0.12, 1);
    this.time = 0;
  }
  resize(w, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(w * dpr); this.canvas.height = Math.floor(h * dpr);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.aspect = this.canvas.width / this.canvas.height;
  }
  begin(sky, fogColor, fogAmt, camPos) {
    const gl = this.gl;
    gl.clearColor(sky[0], sky[1], sky[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.uniform3fv(this.loc.uFogColor, fogColor);
    gl.uniform1f(this.loc.uFogAmt, fogAmt);
    gl.uniform1f(this.loc.uFogNear, 40);
    gl.uniform1f(this.loc.uFogFar, 520);
    gl.uniform3fv(this.loc.uMoonDir, [WORLD.moonDir.x, WORLD.moonDir.y, WORLD.moonDir.z]);
    gl.uniform3fv(this.loc.uCamPos, camPos);
    gl.uniform1f(this.loc.uTime, this.time);
    gl.uniform1f(this.loc.uEmissive, 0);
    gl.uniform1f(this.loc.uWater, 0);
    gl.uniform3fv(this.loc.uSpotPos, [0, 0, 0]);
    gl.uniform1f(this.loc.uSpotR, 0);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
  }
  setView(proj, view) {
    this.gl.uniformMatrix4fv(this.loc.uProj, false, new Float32Array(proj));
    this.gl.uniformMatrix4fv(this.loc.uView, false, new Float32Array(view));
  }
  draw(mesh, model, opts = {}) {
    const gl = this.gl;
    gl.uniformMatrix4fv(this.loc.uModel, false, new Float32Array(model));
    gl.uniform1f(this.loc.uEmissive, opts.emissive ? 1 : 0);
    gl.uniform1f(this.loc.uWater, opts.water ? 1 : 0);
    if (opts.spot) { gl.uniform3fv(this.loc.uSpotPos, opts.spot); gl.uniform1f(this.loc.uSpotR, opts.spotR || 20); }
    else { gl.uniform1f(this.loc.uSpotR, 0); }
    if (opts.blend) {
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
    } else { gl.disable(gl.BLEND); gl.depthMask(true); }
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ibo);
    const stride = 40;
    gl.enableVertexAttribArray(this.aPos); gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(this.aCol); gl.vertexAttribPointer(this.aCol, 4, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(this.aNrm); gl.vertexAttribPointer(this.aNrm, 3, gl.FLOAT, false, stride, 28);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
    if (opts.blend) { gl.disable(gl.BLEND); gl.depthMask(true); }
  }
}

// ---------------------------------------------------------------- static world meshes
export function buildWorldMeshes(gl, world) {
  const water = new MeshBuilder();
  const SEG = 24, SIZE = WORLD.size;
  for (let i = 0; i < SEG; i++) for (let j = 0; j < SEG; j++) {
    const x0 = -SIZE/2 + (i/SEG)*SIZE, x1 = -SIZE/2 + ((i+1)/SEG)*SIZE;
    const z0 = -SIZE/2 + (j/SEG)*SIZE, z1 = -SIZE/2 + ((j+1)/SEG)*SIZE;
    const v = 0.05 + 0.02 * Math.sin(i * 1.7 + j);
    water.quad([x0,0,z0],[x1,0,z0],[x1,0,z1],[x0,0,z1],[0.08+v, 0.19+v, 0.21+v, 1]);
  }
  const land = new MeshBuilder();
  // levee road (raised strip)
  land.box(0, 0.3, WORLD.roadZ, WORLD.roadX1 - WORLD.roadX0, 0.6, WORLD.roadHalf*2, [0.33, 0.29, 0.22, 1]);
  land.box(0, 0.62, WORLD.roadZ, WORLD.roadX1 - WORLD.roadX0, 0.06, 2, [0.75, 0.68, 0.3, 1]); // center line
  // town plaza disc as a low box
  land.box(WORLD.town.x, 0.25, WORLD.town.z, WORLD.town.r*2, 0.5, WORLD.town.r*1.7, [0.29, 0.26, 0.21, 1]);
  // dock planks
  land.box(WORLD.dock.x, 0.5, WORLD.dock.z, 46, 0.5, 18, [0.32, 0.22, 0.12, 1]);
  land.box(WORLD.dock.x, 0.5, WORLD.dock.z + 26, 10, 0.5, 34, [0.30, 0.21, 0.12, 1]);
  // stilt houses: piles + cabin + roof
  for (const h of world.houses) {
    for (const [px, pz] of [[-1,-1],[1,-1],[-1,1],[1,1]]) {
      land.cyl(h.x + px*h.w*0.36, 0.9, h.z + pz*h.d*0.36, 0.35, 1.8, [0.25, 0.18, 0.10, 1], 6);
    }
    land.box(h.x, 3.2, h.z, h.w, 3.4, h.d, [0.30 + h.hue*0.15, 0.22, 0.16, 1], h.rot);
    land.box(h.x, 5.4, h.z, h.w + 1.6, 1.0, h.d + 1.6, [0.16, 0.10, 0.08, 1], h.rot);
    if (h.lit) land.box(h.x, 3.0, h.z + h.d/2 + 0.1, 1.6, 1.2, 0.2, [1.0, 0.75, 0.3, 1], h.rot);
  }
  // hideout (bigger stilt house)
  land.box(WORLD.hideout.x, 3.4, WORLD.hideout.z, 16, 4, 12, [0.34, 0.24, 0.15, 1]);
  land.box(WORLD.hideout.x, 6.0, WORLD.hideout.z, 18, 1.2, 14, [0.15, 0.10, 0.07, 1]);
  land.box(WORLD.hideout.x, 0.5, WORLD.hideout.z + 14, 8, 0.5, 12, [0.30, 0.21, 0.12, 1]); // hideout dock
  for (const [px, pz] of [[-1,-1],[1,-1],[-1,1],[1,1],[0,-1],[0,1]]) {
    land.cyl(WORLD.hideout.x + px*6.5, 1.0, WORLD.hideout.z + pz*5, 0.4, 2.0, [0.25, 0.18, 0.10, 1], 6);
  }
  // cypress trees: trunk + knees + canopy blobs
  for (const t of world.trees) {
    land.cyl(t.x, t.h/2, t.z, 0.7, t.h, [0.20, 0.13, 0.08, 1], 7);
    land.box(t.x, t.h + 1.2, t.z, t.r*2.4, 2.6, t.r*2.4, [0.05, 0.16, 0.07, 1]);
    land.box(t.x + 1.5, t.h + 2.6, t.z, t.r*1.6, 1.8, t.r*1.6, [0.07, 0.20, 0.09, 1]);
    for (let k = 0; k < t.knees; k++) {
      const a = (k / t.knees) * Math.PI * 2;
      land.cyl(t.x + Math.cos(a)*2.2, 0.5, t.z + Math.sin(a)*2.2, 0.28, 1.0, [0.22, 0.15, 0.09, 1], 5);
    }
  }
  // reeds (thicker, brighter — they must read as a marsh, not toothpicks)
  for (const r of world.reeds) {
    land.box(r.x, r.h/2, r.z, 0.5, r.h, 0.5, [0.20 + r.lean*0.1, 0.42, 0.14, 1]);
    land.box(r.x + 0.6, r.h*0.35, r.z + 0.3, 0.36, r.h*0.7, 0.36, [0.24, 0.48, 0.16, 1]);
  }
  // town buildings (Cienaga Landing)
  const townB = [
    [WORLD.bar.x, WORLD.bar.z, 22, 7, 14, [0.28, 0.16, 0.14, 1]],
    [WORLD.workshop.x, WORLD.workshop.z, 20, 6, 12, [0.20, 0.20, 0.22, 1]],
    [WORLD.town.x - 40, WORLD.town.z + 60, 16, 8, 12, [0.24, 0.20, 0.16, 1]],
    [WORLD.town.x + 60, WORLD.town.z + 70, 14, 6, 12, [0.22, 0.24, 0.20, 1]],
    [WORLD.town.x - 90, WORLD.town.z - 50, 18, 7, 14, [0.26, 0.22, 0.18, 1]],
    [WORLD.town.x + 20, WORLD.town.z - 80, 15, 9, 12, [0.20, 0.18, 0.24, 1]],
  ];
  for (const [bx, bz, w, h, d, c] of townB) {
    land.box(bx, 0.5 + h/2, bz, w, h, d, c);
    land.box(bx, 0.5 + h + 0.4, bz, w + 1, 0.8, d + 1, [0.12, 0.10, 0.10, 1]);
  }
  const glow = new MeshBuilder();
  // neon signs at the bar + workshop + windows
  glow.box(WORLD.bar.x, 6.4, WORLD.bar.z + 7.2, 12, 1.4, 0.4, [1.0, 0.15, 0.55, 1]);
  glow.box(WORLD.bar.x, 4.6, WORLD.bar.z + 7.2, 7, 1.0, 0.4, [0.1, 0.95, 0.9, 1]);
  glow.box(WORLD.workshop.x, 5.6, WORLD.workshop.z + 6.2, 9, 1.2, 0.4, [1.0, 0.6, 0.1, 1]);
  glow.box(WORLD.town.x - 40, 6.5, WORLD.town.z + 66.2, 8, 1.0, 0.4, [0.6, 0.9, 1.0, 1]);
  for (const [bx, bz, w] of [[WORLD.bar.x, WORLD.bar.z, 22], [WORLD.town.x - 40, WORLD.town.z + 60, 16], [WORLD.town.x + 60, WORLD.town.z + 70, 14]]) {
    glow.box(bx - w/4, 3.2, bz + 6.2, 2.2, 1.6, 0.3, [1.0, 0.8, 0.35, 1]);
    glow.box(bx + w/4, 3.2, bz + 6.2, 2.2, 1.6, 0.3, [1.0, 0.8, 0.35, 1]);
  }
  // moon: a round disc in the sky (XY plane, facing the marsh), not a square
  glow.discXY(-820, 320, -1350, 46, [0.95, 0.93, 0.8, 1]);
  glow.discXY(-820, 320, -1348, 60, [0.55, 0.58, 0.62, 0.35]);
  // dead-drop markers (small glowing crates)
  for (const d of world.drops) {
    glow.box(d.x, 0.8, d.z, 1.6, 1.2, 1.6, [1.0, 0.75, 0.15, 1]);
    land.box(d.x, 0.3, d.z, 3.2, 0.6, 3.2, [0.2, 0.16, 0.1, 1]);
  }
  // buyer markers
  for (const b of world.buyers) {
    glow.box(b.x, 5.2, b.z, 2.0, 2.0, 0.4, [0.2, 1.0, 0.5, 1]);
  }
  // hideout lit windows (warm, facing the dock where Rook stands)
  glow.box(WORLD.hideout.x - 3, 3.4, WORLD.hideout.z + 6.1, 2.2, 1.5, 0.3, [1.0, 0.8, 0.35, 1]);
  glow.box(WORLD.hideout.x + 3.5, 3.4, WORLD.hideout.z + 6.1, 2.2, 1.5, 0.3, [1.0, 0.8, 0.35, 1]);
  // fog banks (translucent quads, drawn separately)
  const fogBank = new MeshBuilder();
  fogBank.quad([-60, 0, 0], [60, 0, 0], [60, 26, 0], [-60, 26, 0], [0.75, 0.78, 0.82, 0.14]);
  return {
    water: water.build(gl), land: land.build(gl), glow: glow.build(gl), fogBank: fogBank.build(gl),
  };
}

// ---------------------------------------------------------------- entity meshes (unit, origin-centered)
export function buildEntityMeshes(gl) {
  // airboat "Mudskipper": hull + vertical rear fan + seat + bow light
  const ab = new MeshBuilder();
  ab.box(0, 0.5, 0, 3.4, 0.7, 6.4, [0.55, 0.20, 0.10, 1]); // hull (red-brown)
  ab.box(0, 1.0, 1.2, 2.8, 0.5, 3.4, [0.65, 0.25, 0.12, 1]); // deck
  ab.box(0, 1.4, 1.6, 1.4, 0.8, 1.2, [0.30, 0.22, 0.14, 1]); // seat
  ab.box(0, 2.2, -2.7, 2.7, 2.7, 0.25, [0.5, 0.48, 0.46, 1]); // fan frame (vertical)
  ab.box(0, 2.2, -2.55, 2.2, 2.2, 0.12, [0.32, 0.32, 0.30, 1]); // fan disc (dark, so the blades read)
  ab.box(0, 2.2, -2.95, 0.35, 2.0, 0.14, [0.78, 0.78, 0.74, 1]); // fan blade vertical (behind frame, visible from the rear)
  ab.box(0, 2.2, -2.95, 2.0, 0.35, 0.14, [0.78, 0.78, 0.74, 1]); // fan blade horizontal
  ab.box(0, 1.5, 2.9, 0.5, 0.4, 0.5, [1.0, 0.95, 0.6, 1]); // bow light
  const airboat = ab.build(gl);

  const pb = new MeshBuilder();
  pb.box(0, 0.5, 0, 3.4, 0.7, 6.4, [0.85, 0.88, 0.9, 1]); // white LWMP hull
  pb.box(0, 1.0, 1.2, 2.8, 0.5, 3.4, [0.75, 0.78, 0.82, 1]);
  pb.box(0, 1.4, 1.6, 1.4, 0.8, 1.2, [0.10, 0.15, 0.35, 1]);
  pb.box(0, 2.2, -2.7, 2.7, 2.7, 0.25, [0.5, 0.5, 0.5, 1]); // fan frame (vertical)
  pb.box(0, 2.2, -2.55, 2.2, 2.2, 0.12, [0.35, 0.35, 0.33, 1]); // fan disc
  pb.box(0, 2.2, -2.95, 0.35, 2.0, 0.14, [0.78, 0.78, 0.74, 1]);
  pb.box(0, 2.2, -2.95, 2.0, 0.35, 0.14, [0.78, 0.78, 0.74, 1]);
  pb.box(0, 1.9, 0.5, 0.6, 0.5, 0.6, [0.1, 0.3, 1.0, 1]); // blue light bar
  const patrolBoat = pb.build(gl);

  const tr = new MeshBuilder();
  tr.box(0, 0.9, 0.6, 2.2, 1.0, 4.6, [0.22, 0.28, 0.36, 1]); // bed/body (dark slate)
  tr.box(0, 1.35, -1.2, 2.24, 0.28, 4.0, [0.55, 0.20, 0.10, 1]); // red stripe along bed
  tr.box(0, 1.7, 2.2, 2.0, 1.4, 1.6, [0.50, 0.58, 0.68, 1]); // cab
  tr.box(0, 1.9, 3.0, 1.8, 0.7, 0.2, [0.6, 0.75, 0.85, 1]); // windshield
  for (const [wx, wz] of [[-1.0, 2.4], [1.0, 2.4], [-1.0, -1.6], [1.0, -1.6]]) {
    tr.cyl(wx, 0.45, wz, 0.45, 0.3, [0.08, 0.08, 0.08, 1], 8);
  }
  const truck = tr.build(gl);

  const gt = new MeshBuilder();
  gt.box(0, 0.35, 0, 1.1, 0.5, 3.6, [0.10, 0.22, 0.08, 1]); // body
  gt.box(0, 0.4, 2.4, 0.9, 0.35, 1.2, [0.12, 0.25, 0.09, 1]); // head
  gt.box(0, 0.25, -2.8, 0.5, 0.3, 2.2, [0.09, 0.20, 0.07, 1]); // tail
  gt.box(-0.25, 0.62, 2.7, 0.18, 0.18, 0.18, [1.0, 0.9, 0.2, 1]); // eye L
  gt.box(0.25, 0.62, 2.7, 0.18, 0.18, 0.18, [1.0, 0.9, 0.2, 1]); // eye R
  const gator = gt.build(gl);

  const hl = new MeshBuilder();
  hl.box(0, 0, 0, 2.6, 1.6, 5.2, [0.15, 0.18, 0.22, 1]); // body
  hl.box(0, 0.9, 0, 1.6, 0.8, 3.0, [0.2, 0.24, 0.28, 1]); // cabin
  hl.box(0, 0.1, -4.6, 0.6, 0.6, 4.4, [0.15, 0.18, 0.22, 1]); // tail boom
  hl.box(0, 0.6, 1.8, 0.8, 0.6, 0.8, [1.0, 0.95, 0.7, 1]); // searchlight housing
  const heli = hl.build(gl);
  const rotor = new MeshBuilder();
  rotor.box(0, 0, 0, 11, 0.15, 0.7, [0.1, 0.1, 0.1, 1]);
  const rotorMesh = rotor.build(gl);

  const cone = new MeshBuilder();
  cone.coneDown(9, 46, [1.0, 0.95, 0.7, 1]);
  const coneMesh = cone.build(gl);

  // player spotlight: beam tilted forward so it reads as a searchlight, not a pillar
  const spot = new MeshBuilder();
  spot.coneTilted(10, 58, 30, [1.0, 0.95, 0.7, 1]);
  const spotConeMesh = spot.build(gl);

  const pool = new MeshBuilder();
  pool.disc(0, 0, 0, 6, [1.0, 0.95, 0.7, 0.10]);
  const poolMesh = pool.build(gl);

  // gator eye glow (emissive, drawn at each gator's head)
  const eye = new MeshBuilder();
  eye.box(0, 0, 0, 0.3, 0.3, 0.3, [1.0, 0.9, 0.2, 1]);
  const eyeMesh = eye.build(gl);

  const person = new MeshBuilder();
  person.box(0, 0.9, 0, 0.7, 1.1, 0.45, [0.5, 0.3, 0.2, 1]); // torso
  person.box(0, 1.75, 0, 0.45, 0.45, 0.45, [0.85, 0.65, 0.45, 1]); // head
  person.box(0, 0.25, 0, 0.6, 0.5, 0.4, [0.2, 0.2, 0.25, 1]); // legs
  const personMesh = person.build(gl);

  const boat = new MeshBuilder();
  boat.box(0, 0.4, 0, 2.4, 0.6, 4.6, [0.6, 0.55, 0.4, 1]);
  boat.box(0, 0.9, -0.6, 1.8, 0.7, 2.2, [0.7, 0.65, 0.5, 1]);
  const trafficBoat = boat.build(gl);

  return { airboat, patrolBoat, truck, gator, heli, rotor: rotorMesh, cone: coneMesh, spotCone: spotConeMesh, pool: poolMesh, eye: eyeMesh, person: personMesh, trafficBoat };
}

// fog bank drift positions (deterministic) — low, wide, hugging the water
export function fogBankPositions(t) {
  const out = [];
  for (let i = 0; i < 10; i++) {
    const a = i * 2.39996;
    out.push({
      x: Math.sin(t * 0.008 + i * 1.7) * 500 + Math.cos(a) * 420,
      z: Math.cos(t * 0.006 + i * 2.3) * 500 + Math.sin(a) * 420,
      y: 1.5 + (i % 3) * 1.5, yaw: a, sx: 3.5 + (i % 4) * 1.0,
    });
  }
  return out;
}
