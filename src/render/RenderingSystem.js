// RenderingSystem — графика: сцена, освещение, небо, ландшафт, вода, растения
// (InstancedMesh по видам), животные (анимированные модели вблизи и упрощённые
// инстансы вдали), частицы, сцена редактора и миниатюры видов.
import { THREE } from './geo.js';
import { buildCreatureModel, buildCreatureLow, getEggGeometry, getCarcassGeometry } from './CreatureBuilder.js';
import { buildPlantGeometry } from './PlantBuilder.js';
import { AnimationSystem } from './AnimationSystem.js';
import { Pool } from '../core/Pool.js';
import { clamp, clamp01, lerp, smoothstep, rnd, rndRange, TAU } from '../core/utils.js';
import { STAGE } from '../life/OrganismSystem.js';
import { ST } from '../life/BehaviorSystem.js';

export const QUALITY = {
  low: { name: 'Низкое', dpr: 1, shadows: false, rigs: 12, viewDist: 150, grassDist: 55, maxPlantInst: 900, rain: 250, water: false },
  medium: { name: 'Среднее', dpr: 1.5, shadows: true, shadowSize: 1024, rigs: 24, viewDist: 240, grassDist: 100, maxPlantInst: 2400, rain: 500, water: true },
  high: { name: 'Высокое', dpr: 2, shadows: true, shadowSize: 2048, rigs: 44, viewDist: 380, grassDist: 170, maxPlantInst: 6000, rain: 900, water: true },
};

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _c = new THREE.Color(), _up = new THREE.Vector3(0, 1, 0), _e = new THREE.Euler();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

export class RenderingSystem {
  constructor(canvas, quality = 'medium') {
    this.canvas = canvas;
    this.qualityName = quality;
    this.Q = QUALITY[quality];
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance' });
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 2400);
    this.anim = new AnimationSystem();
    this.time = 0;
    this.sim = null;
    this.selected = null; this.follow = false;
    this.cam = { tx: 0, tz: 0, ty: 0, dist: 90, yaw: 0.6, pitch: 0.75, sdist: 90, syaw: 0.6, spitch: 0.75, sx: 0, sz: 0 };
    this.mode = 'world';
    this.inset = { bottom: 0, right: 0 };

    // материалы (общие — одна шейдерная программа на все модели)
    this.matCreature = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.matTerrain = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.wind = { value: 0 }; this.windStr = { value: 1 };
    this.matPlant = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.matPlant.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.wind; sh.uniforms.uWind = this.windStr;
      sh.vertexShader = 'uniform float uTime;\nuniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float ph = uTime * 1.6 + instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.27;
          float sw = (0.05 * transformed.y + 0.0022 * transformed.y * transformed.y) * uWind;
          transformed.x += sin(ph) * sw; transformed.z += cos(ph * 0.8) * sw * 0.6;
        #endif`);
    };
    this.matPlantStatic = new THREE.MeshLambertMaterial({ vertexColors: true });

    this.buildEnvironment();
    this.buildEditorScene();
    this.plantViews = new Map(); this.creatureViews = new Map();
    this.plantT = 0; this.rigT = 0; this.cleanT = 0; this.colorT = 0; this.plantsDirty = true;
    this.rigged = new Set();
    this.setQuality(quality);
    this.resize();
  }

  setQuality(name) {
    this.qualityName = name; this.Q = QUALITY[name];
    const Q = this.Q, r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.dpr));
    r.shadowMap.enabled = Q.shadows;
    this.sun.castShadow = Q.shadows;
    if (Q.shadows) { this.sun.shadow.mapSize.set(Q.shadowSize, Q.shadowSize); if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; } }
    this.matTerrain.needsUpdate = true; this.matCreature.needsUpdate = true; this.matPlant.needsUpdate = true;
    this.plantsDirty = true;
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.w = w; this.h = h;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.edCam.aspect = w / h; this.edCam.updateProjectionMatrix();
  }

  // ======================= окружение =======================
  buildEnvironment() {
    const sc = this.scene;
    sc.fog = new THREE.Fog(0xbfd9ee, 120, 520);
    this.hemi = new THREE.HemisphereLight(0xdfeeff, 0x6b5a3a, 0.9); sc.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff2d8, 1.6); sc.add(this.sun); sc.add(this.sun.target);
    const sh = this.sun.shadow; sh.camera.near = 10; sh.camera.far = 420; sh.bias = -0.0015; sh.normalBias = 0.6;
    // небо: купол с градиентом
    this.skyU = { top: { value: new THREE.Color(0x3d86d8) }, bottom: { value: new THREE.Color(0xbfd9ee) } };
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1800, 20, 12), new THREE.ShaderMaterial({
      uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(normalize(vP).y * 1.6 + 0.12, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, pow(h, 0.65)), 1.0); }',
    }));
    this.sky.renderOrder = -10; sc.add(this.sky);
    // звёзды
    const sp = new Float32Array(500 * 3);
    for (let i = 0; i < 500; i++) { const a = rnd() * TAU, e = Math.asin(rnd()); sp[i * 3] = Math.cos(a) * Math.cos(e) * 1500; sp[i * 3 + 1] = Math.sin(e) * 1500 + 40; sp[i * 3 + 2] = Math.sin(a) * Math.cos(e) * 1500; }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    sc.add(this.stars);
    // солнце и луна
    this.sunDisc = new THREE.Mesh(new THREE.CircleGeometry(70, 20), new THREE.MeshBasicMaterial({ color: 0xfff3c0, fog: false, depthWrite: false }));
    this.moonDisc = new THREE.Mesh(new THREE.CircleGeometry(45, 20), new THREE.MeshBasicMaterial({ color: 0xdfe8ff, fog: false, depthWrite: false }));
    sc.add(this.sunDisc); sc.add(this.moonDisc);
    // облака
    const cg = new THREE.IcosahedronGeometry(1, 1);
    this.cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, fog: false, flatShading: true });
    this.clouds = new THREE.InstancedMesh(cg, this.cloudMat, 90);
    this.clouds.frustumCulled = false; this.cloudData = [];
    for (let i = 0; i < 30; i++) {
      const cx = rndRange(-900, 900), cz = rndRange(-900, 900), cyy = rndRange(110, 170), s = rndRange(18, 40);
      for (let k = 0; k < 3; k++) this.cloudData.push({ x: cx + rndRange(-1, 1) * s, y: cyy + rndRange(-0.2, 0.2) * s, z: cz + rndRange(-0.6, 0.6) * s, sx: s * rndRange(0.7, 1.2), sy: s * rndRange(0.3, 0.45), sz: s * rndRange(0.6, 1), g: i });
    }
    sc.add(this.clouds);
    // осадки
    const n = 900, pp = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) pp[i] = rndRange(-1, 1);
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
    this.rain = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xbfd8ff, size: 0.35, transparent: true, opacity: 0.7, depthWrite: false }));
    this.rain.frustumCulled = false; this.rain.visible = false; sc.add(this.rain);
    // огонь
    const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(600 * 3), 3));
    this.fireFx = new THREE.Points(fg, new THREE.PointsMaterial({ color: 0xff8a1e, size: 2.2, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.fireFx.frustumCulled = false; this.fireFx.visible = false; sc.add(this.fireFx);
    // эффекты событий: пул частиц
    const N = 240;
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    eg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    this.fx = new THREE.Points(eg, new THREE.PointsMaterial({ size: 0.9, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false }));
    this.fx.frustumCulled = false; sc.add(this.fx);
    this.fxLive = []; this.fxPool = new Pool(() => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, r: 1, g: 1, b: 1 }));
    this.fxMax = N;
    // кольцо выделения
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 28), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthTest: false }));
    this.ring.rotation.x = -Math.PI / 2; this.ring.visible = false; this.ring.renderOrder = 5; sc.add(this.ring);
    // указатель инструмента
    this.cursor = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 32), new THREE.MeshBasicMaterial({ color: 0x9cff7a, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthTest: false }));
    this.cursor.rotation.x = -Math.PI / 2; this.cursor.visible = false; this.cursor.renderOrder = 5; sc.add(this.cursor);
    // яйца и останки
    this.eggs = new THREE.InstancedMesh(getEggGeometry(), new THREE.MeshLambertMaterial(), 256);
    this.eggs.frustumCulled = false; this.eggs.castShadow = true; sc.add(this.eggs);
    this.carc = new THREE.InstancedMesh(getCarcassGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), 160);
    this.carc.frustumCulled = false; sc.add(this.carc);
  }

  emitFx(x, y, z, color, n = 8, up = 2) {
    for (let i = 0; i < n && this.fxLive.length < this.fxMax; i++) {
      const p = this.fxPool.get();
      p.x = x + rndRange(-0.4, 0.4); p.y = y + rndRange(0, 0.6); p.z = z + rndRange(-0.4, 0.4);
      p.vx = rndRange(-1, 1); p.vy = rndRange(0.5, 1) * up; p.vz = rndRange(-1, 1); p.life = rndRange(0.7, 1.4);
      p.r = color[0]; p.g = color[1]; p.b = color[2];
      this.fxLive.push(p);
    }
  }

  // ======================= мир =======================
  setSim(sim) {
    this.disposeWorld();
    this.sim = sim;
    if (!sim) return;
    const w = sim.world, ter = sim.terrain, N = w.N, V = w.V, cs = w.cell;
    const pos = new Float32Array(V * V * 3), col = new Float32Array(V * V * 3);
    for (let vz = 0; vz < V; vz++) for (let vx = 0; vx < V; vx++) {
      const k = (vz * V + vx) * 3; pos[k] = vx * cs; pos[k + 1] = w.height[vz * V + vx]; pos[k + 2] = vz * cs;
    }
    const idx = new Uint16Array(N * N * 6);
    let t = 0;
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const a = z * V + x, b = a + 1, c = a + V, d = c + 1;
      if ((x + z) % 2) { idx[t++] = a; idx[t++] = c; idx[t++] = b; idx[t++] = b; idx[t++] = c; idx[t++] = d; }
      else { idx[t++] = a; idx[t++] = c; idx[t++] = d; idx[t++] = a; idx[t++] = d; idx[t++] = b; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    ter.computeColors(col);
    g.computeVertexNormals(); g.computeBoundingSphere();
    this.terrainMesh = new THREE.Mesh(g, this.matTerrain);
    this.terrainMesh.receiveShadow = true;
    this.scene.add(this.terrainMesh);
    // вода
    const ws = Math.max(2400, w.size * 4), seg = this.Q.water ? 60 : 1;
    const wg = new THREE.PlaneGeometry(ws, ws, seg, seg); wg.rotateX(-Math.PI / 2);
    this.waterMat = new THREE.MeshLambertMaterial({ color: 0x2f86c2, transparent: true, opacity: 0.8, flatShading: true });
    this.water = new THREE.Mesh(wg, this.waterMat);
    this.water.position.set(w.size / 2, 0, w.size / 2); this.water.receiveShadow = true;
    this.waterBase = Float32Array.from(wg.attributes.position.array);
    this.scene.add(this.water);
    const c = this.cam; c.tx = c.sx = w.size / 2; c.tz = c.sz = w.size / 2; c.dist = c.sdist = Math.min(150, w.size * 0.45);
    this.plantsDirty = true;
    this.fogFar = Math.max(this.Q.viewDist * 1.6, 300);
    sim.events.on('speciesChanged', (sp) => this.dropView(sp));
    sim.events.on('terrainChanged', () => this.refreshTerrainHeights());
    sim.events.on('birth', (ch) => this.eventFx(ch, [1, 0.95, 0.5]));
    sim.events.on('hatch', (ch) => this.eventFx(ch, [1, 1, 0.9]));
    sim.events.on('mate', (f) => this.eventFx(f, [1, 0.45, 0.7]));
    sim.events.on('kill', (a, o) => this.eventFx(o, [0.9, 0.12, 0.1]));
  }

  eventFx(c, color) {
    if (!this.fxOn) return;
    const dx = c.x - this.cam.sx, dz = c.z - this.cam.sz;
    if (dx * dx + dz * dz < 90 * 90) this.emitFx(c.x, c.y + c.ph.standH * c.grow, c.z, color, 7);
  }

  refreshTerrainHeights() {
    const w = this.sim.world, a = this.terrainMesh.geometry.attributes.position;
    for (let i = 0; i < w.height.length; i++) a.array[i * 3 + 1] = w.height[i];
    a.needsUpdate = true; this.terrainMesh.geometry.computeVertexNormals();
    this.sim.terrain.heightDirty = false; this.sim.terrain.colorsDirty = true;
  }

  dropView(sp) {
    if (sp.kind === 'p') {
      const v = this.plantViews.get(sp.id);
      if (v) { this.scene.remove(v.mesh); v.mesh.geometry.dispose(); v.mesh.dispose(); this.plantViews.delete(sp.id); this.plantsDirty = true; }
    } else {
      const v = this.creatureViews.get(sp.id);
      if (v) {
        for (const c of this.rigged) if (c.sp === sp) this.releaseRig(c);
        v.pool.drain((rig) => { rig.material.dispose(); });
        this.scene.remove(v.inst); v.inst.dispose(); v.low.dispose();
        v.model.body.dispose(); v.model.head.geo.dispose(); v.model.legs.forEach((l) => l.geo.dispose());
        if (v.model.tail) v.model.tail.geo.dispose(); if (v.model.wing) v.model.wing.geo.dispose();
        this.creatureViews.delete(sp.id);
      }
    }
  }

  disposeWorld() {
    if (!this.sim) return;
    for (const c of [...this.rigged]) this.releaseRig(c);
    for (const sp of this.sim.organisms.species.values()) this.dropView(sp);
    this.plantViews.clear(); this.creatureViews.clear();
    if (this.terrainMesh) { this.scene.remove(this.terrainMesh); this.terrainMesh.geometry.dispose(); this.terrainMesh = null; }
    if (this.water) { this.scene.remove(this.water); this.water.geometry.dispose(); this.waterMat.dispose(); this.water = null; }
    this.selected = null; this.ring.visible = false; this.eggs.count = 0; this.carc.count = 0;
    this.sim = null;
  }

  // ---------- растения
  plantView(sp) {
    let v = this.plantViews.get(sp.id);
    if (!v) {
      const geo = buildPlantGeometry(sp.genome, this.qualityName === 'low' ? 1 : 0);
      v = { cap: 0, mesh: null, geo, n: 0, floating: sp.ph.type === 3 };
      this.plantViews.set(sp.id, v);
      this.growView(v, 64);
    }
    return v;
  }
  growView(v, cap) {
    if (v.mesh) { this.scene.remove(v.mesh); v.mesh.dispose(); }
    v.cap = cap;
    v.mesh = new THREE.InstancedMesh(v.geo, this.matPlant, cap);
    v.mesh.frustumCulled = false; v.mesh.castShadow = true; v.mesh.receiveShadow = true;
    v.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    v.mesh.count = 0;
    this.scene.add(v.mesh);
  }

  rebuildPlants() {
    const sim = this.sim, plants = sim.organisms.plants, ter = sim.terrain, cl = sim.climate, Q = this.Q;
    for (const v of this.plantViews.values()) { v.n = 0; v.need = 0; }
    const cx = this.cam.sx, cz = this.cam.sz, zoomK = clamp(this.cam.sdist / 60, 1, 3);
    const gd2 = (Q.grassDist * zoomK) ** 2, sd2 = (Q.grassDist * 1.8 * zoomK) ** 2, td2 = (Q.viewDist * 1.5) ** 2;
    const season = cl.season, sf = (cl.yearFrac * 4) % 1, wl = ter.waterLevel;
    let total = 0;
    const autumn = season === 2 ? 0.25 + sf * 0.75 : 0;
    for (let i = 0; i < plants.length; i++) {
      const p = plants[i];
      if (!p.alive) continue;
      const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz, type = p.ph.type;
      if (d2 > (type === 0 ? td2 : type === 1 || type === 3 ? sd2 : gd2)) continue;
      if (type !== 0 && total >= Q.maxPlantInst) continue;
      const v = this.plantView(p.sp);
      v.need++;
      if (v.n >= v.cap) continue;
      let s = Math.max(0.1, p.grow) * p.sc, sy = s;
      if (type === 2) sy *= 0.45 + 0.55 * clamp01(p.bio / (p.ph.maxBio * p.grow * p.grow + 0.01));
      _p.set(p.x, v.floating ? wl - 0.02 : p.y - 0.03, p.z);
      _q.setFromAxisAngle(_up, p.rot); _s.set(s, sy, s);
      _m.compose(_p, _q, _s);
      v.mesh.setMatrixAt(v.n, _m);
      // оттенок: здоровье, сезон, снег, огонь
      let r = 1, g = 1, b = 1;
      if (p.health < 0.6) { const k = (0.6 - p.health) * 1.1; r = lerp(r, 0.8, k); g = lerp(g, 0.62, k); b = lerp(b, 0.36, k); }
      if (p.ph.deciduous) {
        if (autumn) { r = lerp(r, 1.5, autumn * 0.7); g = lerp(g, 0.85, autumn * 0.7); b = lerp(b, 0.3, autumn * 0.7); }
        else if (season === 3 || p.gf === 0) { r = 0.66; g = 0.56; b = 0.46; }
      }
      const sn = ter.snow[p.cell];
      if (sn > 0.2 && type !== 3) { const k = Math.min(0.65, sn); r = lerp(r, 1.5, k); g = lerp(g, 1.55, k); b = lerp(b, 1.7, k); }
      if (ter.fire[p.cell] > 0) { r = 1.8; g = 0.55; b = 0.12; } else if (ter.burnt[p.cell] > 0.5) { r *= 0.35; g *= 0.3; b *= 0.28; }
      const ic = v.mesh.instanceColor.array, k3 = v.n * 3;
      ic[k3] = r; ic[k3 + 1] = g; ic[k3 + 2] = b;
      v.n++; total++;
    }
    for (const [id, v] of this.plantViews) {
      if (v.need > v.cap) { this.growView(v, Math.max(v.cap * 2, Math.ceil(v.need * 1.3))); this.plantsDirty = true; continue; }
      v.mesh.count = v.n; v.mesh.instanceMatrix.needsUpdate = true; v.mesh.instanceColor.needsUpdate = true;
    }
    this.plantCount = total;
  }

  // ---------- животные
  creatureView(sp) {
    let v = this.creatureViews.get(sp.id);
    if (!v) {
      const model = buildCreatureModel(sp.genome), low = buildCreatureLow(sp.genome);
      const inst = new THREE.InstancedMesh(low, this.matCreature, 32);
      inst.frustumCulled = false; inst.castShadow = true; inst.count = 0;
      inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(32 * 3), 3);
      this.scene.add(inst);
      v = { model, low, inst, cap: 32, n: 0, base: sp.ph.color, size: sp.ph.size };
      v.pool = new Pool(() => this.anim.createRig(model, this.matCreature.clone()));
      this.creatureViews.set(sp.id, v);
    }
    return v;
  }

  acquireRig(c) {
    const v = this.creatureView(c.sp);
    const rig = v.pool.get();
    this.tintOf(c, v, rig.material.color);
    rig.amp = 0; rig.low = 0; rig.nod = 0;
    this.scene.add(rig.root);
    c.rig = rig; this.rigged.add(c);
  }
  releaseRig(c) {
    const rig = c.rig; if (!rig) return;
    this.scene.remove(rig.root);
    const v = this.creatureViews.get(c.sp.id);
    if (v) v.pool.release(rig); else rig.material.dispose();
    c.rig = null; this.rigged.delete(c);
  }
  tintOf(c, v, out) {
    const a = c.ph.color, b = v.base;
    out.setRGB(clamp(a[0] / (b[0] + 0.02), 0.5, 1.8), clamp(a[1] / (b[1] + 0.02), 0.5, 1.8), clamp(a[2] / (b[2] + 0.02), 0.5, 1.8));
    if (c.sick > 0) out.multiplyScalar(0.7);
    return out;
  }

  assignRigs() {
    const cs = this.sim.organisms.creatures, cx = this.cam.sx, cz = this.cam.sz;
    const R2 = Math.min(this.Q.viewDist * 0.5, 40 + this.cam.sdist * 0.9) ** 2;
    const list = this._rigList || (this._rigList = []);
    list.length = 0;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (!c.alive || c.stage === STAGE.EGG) continue;
      const dx = c.x - cx, dz = c.z - cz; c._d2 = dx * dx + dz * dz;
      if (c === this.selected) c._d2 = -1;
      if (c._d2 < R2) list.push(c);
    }
    list.sort((a, b) => a._d2 - b._d2);
    if (list.length > this.Q.rigs) list.length = this.Q.rigs;
    const stamp = (this._stamp = (this._stamp || 0) + 1);
    for (const c of list) c._want = stamp;
    for (const c of [...this.rigged]) if (!c.alive || c._want !== stamp) this.releaseRig(c);
    for (const c of list) if (!c.rig) this.acquireRig(c);
  }

  updateCreatures(dt) {
    const sim = this.sim, cs = sim.organisms.creatures, ter = sim.terrain;
    const cx = this.cam.sx, cz = this.cam.sz, vd2 = (this.Q.viewDist * 1.3) ** 2, t = this.time;
    for (const v of this.creatureViews.values()) v.n = 0;
    let eggs = 0;
    const eggA = this.eggs;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (!c.alive) continue;
      if (c.stage === STAGE.EGG) {
        if (eggs < 256) {
          const s = c.ph.size * 0.55;
          _p.set(c.x, c.y, c.z); _q.identity(); _s.set(s, s, s); _m.compose(_p, _q, _s);
          eggA.setMatrixAt(eggs, _m); const cc = c.ph.color2;
          eggA.setColorAt(eggs, _c.setRGB(0.6 + cc[0] * 0.4, 0.6 + cc[1] * 0.4, 0.55 + cc[2] * 0.4)); eggs++;
        }
        continue;
      }
      const sc = c.grow;
      if (c.rig) {
        const rig = c.rig, root = rig.root;
        root.position.set(c.x, c.y, c.z);
        root.rotation.y = c.heading;
        root.scale.setScalar(sc * c.ph.size / this.creatureViews.get(c.sp.id).size);
        if (!c.flying && !c.swim && c.speed > 0.1) {
          const hx = Math.sin(c.heading), hz = Math.cos(c.heading), L = c.ph.L * 0.5 + 0.3;
          c._slope = clamp(-Math.atan2(ter.heightAt(c.x + hx * L, c.z + hz * L) - ter.heightAt(c.x - hx * L, c.z - hz * L), L * 2), -0.5, 0.5);
        } else if (c.flying || c.swim) c._slope = 0;
        c.slope = c._slope || 0;
        this.anim.pose(rig, c, dt, t);
        if (c.striking > 0) c.striking -= dt;
        continue;
      }
      const dx = c.x - cx, dz = c.z - cz;
      if (dx * dx + dz * dz > vd2) continue;
      const v = this.creatureView(c.sp);
      if (v.n >= v.cap) {
        const cap = v.cap * 2, old = v.inst;
        const inst = new THREE.InstancedMesh(v.low, this.matCreature, cap);
        inst.frustumCulled = false; inst.castShadow = true;
        inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
        inst.instanceMatrix.array.set(old.instanceMatrix.array); inst.instanceColor.array.set(old.instanceColor.array);
        this.scene.remove(old); old.dispose(); this.scene.add(inst); v.inst = inst; v.cap = cap;
      }
      const hop = c.speed > 0.2 && !c.flying && !c.swim ? Math.abs(Math.sin(t * 9 + c.id)) * 0.08 * c.ph.size : 0;
      const sleep = c.state === ST.SLEEP ? -c.ph.legLen * 0.6 * sc : 0;
      const s = sc * c.ph.size / v.size;
      _p.set(c.x, c.y + hop + sleep, c.z); _q.setFromAxisAngle(_up, c.heading); _s.set(s, s, s);
      _m.compose(_p, _q, _s);
      v.inst.setMatrixAt(v.n, _m);
      this.tintOf(c, v, _c);
      const ic = v.inst.instanceColor.array, k3 = v.n * 3; ic[k3] = _c.r; ic[k3 + 1] = _c.g; ic[k3 + 2] = _c.b;
      v.n++;
    }
    for (const v of this.creatureViews.values()) { v.inst.count = v.n; if (v.n) { v.inst.instanceMatrix.needsUpdate = true; v.inst.instanceColor.needsUpdate = true; } }
    eggA.count = eggs; if (eggs) { eggA.instanceMatrix.needsUpdate = true; eggA.instanceColor.needsUpdate = true; }
    // останки
    const ks = sim.organisms.carcasses; let n = 0;
    for (let i = 0; i < ks.length && n < 160; i++) {
      const k = ks[i]; if (!k.alive) continue;
      const s = k.size * (0.6 + 0.6 * k.meat / k.max);
      _p.set(k.x, k.y, k.z); _q.setFromAxisAngle(_up, (k.x * 7.3) % 6.28); _s.set(s, s, s); _m.compose(_p, _q, _s);
      this.carc.setMatrixAt(n++, _m);
    }
    this.carc.count = n; if (n) this.carc.instanceMatrix.needsUpdate = true;
  }

  cleanupViews() {
    for (const sp of this.sim.organisms.species.values()) {
      if (sp.pop > 0) continue;
      if (sp.kind === 'c' ? this.creatureViews.has(sp.id) : this.plantViews.has(sp.id)) this.dropView(sp);
    }
  }

  // ======================= кадр =======================
  update(dt, speed) {
    this.time += dt;
    if (this.mode === 'editor') { this.updateEditor(dt); return; }
    const sim = this.sim; if (!sim) return;
    const ter = sim.terrain, cl = sim.climate, cam = this.cam;
    this.fxOn = speed <= 3;
    // --- камера
    if (this.follow && this.selected && this.selected.alive) { cam.tx = this.selected.x; cam.tz = this.selected.z; }
    cam.tx = clamp(cam.tx, 0, ter.size); cam.tz = clamp(cam.tz, 0, ter.size);
    const k = Math.min(1, dt * 9);
    cam.sx = lerp(cam.sx, cam.tx, k); cam.sz = lerp(cam.sz, cam.tz, k);
    cam.sdist = lerp(cam.sdist, cam.dist, k); cam.spitch = lerp(cam.spitch, cam.pitch, k);
    let dy = cam.yaw - cam.syaw; cam.syaw += dy * k;
    let gy = Math.max(ter.heightAt(cam.sx, cam.sz), ter.waterLevel);
    if (this.follow && this.selected && this.selected.alive) gy = Math.max(gy, this.selected.y);
    cam.ty = lerp(cam.ty, gy, Math.min(1, dt * 4));
    const cp = Math.cos(cam.spitch), sp = Math.sin(cam.spitch);
    const c = this.camera;
    c.position.set(cam.sx + Math.sin(cam.syaw) * cp * cam.sdist, cam.ty + sp * cam.sdist + 1, cam.sz + Math.cos(cam.syaw) * cp * cam.sdist);
    const minY = Math.max(ter.heightAt(c.position.x, c.position.z), ter.waterLevel) + 1.5;
    if (c.position.y < minY) c.position.y = minY;
    c.lookAt(cam.sx, cam.ty + 1, cam.sz);
    c.clearViewOffset();
    // --- небо и свет (при большом ускорении смена дня и ночи «замораживается», чтобы не мерцало)
    const sunE = speed >= 8 ? 0.75 : cl.sunElev, dayAng = speed >= 8 ? 0.2 : cl.dayFrac;
    const day = smoothstep(-0.12, 0.28, sunE), dusk = clamp01(1 - Math.abs(sunE) / 0.32);
    const wet = cl.precip > 0 ? 0.55 + cl.precip * 0.3 : cl.weather === 'cloudy' ? 0.4 : 0;
    this.overcast = lerp(this.overcast ?? wet, wet, Math.min(1, dt * 0.6));
    const oc = this.overcast;
    const top = this.skyU.top.value, bot = this.skyU.bottom.value;
    top.setRGB(lerp(0.015, 0.2, day), lerp(0.025, 0.5, day), lerp(0.07, 0.9, day));
    bot.setRGB(lerp(0.05, 0.72, day) + dusk * 0.3, lerp(0.07, 0.86, day) + dusk * 0.05, lerp(0.15, 0.97, day) - dusk * 0.15);
    _c.setRGB(0.52 * (0.25 + 0.75 * day), 0.56 * (0.25 + 0.75 * day), 0.62 * (0.25 + 0.75 * day));
    top.lerp(_c, oc * 0.8); bot.lerp(_c, oc * 0.7);
    this.scene.fog.color.copy(bot);
    this.scene.fog.near = this.fogFar * (0.3 - oc * 0.15); this.scene.fog.far = this.fogFar * (1 - oc * 0.3) + cam.sdist;
    const ang = TAU * (dayAng - 0.25);
    _v.set(Math.cos(ang) * 0.8, Math.sin(ang), 0.45).normalize();
    const night = sunE < -0.05;
    if (night) _v.set(-_v.x, Math.max(0.35, -_v.y), -_v.z).normalize();
    this.sun.target.position.set(cam.sx, cam.ty, cam.sz);
    this.sun.position.set(cam.sx + _v.x * 180, cam.ty + _v.y * 180, cam.sz + _v.z * 180);
    this.sun.intensity = (night ? 0.28 : 0.25 + 1.55 * day) * (1 - oc * 0.5);
    this.sun.color.setRGB(night ? 0.6 : 1, night ? 0.7 : 0.95 - dusk * 0.25, night ? 1 : 0.85 - dusk * 0.4);
    this.hemi.intensity = 0.3 + 0.62 * day;
    if (this.Q.shadows) {
      const e = clamp(cam.sdist * 0.9, 40, 150), sc = this.sun.shadow.camera;
      if (sc.right !== e) { sc.left = -e; sc.right = e; sc.top = e; sc.bottom = -e; sc.updateProjectionMatrix(); }
    }
    this.sky.position.copy(c.position); this.stars.position.copy(c.position);
    this.stars.material.opacity = (1 - day) * (1 - oc);
    const sd = TAU * (dayAng - 0.25);
    this.sunDisc.position.set(c.position.x + Math.cos(sd) * 0.8 * 1500, c.position.y + Math.sin(sd) * 1500, c.position.z + 0.45 * 1500); this.sunDisc.lookAt(c.position);
    this.moonDisc.position.set(c.position.x - Math.cos(sd) * 0.8 * 1500, c.position.y - Math.sin(sd) * 1500, c.position.z - 0.45 * 1500); this.moonDisc.lookAt(c.position);
    this.sunDisc.visible = oc < 0.5; this.moonDisc.visible = oc < 0.5;
    // облака
    const wantClouds = Math.round(lerp(24, 90, clamp01(oc * 1.5)));
    for (let i = 0; i < this.cloudData.length; i++) {
      const d = this.cloudData[i];
      d.x += dt * 2.2; if (d.x > 1000) d.x -= 2000;
      _p.set(cam.sx + d.x, d.y, cam.sz + d.z); _q.identity(); _s.set(d.sx, d.sy, d.sz); _m.compose(_p, _q, _s);
      this.clouds.setMatrixAt(i, _m);
    }
    this.clouds.count = wantClouds; this.clouds.instanceMatrix.needsUpdate = true;
    const cb = (0.35 + 0.65 * day) * (1 - oc * 0.45);
    this.cloudMat.color.setRGB(cb + dusk * 0.12, cb, cb);
    // --- вода
    if (this.water) {
      this.water.position.y = ter.waterLevel;
      this.waterMat.color.setRGB(lerp(0.03, 0.2, day), lerp(0.1, 0.5, day), lerp(0.22, 0.74, day));
      if (this.Q.water) {
        const a = this.water.geometry.attributes.position.array, b = this.waterBase, t = this.time;
        for (let i = 0; i < a.length; i += 3) a[i + 1] = Math.sin(b[i] * 0.045 + t * 1.1) * 0.13 + Math.cos(b[i + 2] * 0.038 + t * 0.85) * 0.13;
        this.water.geometry.attributes.position.needsUpdate = true;
      }
    }
    // --- ландшафт: цвета (снег, сухость, пожары)
    this.colorT -= dt;
    if (ter.heightDirty) this.refreshTerrainHeights();
    if (this.colorT <= 0 || (ter.colorsDirty && this.colorT < 1.5)) {
      const a = this.terrainMesh.geometry.attributes.color;
      ter.computeColors(a.array); a.needsUpdate = true; this.colorT = 2.5;
    }
    // --- растения
    this.wind.value = this.time; this.windStr.value = 1 + cl.precip * 1.5;
    this.plantT -= dt;
    if (this.plantT <= 0 || this.plantsDirty) { this.plantsDirty = false; this.plantT = speed > 3 ? 0.25 : 0.45; this.rebuildPlants(); }
    // --- животные
    this.rigT -= dt;
    if (this.rigT <= 0) { this.rigT = 0.25; this.assignRigs(); }
    this.updateCreatures(dt);
    this.cleanT -= dt; if (this.cleanT <= 0) { this.cleanT = 5; this.cleanupViews(); }
    // --- выделение
    const sel = this.selected;
    if (sel && sel.alive) {
      const r = sel.kind === 'p' ? sel.ph.crownR * sel.grow + 0.5 : sel.ph.size * sel.grow * 0.9 + 0.6;
      this.ring.visible = true; this.ring.scale.setScalar(r * (1 + Math.sin(this.time * 4) * 0.06));
      this.ring.position.set(sel.x, (sel.kind === 'p' ? Math.max(sel.y, sel.ph.type === 3 ? ter.waterLevel : -99) : sel.y - (sel.alt || 0)) + 0.25, sel.z);
    } else { this.ring.visible = false; if (sel) { this.selected = null; this.follow = false; } }
    this.updateParticles(dt);
  }

  updateParticles(dt) {
    const sim = this.sim, cl = sim.climate, ter = sim.terrain, cam = this.cam;
    // осадки: дождь или снег в зависимости от температуры у камеры
    const pr = cl.precip;
    this.rain.visible = pr > 0.05;
    if (this.rain.visible) {
      const snow = cl.tempAt(cam.sx, cam.sz) < 0.5;
      const m = this.rain.material; m.size = snow ? 0.55 : 0.3; m.color.setHex(snow ? 0xffffff : 0xa9c8f0);
      const a = this.rain.geometry.attributes.position.array, n = Math.min(this.Q.rain, a.length / 3);
      const R = 30 + cam.sdist * 0.5, Hh = 40, sp = snow ? 5 : 38, t = this.time;
      for (let i = 0; i < n; i++) {
        const k = i * 3, seed = i * 12.9898;
        const fx = (Math.sin(seed) * 43758.5453) % 1, fz = (Math.sin(seed * 1.7) * 24634.6345) % 1, fy = (Math.sin(seed * 2.3) * 12345.678) % 1;
        a[k] = cam.sx + fx * R + (snow ? Math.sin(t + i) * 1.5 : 0);
        a[k + 2] = cam.sz + fz * R;
        a[k + 1] = cam.ty + Hh - ((Math.abs(fy) * Hh + t * sp) % Hh);
      }
      this.rain.geometry.setDrawRange(0, Math.floor(n * clamp01(pr * 1.2)));
      this.rain.geometry.attributes.position.needsUpdate = true;
    }
    // огонь
    const fires = cl.fires;
    this.fireFx.visible = fires.length > 0;
    if (fires.length) {
      const a = this.fireFx.geometry.attributes.position.array, max = a.length / 3, N = ter.N, cs = ter.cs;
      let n = 0;
      const per = Math.max(1, Math.min(4, Math.floor(max / fires.length)));
      for (let i = 0; i < fires.length && n < max; i++) {
        const ci = fires[i], x = (ci % N + 0.5) * cs, z = (((ci / N) | 0) + 0.5) * cs, y = sim.world.cellH[ci];
        for (let j = 0; j < per && n < max; j++) { a[n * 3] = x + rndRange(-2, 2); a[n * 3 + 1] = y + rndRange(0.3, 4.5); a[n * 3 + 2] = z + rndRange(-2, 2); n++; }
      }
      this.fireFx.geometry.setDrawRange(0, n); this.fireFx.geometry.attributes.position.needsUpdate = true;
    }
    // частицы событий
    const live = this.fxLive, pa = this.fx.geometry.attributes.position.array, ca = this.fx.geometry.attributes.color.array;
    let n = 0;
    for (let i = live.length - 1; i >= 0; i--) {
      const p = live[i];
      p.life -= dt;
      if (p.life <= 0) { this.fxPool.release(p); live[i] = live[live.length - 1]; live.pop(); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vy -= dt * 1.2;
    }
    for (let i = 0; i < live.length; i++) { const p = live[i]; pa[n * 3] = p.x; pa[n * 3 + 1] = p.y; pa[n * 3 + 2] = p.z; ca[n * 3] = p.r; ca[n * 3 + 1] = p.g; ca[n * 3 + 2] = p.b; n++; }
    this.fx.geometry.setDrawRange(0, n);
    if (n) { this.fx.geometry.attributes.position.needsUpdate = true; this.fx.geometry.attributes.color.needsUpdate = true; }
  }

  render() {
    if (this.mode === 'editor') this.renderer.render(this.edScene, this.edCam);
    else if (this.sim) this.renderer.render(this.scene, this.camera);
  }

  /** Точка на поверхности под экранными координатами. */
  pickGround(px, py) {
    if (!this.sim) return null;
    const ter = this.sim.terrain, c = this.camera;
    _v.set((px / this.w) * 2 - 1, -(py / this.h) * 2 + 1, 0.5).unproject(c);
    _v2.copy(_v).sub(c.position).normalize();
    const o = c.position;
    let t = 0, prev = 0;
    for (let i = 0; i < 400; i++) {
      const x = o.x + _v2.x * t, y = o.y + _v2.y * t, z = o.z + _v2.z * t;
      const g = Math.max(ter.heightAt(x, z), ter.waterLevel);
      if (y <= g) {
        let a = prev, b = t;
        for (let k = 0; k < 8; k++) { const m = (a + b) / 2; const yy = o.y + _v2.y * m; if (yy <= Math.max(ter.heightAt(o.x + _v2.x * m, o.z + _v2.z * m), ter.waterLevel)) b = m; else a = m; }
        const rx = o.x + _v2.x * b, rz = o.z + _v2.z * b;
        if (rx < 0 || rz < 0 || rx > ter.size || rz > ter.size) return null;
        return { x: rx, z: rz, y: o.y + _v2.y * b };
      }
      prev = t; t += Math.max(1, (y - g) * 0.4);
      if (t > 2000) break;
    }
    return null;
  }

  /** Поиск организма рядом с лучом (для выбора касанием). */
  pickOrganism(px, py) {
    const g = this.pickGround(px, py); if (!g) return null;
    const org = this.sim.organisms, r = 2.5 + this.cam.sdist * 0.035;
    // летающие и крупные — проверяем проекцию на экран
    let best = null, bd = 34 * 34;
    org.cgrid.query(g.x, g.z, r + 12, (c) => {
      if (!c.alive) return;
      _v.set(c.x, c.y + c.ph.standH * c.grow * 0.6, c.z).project(this.camera);
      const sx = (_v.x + 1) / 2 * this.w, sy = (1 - _v.y) / 2 * this.h, d = (sx - px) ** 2 + (sy - py) ** 2;
      if (d < bd) { bd = d; best = c; }
    });
    if (best) return best;
    return org.nearestPlant(g.x, g.z, r + 1.5);
  }

  setCursor(x, z, radius, color) {
    if (x === null) { this.cursor.visible = false; return; }
    const ter = this.sim.terrain;
    this.cursor.visible = true; this.cursor.scale.setScalar(radius);
    this.cursor.position.set(x, Math.max(ter.heightAt(x, z), ter.waterLevel) + 0.3, z);
    if (color) this.cursor.material.color.setHex(color);
  }

  // ======================= редактор =======================
  buildEditorScene() {
    const sc = this.edScene = new THREE.Scene();
    sc.background = new THREE.Color(0x9fd0e8);
    sc.fog = new THREE.Fog(0x9fd0e8, 40, 140);
    sc.add(new THREE.HemisphereLight(0xffffff, 0x7a6a50, 1.0));
    const d = new THREE.DirectionalLight(0xfff4e0, 1.5); d.position.set(6, 12, 8); sc.add(d);
    this.edLight = d;
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.15, 0.4, 32), new THREE.MeshLambertMaterial({ color: 0x6fae5a, flatShading: true }));
    ped.position.y = -0.2; sc.add(ped); this.edPed = ped;
    const ground = new THREE.Mesh(new THREE.CircleGeometry(200, 24), new THREE.MeshLambertMaterial({ color: 0x8cc474 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.4; sc.add(ground);
    this.edCam = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
    this.ed = { yaw: 0.7, pitch: 0.25, dist: 6, height: 1, obj: null, rig: null, anim: 'idle', auto: true, disp: [] };
    // отдельная сцена для миниатюр
    const ts = this.thScene = new THREE.Scene();
    ts.add(new THREE.HemisphereLight(0xffffff, 0x8a7a60, 1.1));
    const td = new THREE.DirectionalLight(0xffffff, 1.4); td.position.set(4, 8, 6); ts.add(td);
    this.thCam = new THREE.PerspectiveCamera(32, 1, 0.1, 300);
    this.thTarget = new THREE.WebGLRenderTarget(160, 160);
    this.thCanvas = document.createElement('canvas'); this.thCanvas.width = 160; this.thCanvas.height = 160;
    this.thCache = new Map();
  }

  clearEditorModel() {
    const ed = this.ed;
    if (ed.obj) this.edScene.remove(ed.obj);
    for (const g of ed.disp) g.dispose();
    ed.disp = []; ed.obj = null; ed.rig = null;
  }

  /** Показать организм в редакторе. kind: 'c' | 'p'. */
  setEditorModel(kind, genome) {
    const ed = this.ed;
    this.clearEditorModel();
    let h = 1, wdt = 1;
    if (kind === 'c') {
      const model = buildCreatureModel(genome);
      const rig = this.anim.createRig(model, this.matCreature);
      ed.rig = rig; ed.obj = rig.root; h = model.height; wdt = Math.max(model.length, model.ph.wing > 0.12 ? model.ph.size * model.ph.wing * 3.2 : 0);
      ed.disp.push(model.body, model.head.geo, ...model.legs.map((l) => l.geo)); if (model.tail) ed.disp.push(model.tail.geo); if (model.wing) ed.disp.push(model.wing.geo);
      ed.fishy = model.ph.resp === 1;
      rig.root.position.y = ed.fishy ? model.ph.H * 0.6 : 0;
    } else {
      const geo = buildPlantGeometry(genome, 0);
      const mesh = new THREE.Mesh(geo, this.matPlantStatic);
      ed.obj = mesh; ed.disp.push(geo);
      geo.computeBoundingBox(); h = geo.boundingBox.max.y; wdt = (geo.boundingBox.max.x - geo.boundingBox.min.x);
      mesh.position.y = geo.boundingBox.min.y < -1 ? 0.6 : 0;
    }
    this.edScene.add(ed.obj);
    ed.height = h; ed.width = wdt;
    const r = Math.max(wdt * 0.6, h * 0.35, 0.5);
    this.edPed.scale.set(r, 1, r);
    ed.fit = Math.max(h * 1.5, wdt * 1.25, 1.2) * 1.35;
    if (!ed.userZoom) ed.dist = ed.fit;
  }

  updateEditor(dt) {
    const ed = this.ed, c = this.edCam;
    if (ed.auto) ed.yaw += dt * 0.35;
    if (ed.rig) {
      const ph = ed.rig.model.ph;
      const a = ed.anim;
      const s = this._edState || (this._edState = {});
      s.speed = a === 'walk' ? (ed.fishy ? ph.swim : ph.land) * 0.5 : a === 'run' ? ph.land : a === 'fly' ? ph.fly : 0;
      s.state = a === 'eat' ? ST.EAT : a === 'sleep' ? ST.SLEEP : ST.IDLE;
      s.flying = a === 'fly'; s.swim = ed.fishy; s.striking = 0; s.slope = 0;
      this.anim.pose(ed.rig, s, dt, this.time);
      ed.rig.root.position.y = (ed.fishy ? ph.H * 0.6 : 0) + (a === 'fly' ? ed.height * 0.5 : 0);
    } else if (ed.obj) ed.obj.rotation.z = Math.sin(this.time * 1.3) * 0.015;
    const ty = ed.height * 0.45;
    const cp = Math.cos(ed.pitch);
    c.position.set(Math.sin(ed.yaw) * cp * ed.dist, ty + Math.sin(ed.pitch) * ed.dist, Math.cos(ed.yaw) * cp * ed.dist);
    c.lookAt(0, ty, 0);
    const b = this.inset.bottom, r = this.inset.right;
    if (b || r) c.setViewOffset(this.w, this.h, r / 2, b / 2, this.w, this.h); else c.clearViewOffset();
  }

  /** Миниатюра вида (data URL), кэшируется. */
  thumbnail(sp) {
    const key = sp.id + ':' + (sp.thumbV || 0);
    let url = this.thCache.get(key);
    if (url) return url;
    url = this.renderThumb(sp.kind, sp.genome);
    this.thCache.set(key, url);
    return url;
  }

  renderThumb(kind, genome) {
    const r = this.renderer, sc = this.thScene, cam = this.thCam;
    const geo = kind === 'c' ? buildCreatureLow(genome) : buildPlantGeometry(genome, 1);
    const mesh = new THREE.Mesh(geo, kind === 'c' ? this.matCreature : this.matPlantStatic);
    geo.computeBoundingBox();
    const bb = geo.boundingBox, cx = (bb.min.x + bb.max.x) / 2, cy = (Math.max(bb.min.y, -0.3) + bb.max.y) / 2, cz = (bb.min.z + bb.max.z) / 2;
    const ext = Math.max(bb.max.x - bb.min.x, bb.max.y - Math.max(bb.min.y, -0.3), bb.max.z - bb.min.z);
    sc.add(mesh);
    const d = ext * 1.75 + 0.3;
    cam.position.set(cx + d * 0.72, cy + d * 0.32, cz + d * 0.62); cam.lookAt(cx, cy, cz);
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.thTarget); r.setClearColor(0x000000, 0); r.clear();
    r.render(sc, cam);
    const buf = new Uint8Array(160 * 160 * 4);
    r.readRenderTargetPixels(this.thTarget, 0, 0, 160, 160, buf);
    r.setRenderTarget(prev);
    sc.remove(mesh); geo.dispose();
    const ctx = this.thCanvas.getContext('2d'), img = ctx.createImageData(160, 160);
    for (let y = 0; y < 160; y++) img.data.set(buf.subarray((159 - y) * 640, (160 - y) * 640), y * 640);
    ctx.putImageData(img, 0, 0);
    return this.thCanvas.toDataURL('image/png');
  }
}
