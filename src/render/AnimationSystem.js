// AnimationSystem — процедурные анимации животных: ходьба, бег, плавание, полёт,
// еда, сон, атака. Работает со «скелетом» из групп, созданным по модели вида.
import { THREE } from './geo.js';
import { ST } from '../life/BehaviorSystem.js';
import { clamp, lerp } from '../core/utils.js';

export class AnimationSystem {
  /** Создание анимируемого набора мешей по модели вида. */
  createRig(model, material) {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const mk = (geo) => { const m = new THREE.Mesh(geo, material); m.castShadow = true; m.matrixAutoUpdate = true; return m; };
    body.add(mk(model.body));
    const head = new THREE.Group(); head.position.fromArray(model.head.p); head.add(mk(model.head.geo)); body.add(head);
    let tail = null;
    if (model.tail) { tail = new THREE.Group(); tail.position.fromArray(model.tail.p); tail.add(mk(model.tail.geo)); body.add(tail); }
    let wingR = null, wingL = null;
    if (model.wing) {
      wingR = new THREE.Group(); wingR.position.fromArray(model.wing.p); wingR.add(mk(model.wing.geo)); body.add(wingR);
      wingL = new THREE.Group(); wingL.position.set(-model.wing.p[0], model.wing.p[1], model.wing.p[2]);
      const ml = mk(model.wing.geo); ml.scale.x = -1; wingL.add(ml); body.add(wingL);
    }
    const legs = model.legs.map((l) => { const gr = new THREE.Group(); gr.position.fromArray(l.p); gr.add(mk(l.geo)); root.add(gr); return { g: gr, pair: l.pair, side: l.side }; });
    return { root, body, head, tail, wingR, wingL, legs, model, material, amp: 0, fold: 1, low: 0, nod: 0, phase: Math.random() * 6, lunge: 0, pitch: 0 };
  }

  /**
   * Обновление позы. s — состояние: {speed, state, flying, swim, alt, striking}.
   * Используется и в мире, и в редакторе (там состояние задаётся вручную).
   */
  pose(rig, s, dt, time) {
    const ph = rig.model.ph, size = ph.size;
    const moving = s.speed > 0.15;
    const stride = Math.max(0.3, ph.legLen || size * 0.6);
    rig.phase += dt * (moving ? 2.2 + s.speed * 2.6 / stride : 1.2);
    const p = rig.phase;
    const k = Math.min(1, dt * 8);
    const sleeping = s.state === ST.SLEEP, eating = s.state === ST.EAT, frozen = s.state === ST.FREEZE;
    const targetAmp = s.flying ? 0 : moving ? clamp(0.28 + s.speed * 0.085, 0, 0.8) : 0;
    rig.amp = lerp(rig.amp, targetAmp, k);
    rig.low = lerp(rig.low, sleeping ? 1 : frozen ? 0.5 : 0, k * 0.5);
    rig.nod = lerp(rig.nod, eating ? 1 : sleeping ? 0.55 : 0, k * 0.7);
    rig.fold = lerp(rig.fold, s.flying ? 0 : 1, k * 0.6);
    if (s.striking > 0) rig.lunge = 1;
    rig.lunge = Math.max(0, rig.lunge - dt * 4);
    const amp = rig.amp;

    // ноги: диагональная походка; при полёте поджаты, во сне сложены
    const legLow = rig.low * (ph.legLen ? Math.min(0.75, 0.75) : 0);
    for (let i = 0; i < rig.legs.length; i++) {
      const l = rig.legs[i];
      const off = (l.pair % 2 ? Math.PI : 0) + (l.side > 0 ? Math.PI : 0);
      let rx = Math.sin(p + off) * amp;
      if (s.flying) rx = lerp(rx, 1.0, 1 - rig.fold);
      if (s.swim && !s.flying) rx = Math.sin(p * 1.3 + off) * 0.5;
      l.g.rotation.x = rx + rig.low * 1.25 * (l.pair % 2 ? -1 : 1);
      l.g.position.y = rig.model.legs[i].p[1] - rig.low * ph.legLen * 0.72;
    }
    // туловище: покачивание, наклон, дыхание
    const b = rig.body;
    const bob = Math.abs(Math.sin(p)) * amp * 0.07 * size + Math.sin(time * 2 + rig.phase) * 0.008 * size;
    b.position.y = bob - rig.low * ph.legLen * 0.72;
    let pitch = -rig.lunge * 0.35 + (s.flying ? -0.12 : 0) + (s.slope || 0);
    rig.pitch = lerp(rig.pitch, pitch, k);
    b.rotation.x = rig.pitch;
    b.rotation.z = Math.sin(p) * amp * 0.05 + (s.flying ? Math.sin(time * 0.9 + rig.phase) * 0.12 : 0);
    b.rotation.y = s.swim || !ph.legPairs ? Math.sin(p * (s.swim ? 1.4 : 1)) * (moving ? 0.16 : 0.04) : 0;
    // голова
    const h = rig.head;
    const grazeDepth = clamp(0.5 + ph.neckLen / Math.max(0.3, ph.standH) * 0.9, 0.4, 1.5);
    h.rotation.x = rig.nod * grazeDepth + (eating ? Math.sin(time * 9 + rig.phase) * 0.1 : 0) + Math.sin(p * 2) * amp * 0.05 + rig.lunge * 0.3 +
      (!moving && !sleeping && !eating ? Math.sin(time * 0.7 + rig.phase * 3) * 0.05 : 0);
    h.rotation.y = !moving && !sleeping && !eating ? Math.sin(time * 0.45 + rig.phase * 2) * 0.35 : 0;
    // хвост
    if (rig.tail) {
      const sw = s.swim ? 0.55 : 0.22 + amp * 0.3;
      rig.tail.rotation.y = Math.sin(p * (s.swim ? 1.4 : 0.9) + 1) * sw * (moving || !s.swim ? 1 : 0.3);
      rig.tail.rotation.x = Math.sin(p * 0.5) * 0.08 - rig.low * 0.3;
    }
    // крылья: взмахи в полёте, сложены на земле
    if (rig.wingR) {
      const f = rig.fold;
      const flap = Math.sin(time * (9 / Math.sqrt(size + 0.3)) + rig.phase) * 0.75 + 0.1;
      const rz = lerp(flap, -1.25, f), ry = lerp(0, -0.9, f);
      rig.wingR.rotation.set(0, ry, rz); rig.wingL.rotation.set(0, -ry, -rz);
      const sc = lerp(1, 0.7, f); rig.wingR.scale.setScalar(sc); rig.wingL.scale.setScalar(sc);
    }
  }
}
