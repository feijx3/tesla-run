import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { PAINTS, CAR_PIVOT } from './config.js';
import { radialTexture } from './util.js';

// 模型使用“形状空间”：x = 车头方向，y = 向上，z = 横向。最后整体绕 Y 转 90°，让车头指向 -Z。
// 喷口分三组：down（车底，起飞/悬停）、rear（车尾黑色扩散器上的四个圆喷口）、side（两侧，翻转姿态控制）
const NOZZLES = [
  { g: 'down', p: [1.5, 0.3, 0.55], d: [0.04, -1, 0.1], len: 1.9 },
  { g: 'down', p: [1.5, 0.3, -0.55], d: [0.04, -1, -0.1], len: 1.9 },
  { g: 'down', p: [-1.4, 0.3, 0.55], d: [-0.04, -1, 0.1], len: 1.9 },
  { g: 'down', p: [-1.4, 0.3, -0.55], d: [-0.04, -1, -0.1], len: 1.9 },
  { g: 'rear', p: [-2.3, 0.44, 0.27], d: [-1, -0.04, 0.03], len: 2.6 },
  { g: 'rear', p: [-2.3, 0.44, -0.27], d: [-1, -0.04, -0.03], len: 2.6 },
  { g: 'rear', p: [-2.3, 0.44, 0.7], d: [-1, -0.04, 0.08], len: 2.6 },
  { g: 'rear', p: [-2.3, 0.44, -0.7], d: [-1, -0.04, -0.08], len: 2.6 },
  { g: 'side', p: [0.9, 0.64, 0.96], d: [0.1, 0.3, 1], len: 1.3 },
  { g: 'side', p: [0.9, 0.64, -0.96], d: [0.1, 0.3, -1], len: 1.3 },
  { g: 'side', p: [-1.2, 0.64, 0.96], d: [-0.1, 0.3, 1], len: 1.3 },
  { g: 'side', p: [-1.2, 0.64, -0.96], d: [-0.1, 0.3, -1], len: 1.3 },
];

function extrude(shape, depth, bevel, bevelSize = bevel, segs = 5) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize,
    bevelSegments: segs,
    curveSegments: 28,
  });
  g.translate(0, 0, -depth / 2);
  return toCreasedNormals(g, Math.PI / 4);
}

function flameGeometry() {
  const pts = [[0.0, 0.0], [0.62, 0.015], [1.0, 0.1], [0.96, 0.28], [0.74, 0.5], [0.44, 0.74], [0.18, 0.9], [0.0, 1.0]]
    .map(([r, y]) => new THREE.Vector2(r * 0.15, y));
  const g = new THREE.LatheGeometry(pts, 14);
  // 顶点色：根部最亮，向末端渐隐（加色混合下变黑 = 透明）
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const f = Math.pow(Math.max(0, 1 - pos.getY(i)), 1.5);
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = f;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export class Car {
  constructor() {
    this.root = new THREE.Group(); // 世界位置 + 偏航 + 侧倾
    this.pitchG = new THREE.Group(); // 后空翻（绕横轴）
    this.rollG = new THREE.Group(); // 侧向桶滚（绕车头轴）
    this.model = new THREE.Group();
    this.model.rotation.y = Math.PI / 2;
    this.model.position.y = -CAR_PIVOT;
    this.root.add(this.pitchG);
    this.pitchG.add(this.rollG);
    this.rollG.add(this.model);

    this.paintIndex = 0;
    this.wheels = [];
    this.flames = [];
    this.nozzleObjs = [];
    this.#buildBody();
    this.#buildDetails();
    this.#buildWheels();
    // 程序化车身单独成组：载入真实 .glb 车模后整组隐藏，喷口保留
    this.proc = new THREE.Group();
    for (const c of [...this.model.children]) this.proc.add(c);
    this.model.add(this.proc);
    this.#buildNozzles();

    // 灯光：大灯照亮前方路面，底部光晕，喷气闪光
    this.headlight = new THREE.PointLight(0xcfe9ff, 20, 30, 1.8);
    this.headlight.position.set(0, 1.8, -7.5); // 离车头远一些，避免正面看车时过曝
    this.root.add(this.headlight);
    this.glow = new THREE.PointLight(0x5ad2ff, 6, 9, 2);
    this.glow.position.set(0, -0.2, 0);
    this.root.add(this.glow);
    this.flare = new THREE.PointLight(0xbfe4ff, 0, 16, 2);
    this.flare.position.set(0, -0.4, 0.4);
    this.root.add(this.flare);

    // 路面假阴影：空中时变淡变大，帮助判断落点
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 6.0),
      new THREE.MeshBasicMaterial({
        map: radialTexture(128, [[0, 'rgba(0,0,0,0.85)'], [0.6, 'rgba(0,0,0,0.4)'], [1, 'rgba(0,0,0,0)']]),
        transparent: true,
        depthWrite: false,
        fog: false,
      }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.04;
    this.shadow.renderOrder = 1;
  }

  setPaint(i) {
    this.paintIndex = (i + PAINTS.length) % PAINTS.length;
    this.bodyMat.color.setHex(PAINTS[this.paintIndex].color);
    return PAINTS[this.paintIndex];
  }

  #buildBody() {
    this.bodyMat = new THREE.MeshPhysicalMaterial({
      color: PAINTS[0].color,
      metalness: 0.3,
      roughness: 0.34,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      envMapIntensity: 0.75,
    });
    // 琥珀色调的深色玻璃车顶
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x1b1008,
      metalness: 0.25,
      roughness: 0.05,
      clearcoat: 1,
      envMapIntensity: 1.7,
    });
    this.darkMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0d, metalness: 0.5, roughness: 0.45 });

    // 楔形车身侧视轮廓：低矮尖鼻、长车头、短而翘的尾部
    const s = new THREE.Shape();
    s.moveTo(-2.14, 0.5);
    s.lineTo(-2.2, 0.64);
    s.quadraticCurveTo(-2.18, 0.84, -1.9, 0.88);
    s.lineTo(-0.6, 0.87);
    s.lineTo(0.85, 0.82);
    s.quadraticCurveTo(1.7, 0.66, 2.16, 0.5);
    s.quadraticCurveTo(2.26, 0.46, 2.22, 0.42);
    s.lineTo(2.05, 0.38);
    s.lineTo(-2.05, 0.42);
    s.lineTo(-2.14, 0.5);
    this.model.add(new THREE.Mesh(extrude(s, 1.46, 0.2, 0.12), this.bodyMat));

    // 玻璃座舱：长长的车顶一直延伸到车尾
    const c = new THREE.Shape();
    c.moveTo(-1.85, 0.86);
    c.quadraticCurveTo(-1.25, 1.1, -0.6, 1.14);
    c.lineTo(0.15, 1.15);
    c.quadraticCurveTo(0.62, 1.1, 1.02, 0.83);
    c.lineTo(-1.85, 0.86);
    this.model.add(new THREE.Mesh(extrude(c, 1.0, 0.16, 0.1), glassMat));

    // 黑色下体：车头分流板、侧裙、尾部扩散器
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 1.8), this.darkMat);
    splitter.position.set(2.0, 0.33, 0);
    this.model.add(splitter);
    for (const side of [-1, 1]) {
      const sill = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.09, 0.05), this.darkMat);
      sill.position.set(0, 0.42, side * 0.97);
      this.model.add(sill);
    }
    const d = new THREE.Shape();
    d.moveTo(-2.3, 0.3);
    d.lineTo(-2.3, 0.6);
    d.lineTo(-1.55, 0.56);
    d.lineTo(-1.55, 0.3);
    d.lineTo(-2.3, 0.3);
    this.model.add(new THREE.Mesh(extrude(d, 1.5, 0.08, 0.04, 3), this.darkMat));

    // 尾部小翼
    const lip = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.04, 1.6), this.darkMat);
    lip.position.set(-2.14, 0.93, 0);
    lip.rotation.z = 0.1;
    this.model.add(lip);
  }

  #buildDetails() {
    const white = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.8, 3.4) });
    const red = new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 0.15, 0.1) });
    // 大灯：车头两侧细长灯带
    for (const side of [-1, 1]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.035, 0.5), white);
      h.position.set(1.7, 0.68, side * 0.5);
      h.rotation.z = -0.27;
      h.rotation.y = side * 0.22;
      this.model.add(h);
    }
    // 尾灯：贯穿整个车尾的红色灯带
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 1.75), red);
    tail.position.set(-2.3, 0.74, 0);
    this.model.add(tail);
    // 车底氛围光板
    const under = new THREE.Mesh(
      new THREE.PlaneGeometry(3.6, 1.3),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 1.1, 2.0), transparent: true, opacity: 0.8 }),
    );
    under.rotation.x = Math.PI / 2;
    under.position.y = 0.26;
    this.model.add(under);
  }

  #buildWheels() {
    // 大直径低扁平比轮胎 + 白色涡轮空气动力学轮毂（深色镂空槽）
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 0.9 });
    const discMat = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: 0.7, roughness: 0.3 });
    const tireGeo = new THREE.CylinderGeometry(0.44, 0.44, 0.34, 32).rotateX(Math.PI / 2);
    const discGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.36, 28).rotateX(Math.PI / 2);
    const slotGeo = new THREE.BoxGeometry(0.58, 0.06, 0.38);
    const wellGeo = new THREE.CylinderGeometry(0.53, 0.53, 0.04, 28).rotateX(Math.PI / 2);
    const pos = [[1.48, 0.44, 0.9], [1.48, 0.44, -0.9], [-1.36, 0.44, 0.9], [-1.36, 0.44, -0.9]];
    for (const [x, y, z] of pos) {
      const w = new THREE.Group();
      w.position.set(x, y, z);
      w.add(new THREE.Mesh(tireGeo, tireMat));
      w.add(new THREE.Mesh(discGeo, discMat));
      for (let k = 0; k < 3; k++) {
        const sp = new THREE.Mesh(slotGeo, this.darkMat);
        sp.rotation.z = (k * Math.PI) / 3 + 0.3;
        w.add(sp);
      }
      this.model.add(w);
      this.wheels.push(w);
      // 轮拱：车身侧面的深色环，形成车轮与车身之间的缝隙
      const well = new THREE.Mesh(wellGeo, this.darkMat);
      well.position.set(x, y, Math.sign(z) * 0.95);
      this.model.add(well);
    }
  }

  #buildNozzles() {
    const housing = new THREE.CylinderGeometry(0.1, 0.12, 0.12, 16);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x9aa4b0, metalness: 1, roughness: 0.25 });
    const ringGeo = new THREE.TorusGeometry(0.1, 0.02, 6, 18);
    const holeGeo = new THREE.CircleGeometry(0.085, 16);
    const flameGeo = flameGeometry();
    const add = (color, opacity) => new THREE.MeshBasicMaterial({
      color, vertexColors: true, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mats = {
      cold: { outer: add(new THREE.Color(0.55, 1.0, 2.0), 0.5), inner: add(new THREE.Color(2.4, 3.2, 4.2), 0.95) },
      hot: { outer: add(new THREE.Color(3.0, 1.1, 0.25), 0.6), inner: add(new THREE.Color(2.4, 3.0, 4.2), 0.95) },
    };
    const up = new THREE.Vector3(0, 1, 0);
    for (const n of NOZZLES) {
      const dir = new THREE.Vector3(...n.d).normalize();
      const holder = new THREE.Object3D();
      holder.position.set(...n.p);
      this.model.add(holder);

      const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);
      const h = new THREE.Mesh(housing, this.darkMat);
      h.quaternion.copy(quat);
      h.position.copy(dir).multiplyScalar(-0.02);
      holder.add(h);
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.quaternion.copy(quat);
      ring.rotateX(Math.PI / 2);
      ring.position.copy(dir).multiplyScalar(0.05);
      holder.add(ring);
      const hole = new THREE.Mesh(holeGeo, this.darkMat);
      hole.quaternion.copy(quat);
      hole.rotateX(-Math.PI / 2);
      hole.position.copy(dir).multiplyScalar(0.055);
      holder.add(hole);

      const m = n.g === 'rear' ? mats.hot : mats.cold;
      const flame = new THREE.Group();
      flame.quaternion.copy(quat);
      const outer = new THREE.Mesh(flameGeo, m.outer);
      const inner = new THREE.Mesh(flameGeo, m.inner);
      inner.scale.set(0.5, 0.7, 0.5);
      flame.add(outer, inner);
      flame.visible = false;
      holder.add(flame);

      this.flames.push({ flame, len: n.len, g: n.g });
      this.nozzleObjs.push({ holder, dir, group: n.g });
    }
  }

  // 用外部车模替换程序化车身：自动找出车长方向、缩放到 4.5 米、落地居中。
  // yawDeg 用来修正车头朝向（模型车头朝反了就填 180）
  useModel(obj, yawDeg = 0) {
    const holder = new THREE.Group();
    holder.add(obj);
    let box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    // 形状空间要求 x 为车长方向；模型车长若沿 z，先转 90°
    if (size.z > size.x) obj.rotation.y = Math.PI / 2;
    obj.rotation.y += THREE.MathUtils.degToRad(yawDeg);
    obj.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(obj);
    const len = box.getSize(new THREE.Vector3()).x;
    const k = 4.5 / len;
    obj.scale.multiplyScalar(k);
    obj.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(obj);
    const c = box.getCenter(new THREE.Vector3());
    obj.position.x -= c.x;
    obj.position.z -= c.z;
    obj.position.y -= box.min.y;
    obj.traverse((m) => {
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        if ('envMapIntensity' in mat) mat.envMapIntensity = 1;
        // 纯红色材质视为尾灯，让它发光
        const col = mat.color;
        if (col && mat.emissive && col.r > 0.4 && col.g < 0.15 && col.b < 0.15) {
          mat.emissive.copy(col);
          mat.emissiveIntensity = 4;
        }
      }
    });
    this.proc.visible = false;
    // 真实车模自带喷口造型：隐藏程序化的喷口外壳，只保留喷气效果
    const flames = new Set(this.flames.map((f) => f.flame));
    for (const n of this.nozzleObjs) for (const ch of n.holder.children) if (!flames.has(ch)) ch.visible = false;
    this.model.add(holder);
    this.custom = holder;
  }

  // 设置姿态。pitch: 抬头为正（后空翻为 +2π），roll: 绕车头轴旋转
  setPose({ x, y, yaw, bank, pitch, roll }) {
    this.root.position.set(x, y + CAR_PIVOT, 0);
    this.root.rotation.set(0, yaw, bank);
    this.pitchG.rotation.x = pitch;
    this.rollG.rotation.z = roll;
    this.shadow.position.x = x;
    const h = Math.min(y, 6);
    const s = 1 + h * 0.12;
    this.shadow.scale.set(s, s, 1);
    this.shadow.material.opacity = Math.max(0.15, 1 - h * 0.14);
  }

  spinWheels(distance) {
    for (const w of this.wheels) w.rotation.z -= distance / 0.44;
  }

  // levels: { down, rear, side }，各 0..1
  setJet(levels, time) {
    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i];
      const k = levels[f.g] || 0;
      if (k < 0.02) {
        f.flame.visible = false;
        continue;
      }
      f.flame.visible = true;
      const flick = 0.85 + 0.2 * Math.sin(time * 70 + i * 2.1) + 0.07 * Math.random();
      const len = f.len * k * flick;
      const wide = 0.55 + 0.7 * k;
      f.flame.scale.set(wide, len, wide);
    }
    const peak = Math.max(levels.down || 0, levels.rear || 0);
    this.flare.intensity = 26 * peak * peak;
    this.glow.intensity = 6 + 16 * peak;
  }

  // 喷口世界坐标与朝向，用于发射粒子
  nozzleWorld(i, outPos, outDir) {
    const n = this.nozzleObjs[i];
    n.holder.getWorldPosition(outPos);
    outDir.copy(n.dir).transformDirection(this.model.matrixWorld);
  }
}
