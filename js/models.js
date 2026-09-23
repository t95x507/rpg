// Процедурные модели из примитивов. Каждая модель смотрит в +Z.
// userData.anim(t, moving, atk) — анимация; userData.mats — материалы для подсветки при ударе.
import * as THREE from 'three';

export const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...o });
const glow = (color, intensity = 2) => mat(color, { emissive: color, emissiveIntensity: intensity });

function finish(g) {
  const mats = new Set();
  g.traverse(c => {
    if (c.isMesh) { c.castShadow = true; mats.add(c.material); }
  });
  for (const m of mats) {
    m.userData.baseEmissive = m.emissive.clone();
    m.userData.baseIntensity = m.emissiveIntensity;
  }
  g.userData.mats = [...mats];
  return g;
}

function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
}
function ball(r, material, x = 0, y = 0, z = 0, seg = 12) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, seg * 0.8 | 0), material);
  m.position.set(x, y, z);
  return m;
}
// Конечность с шарниром сверху
function limb(w, h, d, material, x, y, z) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  pivot.add(box(w, h, d, material, 0, -h / 2, 0));
  return pivot;
}

function humanoidAnim(rig, legL, legR, armL, armR, o = {}) {
  const speed = o.speed ?? 11, amp = o.amp ?? 0.7;
  return (t, moving, atk) => {
    const s = moving ? Math.sin(t * speed) * amp : 0;
    legL.rotation.x = s; legR.rotation.x = -s;
    armL.rotation.x = -s * 0.6 - (o.armIdle ?? 0.15);
    rig.position.y = moving ? Math.abs(Math.sin(t * speed)) * 0.06 : Math.sin(t * 2) * 0.02;
    let r = s * 0.6 - 0.35;
    if (atk > 0) {
      const p = 1 - atk;
      r = p < 0.3 ? THREE.MathUtils.lerp(-0.35, -2.7, p / 0.3)
                  : THREE.MathUtils.lerp(-2.7, -0.2, 1 - Math.pow(1 - (p - 0.3) / 0.7, 3));
      if (o.both) armL.rotation.x = r;
    }
    armR.rotation.x = r;
  };
}

// ---------------- Персонаж ----------------
export function buildHero(color = 0x3b6fd6, { sword = true } = {}) {
  const g = new THREE.Group(), rig = new THREE.Group(); g.add(rig);
  const cloth = mat(color), skin = mat(0xf0c8a0), leather = mat(0x4a3322);
  const steel = mat(0xc4c8d4, { metalness: 0.7, roughness: 0.35 });
  const gold = mat(0xd4a73b, { metalness: 0.6, roughness: 0.4 });

  rig.add(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.75, 10), cloth).translateY(1.02));
  rig.add(new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.37, 0.1, 10), leather).translateY(0.72));
  rig.add(ball(0.25, skin, 0, 1.65, 0, 14));
  const helm = new THREE.Mesh(new THREE.SphereGeometry(0.27, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), steel);
  helm.position.y = 1.68; rig.add(helm);
  const eye = mat(0x1a1a1a);
  rig.add(ball(0.035, eye, -0.09, 1.66, 0.22, 6), ball(0.035, eye, 0.09, 1.66, 0.22, 6));
  // плащ
  const cape = box(0.55, 0.9, 0.04, mat(color, { roughness: 0.9 }), 0, 1.0, -0.36);
  cape.rotation.x = 0.12; rig.add(cape);

  const legL = limb(0.17, 0.62, 0.2, leather, -0.14, 0.68, 0);
  const legR = limb(0.17, 0.62, 0.2, leather, 0.14, 0.68, 0);
  const armL = limb(0.14, 0.58, 0.14, cloth, -0.43, 1.33, 0);
  const armR = limb(0.14, 0.58, 0.14, cloth, 0.43, 1.33, 0);
  rig.add(legL, legR, armL, armR);

  if (sword) {
    const sw = new THREE.Group(); sw.position.set(0, -0.56, 0.02);
    sw.add(box(0.07, 0.04, 1.0, steel, 0, 0, 0.62), box(0.32, 0.06, 0.06, gold, 0, 0, 0.1), box(0.05, 0.05, 0.2, leather));
    armR.add(sw);
    const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 14), mat(0x8a5a2b));
    shield.rotation.z = Math.PI / 2; shield.position.set(-0.1, -0.35, 0.05);
    const boss = ball(0.08, gold); boss.position.set(-0.14, -0.35, 0.05);
    armL.add(shield, boss);
  }
  g.userData.anim = humanoidAnim(rig, legL, legR, armL, armR);
  return finish(g);
}

// ---------------- Мобы ----------------
export function buildSlime(color = 0x5ad65a, size = 0.55) {
  const g = new THREE.Group(), rig = new THREE.Group(); g.add(rig);
  const body = ball(size, mat(color, { transparent: true, opacity: 0.88, roughness: 0.2 }), 0, size * 0.75, 0, 18);
  body.scale.y = 0.75;
  const white = mat(0xffffff), black = mat(0x111111);
  for (const sx of [-1, 1]) {
    rig.add(ball(size * 0.17, white, sx * size * 0.32, size * 0.95, size * 0.72, 8));
    rig.add(ball(size * 0.09, black, sx * size * 0.32, size * 0.95, size * 0.86, 6));
  }
  rig.add(body);
  g.userData.rig = rig;
  g.userData.anim = (t, moving, atk) => {
    const hop = moving ? Math.abs(Math.sin(t * 8)) : Math.abs(Math.sin(t * 2.5)) * 0.15;
    rig.position.y = hop * size * 0.5;
    const sq = (1 - hop) * 0.12;
    rig.scale.set(1 + sq + atk * 0.15, 1 - sq + atk * 0.25, 1 + sq + atk * 0.15);
  };
  return finish(g);
}

export function buildSlimeKing() {
  const size = 1.7;
  const g = buildSlime(0x39b86a, size);
  const gold = mat(0xf2c13a, { metalness: 0.8, roughness: 0.3, emissive: 0x553300, emissiveIntensity: 0.4 });
  const crown = new THREE.Group(); crown.position.y = size * 1.4;
  crown.add(new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.7, 0.35, 12, 1, true), gold));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.4, 5), gold);
    c.position.set(Math.cos(a) * 0.62, 0.35, Math.sin(a) * 0.62);
    crown.add(c);
  }
  crown.add(ball(0.12, glow(0xff2a55, 1.5), 0, 0.05, 0.68, 8));
  g.userData.rig.add(crown);
  return finish(g);
}

export function buildWolf(color = 0x6d6d74) {
  const g = new THREE.Group(), rig = new THREE.Group(); g.add(rig);
  const fur = mat(color), dark = mat(0x3a3a40), eye = glow(0xffd23a, 1.5);
  rig.add(box(0.5, 0.45, 1.1, fur, 0, 0.75, 0));
  const head = new THREE.Group(); head.position.set(0, 0.95, 0.62); rig.add(head);
  head.add(box(0.42, 0.38, 0.42, fur, 0, 0, 0.06), box(0.2, 0.16, 0.3, dark, 0, -0.07, 0.36));
  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 4), fur);
    ear.position.set(sx * 0.12, 0.26, 0); head.add(ear);
    head.add(ball(0.04, eye, sx * 0.11, 0.05, 0.27, 6));
  }
  const tail = box(0.1, 0.1, 0.5, fur, 0, 0.85, -0.72); tail.rotation.x = 0.6; rig.add(tail);
  const legs = [[-0.17, 0.38], [0.17, 0.38], [-0.17, -0.38], [0.17, -0.38]].map(([x, z]) => limb(0.13, 0.52, 0.13, dark, x, 0.55, z));
  rig.add(...legs);
  g.userData.anim = (t, moving, atk) => {
    const s = moving ? Math.sin(t * 14) * 0.8 : 0;
    legs[0].rotation.x = s; legs[3].rotation.x = s; legs[1].rotation.x = -s; legs[2].rotation.x = -s;
    head.rotation.x = Math.sin(t * 3) * 0.05 - atk * 0.3;
    tail.rotation.y = Math.sin(t * 6) * 0.3;
    rig.position.z = atk * 0.35;
  };
  return finish(g);
}

export function buildSkeleton(tint = 0xe8e2cc) {
  const g = new THREE.Group(), rig = new THREE.Group(); g.add(rig);
  const bone = mat(tint), dark = mat(0x5a5448), rust = mat(0x7a5a3a, { metalness: 0.4 });
  const eye = glow(0xff3322, 2.5);
  rig.add(box(0.44, 0.5, 0.24, bone, 0, 1.12, 0), box(0.1, 0.35, 0.1, bone, 0, 0.75, 0), box(0.36, 0.14, 0.2, bone, 0, 0.6, 0));
  for (let i = 0; i < 3; i++) rig.add(box(0.5, 0.05, 0.28, dark, 0, 1.0 + i * 0.13, 0));
  rig.add(ball(0.24, bone, 0, 1.62, 0, 12), box(0.2, 0.08, 0.14, bone, 0, 1.43, 0.08));
  rig.add(ball(0.05, eye, -0.08, 1.64, 0.2, 6), ball(0.05, eye, 0.08, 1.64, 0.2, 6));
  const legL = limb(0.1, 0.6, 0.1, bone, -0.13, 0.6, 0), legR = limb(0.1, 0.6, 0.1, bone, 0.13, 0.6, 0);
  const armL = limb(0.08, 0.6, 0.08, bone, -0.32, 1.32, 0), armR = limb(0.08, 0.6, 0.08, bone, 0.32, 1.32, 0);
  const sw = new THREE.Group(); sw.position.set(0, -0.58, 0);
  sw.add(box(0.07, 0.04, 0.9, rust, 0, 0, 0.5), box(0.26, 0.05, 0.05, dark, 0, 0, 0.06));
  armR.add(sw);
  rig.add(legL, legR, armL, armR);
  g.userData.anim = humanoidAnim(rig, legL, legR, armL, armR, { speed: 9 });
  return finish(g);
}

export function buildGolem() {
  const g = new THREE.Group(), rig = new THREE.Group(); g.add(rig);
  const stone = mat(0x7c776d, { flatShading: true, roughness: 1 }), moss = mat(0x4f6b3a, { flatShading: true });
  const lava = glow(0xff6a1a, 2.2);
  rig.add(box(2.2, 1.8, 1.4, stone, 0, 2.7, 0), box(1.6, 0.8, 1.1, stone, 0, 1.75, 0));
  rig.add(box(0.9, 0.8, 0.8, stone, 0, 3.95, 0.15));
  rig.add(box(0.2, 0.1, 0.05, lava, -0.2, 4.0, 0.56), box(0.2, 0.1, 0.05, lava, 0.2, 4.0, 0.56));
  rig.add(box(0.12, 0.9, 0.05, lava, -0.3, 2.7, 0.71), box(0.5, 0.1, 0.05, lava, 0.1, 2.9, 0.71), box(0.1, 0.6, 0.05, lava, 0.4, 2.5, 0.71));
  for (const sx of [-1, 1]) {
    const sh = new THREE.Mesh(new THREE.DodecahedronGeometry(0.7), moss);
    sh.position.set(sx * 1.35, 3.45, 0); rig.add(sh);
  }
  const armL = limb(0.7, 2.0, 0.7, stone, -1.5, 3.3, 0), armR = limb(0.7, 2.0, 0.7, stone, 1.5, 3.3, 0);
  for (const a of [armL, armR]) {
    const fist = new THREE.Mesh(new THREE.DodecahedronGeometry(0.62), stone);
    fist.position.y = -2.1; a.add(fist);
  }
  const legL = limb(0.8, 1.4, 0.8, stone, -0.6, 1.5, 0), legR = limb(0.8, 1.4, 0.8, stone, 0.6, 1.5, 0);
  rig.add(armL, armR, legL, legR);
  g.userData.anim = humanoidAnim(rig, legL, legR, armL, armR, { speed: 5, amp: 0.45, both: true, armIdle: 0.1 });
  return finish(g);
}

export function buildLich() {
  const g = new THREE.Group(), rig = new THREE.Group(); g.add(rig);
  const robe = mat(0x3b1f5c, { roughness: 0.9 }), trim = mat(0xb08a2e, { metalness: 0.6 });
  const bone = mat(0xd8d2bd), soul = glow(0x55ffcc, 3);
  rig.add(new THREE.Mesh(new THREE.ConeGeometry(0.95, 2.4, 12, 1, true), robe).translateY(1.3));
  rig.add(new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.5, 12), robe).translateY(2.45));
  const hood = ball(0.42, robe, 0, 2.85, -0.05, 12); rig.add(hood);
  rig.add(ball(0.27, bone, 0, 2.8, 0.14, 12));
  rig.add(ball(0.06, soul, -0.09, 2.83, 0.37, 6), ball(0.06, soul, 0.09, 2.83, 0.37, 6));
  for (const sx of [-1, 1]) rig.add(ball(0.26, trim, sx * 0.55, 2.55, 0, 8));
  const armL = limb(0.16, 0.9, 0.16, robe, -0.6, 2.45, 0), armR = limb(0.16, 0.9, 0.16, robe, 0.6, 2.45, 0);
  const staff = new THREE.Group(); staff.position.set(0, -0.9, 0.1);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 6), mat(0x2a1a10));
  pole.rotation.x = Math.PI / 2; pole.position.z = 0.5;
  const orb = ball(0.22, soul, 0, 0, 2.1, 12);
  const light = new THREE.PointLight(0x55ffcc, 6, 9, 1.5); light.position.z = 2.1;
  staff.add(pole, orb, light);
  armR.add(staff);
  rig.add(armL, armR);
  g.userData.anim = (t, moving, atk) => {
    rig.position.y = 0.35 + Math.sin(t * 2) * 0.15;
    rig.rotation.z = Math.sin(t * 1.3) * 0.04;
    armL.rotation.x = -0.4 + Math.sin(t * 2.2) * 0.1;
    armR.rotation.x = -0.9 - atk * 1.4;
    orb.scale.setScalar(1 + Math.sin(t * 6) * 0.12 + atk * 0.5);
  };
  return finish(g);
}

// ---------------- Лут ----------------
export function buildGoldDrop() {
  const g = new THREE.Group();
  const m = mat(0xffcc33, { metalness: 0.9, roughness: 0.25, emissive: 0x664400, emissiveIntensity: 0.6 });
  const geo = new THREE.CylinderGeometry(0.16, 0.16, 0.05, 12);
  [[0, 0, 0], [0.12, 0.06, 0.05], [-0.08, 0.1, -0.06]].forEach(([x, y, z], i) => {
    const c = new THREE.Mesh(geo, m); c.position.set(x, y, z); c.rotation.set(i * 0.3, 0, i * 0.4); g.add(c);
  });
  return finish(g);
}
export function buildPotionDrop() {
  const g = new THREE.Group();
  g.add(ball(0.18, mat(0xff3344, { emissive: 0x880011, emissiveIntensity: 0.8, roughness: 0.2 }), 0, 0.15, 0, 10));
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.16, 8), mat(0xddddff)).translateY(0.38));
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 8), mat(0x6b4226)).translateY(0.48));
  return finish(g);
}
export function buildChestDrop(color, beam) {
  const g = new THREE.Group();
  const wood = mat(0x7a4a22), band = mat(color, { metalness: 0.5, emissive: color, emissiveIntensity: 0.35 });
  g.add(box(0.55, 0.32, 0.38, wood, 0, 0.16, 0), box(0.58, 0.14, 0.41, band, 0, 0.38, 0), box(0.1, 0.12, 0.05, band, 0, 0.26, 0.2));
  finish(g);
  if (beam) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.2, 7, 8, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    b.position.y = 3.5; b.castShadow = false; g.add(b);
  }
  return g;
}

// ---------------- Окружение ----------------
export function buildHouse(wallColor = 0xd9c7a0, roofColor = 0x9c3b2e) {
  const g = new THREE.Group();
  const wall = mat(wallColor), roof = mat(roofColor, { flatShading: true }), wood = mat(0x5a3a1e);
  g.add(box(4, 2.8, 3.6, wall, 0, 1.4, 0));
  const r = new THREE.Mesh(new THREE.ConeGeometry(3.4, 2.2, 4), roof);
  r.position.y = 3.9; r.rotation.y = Math.PI / 4; r.scale.z = 0.9; g.add(r);
  g.add(box(0.9, 1.6, 0.1, wood, 0, 0.8, 1.81), box(0.7, 0.6, 0.1, mat(0x9fd3ff, { emissive: 0x3a5a7a, emissiveIntensity: 0.5 }), 1.3, 1.7, 1.81));
  for (const [x, z] of [[-2, -1.8], [2, -1.8], [-2, 1.8], [2, 1.8]]) g.add(box(0.25, 2.8, 0.25, wood, x, 1.4, z));
  g.add(box(0.5, 1.2, 0.5, mat(0x6d6d6d), 1.2, 4.2, -0.6));
  g.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  return g;
}

export function buildStall() {
  const g = new THREE.Group();
  const wood = mat(0x6b4524), cloth = mat(0xc2403a), cloth2 = mat(0xf3e6c8);
  g.add(box(2.6, 0.9, 1, wood, 0, 0.45, 0));
  for (const x of [-1.2, 1.2]) for (const z of [-0.45, 0.45]) g.add(box(0.12, 2.4, 0.12, wood, x, 1.2, z));
  for (let i = 0; i < 6; i++) g.add(box(0.44, 0.08, 1.3, i % 2 ? cloth : cloth2, -1.1 + i * 0.44, 2.45, 0.1));
  g.add(ball(0.18, mat(0xff3344, { emissive: 0x660011 }), -0.6, 1.05, 0.1, 8), ball(0.18, mat(0x3388ff, { emissive: 0x001166 }), 0, 1.05, 0.1, 8), box(0.4, 0.3, 0.3, mat(0xd4a73b, { metalness: 0.7 }), 0.7, 1.05, 0));
  g.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  return g;
}

export function buildCampfire() {
  const g = new THREE.Group();
  const wood = mat(0x4a2e18), stone = mat(0x6d6a66, { flatShading: true });
  for (let i = 0; i < 4; i++) {
    const l = box(0.18, 0.18, 1.3, wood, 0, 0.12, 0); l.rotation.y = i * Math.PI / 4; g.add(l);
  }
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * Math.PI * 2;
    const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22), stone); s.position.set(Math.cos(a) * 0.85, 0.1, Math.sin(a) * 0.85); g.add(s);
  }
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.1, 7), new THREE.MeshBasicMaterial({ color: 0xffa230 }));
  flame.position.y = 0.7;
  const inner = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.7, 7), new THREE.MeshBasicMaterial({ color: 0xfff08a }));
  inner.position.y = 0.55;
  const light = new THREE.PointLight(0xff9a40, 25, 16, 1.6); light.position.y = 1.4;
  g.add(flame, inner, light);
  g.userData.anim = t => {
    const f = 1 + Math.sin(t * 17) * 0.08 + Math.sin(t * 7.3) * 0.08;
    flame.scale.set(f, f * (1 + Math.sin(t * 11) * 0.1), f); inner.scale.setScalar(2 - f);
    light.intensity = 22 + Math.sin(t * 13) * 4 + Math.sin(t * 5.1) * 3;
  };
  return g;
}

export function buildStandingStone(h = 2.4) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, h, 0.6), mat(0x57545e, { flatShading: true }));
  m.position.y = h / 2 - 0.1; m.castShadow = true; m.receiveShadow = true;
  const g = new THREE.Group(); g.add(m);
  const rune = box(0.3, 0.5, 0.02, glow(0x9a5cff, 1.2), 0, h * 0.55, 0.31); g.add(rune);
  return g;
}
