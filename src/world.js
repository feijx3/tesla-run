import * as THREE from 'three';
import { canvasTexture, radialTexture } from './util.js';
import { Scenery } from './scenery.js';

const FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Heiti SC", sans-serif';
const ROAD_W = 12;
const ROAD_LEN = 340;
const ROAD_TILE = 24;
const GROUND_TILE = 20;
const SPAN = 380; // 路边景物循环的总长度

// 沿路滚动的景物：z0 ∈ [0, span)，随世界前进循环到车后
const wrapZ = (z0, scroll, span = SPAN) => 40 - span + ((z0 + scroll) % span);

// 夜间高速公路：克制的蓝灰色调，护栏、路灯、道旁树、远山，以及“前方收费站”龙门指路牌
export class World {
  constructor(scene, renderer) {
    this.scene = scene;
    this.scroll = 0;
    const aniso = renderer.capabilities.getMaxAnisotropy();

    const horizon = new THREE.Color(0x4a5f7c);
    scene.fog = new THREE.Fog(horizon, 45, 270);
    this.horizon = horizon;
    this.#buildSky(horizon);
    this.#buildHills(horizon);
    this.#buildGround(aniso);
    this.#buildRoad(aniso);
    this.#buildGuardrail();
    this.scenery = new Scenery(scene, this.roadTex, horizon);
    this.#buildLamps();
    this.#buildGantries();
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
  }

  #buildSky(horizon) {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(900, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          top: { value: new THREE.Color(0x060c1a) },
          mid: { value: new THREE.Color(0x142443) },
          low: { value: horizon.clone() },
        },
        vertexShader: `varying float vY; void main(){ vY = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `
          uniform vec3 top; uniform vec3 mid; uniform vec3 low; varying float vY;
          void main(){
            float h = max(vY, 0.0);
            vec3 c = mix(low, mid, smoothstep(0.0, 0.25, h));
            c = mix(c, top, smoothstep(0.2, 0.75, h));
            gl_FragColor = vec4(c, 1.0);
          }`,
      }),
    );
    sky.renderOrder = -10;
    this.scene.add(sky);
  }

  // 远处两层山的剪影，给地平线一点层次，但不抢戏
  #buildHills(horizon) {
    const layer = (z, maxH, shade, seed) => {
      const pts = [];
      const w = 1800;
      for (let x = -w / 2; x <= w / 2; x += 24) {
        const n = Math.sin(x * 0.006 + seed) * 0.5 + Math.sin(x * 0.017 + seed * 2.3) * 0.3 + Math.sin(x * 0.041 + seed * 0.7) * 0.2;
        pts.push([x, Math.max(2, maxH * (0.55 + 0.45 * n))]);
      }
      const s = new THREE.Shape();
      s.moveTo(-w / 2, -60);
      for (const [x, y] of pts) s.lineTo(x, y);
      s.lineTo(w / 2, -60);
      const m = new THREE.Mesh(
        new THREE.ShapeGeometry(s),
        new THREE.MeshBasicMaterial({ color: horizon.clone().multiplyScalar(shade), fog: false, depthWrite: true }),
      );
      m.position.set(0, 0, z);
      this.scene.add(m);
    };
    layer(-520, 70, 0.72, 1.3);
    layer(-430, 42, 0.52, 4.1);
  }

  #buildGround(aniso) {
    // 路旁草地：低对比度的颗粒，仅用来体现速度
    const tex = canvasTexture(256, 256, (g, w, h) => {
      g.fillStyle = '#16221a';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 2600; i++) {
        const v = Math.random();
        g.fillStyle = v < 0.5 ? 'rgba(34,52,36,0.7)' : 'rgba(10,16,12,0.7)';
        g.fillRect(Math.random() * w, Math.random() * h, 3, 3);
      }
    }, { repeat: true });
    tex.anisotropy = aniso;
    const size = 900;
    tex.repeat.set(size / GROUND_TILE, size / GROUND_TILE);
    this.groundTex = tex;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.08, -size / 2 + 40);
    this.scene.add(ground);
  }

  #buildRoad(aniso) {
    const tex = canvasTexture(512, 1024, (g, w, h) => {
      g.fillStyle = '#24272d';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 9000; i++) {
        const v = 26 + Math.random() * 26;
        g.fillStyle = `rgba(${v},${v},${v + 6},0.5)`;
        g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
      const px = w / ROAD_W; // 每米像素
      // 各车道的轮胎磨痕：稍深的两条带，让车道更易分辨
      g.fillStyle = 'rgba(0,0,0,0.14)';
      for (const cx of [-3.4, 0, 3.4]) {
        for (const off of [-0.85, 0.85]) g.fillRect(w / 2 + (cx + off) * px - 18, 0, 36, h);
      }
      // 应急车道
      g.fillStyle = 'rgba(255,255,255,0.04)';
      for (const ex of [-5.65, 5.65]) g.fillRect(w / 2 + ex * px - 18, 0, 36, h);
      // 车道虚线
      g.fillStyle = 'rgba(235,240,250,0.9)';
      for (const lx of [-1.7, 1.7]) {
        for (let d = 0; d < 4; d++) g.fillRect(w / 2 + lx * px - 3.5, d * (h / 4) + 10, 7, (h / 4) * 0.5);
      }
      // 路缘实线
      g.fillStyle = 'rgba(235,240,250,0.85)';
      for (const ex of [-5.3, 5.3]) g.fillRect(w / 2 + ex * px - 3.5, 0, 7, h);
    }, { repeat: true });
    tex.anisotropy = aniso;
    tex.repeat.set(1, ROAD_LEN / ROAD_TILE);
    this.roadTex = tex;
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(ROAD_W, ROAD_LEN),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.62, metalness: 0.1 }),
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0, -ROAD_LEN / 2 + 20);
    this.scene.add(road);
  }

  // 波形护栏：连续横梁 + 随世界滚动的立柱
  #buildGuardrail() {
    const railMat = new THREE.MeshStandardMaterial({ color: 0xaeb6c0, metalness: 0.6, roughness: 0.45, emissive: 0x1a2028 });
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.32, ROAD_LEN), railMat);
      rail.position.set(side * 6.55, 0.62, -ROAD_LEN / 2 + 20);
      const rail2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, ROAD_LEN), railMat);
      rail2.position.set(side * 6.55, 0.9, -ROAD_LEN / 2 + 20);
      this.scene.add(rail, rail2);
    }
    this.postSpacing = 4;
    const count = Math.ceil(ROAD_LEN / this.postSpacing) + 2;
    this.postCount = count;
    this.posts = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.12, 0.85, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x6d7580, metalness: 0.5, roughness: 0.6 }),
      count * 2,
    );
    this.posts.frustumCulled = false;
    this.scene.add(this.posts);
  }

  // 暖色路灯：灯杆、灯臂、灯头，加上地面上的一圈暖光（加色贴花，不用真灯光）
  #buildLamps() {
    this.lampSpacing = 38;
    const per = Math.ceil(SPAN / this.lampSpacing);
    this.lampPer = per;
    const n = per * 2;
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x20252c, metalness: 0.5, roughness: 0.55 });
    const headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.9, 1.0) });
    this.lampPole = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 9, 0.2), poleMat, n);
    this.lampArm = new THREE.InstancedMesh(new THREE.BoxGeometry(2.8, 0.14, 0.14), poleMat, n);
    this.lampHead = new THREE.InstancedMesh(new THREE.BoxGeometry(1.1, 0.1, 0.4), headMat, n);
    const poolGeo = new THREE.PlaneGeometry(9, 13).rotateX(-Math.PI / 2);
    const poolMat = new THREE.MeshBasicMaterial({
      map: radialTexture(128, [[0, 'rgba(255,196,120,0.3)'], [0.5, 'rgba(255,170,90,0.09)'], [1, 'rgba(255,160,80,0)']]),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.lampPool = new THREE.InstancedMesh(poolGeo, poolMat, n);
    for (const m of [this.lampPole, this.lampArm, this.lampHead, this.lampPool]) {
      m.frustumCulled = false;
      this.scene.add(m);
    }
  }

  // 龙门架指路牌：按顺序提示“前方收费站 2km → 1km → 500m → 请勿起飞”，一路读下来就是主题
  #buildGantries() {
    const texts = [
      ['火星 方向', '距火星收费站 3km'],
      ['G4 京港澳高速', '前方收费站 2km'],
      ['G4 京港澳高速', '前方收费站 1km'],
      ['ETC 通道请减速', '收费站 500m'],
      ['收费站 200m', '请勿起飞'],
    ];
    this.signTex = texts.map(([small, big]) => canvasTexture(1024, 320, (g, w, h) => {
      g.fillStyle = '#0b6a3c';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#fff';
      g.lineWidth = 8;
      g.strokeRect(12, 12, w - 24, h - 24);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#e8fff0';
      g.font = `bold 58px ${FONT}`;
      g.fillText(small, w / 2, 84);
      g.fillStyle = '#fff';
      g.font = `bold 124px ${FONT}`;
      g.fillText(big, w / 2, 198);
    }));
    const steel = new THREE.MeshStandardMaterial({ color: 0x8a939e, metalness: 0.6, roughness: 0.5 });
    const back = new THREE.MeshStandardMaterial({ color: 0x0a4a2a, roughness: 0.8 });
    this.gantrySpan = 480;
    this.nextSign = 3;
    this.gantries = [];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      for (const sx of [-1, 1]) {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 7.4, 0.6), steel);
        pillar.position.set(sx * 7.6, 3.7, 0);
        g.add(pillar);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(16.2, 0.5, 0.6), steel);
      beam.position.y = 7.2;
      g.add(beam);
      const idx = 2 - i; // 离车最近的先经过：依次是 3km → 2km → 1km，之后循环 500m → 200m
      const face = new THREE.MeshBasicMaterial({ map: this.signTex[idx], color: new THREE.Color(1.25, 1.25, 1.25) });
      const sign = new THREE.Mesh(new THREE.BoxGeometry(8.4, 2.6, 0.14), [back, back, back, back, face, back]);
      sign.position.y = 8.8;
      g.add(sign);
      this.scene.add(g);
      this.gantries.push({ group: g, face, z0: (i / 3) * this.gantrySpan + 60, prev: 0 });
    }
  }

  #place(mesh, i, x, y, z, sx = 1, sy = 1, sz = 1) {
    this._p.set(x, y, z);
    this._s.set(sx, sy, sz);
    this._m.compose(this._p, this._q, this._s);
    mesh.setMatrixAt(i, this._m);
  }

  update(dt, speed) {
    const d = speed * dt;
    this.scroll += d;
    const sc = this.scroll;
    this.roadTex.offset.y += d / ROAD_TILE;
    this.groundTex.offset.y += d / GROUND_TILE;

    // 护栏立柱
    const ps = this.postSpacing;
    const off = sc % ps;
    for (let i = 0; i < this.postCount; i++) {
      const z = 20 - i * ps + off;
      this.#place(this.posts, i * 2, -6.55, 0.42, z);
      this.#place(this.posts, i * 2 + 1, 6.55, 0.42, z);
    }
    this.posts.instanceMatrix.needsUpdate = true;

    // 植物、对向来车、广告牌、远景风车
    this.time = (this.time || 0) + dt;
    this.scenery.update(dt, speed, sc, this.time);

    // 路灯（左右交错）
    const sp = this.lampSpacing;
    for (let i = 0; i < this.lampPer; i++) {
      for (let k = 0; k < 2; k++) {
        const side = k === 0 ? -1 : 1;
        const z = wrapZ(i * sp + (k ? sp / 2 : 0), sc);
        const x = side * 7.9;
        const j = i * 2 + k;
        this.#place(this.lampPole, j, x, 4.5, z);
        this.#place(this.lampArm, j, x - side * 1.4, 9.0, z);
        this.#place(this.lampHead, j, x - side * 2.5, 8.9, z);
        this.#place(this.lampPool, j, x - side * 3.2, 0.05, z);
      }
    }
    for (const m of [this.lampPole, this.lampArm, this.lampHead, this.lampPool]) m.instanceMatrix.needsUpdate = true;

    // 龙门架：每次绕回远处时换成下一块指路牌
    for (const gt of this.gantries) {
      const zz = (gt.z0 + sc) % this.gantrySpan;
      if (zz < gt.prev) {
        gt.face.map = this.signTex[this.nextSign++ % this.signTex.length];
        gt.face.needsUpdate = true;
      }
      gt.prev = zz;
      gt.group.position.z = 40 - this.gantrySpan + zz;
    }
  }
}
