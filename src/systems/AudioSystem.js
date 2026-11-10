// AudioSystem — звук на Web Audio API без внешних файлов: генеративная музыка,
// звуки природы (ветер, дождь, птицы, сверчки) и сигналы интерфейса и событий.
import { rnd, rndRange, rndPick, clamp01 } from '../core/utils.js';

const SCALES = { day: [0, 2, 4, 7, 9, 12, 14, 16], night: [0, 3, 5, 7, 10, 12, 15, 17] };
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class AudioSystem {
  constructor() { this.ctx = null; this.sound = true; this.music = true; this.ready = false; this.t = { mus: 2, bird: 3, cricket: 1, mel: 6 }; this.env = { night: 0, rain: 0, life: 0.5 }; }

  /** Запуск после первого касания (требование браузеров). */
  unlock() {
    if (this.ready) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    try {
      const c = this.ctx = new AC();
      this.master = c.createGain(); this.master.gain.value = 0.9; this.master.connect(c.destination);
      this.sfx = c.createGain(); this.sfx.connect(this.master);
      this.amb = c.createGain(); this.amb.connect(this.master);
      this.mus = c.createGain(); this.mus.gain.value = 0.5;
      // простая реверберация: линия задержки с обратной связью
      const d = c.createDelay(1); d.delayTime.value = 0.42; const fb = c.createGain(); fb.gain.value = 0.38;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
      this.mus.connect(this.master); this.mus.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(this.master);
      const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), ch = buf.getChannelData(0);
      for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
      this.noise = buf;
      this.wind = this.loopNoise('lowpass', 420, 0.5); this.rain = this.loopNoise('highpass', 2600, 0.3);
      this.wind.g.gain.value = 0.05; this.rain.g.gain.value = 0;
      this.ready = true; this.apply();
    } catch (e) { this.ready = false; }
  }
  loopNoise(type, freq, q) {
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); s.connect(f); f.connect(g); g.connect(this.amb); s.start();
    return { s, f, g };
  }
  apply() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.sfx.gain.setTargetAtTime(this.sound ? 1 : 0, t, 0.05);
    this.amb.gain.setTargetAtTime(this.sound ? 1 : 0, t, 0.2);
    this.mus.gain.setTargetAtTime(this.music ? 0.5 : 0, t, 0.3);
  }
  setSound(v) { this.sound = v; this.apply(); }
  setMusic(v) { this.music = v; this.apply(); }
  suspend(v) { if (this.ready) { if (v) this.ctx.suspend(); else this.ctx.resume(); } }

  tone(freq, dur, type = 'sine', vol = 0.2, dest = this.sfx, attack = 0.005, slideTo = 0, delay = 0) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }
  burst(dur, freq, vol, type = 'lowpass') {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime, s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.sfx); s.start(t, rnd()); s.stop(t + dur + 0.05);
  }

  // ---------- сигналы
  click() { this.tone(660, 0.06, 'triangle', 0.12); }
  place() { this.tone(300, 0.14, 'sine', 0.22, this.sfx, 0.005, 620); }
  remove() { this.tone(260, 0.16, 'triangle', 0.18, this.sfx, 0.005, 120); }
  error() { this.tone(160, 0.2, 'square', 0.08); }
  birth() { this.tone(880, 0.18, 'sine', 0.07); this.tone(1320, 0.22, 'sine', 0.06, this.sfx, 0.005, 0, 0.09); }
  death() { this.tone(140, 0.3, 'sine', 0.12, this.sfx, 0.005, 70); }
  growl() { this.tone(110, 0.25, 'sawtooth', 0.06, this.sfx, 0.02, 80); }
  newSpecies() { [72, 76, 79, 84].forEach((n, i) => this.tone(midi(n), 0.5, 'triangle', 0.12, this.sfx, 0.01, 0, i * 0.1)); }
  extinct() { [67, 63, 60, 55].forEach((n, i) => this.tone(midi(n), 0.6, 'triangle', 0.11, this.sfx, 0.01, 0, i * 0.16)); }
  success() { [60, 64, 67, 72, 76].forEach((n, i) => this.tone(midi(n), 0.7, 'triangle', 0.13, this.sfx, 0.01, 0, i * 0.12)); }
  disaster() { this.burst(2.2, 180, 0.6); this.tone(60, 1.8, 'sine', 0.3, this.sfx, 0.05, 30); }
  thunder() { this.burst(1.6, 300, 0.35); }

  /** Вызывается каждый кадр: подстройка звуков природы и генерация музыки. */
  update(dt, env) {
    if (!this.ready || this.ctx.state !== 'running') return;
    const c = this.ctx, t = c.currentTime;
    Object.assign(this.env, env);
    const e = this.env;
    this.rain.g.gain.setTargetAtTime(e.rain * 0.22, t, 0.6);
    this.wind.g.gain.setTargetAtTime(0.035 + e.rain * 0.05 + (e.high || 0) * 0.06, t, 1);
    this.wind.f.frequency.setTargetAtTime(350 + Math.sin(t * 0.21) * 140, t, 0.5);
    const T = this.t;
    if (this.sound && !e.paused) {
      // птицы днём
      T.bird -= dt;
      if (T.bird <= 0) {
        T.bird = rndRange(1.2, 6) / (0.3 + e.life);
        if (e.night < 0.5 && e.rain < 0.3 && e.life > 0.05) {
          const f = rndRange(2200, 4200), n = 1 + Math.floor(rnd() * 4);
          for (let i = 0; i < n; i++) this.tone(f * rndRange(0.9, 1.15), 0.09, 'sine', 0.025, this.amb, 0.01, f * rndRange(1.1, 1.5), i * 0.12);
        }
      }
      // сверчки ночью
      T.cricket -= dt;
      if (T.cricket <= 0) {
        T.cricket = rndRange(0.5, 1.4);
        if (e.night > 0.5 && e.rain < 0.3 && !e.cold) for (let i = 0; i < 3; i++) this.tone(4300, 0.045, 'square', 0.006, this.amb, 0.005, 0, i * 0.07);
      }
      if (e.storm) { T.th = (T.th || 6) - dt; if (T.th <= 0) { T.th = rndRange(7, 20); this.thunder(); } }
    }
    if (this.music) {
      // мягкие аккорды и редкие ноты мелодии
      T.mus -= dt;
      const scale = e.night > 0.5 ? SCALES.night : SCALES.day, root = e.night > 0.5 ? 45 : 48;
      if (T.mus <= 0) {
        T.mus = rndRange(7, 11);
        const deg = rndPick([0, 0, 2, 3, 4]);
        for (const k of [0, 2, 4]) {
          const n = root + scale[(deg + k) % scale.length] + (k === 4 ? 0 : 0);
          for (const det of [-4, 4]) {
            const o = c.createOscillator(), g = c.createGain(); o.type = 'triangle'; o.frequency.value = midi(n); o.detune.value = det;
            g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.035, t + 2.5); g.gain.linearRampToValueAtTime(0.0001, t + 9);
            o.connect(g); g.connect(this.mus); o.start(t); o.stop(t + 9.2);
          }
        }
      }
      T.mel -= dt;
      if (T.mel <= 0) {
        T.mel = rndRange(1.2, 5);
        const n = root + 12 + rndPick(scale);
        this.tone(midi(n), 1.8, 'sine', 0.045, this.mus, 0.02);
      }
    }
  }
}
