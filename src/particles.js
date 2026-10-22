import * as THREE from 'three';

// 单一 Points 对象承载所有粒子（喷气、火花、烟、拾取特效），加色混合，配合 Bloom 发光
export class Particles {
  constructor(max = 2000) {
    this.max = max;
    this.cursor = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.c0 = new Float32Array(max * 3);
    this.c1 = new Float32Array(max * 3);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { uScale: { value: 600 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec4 aColor; attribute float aSize;
        uniform float uScale; varying vec4 vColor; varying float vFade;
        void main() {
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vFade = smoothstep(1.5, 5.5, -mv.z); // 靠近镜头时淡出，避免大团粒子糊脸
          gl_PointSize = aSize * uScale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec4 vColor; varying float vFade;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = clamp(1.0 - d, 0.0, 1.0);
          a *= a;
          gl_FragColor = vec4(vColor.rgb * vColor.a * a * vFade, 1.0);
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    this.geo = geo;
    // 所有粒子初始为“死亡”
    this.life.fill(0);
    this.pos.fill(9999);
  }

  setScale(pixelHeight, fovDeg) {
    this.uniforms.uScale.value = pixelHeight / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  // c0/c1: [r,g,b]，可大于 1（配合 Bloom）
  emit(x, y, z, vx, vy, vz, life, s0, s1, c0, c1, drag = 0, grav = 0) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.life[i] = this.maxLife[i] = life;
    this.s0[i] = s0; this.s1[i] = s1;
    this.c0[i3] = c0[0]; this.c0[i3 + 1] = c0[1]; this.c0[i3 + 2] = c0[2];
    this.c1[i3] = c1[0]; this.c1[i3 + 1] = c1[1]; this.c1[i3 + 2] = c1[2];
    this.drag[i] = drag;
    this.grav[i] = grav;
  }

  // scroll: 世界向 +z 滚动的速度（粒子留在原地，相对车辆后退）
  update(dt, scroll) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.size[i] = 0;
        this.col[i * 4 + 3] = 0;
        continue;
      }
      this.life[i] -= dt;
      const i3 = i * 3;
      const k = 1 - Math.max(0, this.life[i]) / this.maxLife[i]; // 0→1
      const damp = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= damp; this.vel[i3 + 1] = this.vel[i3 + 1] * damp - this.grav[i] * dt; this.vel[i3 + 2] *= damp;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += (this.vel[i3 + 2] + scroll) * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * k;
      const i4 = i * 4;
      this.col[i4] = this.c0[i3] + (this.c1[i3] - this.c0[i3]) * k;
      this.col[i4 + 1] = this.c0[i3 + 1] + (this.c1[i3 + 1] - this.c0[i3 + 1]) * k;
      this.col[i4 + 2] = this.c0[i3 + 2] + (this.c1[i3 + 2] - this.c0[i3 + 2]) * k;
      this.col[i4 + 3] = (1 - k) * (1 - k);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
  }
}
