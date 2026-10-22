import * as THREE from 'three';
import { LANE_X, SPAWN_Z, DESPAWN_Z, JET_VY, GRAVITY } from './config.js';
import { canvasTexture, radialTexture, rand, pick } from './util.js';

// 障碍物主题：中国高速收费站。起落杆、收费亭、ETC 雨棚、限高架、排队 LED 牌……
const FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Heiti SC", sans-serif';

// 飞越成功 / 撞毁时的吐槽文案（kind → 候选）
export const CLEAR_TEXT = {
  boom: ['逃费成功！', 'ETC 不用刷了', '杆呢？我飞过去了', '免费通行'],
  booth: ['飞越收费亭', '大爷您醒醒', '过路费？不存在'],
  gate: ['飞越限高架', '限高架：？？？', '违规操作 +100'],
  mega: ['无视春运拥堵', '5 公里？我 5 秒', '飞越排队长龙'],
  truck: ['飞越赛博皮卡', '超车成功'],
};
export const CRASH_TEXT = {
  boom: ['道闸：想跑？先缴费', '起落杆教你做人'],
  booth: ['撞进收费亭 · 请补缴 ¥9999', '大爷：我睡着了，你呢'],
  gate: ['限高架不讲武德', '车高超限 · 罚款 ¥200'],
  mega: ['排队 5 公里 · 请重新取号', 'ETC 识别失败'],
  truck: ['追尾赛博皮卡 · 全责', '保险公司表示：不赔'],
};
const STATIONS = ['火星', '月球', '硅谷', '奇点', '超级工厂', '德州', '深南', '京沪'];
const LED_JOKES = [
  ['前方', '收费', '站'],
  ['请', '人工', '缴费'],
  ['ETC', '系统', '故障'],
  ['春运', '免费', '取消'],
  ['排队', '5', '公里'],
  ['不', '许', '飞'],
];

// ───────────── 贴图 ─────────────
const texCache = new Map();
function cached(key, make) {
  if (!texCache.has(key)) texCache.set(key, make());
  return texCache.get(key);
}
function textBlock(g, text, x, y, size, color = '#fff', weight = 'bold') {
  g.font = `${weight} ${size}px ${FONT}`;
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, x, y);
}

const hazardTex = canvasTexture(128, 64, (g, w, h) => {
  g.fillStyle = '#16120c';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#ffb020';
  for (let x = -h; x < w + h; x += 32) {
    g.beginPath();
    g.moveTo(x, h); g.lineTo(x + 16, h); g.lineTo(x + 16 + h, 0); g.lineTo(x + h, 0);
    g.fill();
  }
}, { repeat: true });

const armTex = canvasTexture(256, 32, (g, w, h) => {
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? '#f4f4f4' : '#e21f2a';
    g.fillRect((i * w) / 8, 0, w / 8, h);
  }
});

function boothFrontTex() {
  return cached('boothFront', () => canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#dfe4ea';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#0b4ea2';
    g.fillRect(0, h - 56, w, 56);
    g.fillRect(0, 0, w, 44);
    textBlock(g, '收费  TOLL', w / 2, 24, 30);
    // 窗口：暖黄灯光 + 打瞌睡的收费员剪影
    const grad = g.createLinearGradient(0, 62, 0, 180);
    grad.addColorStop(0, '#ffe9a0');
    grad.addColorStop(1, '#ffb347');
    g.fillStyle = '#1b2430';
    g.fillRect(26, 58, w - 52, 128);
    g.fillStyle = grad;
    g.fillRect(32, 64, w - 64, 116);
    g.fillStyle = '#2a2018';
    g.beginPath(); g.arc(w / 2 + 6, 128, 24, 0, Math.PI * 2); g.fill(); // 头
    g.fillRect(w / 2 - 36, 150, 84, 34); // 肩
    g.fillStyle = '#1d3a6b';
    g.fillRect(w / 2 - 28, 100, 68, 10); // 帽檐
    g.fillRect(w / 2 - 20, 88, 52, 16);
    textBlock(g, 'z z Z', w / 2 + 70, 82, 22, '#7a5a20');
    textBlock(g, '人工', w / 2, h - 28, 30);
  }));
}
function signTex(key, w, h, draw) {
  return cached(key, () => canvasTexture(w, h, draw));
}
function tollSmallSign() {
  return signTex('tollSmall', 256, 64, (g, w, h) => {
    g.fillStyle = '#0b4ea2'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#fff'; g.lineWidth = 3; g.strokeRect(4, 4, w - 8, h - 8);
    textBlock(g, '收费站 TOLL', w / 2, h / 2 + 2, 30);
  });
}
function fasciaTex(name) {
  return signTex(`fascia:${name}`, 1024, 256, (g, w, h) => {
    g.fillStyle = '#0b4ea2'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#fff'; g.lineWidth = 8; g.strokeRect(14, 14, w - 28, h - 28);
    textBlock(g, `${name}收费站`, w / 2, 112, 128);
    textBlock(g, 'TOLL GATE  ·  ETC 请减速', w / 2, 208, 38, '#cfe3ff', 'normal');
  });
}
function laneSignalTex(open) {
  return signTex(`signal:${open}`, 128, 176, (g, w, h) => {
    g.fillStyle = '#0a0f18'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#56627a'; g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h - 4);
    if (open) {
      g.fillStyle = '#0b4ea2'; g.fillRect(6, 6, w - 12, 40);
      textBlock(g, 'ETC', w / 2, 27, 32);
      g.fillStyle = '#2cff7a';
      g.beginPath(); // 绿色向下箭头
      g.moveTo(w / 2, 168); g.lineTo(18, 100); g.lineTo(48, 100); g.lineTo(48, 58); g.lineTo(80, 58); g.lineTo(80, 100); g.lineTo(110, 100);
      g.closePath(); g.fill();
    } else {
      g.strokeStyle = '#ff2a2a'; g.lineWidth = 16; g.lineCap = 'round';
      g.beginPath(); g.moveTo(30, 50); g.lineTo(98, 140); g.moveTo(98, 50); g.lineTo(30, 140); g.stroke();
    }
  });
}
function ledTex(text) {
  return signTex(`led:${text}`, 256, 128, (g, w, h) => {
    g.fillStyle = '#080204'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#5a0a12'; g.lineWidth = 4; g.strokeRect(3, 3, w - 6, h - 6);
    textBlock(g, text, w / 2, h / 2 + 4, text.length > 3 ? 62 : 84, '#ff3b30');
  });
}
function limitSignTex() {
  return signTex('limit', 256, 128, (g, w, h) => {
    g.fillStyle = '#ffd21a'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#111'; g.lineWidth = 6; g.strokeRect(5, 5, w - 10, h - 10);
    textBlock(g, '限高 1.8m', w / 2, 52, 56, '#111');
    textBlock(g, '（会飞的也不行）', w / 2, 100, 24, '#a01010', 'normal');
  });
}
function plateTex() {
  return signTex('plate', 256, 64, (g, w, h) => {
    g.fillStyle = '#0a46c8'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#fff'; g.lineWidth = 3; g.strokeRect(3, 3, w - 6, h - 6);
    textBlock(g, '沪A·88888', w / 2, h / 2 + 2, 38);
  });
}

// ───────────── 共享材质 / 几何体 ─────────────
const hazardMat = new THREE.MeshStandardMaterial({ map: hazardTex, roughness: 0.7, emissive: 0xffffff, emissiveMap: hazardTex, emissiveIntensity: 0.4 });
const armMat = new THREE.MeshStandardMaterial({ map: armTex, roughness: 0.55, emissive: 0xffffff, emissiveMap: armTex, emissiveIntensity: 0.55 });
const cabMat = new THREE.MeshStandardMaterial({ color: 0xcfd6de, roughness: 0.6, metalness: 0.2 });
const cabBandMat = new THREE.MeshStandardMaterial({ color: 0x0b4ea2, roughness: 0.5, emissive: 0x0b4ea2, emissiveIntensity: 0.35 });
const amberMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 2.4, 0.3) });
const redLampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.3, 0.3) });
const blueRoofMat = new THREE.MeshStandardMaterial({ color: 0x0b4ea2, roughness: 0.5, emissive: 0x0b4ea2, emissiveIntensity: 0.4 });
const wallMat = new THREE.MeshStandardMaterial({ color: 0xdfe4ea, roughness: 0.7 });
const darkBlueMat = new THREE.MeshStandardMaterial({ color: 0x0a2a5c, roughness: 0.6, metalness: 0.3 });
const pillarMat = new THREE.MeshStandardMaterial({ color: 0x9aa5b4, roughness: 0.7, metalness: 0.3 });
const lightBarMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 3.6, 4.4) });
const concreteMat = new THREE.MeshStandardMaterial({ color: 0x7a7e88, roughness: 0.85 });
const steelMat = new THREE.MeshStandardMaterial({ color: 0x8e949c, metalness: 1, roughness: 0.38, flatShading: true });
const tireMat = new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 0.9 });
const headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 6, 8) });
const tailMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(7, 0.15, 0.1) });
const yellowPostMat = new THREE.MeshStandardMaterial({ map: hazardTex, roughness: 0.6, emissive: 0xffffff, emissiveMap: hazardTex, emissiveIntensity: 0.3 });

const basic = (map, k = 1.8) => new THREE.MeshBasicMaterial({ map, color: new THREE.Color(k, k, k) });

const bumpGeo = new THREE.BoxGeometry(3.1, 0.05, 0.7);
const cabGeo = new THREE.BoxGeometry(0.6, 1.15, 0.6);
const armGeo = new THREE.BoxGeometry(2.75, 0.17, 0.14);
const megaGeo = new THREE.BoxGeometry(3.3, 2.7, 1.0);

function speedBump(z) {
  const b = new THREE.Mesh(bumpGeo, hazardMat);
  b.position.set(0, 0.025, z);
  return b;
}

function truckGeometry() {
  // 侧视轮廓：车头在 +x，经典“楔形”
  const s = new THREE.Shape();
  s.moveTo(-2.7, 0.4);
  s.lineTo(-2.7, 1.5);
  s.lineTo(-0.2, 1.88);
  s.lineTo(2.7, 0.92);
  s.lineTo(2.7, 0.42);
  s.lineTo(-2.7, 0.4);
  const g = new THREE.ExtrudeGeometry(s, { depth: 2.1, bevelEnabled: false });
  g.translate(0, 0, -1.05);
  return g;
}
const truckGeo = truckGeometry();
const wheelGeo = new THREE.CylinderGeometry(0.52, 0.52, 0.4, 18).rotateX(Math.PI / 2);

// 起落杆（道闸）：路边机箱 + 红白相间的杆子横在车道上，需要飞过去
function makeBoom() {
  const g = new THREE.Group();
  const cab = new THREE.Mesh(cabGeo, [cabMat, cabMat, cabMat, cabMat, cabMat, cabMat]);
  cab.position.set(-1.45, 0.575, 0);
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.22, 0.62), cabBandMat);
  band.position.set(-1.45, 0.5, 0);
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.2, 0.24), amberMat);
  lamp.position.set(-1.45, 1.27, 0);
  const arm = new THREE.Mesh(armGeo, armMat);
  arm.position.set(0.05, 0.95, 0);
  const tip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.18), redLampMat);
  tip.position.set(1.43, 0.95, 0);
  g.add(cab, band, lamp, arm, tip, speedBump(2.4));
  return g;
}

// 收费亭：就这么大剌剌地建在路中间，窗里的大爷在打瞌睡
function makeBooth() {
  const g = new THREE.Group();
  const front = new THREE.MeshStandardMaterial({ map: boothFrontTex(), roughness: 0.6, emissive: 0xffffff, emissiveMap: boothFrontTex(), emissiveIntensity: 0.55 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 2.0, 1.8), [wallMat, wallMat, wallMat, wallMat, front, wallMat]);
  body.position.y = 1.0;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.16, 2.3), blueRoofMat);
  roof.position.y = 2.08;
  const sign = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.34, 0.06), basic(tollSmallSign()));
  sign.position.set(0, 2.2, 1.18);
  const lampL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), amberMat);
  lampL.position.set(-1.1, 2.22, 1.0);
  const lampR = lampL.clone();
  lampR.position.x = 1.1;
  g.add(body, roof, sign, lampL, lampR, speedBump(2.6));
  return g;
}

// 排队 LED 牌：整块混凝土墙 + 红字滚动牌，三块并排拼成一句吐槽
function makeLedWall(text) {
  const g = new THREE.Group();
  const led = basic(ledTex(text), 2.2);
  const body = new THREE.Mesh(megaGeo, [concreteMat, concreteMat, concreteMat, concreteMat, led, concreteMat]);
  body.position.y = 1.35;
  const base = new THREE.Mesh(new THREE.BoxGeometry(3.34, 0.5, 1.04), hazardMat);
  base.position.y = 0.25;
  const top = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.12, 1.05), redLampMat);
  top.position.y = 2.76;
  g.add(body, base, top);
  return g;
}

// 限高架：不能跳！限高 1.8m，会飞也一样
function makeLimitFrame(width) {
  const g = new THREE.Group();
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 3.0, 0.4), yellowPostMat);
    post.position.set(sx * (width / 2), 1.5, 0);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.24, 0.28), amberMat);
    lamp.position.set(sx * (width / 2), 3.12, 0);
    g.add(post, lamp);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(width, 0.34, 0.3), yellowPostMat);
  bar.position.y = 1.72;
  const sign = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.0, 0.08), basic(limitSignTex(), 1.5));
  sign.position.set(0, 2.5, 0.05);
  // 吊链
  for (const sx of [-0.7, 0.7]) {
    const chain = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.8, 0.04), steelMat);
    chain.position.set(sx, 2.1, 0.05);
    g.add(chain);
  }
  g.add(bar, sign, speedBump(2.4));
  return g;
}

// 赛博皮卡：在收费站排队的老哥，车头对着你
function makeTruck() {
  const g = new THREE.Group();
  const model = new THREE.Group();
  model.rotation.y = -Math.PI / 2; // 车头朝向玩家，一眼认出楔形轮廓
  model.add(new THREE.Mesh(truckGeo, steelMat));
  for (const [x, z] of [[1.6, 1.1], [1.6, -1.1], [-1.55, 1.1], [-1.55, -1.1]]) {
    const w = new THREE.Mesh(wheelGeo, tireMat);
    w.position.set(x, 0.52, z);
    model.add(w);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 2.0), headMat);
  bar.position.set(2.72, 0.93, 0);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 2.0), tailMat);
  tail.position.set(-2.72, 1.48, 0);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.18), basic(plateTex(), 1.3));
  plate.position.set(2.74, 0.58, 0);
  plate.rotation.y = Math.PI / 2;
  model.add(bar, tail, plate);
  g.add(model);
  return g;
}

// 收费站雨棚（纯装饰，高高在上）：ETC 通道亮绿灯，其余通道红叉
function makeCanopy(name, open) {
  const g = new THREE.Group();
  const fascia = new THREE.MeshStandardMaterial({ map: fasciaTex(name), roughness: 0.5, emissive: 0xffffff, emissiveMap: fasciaTex(name), emissiveIntensity: 0.7 });
  const beam = new THREE.Mesh(new THREE.BoxGeometry(16.4, 1.7, 3.2), [darkBlueMat, darkBlueMat, darkBlueMat, darkBlueMat, fascia, darkBlueMat]);
  beam.position.y = 7.6;
  g.add(beam);
  for (const sx of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.9, 8.2, 0.9), pillarMat);
    pillar.position.set(sx * 7.6, 4.1, 0);
    g.add(pillar);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(15.6, 0.07, 0.3), lightBarMat);
  bar.position.set(0, 6.72, 1.0);
  g.add(bar);
  for (let l = 0; l < 3; l++) {
    const rod = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, 0.06), pillarMat);
    rod.position.set(LANE_X[l], 6.3, 1.2);
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.5, 0.16), basic(laneSignalTex(open[l]), 1.9));
    box.position.set(LANE_X[l], 5.55, 1.2);
    g.add(rod, box);
  }
  return g;
}

// ───────────── 电芯（4680 造型） ─────────────
const cellBodyGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.62, 16);
const cellCapGeo = new THREE.CylinderGeometry(0.15, 0.2, 0.12, 16);
const cellBodyMat = new THREE.MeshStandardMaterial({ color: 0xcfd8e3, metalness: 1, roughness: 0.2, emissive: 0x2288ff, emissiveIntensity: 0.9 });
const cellCapMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 3.2, 5) });
const haloTex = radialTexture(128, [[0, 'rgba(90,210,255,0.9)'], [0.4, 'rgba(60,150,255,0.35)'], [1, 'rgba(0,0,0,0)']]);
const haloMat = new THREE.SpriteMaterial({ map: haloTex, blending: THREE.AdditiveBlending, depthWrite: false });

function makeCell() {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  inner.rotation.z = 0.35;
  const body = new THREE.Mesh(cellBodyGeo, cellBodyMat);
  const cap = new THREE.Mesh(cellCapGeo, cellCapMat);
  cap.position.y = 0.37;
  inner.add(body, cap);
  const halo = new THREE.Sprite(haloMat);
  halo.scale.set(2.0, 2.0, 1);
  g.add(inner, halo);
  g.userData.inner = inner;
  return g;
}

// ───────────── 生成器 ─────────────
const PATTERNS = [
  { name: 'single', w: 5, min: 0, gapT: 1.5 },
  { name: 'cells', w: 2.5, min: 0, gapT: 1.1 },
  { name: 'pair', w: 3, min: 0.04, gapT: 1.5 },
  { name: 'plaza', w: 5, min: 0, gapT: 1.6 },
  { name: 'wall3', w: 2.5, min: 0.1, gapT: 2.0 },
  { name: 'tall', w: 3, min: 0.14, gapT: 1.6 },
  { name: 'truck', w: 3, min: 0.2, gapT: 1.7 },
  { name: 'laser', w: 3, min: 0.28, gapT: 1.7 },
  { name: 'slalom', w: 2, min: 0.38, gapT: 1.5 },
  { name: 'mega', w: 1.8, min: 0.5, gapT: 2.2 },
];

export class Spawner {
  constructor(scene) {
    this.scene = scene;
    this.obstacles = [];
    this.pickups = [];
    this.decor = [];
    this.timer = 0;
    this.first = true;
    this.last = '';
  }

  reset() {
    for (const o of this.obstacles) this.scene.remove(o.mesh);
    for (const p of this.pickups) this.scene.remove(p.mesh);
    for (const d of this.decor) this.scene.remove(d.mesh);
    this.obstacles.length = 0;
    this.pickups.length = 0;
    this.decor.length = 0;
    this.timer = 0;
    this.first = true;
    this.last = '';
  }

  update(dt, speed, difficulty, time) {
    const d = speed * dt;
    for (const o of this.obstacles) o.mesh.position.z = o.z += d;
    for (const c of this.decor) c.mesh.position.z = c.z += d;
    for (const p of this.pickups) {
      p.z += d;
      p.mesh.position.set(p.x, p.y + Math.sin(time * 3 + p.phase) * 0.12, p.z);
      p.mesh.userData.inner.rotation.y = time * 2.4 + p.phase;
    }
    this.#cull();
    amberMat.color.setRGB(5, 2.4, 0.3).multiplyScalar(0.55 + 0.45 * Math.sin(time * 9));

    this.timer -= d;
    if (this.timer <= 0) {
      const z = this.first ? -120 : SPAWN_Z;
      // 开局第一个障碍固定是收费站，一上来就点题
      const { name, gapT } = this.first ? PATTERNS.find((p) => p.name === 'plaza') : this.#choose(difficulty);
      this.first = false;
      const len = this[`p_${name}`](z, speed);
      this.last = name;
      const gapTime = gapT * (1.15 - 0.4 * difficulty);
      this.timer = len + speed * gapTime;
    }
  }

  #cull() {
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      if (this.obstacles[i].z > DESPAWN_Z) {
        this.scene.remove(this.obstacles[i].mesh);
        this.obstacles.splice(i, 1);
      }
    }
    for (let i = this.decor.length - 1; i >= 0; i--) {
      if (this.decor[i].z > DESPAWN_Z + 14) {
        this.scene.remove(this.decor[i].mesh);
        this.decor.splice(i, 1);
      }
    }
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      if (p.z > DESPAWN_Z || p.taken) {
        this.scene.remove(p.mesh);
        this.pickups.splice(i, 1);
      }
    }
  }

  #choose(d) {
    const avail = PATTERNS.filter((p) => d >= p.min && p.name !== this.last);
    const total = avail.reduce((s, p) => s + p.w, 0);
    let r = Math.random() * total;
    for (const p of avail) {
      r -= p.w;
      if (r <= 0) return p;
    }
    return avail[0];
  }

  // ── 基础构件 ──
  #add(mesh, kind, x, z, hw, hd, y0, y1) {
    mesh.position.set(x, 0, z);
    this.scene.add(mesh);
    this.obstacles.push({ mesh, kind, x, z, hw, hd, y0, y1, cleared: false, awarded: false });
  }
  #boom(x, z) { this.#add(makeBoom(), 'boom', x, z, 1.5, 0.4, 0, 1.05); }
  #booth(x, z) { this.#add(makeBooth(), 'booth', x, z, 1.05, 0.95, 0, 2.38); }
  #led(x, z, text) { this.#add(makeLedWall(text), 'mega', x, z, 1.65, 0.5, 0, 2.7); }
  #truck(x, z) { this.#add(makeTruck(), 'truck', x, z, 1.05, 2.7, 0.15, 1.8); }
  #gate(x, z, width) { this.#add(makeLimitFrame(width), 'gate', x, z, width / 2, 0.15, 1.55, 1.9); }
  #canopy(z, open) {
    const mesh = makeCanopy(pick(STATIONS), open);
    mesh.position.set(0, 0, z);
    this.scene.add(mesh);
    this.decor.push({ mesh, z });
  }
  #cell(x, y, z) {
    const mesh = makeCell();
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.pickups.push({ mesh, x, y, z, phase: rand(0, 6), taken: false });
  }
  // 按喷气抛物线布置电芯，跟着拿就能越过障碍
  #arc(x, zc, v, n = 5) {
    for (let i = 0; i < n; i++) {
      const t = 0.14 + (i * 0.62) / (n - 1);
      const y = JET_VY * t - 0.5 * GRAVITY * t * t;
      this.#cell(x, 0.75 + y, zc - v * (0.45 - t));
    }
  }
  #line(x, z, n, step = 3.2) {
    for (let i = 0; i < n; i++) this.#cell(x, 0.9, z - i * step);
  }
  #lane() { return (Math.random() * 3) | 0; }
  #otherLanes(l) { return [0, 1, 2].filter((i) => i !== l); }

  // ── 关卡图案 ──（返回向远处延伸的长度）
  p_single(z, v) {
    const l = this.#lane();
    this.#boom(LANE_X[l], z);
    this.#arc(LANE_X[l], z, v);
    return 4;
  }
  p_cells(z) {
    const l = this.#lane();
    this.#line(LANE_X[l], z, 7);
    return 7 * 3.2;
  }
  p_pair(z) {
    const free = this.#lane();
    for (const l of this.#otherLanes(free)) this.#boom(LANE_X[l], z);
    this.#line(LANE_X[free], z + 4, 4, 3);
    return 12;
  }
  // 收费站：雨棚下只有一条 ETC 绿灯通道，其他通道要么落杆要么有人
  p_plaza(z, v) {
    const free = this.#lane();
    const open = [false, false, false];
    open[free] = true;
    this.#canopy(z, open);
    for (const l of this.#otherLanes(free)) {
      if (Math.random() < 0.55) this.#boom(LANE_X[l], z);
      else this.#booth(LANE_X[l], z);
    }
    this.#line(LANE_X[free], z + 6, 6, 2.8);
    return 10;
  }
  // 全封闭：三条通道的杆全落下，只能飞过去
  p_wall3(z, v) {
    this.#canopy(z, [false, false, false]);
    for (let l = 0; l < 3; l++) this.#boom(LANE_X[l], z);
    this.#arc(0, z, v);
    return 6;
  }
  p_tall(z, v) {
    const l = this.#lane();
    this.#booth(LANE_X[l], z);
    const o = pick(this.#otherLanes(l));
    if (Math.random() < 0.6) this.#boom(LANE_X[o], z);
    this.#arc(LANE_X[l], z, v);
    return 4;
  }
  p_truck(z, v) {
    const l = this.#lane();
    this.#truck(LANE_X[l], z);
    if (Math.random() < 0.5) this.#boom(LANE_X[pick(this.#otherLanes(l))], z + 1);
    this.#arc(LANE_X[l], z - 0.5, v, 6);
    return 8;
  }
  p_laser(z) {
    if (Math.random() < 0.35) {
      this.#gate(0, z, 3.4 * 3);
      this.#line(LANE_X[this.#lane()], z + 5, 6, 2.6);
    } else {
      const left = Math.random() < 0.5;
      this.#gate(left ? -1.7 : 1.7, z, 3.4 * 2);
      this.#line(LANE_X[left ? (Math.random() < 0.5 ? 0 : 1) : (Math.random() < 0.5 ? 1 : 2)], z + 5, 6, 2.6);
    }
    return 10;
  }
  p_slalom(z, v) {
    const step = v * 1.0 + 4;
    let free = this.#lane();
    for (let i = 0; i < 4; i++) {
      for (const l of this.#otherLanes(free)) this.#boom(LANE_X[l], z - i * step);
      this.#cell(LANE_X[free], 0.9, z - i * step);
      free = free === 1 ? pick([0, 2]) : 1;
    }
    return 4 * step;
  }
  p_mega(z, v) {
    const words = pick(LED_JOKES);
    for (let l = 0; l < 3; l++) this.#led(LANE_X[l], z, words[l]);
    this.#arc(0, z, v, 7);
    return 4;
  }
}
