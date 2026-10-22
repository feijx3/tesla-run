// 全部音效与背景音乐都由 WebAudio 实时合成，无需任何音频文件
const BPM = 118;
const STEP = 60 / BPM / 4;
const BASS = [55, 43.65, 65.41, 49];
const CHORDS = [
  [220, 261.63, 329.63],
  [174.61, 220, 261.63],
  [261.63, 329.63, 392],
  [196, 246.94, 293.66],
];

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.musicPlaying = false;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.85;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.music = ctx.createGain();
    this.music.gain.value = 0.2;
    this.music.connect(this.master);

    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // 电动机：低频嗡鸣 + 高频啸叫
    this.hum = ctx.createOscillator();
    this.hum.type = 'triangle';
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    this.hum.connect(this.humGain).connect(this.sfx);
    this.whine = ctx.createOscillator();
    this.whine.type = 'sawtooth';
    const wf = ctx.createBiquadFilter();
    wf.type = 'bandpass';
    wf.frequency.value = 900;
    wf.Q.value = 4;
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whine.connect(wf).connect(this.whineGain).connect(this.sfx);
    this.hum.start();
    this.whine.start();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.05);
  }

  // 随速度变化的电机声。speed: 0..1
  engine(speed, active) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const a = active ? 1 : 0;
    this.hum.frequency.setTargetAtTime(60 + speed * 70, t, 0.1);
    this.humGain.gain.setTargetAtTime(a * (0.05 + speed * 0.05), t, 0.1);
    this.whine.frequency.setTargetAtTime(280 + speed * 900, t, 0.1);
    this.whineGain.gain.setTargetAtTime(a * (0.012 + speed * 0.02), t, 0.1);
  }

  #env(g, t, attack, dur, vol) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  #tone(freq, dur, type = 'sine', vol = 0.2, slideTo = null, when = 0, bus = this.sfx) {
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    this.#env(g, t, 0.008, dur, vol);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  #noise({ dur = 0.5, f0 = 800, f1 = 800, q = 1, vol = 0.3, type = 'bandpass', attack = 0.01, when = 0, bus = this.sfx }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    this.#env(g, t, attack, dur, vol);
    src.connect(f).connect(g).connect(bus);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  // 喷气翻滚
  jet() {
    if (!this.ctx) return;
    this.#noise({ dur: 0.95, f0: 500, f1: 3200, q: 0.9, vol: 0.55, attack: 0.06 });
    this.#noise({ dur: 0.7, f0: 5000, f1: 9000, q: 0.5, vol: 0.18, type: 'highpass', attack: 0.04 });
    this.#tone(150, 0.4, 'sine', 0.55, 42);
    this.#tone(90, 0.8, 'sawtooth', 0.08, 220);
  }

  deny() {
    if (!this.ctx) return;
    this.#tone(150, 0.12, 'square', 0.08, 90);
  }

  pickup(combo = 0) {
    if (!this.ctx) return;
    const base = 880 * Math.pow(1.0595, Math.min(combo, 12));
    this.#tone(base, 0.12, 'sine', 0.16);
    this.#tone(base * 1.5, 0.18, 'sine', 0.12, null, 0.05);
  }

  clear() {
    if (!this.ctx) return;
    [523, 659, 784, 1047].forEach((f, i) => this.#tone(f, 0.22, 'triangle', 0.12, null, i * 0.06));
  }

  land(strength = 1) {
    if (!this.ctx) return;
    this.#tone(110, 0.22, 'sine', 0.3 * strength, 45);
    this.#noise({ dur: 0.18, f0: 1400, f1: 200, type: 'lowpass', vol: 0.25 * strength });
  }

  crash() {
    if (!this.ctx) return;
    this.#noise({ dur: 1.1, f0: 3000, f1: 120, type: 'lowpass', vol: 0.8, attack: 0.005 });
    this.#tone(140, 0.7, 'sawtooth', 0.35, 28);
    this.#tone(70, 0.9, 'sine', 0.5, 25);
  }

  // ───── 背景音乐 ─────
  startMusic() {
    if (!this.ctx || this.musicPlaying) return;
    this.musicPlaying = true;
    this.step = 0;
    this.nextT = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.#schedule(), 25);
  }

  stopMusic() {
    this.musicPlaying = false;
    clearInterval(this.timer);
  }

  #schedule() {
    while (this.nextT < this.ctx.currentTime + 0.15) {
      this.#musicStep(this.step, this.nextT - this.ctx.currentTime);
      this.nextT += STEP;
      this.step++;
    }
  }

  #musicStep(n, when) {
    const bar = Math.floor(n / 16) % 4;
    const s = n % 16;
    const bus = this.music;
    if (s % 4 === 0) this.#tone(120, 0.18, 'sine', 0.9, 38, when, bus); // kick
    if (s % 4 === 2) this.#noise({ dur: 0.05, f0: 9000, f1: 9000, type: 'highpass', vol: 0.12, when, bus }); // hat
    if (s === 4 || s === 12) this.#noise({ dur: 0.14, f0: 2200, f1: 1500, q: 1.2, vol: 0.2, when, bus }); // snare
    // 低音：十六分音符脉冲
    if (s % 2 === 0 || s === 7 || s === 15) {
      const root = BASS[bar] * (s === 6 || s === 14 ? 2 : 1);
      this.#tone(root, 0.14, 'sawtooth', 0.22, null, when, bus);
    }
    // 琶音
    const chord = CHORDS[bar];
    const idx = [0, 1, 2, 1][s % 4];
    const oct = s >= 8 ? 2 : 1;
    this.#tone(chord[idx] * oct, 0.16, 'square', 0.05, null, when, bus);
  }
}
