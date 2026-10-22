import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTexture, rand, pick, radialTexture } from './util.js';

const FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Heiti SC", sans-serif';
const SPAN = 380;
const wrap = (z0, scroll, span) => 40 - span + ((z0 + scroll) % span);

// 对向车道中心线 / 中央分隔带位置
const OPP_X = -16.1;
const MEDIAN_X = -8.0;

// ───────────── 低多边形植物 ─────────────
// 由位置哈希出的确定性噪声：同一个顶点的重复拷贝得到同样的偏移，表面不会裂开
function hash3(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

// 把一个部件处理成：非索引、带顶点色、可抖动顶点、顶部亮底部暗（假 AO）
function part(geo, hex, { jitter = 0, seed = 0, shade = 0.35, vary = 0.08 } = {}) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const pos = g.attributes.position;
  g.computeBoundingBox();
  const { min, max } = g.boundingBox;
  if (jitter) {
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const k = (v) => Math.round(v * 1000) / 1000;
      const h = (o) => (hash3(k(x) + o + seed, k(y), k(z)) - 0.5) * 2 * jitter;
      pos.setXYZ(i, x + h(0.1), y + h(3.7) * 0.6, z + h(9.2));
    }
  }
  const base = new THREE.Color(hex);
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 3) {
    // 每个三角面一个颜色，配合平直着色出“low poly”质感
    const f = 1 + (hash3(i * 0.37 + seed, seed, 1.3) - 0.5) * 2 * vary;
    const yMid = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    const t = (yMid - min.y) / Math.max(0.001, max.y - min.y);
    const ao = 1 - shade + shade * t;
    c.copy(base).multiplyScalar(f * ao);
    for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (i + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

const TRUNK = 0x3b2c22;

function pineGeo(seed) {
  const parts = [part(new THREE.CylinderGeometry(0.12, 0.2, 1.6, 6).translate(0, 0.8, 0), TRUNK, { seed })];
  const tiers = [[1.75, 1.9, 1.7], [1.4, 1.8, 2.8], [1.05, 1.6, 3.75], [0.65, 1.4, 4.6]];
  tiers.forEach(([r, h, y], i) => {
    const greens = [0x24452f, 0x2a4f35, 0x2f573a, 0x355f40];
    parts.push(part(new THREE.ConeGeometry(r * rand(0.9, 1.1), h, 8, 2).rotateY(rand(0, 6)).translate(0, y, 0), greens[i], { jitter: 0.13, seed: seed + i, shade: 0.45 }));
  });
  return mergeGeometries(parts);
}

function broadleafGeo(seed) {
  const parts = [part(new THREE.CylinderGeometry(0.14, 0.26, 2.6, 6).translate(0, 1.3, 0), TRUNK, { seed })];
  const n = 4 + (seed % 2);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand(-0.3, 0.3);
    const r = i === 0 ? 0 : rand(0.6, 1.0);
    const blob = new THREE.IcosahedronGeometry(rand(1.05, 1.5), 1)
      .translate(Math.cos(a) * r, 3.3 + rand(-0.3, 0.6) + (i === 0 ? 0.5 : 0), Math.sin(a) * r);
    parts.push(part(blob, pick([0x3a5a2e, 0x41632f, 0x35532b, 0x4a6a33]), { jitter: 0.22, seed: seed * 7 + i, shade: 0.5 }));
  }
  return mergeGeometries(parts);
}

function poplarGeo(seed) {
  const parts = [part(new THREE.CylinderGeometry(0.1, 0.18, 2.2, 6).translate(0, 1.1, 0), 0x4a3e33, { seed })];
  parts.push(part(new THREE.IcosahedronGeometry(1, 1).scale(0.95, 3.1, 0.95).translate(0, 4.6, 0), 0x3b5a30, { jitter: 0.12, seed, shade: 0.5 }));
  parts.push(part(new THREE.IcosahedronGeometry(0.7, 1).scale(0.9, 2.2, 0.9).translate(0.25, 3.4, 0.2), 0x35522c, { jitter: 0.1, seed: seed + 3, shade: 0.5 }));
  return mergeGeometries(parts);
}

function bushGeo(seed) {
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const r = rand(0.5, 0.8);
    parts.push(part(new THREE.IcosahedronGeometry(r, 1).translate(rand(-0.6, 0.6), r * 0.75, rand(-0.5, 0.5)), pick([0x2c4a28, 0x32522b, 0x3a5a2e]), { jitter: 0.1, seed: seed * 5 + i, shade: 0.55 }));
  }
  return mergeGeometries(parts);
}

// 一组随世界滚动的实例：每个实例有固定的 x、初始 z、缩放、朝向
class Scroller {
  constructor(scene, geo, mat, items, span = SPAN) {
    this.items = items;
    this.span = span;
    this.mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
    this.mesh.count = items.length;
    this.mesh.frustumCulled = false;
    for (const it of items) it.q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.ry || 0);
    this._m = new THREE.Matrix4();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    scene.add(this.mesh);
  }
  update(scroll) {
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      this._p.set(it.x, it.y || 0, wrap(it.z0, scroll, this.span));
      this._s.set(it.s, it.s * (it.sy || 1), it.s);
      this._m.compose(this._p, it.q, this._s);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ───────────── 路边景物总成 ─────────────
export class Scenery {
  constructor(scene, roadTex, horizon) {
    this.scene = scene;
    this.scrollers = [];
    this.#plants();
    this.#median(roadTex);
    this.#traffic();
    this.#billboards();
    this.#distant(horizon);
  }

  #plants() {
    // 夜里的植物：顶点色再压暗一点，避免抢主角
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, color: 0xc8c8c8 });
    const kinds = {
      pine: [pineGeo(1), pineGeo(2)],
      broad: [broadleafGeo(3), broadleafGeo(4)],
      poplar: [poplarGeo(5), poplarGeo(6)],
      bush: [bushGeo(7), bushGeo(8)],
    };
    const lists = {};
    for (const k in kinds) lists[k] = kinds[k].map(() => []);
    const add = (kind, x, z0, s, sy = 1) => {
      const arr = lists[kind];
      arr[(Math.random() * arr.length) | 0].push({ x, z0: ((z0 % SPAN) + SPAN) % SPAN, s, sy, ry: rand(0, Math.PI * 2) });
    };

    // 右侧：紧贴护栏的一排杨树 + 外侧成片的树丛
    for (let z = 0; z < SPAN; z += rand(9, 15)) add('poplar', rand(9.6, 10.6), z, rand(0.85, 1.15), rand(0.9, 1.2));
    for (let z = 0; z < SPAN; z += rand(5, 9)) add('bush', rand(7.8, 8.8), z, rand(0.7, 1.1));
    // 左侧对向车道外侧
    for (let z = 0; z < SPAN; z += rand(11, 17)) add('poplar', rand(-23.6, -24.6), z, rand(0.85, 1.15), rand(0.9, 1.2));

    for (const side of [1, -1]) {
      const near = side > 0 ? 13 : 26.5;
      for (let i = 0; i < 24; i++) {
        const kind = pick(['pine', 'pine', 'broad', 'broad', 'broad']);
        const cx = side * (near + Math.pow(Math.random(), 1.6) * 30);
        const cz = rand(0, SPAN);
        const n = 1 + ((Math.random() * 4) | 0);
        for (let j = 0; j < n; j++) add(kind, cx + side * rand(-2.5, 3), cz + rand(-5, 5), rand(0.8, 1.35));
        if (Math.random() < 0.6) add('bush', cx + rand(-3, 3), cz + rand(-6, 6), rand(0.8, 1.3));
      }
    }
    // 中央分隔带绿篱
    for (let z = 0; z < SPAN; z += 2.6) add('bush', MEDIAN_X + rand(-0.25, 0.25), z, rand(0.75, 0.95), 0.9);

    for (const k in kinds) kinds[k].forEach((g, i) => this.scrollers.push(new Scroller(this.scene, g, mat, lists[k][i])));
  }

  // 中央分隔带的第二道护栏 + 对向车道
  #median(roadTex) {
    const railMat = new THREE.MeshStandardMaterial({ color: 0xaeb6c0, metalness: 0.6, roughness: 0.45, emissive: 0x1a2028 });
    const len = 340;
    for (const x of [MEDIAN_X - 1.35, OPP_X - 6.4]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.32, len), railMat);
      rail.position.set(x, 0.62, -len / 2 + 20);
      this.scene.add(rail);
    }
    const opp = new THREE.Mesh(
      new THREE.PlaneGeometry(12, len),
      new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.62, metalness: 0.1 }),
    );
    opp.rotation.x = -Math.PI / 2;
    opp.position.set(OPP_X, 0, -len / 2 + 20);
    this.scene.add(opp);
  }

  // 对向来车：车灯迎面驶过，给夜路一点生气
  #traffic() {
    const glow = new THREE.SpriteMaterial({
      map: radialTexture(64, [[0, 'rgba(255,250,235,1)'], [0.25, 'rgba(255,235,200,0.5)'], [1, 'rgba(255,220,180,0)']]),
      blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(1.3, 1.25, 1.15),
    });
    const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.9, 3.5) });
    const bodyGeo = new THREE.BoxGeometry(1.9, 0.75, 4.4);
    const cabGeo = new THREE.BoxGeometry(1.65, 0.6, 2.2);
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x0b0f14, roughness: 0.2, metalness: 0.4 });
    this.cars = [];
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({ color: pick([0x1a1d22, 0x8c939b, 0xd8dbe0, 0x23324a, 0x4a1a1a]), metalness: 0.5, roughness: 0.4 }));
      body.position.y = 0.6;
      const cab = new THREE.Mesh(cabGeo, glassMat);
      cab.position.set(0, 1.25, -0.3);
      g.add(body, cab);
      for (const sx of [-0.65, 0.65]) {
        const l = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.05), lampMat);
        l.position.set(sx, 0.7, 2.21);
        const s = new THREE.Sprite(glow);
        s.scale.set(1.3, 1.3, 1);
        s.position.set(sx, 0.7, 2.4);
        g.add(l, s);
      }
      this.scene.add(g);
      const car = { g, v: 0 };
      this.#respawnCar(car, -rand(20, 320));
      this.cars.push(car);
    }
  }

  #respawnCar(car, z) {
    car.g.position.set(OPP_X + pick([-3.4, 0, 3.4]), 0, z);
    car.v = rand(22, 34);
  }

  // 高炮广告牌：偶尔出现，有灯照着
  #billboards() {
    const ads = [
      ['#c8101a', '特斯拉超级充电站', '前方 8 km · 24 小时'],
      ['#0b4ea2', 'ETC 不停车 · 更快一步', '（会飞的车除外）'],
      ['#1b1f27', '飞行汽车专用道', '即将开通 · 敬请期待'],
    ];
    this.adTex = ads.map(([bg, a, b]) => canvasTexture(1024, 400, (g, w, h) => {
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 10; g.strokeRect(16, 16, w - 32, h - 32);
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
      g.font = `bold 112px ${FONT}`; g.fillText(a, w / 2, 160);
      g.font = `52px ${FONT}`; g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillText(b, w / 2, 290);
    }));
    const steel = new THREE.MeshStandardMaterial({ color: 0x59616c, metalness: 0.6, roughness: 0.5 });
    const back = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.8 });
    const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.2, 1.8) });
    this.adSpan = 640;
    this.nextAd = 2;
    this.ads = [];
    for (let i = 0; i < 2; i++) {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 10, 10), steel);
      pole.position.y = 5;
      const face = new THREE.MeshBasicMaterial({ map: this.adTex[i], color: new THREE.Color(1.1, 1.1, 1.1) });
      const board = new THREE.Mesh(new THREE.BoxGeometry(9, 3.6, 0.3), [back, back, back, back, face, back]);
      board.position.y = 11.6;
      g.add(pole, board);
      for (const sx of [-3, 0, 3]) {
        const l = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.3), lamp);
        l.position.set(sx, 13.55, 0.35);
        g.add(l);
      }
      g.position.x = 18;
      g.rotation.y = -0.25; // 微微朝向行车方向
      this.scene.add(g);
      this.ads.push({ g, face, z0: i * (this.adSpan / 2) + 150, prev: 0 });
    }
  }

  // 远景：山上的风车（缓慢转动、红灯闪烁）+ 地平线上零星的村镇灯火
  #distant(horizon) {
    const silhouette = new THREE.MeshBasicMaterial({ color: horizon.clone().multiplyScalar(0.4), fog: false });
    const hillY = (x, seed, maxH) => {
      const n = Math.sin(x * 0.006 + seed) * 0.5 + Math.sin(x * 0.017 + seed * 2.3) * 0.3 + Math.sin(x * 0.041 + seed * 0.7) * 0.2;
      return Math.max(2, maxH * (0.55 + 0.45 * n));
    };
    this.rotors = [];
    this.beacons = [];
    const beaconMat = new THREE.SpriteMaterial({
      map: radialTexture(32, [[0, 'rgba(255,60,50,1)'], [1, 'rgba(255,40,30,0)']]),
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false, color: new THREE.Color(3, 1, 1),
    });
    const blade = new THREE.BoxGeometry(1.4, 22, 0.4).translate(0, 11, 0);
    for (const x of [-260, -205, -150, 120, 175, 235, 300]) {
      const y0 = hillY(x, 1.3, 70) - 6;
      const g = new THREE.Group();
      g.position.set(x, y0, -515);
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.6, 42, 8), silhouette);
      tower.position.y = 21;
      const nacelle = new THREE.Mesh(new THREE.BoxGeometry(3, 2.2, 5), silhouette);
      nacelle.position.y = 42;
      const rotor = new THREE.Group();
      rotor.position.set(0, 42, 2.8);
      for (let k = 0; k < 3; k++) {
        const b = new THREE.Mesh(blade, silhouette);
        b.rotation.z = (k * Math.PI * 2) / 3;
        rotor.add(b);
      }
      rotor.rotation.z = rand(0, 6);
      const beacon = new THREE.Sprite(beaconMat);
      beacon.scale.set(6, 6, 1);
      beacon.position.set(0, 43.5, 0);
      g.add(tower, nacelle, rotor, beacon);
      this.scene.add(g);
      this.rotors.push({ rotor, speed: rand(0.25, 0.4) });
      this.beacons.push(beacon);
    }

    // 村镇灯火：远处地面上的暖色光点
    const n = 260;
    const p = new Float32Array(n * 3);
    const c = new Float32Array(n * 3);
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      // 成簇分布，像一个个小村子
      const cx = pick([-1, 1]) * rand(60, 420);
      const cz = -rand(300, 420);
      p.set([cx + rand(-18, 18), rand(0.5, 4), cz + rand(-14, 14)], i * 3);
      col.setHSL(rand(0.07, 0.13), 0.8, rand(0.55, 0.75));
      c.set([col.r, col.g, col.b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    this.scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, fog: false, transparent: true, opacity: 0.85, depthWrite: false })));
  }

  update(dt, speed, scroll, time) {
    for (const s of this.scrollers) s.update(scroll);
    for (const car of this.cars) {
      car.g.position.z += (speed + car.v) * dt;
      if (car.g.position.z > 40) this.#respawnCar(car, -rand(280, 420));
    }
    for (const ad of this.ads) {
      const zz = (ad.z0 + scroll) % this.adSpan;
      if (zz < ad.prev) {
        ad.face.map = this.adTex[this.nextAd++ % this.adTex.length];
        ad.face.needsUpdate = true;
      }
      ad.prev = zz;
      ad.g.position.z = 40 - this.adSpan + zz;
    }
    for (const r of this.rotors) r.rotor.rotation.z += r.speed * dt;
    const blink = Math.sin(time * 3) > 0.2 ? 1 : 0.05;
    for (const b of this.beacons) b.material.opacity = blink;
  }
}
