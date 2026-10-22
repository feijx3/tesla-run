import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import {
  LANE_X, GRAVITY, JET_VY, JET_VY_AIR, ENERGY_MAX, JET_COST, ENERGY_REGEN_GROUND, ENERGY_REGEN_AIR,
  CELL_ENERGY, ROLL_TIME, FLIP_TIME, CAR_HALF_W, CAR_HALF_L, CAR_H, CAR_PIVOT, PAINTS,
} from './config.js';
import { clamp, damp, lerp, rand, pick } from './util.js';
import { Car } from './car.js';
import { World } from './world.js';
import { Spawner, CLEAR_TEXT, CRASH_TEXT } from './obstacles.js';
import { Particles } from './particles.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { Sound } from './audio.js';

const $ = (id) => document.getElementById(id);
const safeStore = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* 忽略 */ } },
};

// ───────────── 渲染器 / 场景 ─────────────
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
} catch (e) {
  const f = $('fatal');
  f.style.display = 'flex';
  f.textContent = '无法创建 WebGL 上下文。请使用最新版 Chrome / Edge / Firefox，并开启硬件加速。';
  throw e;
}
const PIXEL_RATIO = Math.min(window.devicePixelRatio || 1, 1.75);
renderer.setPixelRatio(PIXEL_RATIO);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.45;

const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1200);
camera.position.set(0, 3.8, 9);

scene.add(new THREE.HemisphereLight(0x9fb4d8, 0x151a20, 0.75));
const moon = new THREE.DirectionalLight(0xbcd0ff, 0.9);
moon.position.set(-6, 10, -12);
scene.add(moon);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.32, 0.5, 1.0);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const world = new World(scene, renderer);
const car = new Car();
scene.add(car.root, car.shadow);
const spawner = new Spawner(scene);
const particles = new Particles(2400);
scene.add(particles.points);
const sound = new Sound();

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  composer.setSize(w, h);
  composer.setPixelRatio(PIXEL_RATIO);
  camera.aspect = w / h;
  // 竖屏时拉大视野
  camera.userData.baseFov = w / h < 1 ? 78 : 62;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ───────────── 游戏状态 ─────────────
const S = {
  mode: 'menu', // menu | playing | dead
  paused: false,
  time: 0,
  speed: 14,
  dist: 0,
  bonus: 0,
  cells: 0,
  clears: 0,
  combo: 0,
  comboT: 0,
  best: Number(safeStore.get('teslarun.best')) || 0,
  deadT: 0,
  timeScale: 1,
  shake: 0,
  kick: 0, // 喷气瞬间的镜头冲击
  menuRollT: 1.2,
};

const P = {
  lane: 1, x: 0, y: 0, vy: 0, grounded: true, energy: ENERGY_MAX,
  jetT: 0, launchT: 0, bank: 0, yaw: 0, pitch: 0,
  flip: makeSpin(1), // 第一下喷气：后空翻（绕横轴）
  roll: makeSpin(1), // 空中二段喷气：侧向桶滚（绕车头轴）
  crashSpin: 0, crashPitch: 0,
};

function savedPaint() {
  const i = Number(safeStore.get('teslarun.paint'));
  return Number.isFinite(i) ? i : 0;
}
car.setPaint(savedPaint());
$('paintName').textContent = PAINTS[car.paintIndex].name;

// 外部车模：构建时把 assets/roadster.glb 内嵌为 window.__ROADSTER_GLB__；没有就继续用程序化车身
if (window.__ROADSTER_GLB__) {
  new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(
    window.__ROADSTER_GLB__,
    (gltf) => {
      car.useModel(gltf.scene, window.__ROADSTER_YAW__ || 0);
      document.body.classList.add('custom-car'); // 真实车模自带涂装，关闭换色
      if (window.__ROADSTER_CREDIT__) $('credit').textContent = window.__ROADSTER_CREDIT__;
    },
    undefined,
    (err) => console.warn('车模载入失败，使用内置车身', err),
  );
}

// ───────────── HUD ─────────────
const hud = {
  score: $('score'), cells: $('cells'), kmh: $('kmh'), best: $('best'), combo: $('combo'),
  fill: $('energyFill'), energy: $('energy'), popups: $('popups'),
  _s: -1, _c: -1, _k: -1,
};
function popup(text, sub = '', gold = false) {
  const el = document.createElement('div');
  el.className = 'pop' + (gold ? ' gold' : '');
  el.innerHTML = text + (sub ? `<small>${sub}</small>` : '');
  hud.popups.appendChild(el);
  setTimeout(() => el.remove(), 1250);
}
function updateHud() {
  const score = Math.floor(S.dist + S.bonus);
  if (score !== hud._s) { hud._s = score; hud.score.textContent = score.toLocaleString(); }
  if (S.cells !== hud._c) { hud._c = S.cells; hud.cells.textContent = S.cells; }
  const kmh = Math.round(Math.max(0, S.speed) * 4.6);
  if (kmh !== hud._k) { hud._k = kmh; hud.kmh.textContent = kmh; }
  hud.fill.style.width = `${(P.energy / ENERGY_MAX) * 100}%`;
  hud.energy.classList.toggle('ready', P.energy >= JET_COST);
  if (S.combo >= 2 && S.comboT > 0) {
    hud.combo.textContent = `连击 ×${S.combo}`;
    hud.combo.classList.add('on');
  } else hud.combo.classList.remove('on');
}
function setOverlay(id, show) { $(id).classList.toggle('show', show); }
hud.best.textContent = S.best ? `最高 ${S.best.toLocaleString()}` : '';

// ───────────── 玩法逻辑 ─────────────
const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

function makeSpin(dir) {
  return { angle: 0, from: 0, to: 0, p: 1, dur: 1, dir };
}
function startSpin(s, time, fixedDir) {
  if (s.p < 1) {
    // 动作还没转完又触发：沿同方向再转一圈
    s.from = s.angle;
    s.to += s.dir * Math.PI * 2;
  } else {
    s.dir = fixedDir ?? -s.dir;
    s.angle = 0;
    s.from = 0;
    s.to = s.dir * Math.PI * 2;
  }
  s.p = 0;
  s.dur = (time * Math.abs(s.to - s.from)) / (Math.PI * 2);
}
function stepSpin(s, dt) {
  if (s.p >= 1) return;
  s.p = Math.min(1, s.p + dt / s.dur);
  if (s.p >= 1) { s.angle = 0; s.from = 0; s.to = 0; } else s.angle = s.from + (s.to - s.from) * ease(s.p);
}

// 冷气喷射：白色雾团（车尾为橙白色高温尾焰）
const JET_FX = {
  down: { rate: 70, speed: [10, 17], life: [0.28, 0.5], s0: [0.14, 0.22], s1: [0.55, 0.9], c0: [1.3, 1.45, 1.7], c1: [0.3, 0.45, 0.7], drag: 2.4 },
  rear: { rate: 80, speed: [10, 19], life: [0.22, 0.45], s0: [0.2, 0.34], s1: [0.8, 1.3], c0: [2.2, 1.6, 1.0], c1: [0.6, 0.15, 0.03], drag: 2.4 },
  side: { rate: 50, speed: [6, 11], life: [0.28, 0.5], s0: [0.12, 0.2], s1: [0.5, 0.9], c0: [1.3, 1.45, 1.7], c1: [0.3, 0.45, 0.7], drag: 2.2 },
};
const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
function puff(fx, k, speedMul = 1, sizeMul = 1) {
  const sp = rand(fx.speed[0], fx.speed[1]) * (0.5 + k * 0.5) * speedMul;
  particles.emit(
    _v.x + rand(-0.05, 0.05), _v.y + rand(-0.05, 0.05), _v.z + rand(-0.05, 0.05),
    _d.x * sp + rand(-0.9, 0.9), _d.y * sp + rand(-0.9, 0.9), _d.z * sp + rand(-0.9, 0.9),
    rand(fx.life[0], fx.life[1]), rand(fx.s0[0], fx.s0[1]) * sizeMul, rand(fx.s1[0], fx.s1[1]) * sizeMul,
    fx.c0, fx.c1, fx.drag,
  );
}
// 起飞瞬间所有喷口一起“噗”地喷一大团
function burstJet(groups = ['down', 'rear', 'side']) {
  car.model.updateWorldMatrix(true, true);
  for (let i = 0; i < car.nozzleObjs.length; i++) {
    const g = car.nozzleObjs[i].group;
    if (!groups.includes(g)) continue;
    car.nozzleWorld(i, _v, _d);
    for (let k = 0; k < 5; k++) puff(JET_FX[g], 1, 1.1, 1.4);
  }
}
const jetAcc = { down: 0, rear: 0, side: 0 };
function emitJets(levels, dt) {
  car.model.updateWorldMatrix(true, true);
  for (const g of ['down', 'rear', 'side']) {
    const k = levels[g];
    if (k < 0.08) { jetAcc[g] = 0; continue; }
    jetAcc[g] += JET_FX[g].rate * k * dt;
    const n = Math.floor(jetAcc[g]);
    if (n < 1) continue;
    jetAcc[g] -= n;
    for (let i = 0; i < car.nozzleObjs.length; i++) {
      if (car.nozzleObjs[i].group !== g) continue;
      car.nozzleWorld(i, _v, _d);
      for (let j = 0; j < n; j++) puff(JET_FX[g], k);
    }
  }
}

function tryJet() {
  if (S.mode === 'menu') {
    triggerJet(true);
    return;
  }
  if (S.mode !== 'playing') return;
  if (P.energy < JET_COST) {
    sound.deny();
    hud.energy.classList.remove('deny');
    void hud.energy.offsetWidth;
    hud.energy.classList.add('deny');
    return;
  }
  P.energy -= JET_COST;
  triggerJet(false);
}

function triggerJet(silent) {
  const fromGround = P.grounded;
  P.vy = fromGround ? JET_VY : JET_VY_AIR;
  P.grounded = false;
  P.y = Math.max(P.y, 0.001);
  P.jetT = 0.55;
  // 地面起飞 → 后空翻；空中二段 → 侧向桶滚
  if (fromGround) startSpin(P.flip, FLIP_TIME, 1);
  else startSpin(P.roll, ROLL_TIME);
  S.kick = 1;
  if (!silent) sound.jet();
  burstJet();
}

function landFx(impact) {
  const k = clamp(impact / 16, 0.25, 1);
  car.model.updateWorldMatrix(true, true);
  const x = P.x;
  for (let i = 0; i < 26 * k; i++) {
    const a = rand(0, Math.PI * 2);
    particles.emit(
      x + rand(-1, 1), 0.15, rand(-1.8, 1.8),
      Math.cos(a) * rand(2, 7), rand(0.5, 3), Math.sin(a) * rand(2, 7),
      rand(0.3, 0.6), rand(0.5, 0.9), rand(1.4, 2.4),
      [1.2, 1.3, 1.5], [0.25, 0.3, 0.4], 3,
    );
  }
  for (let i = 0; i < 10 * k; i++) {
    particles.emit(
      x + rand(-0.8, 0.8), 0.2, rand(-1.5, 1.5),
      rand(-4, 4), rand(3, 7), rand(-4, 4),
      rand(0.25, 0.5), 0.18, 0.05,
      [6, 3, 1], [3, 0.6, 0.1], 0.5, 18,
    );
  }
  if (S.mode === 'playing') {
    S.shake = Math.max(S.shake, 0.25 * k);
    sound.land(k);
  }
}

function crash() {
  S.mode = 'dead';
  S.deadT = 0;
  S.timeScale = 0.35;
  S.shake = 1;
  P.vy = 9;
  P.grounded = false;
  P.crashSpin = rand(8, 13) * (Math.random() < 0.5 ? -1 : 1);
  P.crashPitch = rand(3, 6);
  P.roll.p = 1;
  P.flip.p = 1;
  S.speed = -7;
  S.combo = 0;
  sound.crash();
  sound.stopMusic();
  car.model.updateWorldMatrix(true, true);
  for (let i = 0; i < 160; i++) {
    const a = rand(0, Math.PI * 2), e = rand(0, Math.PI);
    const sp = rand(4, 20);
    particles.emit(
      P.x, P.y + 0.8, 0,
      Math.cos(a) * Math.sin(e) * sp, Math.cos(e) * sp * 0.8 + 3, Math.sin(a) * Math.sin(e) * sp,
      rand(0.5, 1.4), rand(0.3, 0.7), rand(0.05, 0.25),
      [7, 4, 1.2], [2.5, 0.3, 0.05], 0.6, 16,
    );
  }
  for (let i = 0; i < 60; i++) {
    particles.emit(
      P.x + rand(-1, 1), P.y + 0.6, rand(-1.5, 1.5),
      rand(-3, 3), rand(1, 5), rand(-3, 3),
      rand(0.8, 1.8), rand(1.5, 2.5), rand(3.5, 6),
      [0.8, 0.5, 0.45], [0.05, 0.03, 0.04], 1.2,
    );
  }
  const total = Math.floor(S.dist + S.bonus);
  const isBest = total > S.best;
  if (isBest) {
    S.best = total;
    safeStore.set('teslarun.best', String(total));
  }
  $('overTitle').textContent = pick(CRASH_TEXT[S.lastHit] || ['撞毁']);
  $('finalScore').textContent = total.toLocaleString();
  $('finalCells').textContent = S.cells;
  $('finalClears').textContent = S.clears;
  $('newBest').textContent = isBest && total > 0 ? '★ 新纪录 ★' : '';
  hud.best.textContent = `最高 ${S.best.toLocaleString()}`;
}

function resetRun() {
  spawner.reset();
  S.dist = 0; S.bonus = 0; S.cells = 0; S.clears = 0; S.combo = 0; S.comboT = 0;
  S.timeScale = 1; S.shake = 0;
  S.speed = 20;
  Object.assign(P, { lane: 1, x: 0, y: 0, vy: 0, grounded: true, energy: ENERGY_MAX, jetT: 0, launchT: 0, bank: 0, yaw: 0, pitch: 0, crashSpin: 0, crashPitch: 0 });
  Object.assign(P.roll, { angle: 0, from: 0, to: 0, p: 1 });
  Object.assign(P.flip, { angle: 0, from: 0, to: 0, p: 1 });
  hud._s = hud._c = hud._k = -1;
}

function startGame() {
  sound.init();
  resetRun();
  S.mode = 'playing';
  S.speed = 6; // 发布会式起步：尾喷口爆燃，瞬间冲出去
  P.launchT = 0.9;
  S.kick = 1;
  document.body.classList.add('playing');
  setOverlay('start', false);
  setOverlay('over', false);
  sound.startMusic();
  sound.jet();
  burstJet(['rear']);
}

function showMenu() {
  S.mode = 'menu';
  document.body.classList.remove('playing');
  resetRun();
  S.speed = 14;
  setOverlay('over', false);
  setOverlay('start', true);
}

function changeLane(dir) {
  if (S.mode !== 'playing') return;
  P.lane = clamp(P.lane + dir, 0, 2);
}

function award(points, label, sub, gold) {
  S.bonus += points;
  popup(label, sub, gold);
}

function setPaint(delta) {
  if (car.custom) return;
  const p = car.setPaint(car.paintIndex + delta);
  $('paintName').textContent = p.name;
  safeStore.set('teslarun.paint', String(car.paintIndex));
  if (S.mode === 'playing' || S.mode === 'dead') popup(p.name, '', false);
}

// ───────────── 输入 ─────────────
window.addEventListener('keydown', (e) => {
  if (e.repeat && e.code === 'Space') { e.preventDefault(); return; }
  switch (e.code) {
    case 'Space':
    case 'Enter':
      e.preventDefault();
      sound.init();
      if (S.paused) togglePause();
      else if (S.mode === 'menu') startGame();
      else if (S.mode === 'dead') { if (S.deadT > 0.9) startGame(); }
      else if (e.code === 'Space') tryJet();
      break;
    case 'ArrowUp': case 'KeyW':
      e.preventDefault();
      if (S.mode === 'playing') tryJet();
      break;
    case 'ArrowLeft': case 'KeyA': e.preventDefault(); changeLane(-1); break;
    case 'ArrowRight': case 'KeyD': e.preventDefault(); changeLane(1); break;
    case 'KeyC': setPaint(1); break;
    case 'KeyM': toggleMute(); break;
    case 'KeyP': case 'Escape': togglePause(); break;
  }
});

function toggleMute() {
  sound.init();
  sound.setMuted(!sound.muted);
  $('mute').textContent = sound.muted ? '♪ 声音 关 · M' : '♪ 声音 开 · M';
}
$('mute').addEventListener('click', toggleMute);

function togglePause() {
  if (S.mode !== 'playing' && !S.paused) return;
  S.paused = !S.paused;
  setOverlay('pause', S.paused);
  if (sound.ctx) S.paused ? sound.ctx.suspend() : sound.ctx.resume();
}
document.addEventListener('visibilitychange', () => { if (document.hidden && S.mode === 'playing' && !S.paused) togglePause(); });

// 触屏：左右滑动变道，点按喷气
let touch = null;
renderer.domElement.addEventListener('pointerdown', (e) => {
  sound.init();
  touch = { x: e.clientX, y: e.clientY, done: false };
  if (S.mode === 'menu') startGame();
  else if (S.mode === 'dead' && S.deadT > 0.9) startGame();
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!touch || touch.done || e.pointerType === 'mouse') return;
  const dx = e.clientX - touch.x;
  if (Math.abs(dx) > 36) { changeLane(Math.sign(dx)); touch.done = true; }
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (touch && !touch.done && e.pointerType !== 'mouse' && S.mode === 'playing') tryJet();
  touch = null;
});

// ───────────── 每帧更新 ─────────────
function collisions() {
  const cy0 = P.y + 0.12, cy1 = P.y + CAR_H;
  for (const o of spawner.obstacles) {
    const xz = Math.abs(o.x - P.x) < o.hw + CAR_HALF_W && Math.abs(o.z) < o.hd + CAR_HALF_L;
    if (xz) {
      if (cy1 > o.y0 && cy0 < o.y1) {
        S.lastHit = o.kind;
        crash();
        return;
      }
      if (cy0 >= o.y1) o.cleared = true; // 从上方飞越
    } else if (!o.awarded && o.z - o.hd > CAR_HALF_L) {
      o.awarded = true;
      if (o.cleared) {
        S.clears++;
        S.combo++;
        S.comboT = 4;
        const mult = Math.min(S.combo, 8);
        const spinning = P.flip.p < 1 || P.roll.p < 1;
        const pts = (spinning ? 150 : 100) * mult;
        award(pts, pick(CLEAR_TEXT[o.kind] || ['飞越']), `${spinning ? '空中翻滚 · ' : ''}+${pts}${mult > 1 ? `　×${mult}` : ''}`, spinning);
        sound.clear();
      }
    }
  }
  // 电芯
  for (const p of spawner.pickups) {
    if (p.taken) continue;
    const dx = p.x - P.x, dy = p.y - (P.y + CAR_PIVOT), dz = p.z;
    if (dx * dx + dy * dy * 0.8 + dz * dz * 0.5 < 1.9 * 1.9) {
      p.taken = true;
      S.cells++;
      S.bonus += 50;
      P.energy = Math.min(ENERGY_MAX, P.energy + CELL_ENERGY);
      sound.pickup(S.combo);
      for (let i = 0; i < 14; i++) {
        particles.emit(
          p.x, p.y, p.z, rand(-4, 4), rand(-1, 5), rand(-4, 4),
          rand(0.3, 0.6), 0.5, 0.1, [1.2, 3.5, 5], [0.1, 0.4, 1], 2,
        );
      }
    }
  }
}

function update(rdt) {
  const dt = rdt * S.timeScale;
  S.time += rdt;

  // ── 速度 / 难度 ──
  const difficulty = 1 - Math.exp(-S.dist / 3800);
  if (S.mode === 'playing') {
    const target = 24 + 34 * (1 - Math.exp(-S.dist / 3600));
    S.speed = damp(S.speed, target, S.dist < 60 ? 3.2 : 1.2, dt);
    S.dist += S.speed * dt;
  } else if (S.mode === 'menu') {
    S.speed = damp(S.speed, 14, 2, dt);
  } else {
    // 撞毁后：先回弹，再停下
    S.speed = damp(S.speed, 0, 3.5, rdt);
    S.deadT += rdt;
    S.timeScale = damp(S.timeScale, 1, 1.6, rdt);
    if (S.deadT > 0.7 && !$('over').classList.contains('show')) setOverlay('over', true);
  }

  if (S.mode === 'playing') {
    // 能量回复
    P.energy = Math.min(ENERGY_MAX, P.energy + (P.grounded ? ENERGY_REGEN_GROUND : ENERGY_REGEN_AIR) * dt);
    if (S.comboT > 0) { S.comboT -= dt; if (S.comboT <= 0) S.combo = 0; }
  }

  // ── 菜单演示：定时自动翻滚 ──
  if (S.mode === 'menu') {
    S.menuRollT -= rdt;
    if (S.menuRollT <= 0 && P.grounded) { triggerJet(true); S.menuRollT = 3.6; }
  }

  // ── 车辆运动 ──
  const targetX = LANE_X[P.lane];
  const prevX = P.x;
  P.x = damp(P.x, targetX, 13, dt);
  const vx = (P.x - prevX) / Math.max(dt, 1e-4);
  P.bank = damp(P.bank, clamp(-vx * 0.035, -0.4, 0.4), 12, dt);
  P.yaw = damp(P.yaw, clamp(-vx * 0.03, -0.35, 0.35), 12, dt);

  if (!P.grounded) {
    P.vy -= GRAVITY * dt;
    P.y += P.vy * dt;
    if (P.y <= 0 && P.vy < 0) {
      const impact = -P.vy;
      P.y = 0;
      P.vy = 0;
      if (S.mode !== 'dead') {
        P.grounded = true;
        landFx(impact);
      } else if (impact > 3) {
        P.vy = impact * 0.35; // 撞毁后弹跳
        landFx(impact * 0.5);
      } else P.grounded = true;
    }
  }
  if (S.mode === 'dead') {
    P.roll.angle += P.crashSpin * dt;
    P.pitch += P.crashPitch * dt;
    P.crashSpin = damp(P.crashSpin, 0, 1.5, dt);
    P.crashPitch = damp(P.crashPitch, 0, 1.5, dt);
    if (P.grounded) {
      const turn = Math.PI * 2;
      P.roll.angle = damp(P.roll.angle, Math.round(P.roll.angle / turn) * turn, 4, dt);
      P.flip.angle = damp(P.flip.angle, Math.round(P.flip.angle / turn) * turn, 4, dt);
      P.pitch = damp(P.pitch, 0, 4, dt);
    }
  } else {
    stepSpin(P.flip, dt);
    stepSpin(P.roll, dt);
    const targetPitch = P.grounded ? 0 : clamp(P.vy * 0.016, -0.32, 0.3);
    P.pitch = damp(P.pitch, targetPitch, 10, dt);
  }

  // 喷气强度
  P.jetT = Math.max(0, P.jetT - dt);
  P.launchT = Math.max(0, P.launchT - dt);
  const alive = S.mode !== 'dead';
  const thrust = alive && P.jetT > 0 ? Math.pow(P.jetT / 0.55, 0.6) : 0;
  const launch = alive && P.launchT > 0 ? Math.min(1, P.launchT / 0.5) : 0;
  const spinP = P.flip.p < 1 ? P.flip.p : P.roll.p < 1 ? P.roll.p : 1;
  const levels = {
    down: thrust,
    rear: Math.max(thrust, launch),
    side: alive && spinP < 1 ? Math.sin(Math.PI * spinP) * 0.9 : 0, // 翻转时两侧姿态喷口点射
  };
  emitJets(levels, dt);
  const jetK = Math.max(levels.down, levels.rear);

  car.setPose({ x: P.x, y: P.y, yaw: P.yaw, bank: P.bank, pitch: P.pitch + P.flip.angle, roll: P.roll.angle });
  car.setJet(levels, S.time);
  car.spinWheels(Math.max(0, S.speed) * dt);

  // ── 世界 ──
  const scrollSpeed = S.speed;
  world.update(dt, scrollSpeed, jetK);
  if (S.mode === 'playing') {
    spawner.update(dt, S.speed, difficulty, S.time);
    collisions();
  } else if (S.mode === 'dead') {
    spawner.update(dt, S.speed, difficulty, S.time);
  } else {
    // 菜单背景：不生成障碍
    spawner.update(0, 0, 0, S.time);
  }
  particles.update(dt, S.mode === 'menu' ? S.speed : Math.max(S.speed, 0));

  // ── 相机 ──
  S.shake = Math.max(0, S.shake - rdt * 2.2);
  S.kick = Math.max(0, S.kick - rdt * 2.4);
  updateCamera(rdt);

  // ── 声音与 HUD ──
  sound.engine(clamp((S.speed - 10) / 50, 0, 1), S.mode === 'playing' || S.mode === 'menu');
  if (S.mode === 'playing') updateHud();
}

const camTarget = new THREE.Vector3();
const lookAt = new THREE.Vector3();
let menuAngle = 0;
function updateCamera(dt) {
  const base = camera.userData.baseFov || 62;
  let tx, ty, tz, lx, ly, lz, rate = 5;
  if (S.mode === 'menu') {
    menuAngle += dt * 0.3;
    const a = Math.PI * 0.3 + Math.sin(menuAngle) * 0.45; // 车尾 3/4 视角：红色灯带 + 四个圆喷口
    tx = Math.sin(a) * 7.2; ty = 1.7 + Math.sin(menuAngle * 1.3) * 0.25; tz = Math.cos(a) * 7.2; // 在车尾两侧缓缓摆动
    lx = 0; ly = 0.9; lz = 0;
    rate = 2.5;
  } else {
    const k = S.kick;
    tx = P.x * 0.62;
    ty = 3.7 + P.y * 0.5 + (S.mode === 'dead' ? 0.6 : 0);
    tz = 8.6 + k * 1.1 + clamp(S.speed / 60, 0, 1) * 1.2;
    lx = P.x * 0.72; ly = 1.1 + P.y * 0.42; lz = -14;
    rate = 6.5;
  }
  camTarget.set(tx, ty, tz);
  camera.position.x = damp(camera.position.x, camTarget.x, rate, dt);
  camera.position.y = damp(camera.position.y, camTarget.y, rate, dt);
  camera.position.z = damp(camera.position.z, camTarget.z, rate, dt);
  lookAt.x = damp(lookAt.x, lx, rate + 2, dt);
  lookAt.y = damp(lookAt.y, ly, rate + 2, dt);
  lookAt.z = damp(lookAt.z, lz, rate + 2, dt);
  const sh = S.shake * S.shake;
  const ox = rand(-1, 1) * sh * 0.5, oy = rand(-1, 1) * sh * 0.5;
  camera.position.x += ox; camera.position.y += oy;
  camera.lookAt(lookAt);
  camera.position.x -= ox; camera.position.y -= oy;

  const speedFov = S.mode === 'menu' ? 0 : clamp(S.speed / 60, 0, 1) * 10 + S.kick * 7;
  const fov = damp(camera.fov, base + speedFov, 6, dt);
  if (Math.abs(fov - camera.fov) > 0.001) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
  particles.setScale(renderer.domElement.height, camera.fov);
  bloom.strength = 0.32 + S.kick * 0.35;
}

// ───────────── 主循环 ─────────────
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  try {
    if (!S.paused) update(dt);
    composer.render();
  } catch (err) {
    window.__lastError = String(err && err.stack || err);
    if (!frame.reported) { frame.reported = true; console.error(err); }
  }
}
camera.position.set(4, 1.8, 6);
lookAt.set(0, 0.9, 0);
requestAnimationFrame(frame);

// 调试 / 自动化测试钩子
window.__game = {
  S, P, startGame, tryJet, changeLane, spawner, camera, car, crash, update, world,
  // 手动推进模拟（后台标签页 rAF 被节流时用于测试）
  step(sec, dt = 1 / 60) { for (let t = 0; t < sec; t += dt) { if (!S.paused) update(dt); } composer.render(); },
};
