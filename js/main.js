import * as THREE from 'three';
import * as M from './models.js';
import { makeItem, RARITY, tooltipHTML } from './items.js';
import { connectNet } from './net.js';

// ============================================================ утилиты
const $ = id => document.getElementById(id);
const WORLD_R = 98, TOWN_R = 13, SAVE_KEY = 'minimmo-save-v1', INV_SIZE = 24;
const RIGHT = new THREE.Vector3(1, 0, -1).normalize();  // «вправо» на экране
const UP = new THREE.Vector3(-1, 0, -1).normalize();    // «вверх» на экране
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rr = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const lerpAngle = (a, b, t) => a + ((((b - a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI) * t;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function mulberry32(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const srand = mulberry32(20260923); // одинаковый мир у всех игроков

// ============================================================ рендер
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
$('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14201a);
const VIEW = 24;
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400);
const CAM_OFF = new THREE.Vector3(40, 46, 40);
function resize() {
  const a = innerWidth / innerHeight;
  camera.left = -VIEW * a / 2; camera.right = VIEW * a / 2; camera.top = VIEW / 2; camera.bottom = -VIEW / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize); resize();

scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x40502f, 1.2));
const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -38, right: 38, top: 38, bottom: -38, near: 1, far: 140 });
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
const SUN_OFF = new THREE.Vector3(-22, 45, 14);

// ============================================================ мир
const BOSS_SPOTS = {
  slimeKing: { x: -26, z: 26 },
  golem: { x: 42, z: -44 },
  lich: { x: -58, z: -66 },
};
const colliders = [];
const C = hex => new THREE.Color(hex);
const C_TOWN = C(0xa08c5c), C_ROAD = C(0x9a8358), C1 = C(0x6fae4f), C2 = C(0x3f7e3b), C3 = C(0x5d5668), C_EDGE = C(0x22301f);
const hash = (x, z) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };
function groundColor(x, z, out) {
  const d = Math.hypot(x, z);
  out.copy(C_TOWN).lerp(C1, smooth(TOWN_R - 1, TOWN_R + 3, d)).lerp(C2, smooth(38, 46, d))
     .lerp(C3, smooth(66, 74, d)).lerp(C_EDGE, smooth(99, 106, d));
  const road = Math.min(Math.abs(x), Math.abs(z));
  if (d > TOWN_R - 1 && d < 74) out.lerp(C_ROAD, (1 - smooth(1.0, 2.4, road)) * 0.85);
  return out.multiplyScalar(0.88 + hash(x, z) * 0.2 + Math.sin(x * 0.15) * Math.cos(z * 0.13) * 0.06);
}
function zoneAt(p) {
  const d = Math.hypot(p.x, p.z);
  if (d < TOWN_R) return 'Город Рассвет · безопасная зона';
  if (d < 41) return 'Зелёные луга · ур. 1–3';
  if (d < 69) return 'Волчий лес · ур. 4–7';
  return 'Мёртвые земли · ур. 8–12';
}
function okSpot(x, z, minTown = TOWN_R + 3) {
  const d = Math.hypot(x, z);
  if (d < minTown) return false;
  for (const b of Object.values(BOSS_SPOTS)) if (Math.hypot(x - b.x, z - b.z) < 14) return false;
  if (Math.min(Math.abs(x), Math.abs(z)) < 3 && d < 74) return false;
  return true;
}

const worldAnims = [];
function buildWorld() {
  // земля
  const geo = new THREE.PlaneGeometry(260, 260, 170, 170).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, cols = [], c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) { groundColor(pos.getX(i), pos.getZ(i), c); cols.push(c.r, c.g, c.b); }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  ground.receiveShadow = true; scene.add(ground);

  // деревья
  const trees = [];
  for (let i = 0; i < 520; i++) {
    const a = srand() * Math.PI * 2, r = Math.sqrt(srand()) * WORLD_R;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (okSpot(x, z)) trees.push({ x, z, s: 0.8 + srand() * 0.6, pine: srand() < 0.5, d: r });
  }
  for (let i = 0; i < 330; i++) {
    const a = srand() * Math.PI * 2, r = 101 + srand() * 22;
    trees.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, s: 1 + srand() * 0.7, pine: srand() < 0.7, d: r });
  }
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 1.4, 6).translate(0, 0.7, 0);
  const pineGeo = new THREE.ConeGeometry(1.1, 2.8, 7).translate(0, 2.6, 0);
  const roundGeo = new THREE.IcosahedronGeometry(1.25, 0).translate(0, 2.5, 0);
  const leafMat = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true });
  const trunks = new THREE.InstancedMesh(trunkGeo, M.mat(0x5a3d22), trees.length);
  const pines = new THREE.InstancedMesh(pineGeo, leafMat, trees.length);
  const rounds = new THREE.InstancedMesh(roundGeo, leafMat, trees.length);
  let np = 0, nr = 0;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  trees.forEach((t, i) => {
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, srand() * 6.28);
    m4.compose(p.set(t.x, 0, t.z), q, s.setScalar(t.s));
    trunks.setMatrixAt(i, m4);
    const dead = t.d > 70 && t.d < 100;
    const col = dead ? c.setHSL(0.75 + srand() * 0.08, 0.15, 0.28 + srand() * 0.1)
                     : c.setHSL(0.26 + srand() * 0.08, 0.5, (t.d > 42 ? 0.22 : 0.32) + srand() * 0.1);
    if (t.pine) { pines.setMatrixAt(np, m4); pines.setColorAt(np++, col); }
    else { rounds.setMatrixAt(nr, m4); rounds.setColorAt(nr++, col); }
    if (t.d < 100) colliders.push({ x: t.x, z: t.z, r: 0.45 * t.s });
  });
  pines.count = np; rounds.count = nr;
  for (const im of [trunks, pines, rounds]) { im.castShadow = true; scene.add(im); }

  // камни
  const rocks = [];
  for (let i = 0; i < 140; i++) {
    const a = srand() * Math.PI * 2, r = 15 + srand() * 82;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (okSpot(x, z)) rocks.push({ x, z, s: 0.4 + srand() * 0.9 });
  }
  const rockMesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1), M.mat(0x7a7680, { flatShading: true, roughness: 1 }), rocks.length);
  rocks.forEach((r, i) => {
    q.setFromEuler(new THREE.Euler(srand(), srand() * 6, srand()));
    m4.compose(p.set(r.x, r.s * 0.3, r.z), q, s.set(r.s, r.s * 0.7, r.s));
    rockMesh.setMatrixAt(i, m4);
    colliders.push({ x: r.x, z: r.z, r: r.s * 0.9 });
  });
  rockMesh.castShadow = rockMesh.receiveShadow = true; scene.add(rockMesh);

  // трава
  const N = 3000, grass = new THREE.InstancedMesh(new THREE.ConeGeometry(0.07, 0.5, 3).translate(0, 0.25, 0), new THREE.MeshStandardMaterial({ roughness: 1 }), N);
  for (let i = 0; i < N; i++) {
    const a = srand() * Math.PI * 2, r = 12 + srand() * 58;
    m4.compose(p.set(Math.cos(a) * r, 0, Math.sin(a) * r), q.identity(), s.setScalar(0.6 + srand() * 0.9));
    grass.setMatrixAt(i, m4);
    grass.setColorAt(i, c.setHSL(0.25 + srand() * 0.07, 0.55, r > 42 ? 0.2 : 0.33));
  }
  scene.add(grass);
  // цветы
  const fl = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 5, 4), new THREE.MeshStandardMaterial({ emissive: 0x222222 }), 500);
  for (let i = 0; i < 500; i++) {
    const a = srand() * Math.PI * 2, r = 10 + srand() * 32;
    m4.compose(p.set(Math.cos(a) * r, 0.25, Math.sin(a) * r), q, s.setScalar(1));
    fl.setMatrixAt(i, m4); fl.setColorAt(i, c.set(pick([0xff6b9a, 0xfff06b, 0xffffff, 0x9ab8ff])));
  }
  scene.add(fl);

  // город
  const houseCols = [[0xd9c7a0, 0x9c3b2e], [0xcfd6d9, 0x3b5a9c], [0xe0cfa6, 0x5a7d3a], [0xd4b896, 0x7a3b6b]];
  [0.8, 2.35, 3.93, 5.5].forEach((ang, i) => {
    const h = M.buildHouse(...houseCols[i]);
    const x = Math.cos(ang) * 9, z = Math.sin(ang) * 9;
    h.position.set(x, 0, z); h.lookAt(0, 0, 0); scene.add(h);
    colliders.push({ x, z, r: 2.6 });
  });
  const fire = M.buildCampfire(); scene.add(fire); worldAnims.push(fire.userData.anim);
  colliders.push({ x: 0, z: 0, r: 1.0 });
  const stall = M.buildStall(); stall.position.set(-5.2, 0, 1.5); stall.rotation.y = Math.PI / 2; scene.add(stall);
  colliders.push({ x: -5.4, z: 0.6, r: 0.7 }, { x: -5.4, z: 2.4, r: 0.7 });

  // арены боссов
  for (const b of Object.values(BOSS_SPOTS)) {
    for (let i = 0; i < 12; i++) {
      if (i % 4 === 0) continue; // проходы
      const a = i / 12 * Math.PI * 2 + 0.26, x = b.x + Math.cos(a) * 12, z = b.z + Math.sin(a) * 12;
      const st = M.buildStandingStone(2 + srand()); st.position.set(x, 0, z); st.lookAt(b.x, 0, b.z); scene.add(st);
      colliders.push({ x, z, r: 0.6 });
    }
  }
}
buildWorld();

// торговец
const merchant = { pos: new THREE.Vector3(-3.9, 0, 1.5) };
{
  const g = M.buildHero(0x7a3b8f, { sword: false });
  g.position.copy(merchant.pos); g.rotation.y = Math.PI / 2; scene.add(g);
  merchant.model = g;
  merchant.hb = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 2.2, 8), new THREE.MeshBasicMaterial({ visible: false }));
  merchant.hb.position.set(merchant.pos.x, 1.1, merchant.pos.z); scene.add(merchant.hb);
  colliders.push({ x: merchant.pos.x, z: merchant.pos.z, r: 0.5 });
}

// ============================================================ общие эффекты
const labelsEl = $('labels');
const _v = new THREE.Vector3();
function toScreen(p, yOff = 0) {
  _v.set(p.x, (p.y || 0) + yOff, p.z).project(camera);
  return [(_v.x * 0.5 + 0.5) * innerWidth, (-_v.y * 0.5 + 0.5) * innerHeight];
}

const floats = [];
function floatText(text, p, cls = 'dmg', yOff = 2, dur = 1) {
  const el = document.createElement('div');
  el.className = 'ft ' + cls; el.textContent = text; labelsEl.appendChild(el);
  floats.push({ el, p: new THREE.Vector3(p.x + rr(-0.3, 0.3), yOff, p.z + rr(-0.3, 0.3)), t: 0, dur });
}
function updateFloats(dt) {
  for (let i = floats.length - 1; i >= 0; i--) {
    const f = floats[i]; f.t += dt; f.p.y += dt * 1.8;
    const [x, y] = toScreen(f.p);
    f.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    f.el.style.opacity = 1 - Math.pow(f.t / f.dur, 3);
    if (f.t >= f.dur) { f.el.remove(); floats.splice(i, 1); }
  }
}

const particles = [], PGEO = new THREE.BoxGeometry(0.14, 0.14, 0.14), pMats = {};
function burst(x, y, z, color, n = 10, speed = 4, up = 4, life = 0.6) {
  const mat = pMats[color] ||= new THREE.MeshBasicMaterial({ color });
  for (let i = 0; i < n && particles.length < 500; i++) {
    const m = new THREE.Mesh(PGEO, mat); m.position.set(x, y, z); scene.add(m);
    const a = Math.random() * Math.PI * 2, sp = speed * rr(0.3, 1);
    particles.push({ m, v: new THREE.Vector3(Math.cos(a) * sp, rr(0.5, 1) * up, Math.sin(a) * sp), life, max: life });
  }
}
function ringBurst(x, z, r, color, n = 24) {
  const mat = pMats[color] ||= new THREE.MeshBasicMaterial({ color });
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2, m = new THREE.Mesh(PGEO, mat);
    m.position.set(x + Math.cos(a) * 0.8, 0.8, z + Math.sin(a) * 0.8); scene.add(m);
    particles.push({ m, v: new THREE.Vector3(Math.cos(a) * r * 3, 1.5, Math.sin(a) * r * 3), life: 0.35, max: 0.35 });
  }
}
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]; p.life -= dt;
    p.v.y -= 14 * dt; p.m.position.addScaledVector(p.v, dt);
    if (p.m.position.y < 0.07) { p.m.position.y = 0.07; p.v.multiplyScalar(0.6); p.v.y = Math.abs(p.v.y) * 0.3; }
    p.m.scale.setScalar(Math.max(0.01, p.life / p.max));
    if (p.life <= 0) { scene.remove(p.m); particles.splice(i, 1); }
  }
}

let shakeT = 0;
function shake(s) { shakeT = Math.max(shakeT, s); }

let toastTimer = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); toastTimer = 1.8; }

function addChat(html, cls = '') {
  const log = $('chat-log'), d = document.createElement('div');
  d.className = cls; d.innerHTML = html; log.appendChild(d);
  while (log.children.length > 80) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
}
const sys = msg => addChat(esc(msg), 'sys');

// ============================================================ полоски HP над мобами
function makeBar(w, y, color) {
  const g = new THREE.Group(); g.position.y = y;
  const bg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x000000, opacity: 0.65, transparent: true, depthTest: false }));
  bg.center.set(0, 0.5); bg.scale.set(w + 0.08, 0.17, 1); bg.position.copy(RIGHT).multiplyScalar(-(w + 0.08) / 2); bg.renderOrder = 10;
  const fg = new THREE.Sprite(new THREE.SpriteMaterial({ color, transparent: true, depthTest: false }));
  fg.center.set(0, 0.5); fg.scale.set(w, 0.1, 1); fg.position.copy(RIGHT).multiplyScalar(-w / 2); fg.renderOrder = 11;
  g.add(bg, fg); g.userData = { fg, w }; g.visible = false;
  return g;
}

// ============================================================ мобы
const TYPES = {
  slime: { name: 'Слизень', hp: 34, dmg: 5, speed: 2.4, range: 1.3, atkCd: 1.5, xp: 12, radius: 0.6, height: 1.1, aggro: 7, gold: [1, 4], build: () => M.buildSlime(pick([0x5ad65a, 0x6fd6a0, 0x9ad64a])) },
  wolf: { name: 'Серый волк', hp: 50, dmg: 6, speed: 4.6, range: 1.6, atkCd: 1.2, xp: 16, radius: 0.7, height: 1.3, aggro: 10, gold: [2, 6], build: () => M.buildWolf(pick([0x6d6d74, 0x5a5a60, 0x8a8078])) },
  skeleton: { name: 'Скелет-воин', hp: 70, dmg: 7.5, speed: 3.2, range: 1.7, atkCd: 1.4, xp: 22, radius: 0.6, height: 2, aggro: 9, gold: [3, 9], build: () => M.buildSkeleton() },
  slimeKing: { name: 'Король Слизней', boss: true, hp: 700, dmg: 11, speed: 2.6, range: 3.3, atkCd: 2, xp: 400, radius: 2.1, height: 4, aggro: 12, leash: 24, gold: [60, 90], build: M.buildSlimeKing, abilities: ['slam', 'slam', 'summon'], summon: 'slime' },
  golem: { name: 'Древний Голем', boss: true, hp: 1300, dmg: 14, speed: 2.6, range: 3.6, atkCd: 2.2, xp: 700, radius: 2.3, height: 5, aggro: 13, leash: 24, gold: [150, 220], build: M.buildGolem, abilities: ['slam', 'rocks', 'rocks'] },
  lich: { name: 'Лич Моргрим', boss: true, hp: 1700, dmg: 14, speed: 3, range: 9, atkCd: 1.5, xp: 1000, radius: 1.1, height: 3.6, aggro: 15, leash: 26, gold: [300, 450], build: M.buildLich, abilities: ['meteor', 'nova', 'summon', 'meteor'], summon: 'skeleton', ranged: true },
};
const BOSS_LEVEL = { slimeKing: 5, golem: 11, lich: 16 };
const HITMAT = new THREE.MeshBasicMaterial({ visible: false });
const mobs = [], bosses = [], hitboxes = [];

function createMob(type, lvl, x, z, temp = false) {
  const T = TYPES[type], f = 1 + 0.18 * (lvl - 1);
  const root = new THREE.Group(); root.position.set(x, 0, z);
  const model = T.build(); model.rotation.y = Math.random() * 6.28; root.add(model);
  const hb = new THREE.Mesh(new THREE.CylinderGeometry(T.radius + 0.3, T.radius + 0.3, T.height, 8), HITMAT);
  hb.position.y = T.height / 2; root.add(hb);
  const bar = makeBar(T.boss ? 3.2 : 1.2, T.height + 0.5, T.boss ? 0xff7a2e : 0xe04040); root.add(bar);
  scene.add(root);
  const m = { type, T, lvl, root, model, bar, hb, pos: root.position, home: new THREE.Vector3(x, 0, z),
    maxHp: Math.round(T.hp * f), hp: 0, dmg: T.dmg * f, state: 'idle', wanderT: rr(1, 6), wanderTo: null,
    atkCd: 0, atkAnim: 0, flash: 0, tint: -1, dead: false, dyingT: 0, respawnT: 0, phase: Math.random() * 10,
    temp, abilityT: 4, enraged: false, contrib: 0, lastHit: -99, faceTo: model.rotation.y, moving: false, idx: -1 };
  m.hp = m.maxHp;
  hb.userData.mob = m;
  hitboxes.push(hb); mobs.push(m);
  if (T.boss) { m.idx = bosses.length; bosses.push(m); }
  return m;
}
function removeMob(m) {
  scene.remove(m.root);
  mobs.splice(mobs.indexOf(m), 1);
  hitboxes.splice(hitboxes.indexOf(m.hb), 1);
}

function spawnWorldMobs() {
  const add = (type, n, rMin, rMax, lMin, lMax) => {
    for (let i = 0, tries = 0; i < n && tries < 500; tries++) {
      const a = srand() * Math.PI * 2, r = rMin + srand() * (rMax - rMin);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!okSpot(x, z)) continue;
      createMob(type, Math.round(lMin + (lMax - lMin) * (r - rMin) / (rMax - rMin)), x, z); i++;
    }
  };
  add('slime', 28, 17, 39, 1, 3);
  add('wolf', 24, 44, 67, 4, 7);
  add('skeleton', 22, 72, 95, 8, 12);
  for (const [type, s] of Object.entries(BOSS_SPOTS)) createMob(type, BOSS_LEVEL[type], s.x, s.z);
}
spawnWorldMobs();

function setTint(m, mode) { // 0 — норм, 1 — вспышка, 2 — ярость
  if (m.tint === mode) return; m.tint = mode;
  for (const mt of m.model.userData.mats) {
    if (mode === 1) { mt.emissive.setRGB(1, 1, 1); mt.emissiveIntensity = 0.7; }
    else if (mode === 2 && mt.userData.baseIntensity < 1) { mt.emissive.setRGB(0.6, 0.05, 0.02); mt.emissiveIntensity = 0.5; }
    else { mt.emissive.copy(mt.userData.baseEmissive); mt.emissiveIntensity = mt.userData.baseIntensity; }
  }
}

function moveToward(m, target, speed, dt, stop) {
  const dx = target.x - m.pos.x, dz = target.z - m.pos.z, d = Math.hypot(dx, dz);
  m.faceTo = Math.atan2(dx, dz);
  if (d <= stop) return false;
  const step = Math.min(speed * dt, d - stop);
  m.pos.x += dx / d * step; m.pos.z += dz / d * step;
  return true;
}

function playerTargetable() { return started && !player.dead && Math.hypot(player.pos.x, player.pos.z) > TOWN_R; }

function aggro(m) {
  if (m.state === 'chase' || m.dead) return;
  m.state = 'chase'; m.atkCd = Math.max(m.atkCd, 0.6);
  if (m.T.boss) { sys(`⚔ ${m.T.name} вступает в бой!`); m.abilityT = 3; }
}

function updateMob(m, dt) {
  if (m.dead) {
    if (m.dyingT > 0) {
      m.dyingT -= dt;
      const k = Math.max(0, m.dyingT / 0.6);
      m.model.scale.setScalar(0.2 + 0.8 * k); m.model.position.y = -(1 - k) * 0.6;
      if (m.dyingT <= 0) { m.root.visible = false; if (m.temp) removeMob(m); }
    } else if ((m.respawnT -= dt) <= 0) respawnMob(m);
    return;
  }
  const T = m.T;
  m.atkCd -= dt; m.atkAnim = Math.max(0, m.atkAnim - dt * 2.5); m.flash -= dt;
  const dP = dist(m.pos, player.pos), valid = playerTargetable();
  let moving = false;

  if (m.state === 'idle') {
    if (valid && dP < T.aggro) aggro(m);
    else {
      if ((m.wanderT -= dt) <= 0) {
        m.wanderT = rr(3, 8);
        m.wanderTo = m.home.clone().add(new THREE.Vector3(rr(-4, 4), 0, rr(-4, 4)));
      }
      if (m.wanderTo) { moving = moveToward(m, m.wanderTo, T.speed * 0.35, dt, 0.2); if (!moving) m.wanderTo = null; }
      if (m.hp < m.maxHp && time - m.lastHit > 8) m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.05 * dt);
    }
  } else if (m.state === 'chase') {
    if (!valid || dist(m.pos, m.home) > (T.leash || 22)) {
      m.state = 'return';
      if (T.boss && valid) sys(`${T.name} отступает в своё логово.`);
    } else {
      const reach = T.range + 0.4;
      if (dP > reach * 0.85) moving = moveToward(m, player.pos, T.speed * (m.enraged ? 1.25 : 1), dt, reach * 0.8);
      else m.faceTo = Math.atan2(player.pos.x - m.pos.x, player.pos.z - m.pos.z);
      if (dP <= reach && m.atkCd <= 0) {
        m.atkCd = T.atkCd * (m.enraged ? 0.8 : 1); m.atkAnim = 1;
        if (T.ranged) fireBolt(m);
        else pendingHits.push({ t: 0.25, fn: () => { if (!m.dead && dist(m.pos, player.pos) <= reach + 0.6) hurtPlayer(m.dmg, m); } });
      }
      if (T.boss) bossAbilities(m, dt);
    }
  } else if (m.state === 'return') {
    moving = moveToward(m, m.home, T.speed * 1.7, dt, 0.5);
    m.hp = Math.min(m.maxHp, m.hp + m.maxHp * dt * 0.4);
    if (!moving) { m.state = 'idle'; m.hp = m.maxHp; m.contrib = 0; m.enraged = false; }
  }
  // не залезать в игрока
  if (!player.dead && dP < T.radius + 0.45 && dP > 0.001) {
    const k = (T.radius + 0.45) / dP;
    m.pos.x = player.pos.x + (m.pos.x - player.pos.x) * k; m.pos.z = player.pos.z + (m.pos.z - player.pos.z) * k;
  }
  m.moving = moving;
  m.model.rotation.y = lerpAngle(m.model.rotation.y, m.faceTo, Math.min(1, dt * 10));
  m.model.userData.anim(time + m.phase, moving, m.atkAnim);
  setTint(m, m.flash > 0 ? 1 : m.enraged ? 2 : 0);
  // полоска HP
  const show = m.hp < m.maxHp || player.target === m;
  m.bar.visible = show;
  if (show) m.bar.userData.fg.scale.x = Math.max(0.001, m.bar.userData.w * m.hp / m.maxHp);
}

function separateMobs() {
  const act = mobs.filter(m => !m.dead && m.state === 'chase');
  for (let i = 0; i < act.length; i++) for (let j = i + 1; j < act.length; j++) {
    const a = act[i], b = act[j], dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz), r = a.T.radius + b.T.radius;
    if (d < r && d > 0.001) {
      const push = (r - d) / 2, nx = dx / d, nz = dz / d;
      const wa = a.T.boss ? 0 : 1, wb = b.T.boss ? 0 : 1, s = (wa + wb) || 1;
      a.pos.x -= nx * push * 2 * wa / s; a.pos.z -= nz * push * 2 * wa / s;
      b.pos.x += nx * push * 2 * wb / s; b.pos.z += nz * push * 2 * wb / s;
    }
  }
}

function respawnMob(m) {
  m.dead = false; m.hp = m.maxHp; m.state = 'idle'; m.enraged = false; m.contrib = 0;
  m.pos.copy(m.home); m.root.visible = true; m.model.scale.setScalar(1); m.model.position.y = 0;
  burst(m.pos.x, 0.5, m.pos.z, 0xb9a0ff, 12, 2, 3);
}

function damageMob(m, base, fromWhirl = false) {
  if (m.dead) return;
  let dmg = base * rr(0.88, 1.12);
  const crit = Math.random() < 0.12;
  if (crit) dmg *= 1.8;
  dmg = Math.max(1, Math.round(dmg));
  m.hp -= dmg; m.flash = 0.12; m.lastHit = time;
  floatText(crit ? dmg + '!' : '' + dmg, m.pos, crit ? 'crit' : 'dmg', m.T.height + 0.3);
  burst(m.pos.x, m.T.height * 0.5, m.pos.z, crit ? 0xffae2e : 0xffffff, crit ? 8 : 4, 3, 3, 0.35);
  if (m.state !== 'chase') aggro(m);
  if (!fromWhirl) for (const o of mobs) // стая помогает
    if (o !== m && !o.dead && o.state === 'idle' && o.type === m.type && !o.T.boss && dist(o.pos, m.pos) < 7) aggro(o);
  player.combatT = 0;
  if (m.T.boss) { m.contrib += dmg; net?.sendHit({ b: m.idx, d: dmg }); }
  if (m.hp <= 0) killMob(m);
}

function killMob(m) {
  m.dead = true; m.hp = 0; m.dyingT = 0.6; m.bar.visible = false;
  m.respawnT = m.T.boss ? 150 : rr(14, 22);
  if (player.target === m) player.target = null;
  burst(m.pos.x, 0.8, m.pos.z, m.T.boss ? 0xffcc33 : 0x999999, m.T.boss ? 40 : 12, m.T.boss ? 7 : 3, 5, 0.9);
  const credit = m.T.boss ? m.contrib > 0 : true;
  if (m.T.boss) {
    shake(0.6);
    sys(credit ? `🏆 ${m.T.name} повержен!` : `${m.T.name} повержен другими героями.`);
    if (credit) { floatText('ПОБЕДА!', player.pos, 'big', 3.5, 2.2); net?.sendChat({ t: `⚔ победил босса «${m.T.name}»!` }); }
  }
  if (!credit) return;
  gainXp(Math.round(m.T.xp * (1 + 0.18 * (m.lvl - 1)) * (m.temp ? 0.3 : 1)));
  dropLoot(m);
}

// ============================================================ способности боссов
const telegraphs = [], TG_FILL = new THREE.MeshBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0.28, depthWrite: false });
const TG_RING = new THREE.MeshBasicMaterial({ color: 0xff5030, transparent: true, opacity: 0.9, depthWrite: false });
const CIRCLE = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);

function telegraph(x, z, r, delay, dmg, src, kind = 'slam') {
  const g = new THREE.Group(); g.position.set(x, 0.05, z);
  const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.15, r, 48).rotateX(-Math.PI / 2), TG_RING);
  const fill = new THREE.Mesh(CIRCLE, TG_FILL); fill.scale.setScalar(0.01);
  g.add(ring, fill); scene.add(g);
  let proj = null;
  if (kind === 'rock' || kind === 'meteor') {
    proj = new THREE.Mesh(new THREE.DodecahedronGeometry(kind === 'rock' ? 0.9 : 0.7),
      kind === 'rock' ? M.mat(0x7a7680, { flatShading: true }) : new THREE.MeshBasicMaterial({ color: 0x66ffcc }));
    proj.position.set(x, 30, z); proj.castShadow = true; scene.add(proj);
  }
  telegraphs.push({ g, ring, fill, x, z, r, t: 0, delay, dmg, src, kind, proj });
}
function updateTelegraphs(dt) {
  for (let i = telegraphs.length - 1; i >= 0; i--) {
    const tg = telegraphs[i]; tg.t += dt;
    const k = Math.min(1, tg.t / tg.delay);
    tg.fill.scale.setScalar(tg.r * k);
    if (tg.proj) { tg.proj.position.y = 30 * (1 - k * k) + 0.5; tg.proj.rotation.x += dt * 5; }
    if (k >= 1) {
      scene.remove(tg.g); tg.ring.geometry.dispose();
      if (tg.proj) scene.remove(tg.proj);
      const col = tg.kind === 'meteor' || tg.kind === 'nova' ? 0x66ffcc : tg.kind === 'rock' ? 0x9a948a : 0x7fd67f;
      burst(tg.x, 0.3, tg.z, col, Math.round(10 + tg.r * 4), tg.r * 1.4, 5, 0.7);
      if (dist(tg, player.pos) < tg.r + 10) shake(0.25);
      if (!player.dead && dist(tg, player.pos) < tg.r + 0.3) hurtPlayer(tg.dmg, tg.src);
      telegraphs.splice(i, 1);
    }
  }
}

function bossAbilities(m, dt) {
  if (!m.enraged && m.hp < m.maxHp * 0.5) {
    m.enraged = true; shake(0.4);
    sys(`🔥 ${m.T.name} приходит в ярость!`);
    floatText('ЯРОСТЬ!', m.pos, 'crit', m.T.height + 1, 1.5);
  }
  if ((m.abilityT -= dt) > 0) return;
  m.abilityT = (m.enraged ? 4.2 : 6.5) * rr(0.85, 1.15);
  const px = player.pos.x, pz = player.pos.z;
  switch (pick(m.T.abilities)) {
    case 'slam':
      telegraph(m.pos.x, m.pos.z, 5.5, 1.5, m.dmg * 2.2, m); m.atkAnim = 1; m.atkCd = 1.8; break;
    case 'rocks':
      for (let i = 0; i < (m.enraged ? 5 : 3); i++)
        telegraph(px + (i ? rr(-3.5, 3.5) : 0), pz + (i ? rr(-3.5, 3.5) : 0), 2.4, 1.2 + i * 0.25, m.dmg * 1.6, m, 'rock');
      m.atkAnim = 1; break;
    case 'meteor':
      for (let i = 0; i < (m.enraged ? 7 : 5); i++)
        telegraph(px + (i ? rr(-5, 5) : 0), pz + (i ? rr(-5, 5) : 0), 2.6, 1.1 + i * 0.3, m.dmg * 1.5, m, 'meteor');
      m.atkAnim = 1; break;
    case 'nova':
      telegraph(m.pos.x, m.pos.z, 9, 2.4, m.dmg * 2.6, m, 'nova'); m.atkAnim = 1;
      floatText('Беги!', m.pos, 'hurt', m.T.height + 1); break;
    case 'summon': {
      const adds = mobs.filter(o => o.temp && !o.dead).length;
      if (adds >= 6) break;
      sys(`${m.T.name} призывает прислужников!`);
      for (let i = 0; i < 3; i++) {
        const a = rr(0, 6.28), s = createMob(m.T.summon, Math.max(1, m.lvl - 3), m.pos.x + Math.cos(a) * 3.5, m.pos.z + Math.sin(a) * 3.5, true);
        s.home.copy(m.home); aggro(s);
        burst(s.pos.x, 0.5, s.pos.z, 0x9a5cff, 10, 2, 3);
      }
    }
  }
}

const projectiles = [], BOLT_MAT = new THREE.MeshBasicMaterial({ color: 0x55ffcc }), BOLT_GEO = new THREE.SphereGeometry(0.28, 10, 8);
function fireBolt(m) {
  const mesh = new THREE.Mesh(BOLT_GEO, BOLT_MAT);
  mesh.position.set(m.pos.x, 2.6, m.pos.z); scene.add(mesh);
  const dir = new THREE.Vector3(player.pos.x - m.pos.x, 0, player.pos.z - m.pos.z).normalize();
  projectiles.push({ mesh, dir, speed: 13, life: 1.6, dmg: m.dmg, src: m });
}
function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i]; p.life -= dt;
    p.mesh.position.addScaledVector(p.dir, p.speed * dt);
    p.mesh.position.y = Math.max(1, p.mesh.position.y - dt * 2);
    if (Math.random() < 0.5) burst(p.mesh.position.x, p.mesh.position.y, p.mesh.position.z, 0x55ffcc, 1, 0.5, 0.5, 0.3);
    let done = p.life <= 0;
    if (!done && !player.dead && !player.dashT && dist(p.mesh.position, player.pos) < 0.8) { hurtPlayer(p.dmg, p.src); done = true; }
    if (done) { scene.remove(p.mesh); projectiles.splice(i, 1); }
  }
}

// ============================================================ игрок
const player = {
  name: 'Герой', level: 1, xp: 0, gold: 0, potions: 3, inv: [], equip: { weapon: null, armor: null, ring: null },
  hp: 100, mp: 50, dead: false, target: null, autoChase: false, moveTarget: null, rot: 0,
  atkCd: 0, atkAnim: 0, spinT: 0, dashT: 0, dashDir: new THREE.Vector3(), combatT: 99, flash: 0, pendingNpc: false,
  cd: { whirl: 0, heal: 0, dash: 0, potion: 0 }, st: null,
};
const pRoot = new THREE.Group(), pModel = M.buildHero(0x3b6fd6);
pRoot.add(pModel); scene.add(pRoot);
player.pos = pRoot.position; player.pos.set(2.5, 0, 3.5);
const xpNeed = l => Math.round(60 * Math.pow(l, 1.6));

function recalc() {
  let dmg = 5 + player.level * 3, def = player.level * 1.5, maxHp = 90 + player.level * 20;
  for (const it of Object.values(player.equip)) if (it) { dmg += it.stats.dmg || 0; def += it.stats.def || 0; maxHp += it.stats.hp || 0; }
  player.st = { dmg: Math.round(dmg), def: Math.round(def), maxHp, maxMp: 40 + player.level * 8 };
  player.hp = Math.min(player.hp, maxHp); player.mp = Math.min(player.mp, player.st.maxMp);
}
recalc();

// маркеры: кольцо цели и точка клика
const targetRing = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.05, 40).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xff4040, transparent: true, opacity: 0.85, depthWrite: false }));
targetRing.position.y = 0.06; scene.add(targetRing);
const clickMark = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.45, 24).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x7dff9a, transparent: true, depthWrite: false }));
clickMark.position.y = 0.06; clickMark.visible = false; scene.add(clickMark);

const SKILLS = {
  whirl: { cd: 5, mp: 20 }, heal: { cd: 12, mp: 30 }, dash: { cd: 4, mp: 0 }, potion: { cd: 2, mp: 0 },
};
function useSkill(k) {
  if (!started || player.dead) return;
  const S = SKILLS[k];
  if (player.cd[k] > 0) return;
  if (player.mp < S.mp) { toast('Недостаточно маны'); return; }
  if (k === 'potion') {
    if (player.potions <= 0) { toast('Нет зелий — купи у торговца'); return; }
    if (player.hp >= player.st.maxHp) { toast('Здоровье полное'); return; }
    player.potions--; healPlayer(0.5);
  }
  if (k === 'heal') { healPlayer(0.4); burst(player.pos.x, 1, player.pos.z, 0x5aff7a, 18, 1.5, 5, 0.9); }
  if (k === 'whirl') {
    player.spinT = 0.45;
    ringBurst(player.pos.x, player.pos.z, 1.3, 0xcfe8ff);
    for (const m of [...mobs]) if (!m.dead && dist(m.pos, player.pos) < 3.6 + m.T.radius) damageMob(m, player.st.dmg * 1.6, true);
  }
  if (k === 'dash') {
    const dir = lastMoveDir.lengthSq() > 0 ? lastMoveDir : new THREE.Vector3(Math.sin(player.rot), 0, Math.cos(player.rot));
    player.dashDir.copy(dir).normalize(); player.dashT = 0.18;
    burst(player.pos.x, 0.4, player.pos.z, 0xddeeff, 10, 2, 1.5, 0.4);
  }
  player.mp -= S.mp; player.cd[k] = S.cd;
}
function healPlayer(frac) {
  const a = Math.round(player.st.maxHp * frac);
  player.hp = Math.min(player.st.maxHp, player.hp + a);
  floatText('+' + a, player.pos, 'heal', 2.3);
}

function hurtPlayer(raw, src) {
  if (player.dead || player.dashT > 0) return;
  const dmg = Math.max(1, Math.round(raw * 100 / (100 + player.st.def * 2) * rr(0.9, 1.1)));
  player.hp -= dmg; player.combatT = 0; player.flash = 0.12;
  floatText('-' + dmg, player.pos, 'hurt', 2.2);
  if (src && !src.dead && src.state === 'idle') aggro(src);
  if (player.hp <= 0) die();
}
function die() {
  player.dead = true; player.hp = 0; player.target = null; player.moveTarget = null;
  pRoot.rotation.x = -Math.PI / 2; pRoot.position.y = 0.35;
  sys('☠ Вы погибли.');
  setTimeout(() => $('death').classList.remove('hidden'), 900);
}
function respawnPlayer() {
  const lost = Math.floor(player.gold * 0.1);
  player.gold -= lost;
  player.dead = false; player.hp = player.st.maxHp; player.mp = player.st.maxMp;
  pRoot.rotation.x = 0; player.pos.set(2.5, 0, 3.5);
  $('death').classList.add('hidden');
  if (lost) sys(`Потеряно ${lost} золота.`);
  burst(player.pos.x, 1, player.pos.z, 0xffe8a0, 24, 2, 5, 1);
}

function gainXp(x) {
  player.xp += x;
  floatText(`+${x} опыта`, player.pos, 'xp', 2.8, 1.3);
  while (player.xp >= xpNeed(player.level)) {
    player.xp -= xpNeed(player.level); player.level++;
    recalc(); player.hp = player.st.maxHp; player.mp = player.st.maxMp;
    floatText(`Уровень ${player.level}!`, player.pos, 'big', 3.2, 2);
    ringBurst(player.pos.x, player.pos.z, 1, 0xffe27a, 36);
    burst(player.pos.x, 1, player.pos.z, 0xffe27a, 30, 2, 7, 1.2);
    sys(`✨ Новый уровень: ${player.level}! Урон и здоровье выросли.`);
  }
  save();
}

// ============================================================ лут
const drops = [];
function spawnDrop(pos, data, spread = 1.3) {
  let mesh;
  if (data.kind === 'gold') mesh = M.buildGoldDrop();
  else if (data.kind === 'potion') mesh = M.buildPotionDrop();
  else mesh = M.buildChestDrop(new THREE.Color(RARITY[data.item.rarity].color).getHex(), data.item.rarity >= 2);
  const a = rr(0, 6.28), r = rr(0.4, spread);
  const d = { ...data, mesh, x: pos.x + Math.cos(a) * r, z: pos.z + Math.sin(a) * r, sx: pos.x, sz: pos.z, t: 0 };
  mesh.position.set(d.sx, 1, d.sz); scene.add(mesh); drops.push(d);
}
function dropLoot(m) {
  const f = 1 + 0.15 * (m.lvl - 1), boss = m.T.boss;
  spawnDrop(m.pos, { kind: 'gold', amount: Math.round(rr(...m.T.gold) * f) });
  if (boss) {
    spawnDrop(m.pos, { kind: 'potion', amount: 3 }, 3);
    const n = m.type === 'lich' ? 4 : 3;
    for (let i = 0; i < n; i++) spawnDrop(m.pos, { kind: 'item', item: makeItem(m.lvl + 1, i === 0 && m.type === 'lich' ? 3 : 2, 1.5) }, 3.5);
  } else {
    if (Math.random() < 0.12) spawnDrop(m.pos, { kind: 'potion', amount: 1 });
    if (Math.random() < (m.temp ? 0.08 : 0.24)) spawnDrop(m.pos, { kind: 'item', item: makeItem(m.lvl) });
  }
}
let invFullWarn = 0;
function updateDrops(dt) {
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i]; d.t += dt;
    const k = Math.min(1, d.t / 0.45);
    d.mesh.position.set(d.sx + (d.x - d.sx) * k, 0.05 + Math.sin(k * Math.PI) * 1.4 + (k >= 1 ? Math.sin(time * 3 + i) * 0.06 + 0.06 : 0), d.sz + (d.z - d.sz) * k);
    d.mesh.rotation.y += dt * (d.kind === 'item' ? 0.6 : 2);
    if (d.t > 120) { scene.remove(d.mesh); drops.splice(i, 1); continue; }
    if (player.dead || d.t < 0.5 || dist(d, player.pos) > 1.5) continue;
    if (d.kind === 'gold') { player.gold += d.amount; floatText(`+${d.amount} 🪙`, player.pos, 'gold', 2.5); }
    else if (d.kind === 'potion') { player.potions += d.amount; floatText(`+${d.amount} 🧪`, player.pos, 'heal', 2.5); }
    else {
      if (!addItem(d.item)) { if (time - invFullWarn > 3) { toast('Сумка полна!'); invFullWarn = time; } continue; }
      const r = RARITY[d.item.rarity];
      addChat(`Получено: <span style="color:${r.color}">[${esc(d.item.name)}]</span>`, 'loot');
      if (d.item.rarity >= 3) burst(player.pos.x, 1, player.pos.z, new THREE.Color(r.color).getHex(), 24, 2, 6, 1);
    }
    scene.remove(d.mesh); drops.splice(i, 1);
  }
}

// ============================================================ инвентарь / магазин
let shopOpen = false;
function addItem(it) {
  if (!player.equip[it.slot]) { player.equip[it.slot] = it; recalc(); renderInv(); toast(`Надето: ${it.name}`); return true; }
  if (player.inv.length >= INV_SIZE) return false;
  player.inv.push(it); renderInv(); return true;
}
function equip(it) {
  const i = player.inv.indexOf(it); if (i < 0) return;
  player.inv.splice(i, 1);
  const old = player.equip[it.slot]; if (old) player.inv.push(old);
  player.equip[it.slot] = it; recalc(); renderInv(); save();
}
function unequip(slot) {
  const it = player.equip[slot]; if (!it) return;
  if (player.inv.length >= INV_SIZE) { toast('Сумка полна!'); return; }
  player.equip[slot] = null; player.inv.push(it); recalc(); renderInv(); save();
}
function sell(it) {
  const i = player.inv.indexOf(it); if (i < 0) return;
  player.inv.splice(i, 1); player.gold += it.value;
  toast(`Продано за ${it.value} 🪙`); renderInv(); save();
}
const tip = $('tooltip');
function bindTip(el, it, hint) {
  el.onmouseenter = () => { tip.innerHTML = tooltipHTML(it, player.equip[it.slot], hint()); tip.classList.remove('hidden'); };
  el.onmousemove = e => {
    const x = Math.min(e.clientX + 16, innerWidth - tip.offsetWidth - 8), y = Math.min(e.clientY + 12, innerHeight - tip.offsetHeight - 8);
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  };
  el.onmouseleave = () => tip.classList.add('hidden');
}
function renderInv() {
  tip.classList.add('hidden');
  const eq = $('equip'); eq.innerHTML = '';
  for (const slot of ['weapon', 'armor', 'ring']) {
    const it = player.equip[slot], d = document.createElement('div');
    d.className = 'slot eq';
    if (it) {
      d.style.borderColor = RARITY[it.rarity].color; d.textContent = it.icon;
      d.onclick = () => unequip(slot); bindTip(d, it, () => 'Клик — снять');
    } else d.innerHTML = `<span class="ph">${{ weapon: 'Оружие', armor: 'Доспех', ring: 'Кольцо' }[slot]}</span>`;
    eq.appendChild(d);
  }
  const s = player.st;
  $('stats').innerHTML = `<span>⚔ ${s.dmg}</span><span>🛡 ${s.def}</span><span>❤ ${s.maxHp}</span>`;
  $('inv-count').textContent = `${player.inv.length}/${INV_SIZE}`;
  const grid = $('inv-grid'); grid.innerHTML = '';
  for (let i = 0; i < INV_SIZE; i++) {
    const it = player.inv[i], d = document.createElement('div'); d.className = 'slot';
    if (it) {
      d.textContent = it.icon; d.style.borderColor = RARITY[it.rarity].color;
      d.onclick = e => {
        if (shopOpen) sell(it);
        else if (e.shiftKey) { player.inv.splice(player.inv.indexOf(it), 1); renderInv(); save(); }
        else equip(it);
      };
      bindTip(d, it, () => shopOpen ? `Клик — продать за ${it.value} 🪙` : 'Клик — надеть · Shift+клик — выбросить');
    }
    grid.appendChild(d);
  }
  $('inv-hint').textContent = shopOpen ? 'Клик по предмету — продать' : 'Клик — надеть · Shift+клик — выбросить';
}
function toggleInv(force) {
  const el = $('inventory'), show = force ?? el.classList.contains('hidden');
  el.classList.toggle('hidden', !show); if (show) renderInv(); else tip.classList.add('hidden');
}
function openShop() { shopOpen = true; $('shop').classList.remove('hidden'); toggleInv(true); }
function closeShop() { shopOpen = false; $('shop').classList.add('hidden'); renderInv(); }
function buyPotions(n, price) {
  if (player.gold < price) { toast('Не хватает золота'); return; }
  player.gold -= price; player.potions += n; toast(`Куплено зелий: ${n}`); save();
}
$('buy-1').onclick = () => buyPotions(1, 25);
$('buy-5').onclick = () => buyPotions(5, 110);
$('sell-junk').onclick = () => {
  const junk = player.inv.filter(it => it.rarity <= 1);
  if (!junk.length) { toast('Нечего продавать'); return; }
  const sum = junk.reduce((a, it) => a + it.value, 0);
  player.inv = player.inv.filter(it => it.rarity > 1); player.gold += sum;
  toast(`Продано ${junk.length} предм. за ${sum} 🪙`); renderInv(); save();
};
document.querySelectorAll('[data-close]').forEach(el => el.onclick = () => {
  if (el.dataset.close === 'shop') closeShop(); else toggleInv(false);
});
$('btn-inv').onclick = () => toggleInv();
document.querySelectorAll('.skill[data-skill]').forEach(el => el.onclick = () => useSkill(el.dataset.skill));

// ============================================================ ввод
const keys = {}, mouse = new THREE.Vector2(), raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let mouseHeld = false;
const lastMoveDir = new THREE.Vector3();

function setMouse(e) { mouse.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); }
function groundPoint() {
  raycaster.setFromCamera(mouse, camera);
  const p = new THREE.Vector3();
  return raycaster.ray.intersectPlane(groundPlane, p) ? p : null;
}
function pickMob() {
  raycaster.setFromCamera(mouse, camera);
  for (const h of raycaster.intersectObjects(hitboxes, false)) if (!h.object.userData.mob.dead) return h.object.userData.mob;
  return null;
}
function pickMerchant() { raycaster.setFromCamera(mouse, camera); return raycaster.intersectObject(merchant.hb, false).length > 0; }

const canvas = renderer.domElement;
canvas.addEventListener('pointerdown', e => {
  if (!started || player.dead || e.button !== 0) return;
  setMouse(e); document.activeElement?.blur?.();
  const m = pickMob();
  if (m) { player.target = m; player.autoChase = true; player.moveTarget = null; return; }
  if (pickMerchant()) {
    if (dist(player.pos, merchant.pos) < 3.5) openShop();
    else { player.moveTarget = merchant.pos.clone(); player.pendingNpc = true; }
    return;
  }
  const gp = groundPoint();
  if (gp) {
    player.moveTarget = gp; player.autoChase = false; player.pendingNpc = false; mouseHeld = true;
    clickMark.position.set(gp.x, 0.06, gp.z); clickMark.visible = true; clickMark.scale.setScalar(1.4);
  }
});
addEventListener('pointermove', e => setMouse(e));
addEventListener('pointerup', () => { mouseHeld = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('wheel', e => {
  camera.zoom = clamp(camera.zoom * (e.deltaY > 0 ? 0.9 : 1.1), 0.6, 1.7); camera.updateProjectionMatrix();
}, { passive: true });

function nearestMob(maxD = 14, exclude = null) {
  let best = null, bd = maxD;
  for (const m of mobs) if (!m.dead && m !== exclude) { const d = dist(m.pos, player.pos); if (d < bd) { bd = d; best = m; } }
  return best;
}

const chatInput = $('chat-input');
addEventListener('keydown', e => {
  if (document.activeElement === chatInput) {
    if (e.key === 'Enter') {
      const t = chatInput.value.trim().slice(0, 160);
      if (t) { addChat(`<span class="nm">${esc(player.name)}:</span> ${esc(t)}`); net?.sendChat({ t }); showBubble(selfBubble, t); }
      chatInput.value = ''; chatInput.blur();
    } else if (e.key === 'Escape') chatInput.blur();
    return;
  }
  if (!started) return;
  if (document.activeElement?.tagName === 'INPUT') return;
  keys[e.code] = true;
  switch (e.code) {
    case 'Enter': chatInput.focus(); e.preventDefault(); break;
    case 'Digit1': useSkill('whirl'); break;
    case 'Digit2': useSkill('heal'); break;
    case 'Digit3': case 'ShiftLeft': case 'ShiftRight': useSkill('dash'); break;
    case 'Digit4': case 'KeyR': useSkill('potion'); break;
    case 'KeyI': case 'KeyB': toggleInv(); break;
    case 'KeyH': $('help').classList.toggle('hidden'); break;
    case 'Tab': e.preventDefault(); player.target = nearestMob(20, player.target) || player.target; player.autoChase = false; break;
    case 'Space': e.preventDefault(); { const m = nearestMob(12); if (m) { player.target = m; player.autoChase = true; player.moveTarget = null; } } break;
    case 'Escape':
      if (shopOpen) closeShop(); else if (!$('inventory').classList.contains('hidden')) toggleInv(false); else player.target = null;
      break;
  }
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseHeld = false; });

// ============================================================ апдейт игрока
const pendingHits = [];
function updatePending(dt) {
  for (let i = pendingHits.length - 1; i >= 0; i--) if ((pendingHits[i].t -= dt) <= 0) { const h = pendingHits[i]; pendingHits.splice(i, 1); h.fn(); }
}
function collide(p, r) {
  for (const c of colliders) {
    const dx = p.x - c.x, dz = p.z - c.z, rr2 = c.r + r, d2 = dx * dx + dz * dz;
    if (d2 < rr2 * rr2 && d2 > 1e-8) { const d = Math.sqrt(d2); p.x = c.x + dx / d * rr2; p.z = c.z + dz / d * rr2; }
  }
  const d = Math.hypot(p.x, p.z);
  if (d > WORLD_R) { p.x *= WORLD_R / d; p.z *= WORLD_R / d; }
}

function updatePlayer(dt) {
  for (const k in player.cd) player.cd[k] = Math.max(0, player.cd[k] - dt);
  player.atkCd -= dt; player.atkAnim = Math.max(0, player.atkAnim - dt * 3.2); player.flash -= dt;
  if (player.dead) return;
  const st = player.st, t = player.target;
  if (t && (t.dead || dist(t.pos, player.pos) > 35)) player.target = null;

  const mv = new THREE.Vector3();
  if (document.activeElement !== chatInput) {
    if (keys.KeyW || keys.ArrowUp) mv.add(UP);
    if (keys.KeyS || keys.ArrowDown) mv.sub(UP);
    if (keys.KeyD || keys.ArrowRight) mv.add(RIGHT);
    if (keys.KeyA || keys.ArrowLeft) mv.sub(RIGHT);
  }
  if (mv.lengthSq() > 0) { mv.normalize(); player.moveTarget = null; player.autoChase = false; player.pendingNpc = false; }
  else if (mouseHeld) {
    const gp = groundPoint();
    if (gp) player.moveTarget = gp;
  }
  const tgt = player.target;
  const reach = tgt ? 1.7 + tgt.T.radius : 0;
  if (!mv.lengthSq()) {
    if (tgt && player.autoChase && dist(tgt.pos, player.pos) > reach * 0.9) mv.set(tgt.pos.x - player.pos.x, 0, tgt.pos.z - player.pos.z).normalize();
    else if (player.moveTarget) {
      const d = dist(player.moveTarget, player.pos);
      if (d < 0.15 || (player.pendingNpc && d < 3)) {
        player.moveTarget = null;
        if (player.pendingNpc) { player.pendingNpc = false; openShop(); }
      } else mv.set(player.moveTarget.x - player.pos.x, 0, player.moveTarget.z - player.pos.z).normalize();
    }
  }
  let speed = 6.5;
  if (player.dashT > 0) { player.dashT -= dt; mv.copy(player.dashDir); speed = 36; }
  if (mv.lengthSq() > 0) {
    lastMoveDir.copy(mv);
    player.pos.addScaledVector(mv, speed * dt);
    collide(player.pos, 0.4);
    player.rot = Math.atan2(mv.x, mv.z);
  } else lastMoveDir.set(0, 0, 0);

  // автоатака
  if (tgt && !tgt.dead && dist(tgt.pos, player.pos) <= reach) {
    player.rot = Math.atan2(tgt.pos.x - player.pos.x, tgt.pos.z - player.pos.z);
    if (player.atkCd <= 0) {
      player.atkCd = 0.75; player.atkAnim = 1;
      pendingHits.push({ t: 0.14, fn: () => { if (!tgt.dead && dist(tgt.pos, player.pos) <= reach + 0.8) damageMob(tgt, st.dmg); } });
    }
  }
  // регенерация
  player.combatT += dt;
  const inTown = Math.hypot(player.pos.x, player.pos.z) < TOWN_R;
  if (player.combatT > 5 || inTown) player.hp = Math.min(st.maxHp, player.hp + st.maxHp * (inTown ? 0.15 : 0.04) * dt);
  player.mp = Math.min(st.maxMp, player.mp + (player.combatT > 5 ? 8 : 3) * dt);
  if (shopOpen && dist(player.pos, merchant.pos) > 5) closeShop();

  // анимация
  if (player.spinT > 0) { player.spinT -= dt; pModel.rotation.y += dt * 28; }
  else pModel.rotation.y = lerpAngle(pModel.rotation.y, player.rot, Math.min(1, dt * 14));
  pModel.userData.anim(time, mv.lengthSq() > 0, player.atkAnim);
  const fl = player.flash > 0;
  if (fl !== player._fl) { player._fl = fl; for (const m of pModel.userData.mats) { m.emissive.setRGB(fl ? 1 : 0, 0, 0); m.emissiveIntensity = fl ? 0.6 : 0; } }
}

// ============================================================ сеть
let net = null;
const others = new Map();
const nameColor = n => { let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) >>> 0; return new THREE.Color().setHSL((h % 360) / 360, 0.55, 0.5).getHex(); };
const cleanName = n => String(n || 'Странник').replace(/[\u0000-\u001f]/g, '').slice(0, 16);
function makeLabel(cls) {
  const el = document.createElement('div');
  el.className = 'plabel ' + cls;
  el.innerHTML = '<div class="bubble hidden"></div><div class="pn"></div><div class="pbar"><i></i></div>';
  labelsEl.appendChild(el);
  return { el, bubble: el.firstChild, pn: el.children[1], bar: el.children[2].firstChild, bubbleT: 0 };
}
function showBubble(lb, text) { lb.bubble.textContent = text; lb.bubble.classList.remove('hidden'); lb.bubbleT = 6; }
const selfBubble = makeLabel('self'); selfBubble.pn.remove(); selfBubble.el.querySelector('.pbar').remove();
const merchantLabel = makeLabel('npc'); merchantLabel.pn.textContent = 'Торговец Борис 💰'; merchantLabel.el.querySelector('.pbar').remove();

function onState(id, s) {
  if (!s || typeof s.x !== 'number' || typeof s.z !== 'number') return;
  let o = others.get(id);
  const name = cleanName(s.n);
  if (!o) {
    const root = new THREE.Group(), model = M.buildHero(nameColor(name));
    root.add(model); root.position.set(s.x, 0, s.z); scene.add(root);
    o = { root, model, lb: makeLabel(''), tx: s.x, tz: s.z, rot: 0, atk: 0, spin: 0, last: time };
    others.set(id, o);
    sys(`${name} вошёл в мир.`);
  }
  Object.assign(o, { tx: clamp(s.x, -110, 110), tz: clamp(s.z, -110, 110), rot: +s.r || 0, name, lvl: s.l | 0, hpf: clamp(+s.h || 0, 0, 1), dead: !!s.d, last: time });
  if (s.a && o.atk <= 0) o.atk = 1;
  if (s.w && o.spin <= 0) o.spin = 0.45;
  o.lb.pn.textContent = `${name} [${o.lvl}]`;
}
function removeOther(id) {
  const o = others.get(id); if (!o) return;
  scene.remove(o.root); o.lb.el.remove(); others.delete(id);
  sys(`${o.name} покинул мир.`);
}
function updateOthers(dt) {
  for (const [id, o] of others) {
    if (time - o.last > 15) { removeOther(id); continue; }
    const p = o.root.position, dx = o.tx - p.x, dz = o.tz - p.z, d = Math.hypot(dx, dz);
    if (d > 15) p.set(o.tx, 0, o.tz); else { p.x += dx * Math.min(1, dt * 10); p.z += dz * Math.min(1, dt * 10); }
    o.atk = Math.max(0, o.atk - dt * 3.2);
    if (o.spin > 0) { o.spin -= dt; o.model.rotation.y += dt * 28; }
    else o.model.rotation.y = lerpAngle(o.model.rotation.y, o.rot, Math.min(1, dt * 12));
    o.model.userData.anim(time, d > 0.05, o.atk);
    o.root.rotation.x = o.dead ? -Math.PI / 2 : 0; p.y = o.dead ? 0.35 : 0;
    o.lb.bar.style.width = (o.hpf * 100) + '%';
  }
}
let netTimer = 0;
function netTick(dt) {
  if (!net || (netTimer -= dt) > 0) return;
  netTimer = 0.1;
  net.sendState({ n: player.name, x: +player.pos.x.toFixed(2), z: +player.pos.z.toFixed(2), r: +pModel.rotation.y.toFixed(2),
    l: player.level, h: +(player.hp / player.st.maxHp).toFixed(2), d: player.dead ? 1 : 0, a: player.atkAnim > 0.6 ? 1 : 0, w: player.spinT > 0 ? 1 : 0 });
}
async function startNet() {
  try {
    net = await connectNet({
      onState,
      onJoin: () => {},
      onLeave: id => removeOther(id),
      onChat: (id, d) => {
        const t = String(d?.t ?? '').slice(0, 160); if (!t) return;
        const o = others.get(id), n = o?.name || 'Странник';
        addChat(`<span class="nm">${esc(n)}:</span> ${esc(t)}`);
        if (o) showBubble(o.lb, t);
      },
      onBossHit: (id, d) => { // урон по боссам от других игроков синхронизируется
        const b = bosses[d?.b | 0], dmg = Math.min(+d?.d || 0, 3000);
        if (!b || b.dead || !(dmg > 0)) return;
        b.hp -= dmg; b.lastHit = time;
        if (dist(b.pos, player.pos) < 30) floatText('' + Math.round(dmg), b.pos, 'ally', b.T.height + 0.3);
        if (b.hp <= 0) killMob(b);
      },
    });
    sys('🌐 Подключено к миру. Другие игроки появятся, когда зайдут.');
  } catch (err) {
    console.warn('P2P недоступен', err);
    net = null;
    sys('Сеть недоступна — играем в одиночку.');
  }
}

// ============================================================ HUD
const mapCanvas = $('minimap'), mctx = mapCanvas.getContext('2d');
const MAP_S = 180, MAP_SCALE = 0.86;
const mapBg = document.createElement('canvas'); mapBg.width = mapBg.height = MAP_S;
{
  const bctx = mapBg.getContext('2d'), img = bctx.createImageData(MAP_S, MAP_S), c = new THREE.Color();
  for (let py = 0; py < MAP_S; py++) for (let px = 0; px < MAP_S; px++) {
    const u = (px - MAP_S / 2) / MAP_SCALE, v = (py - MAP_S / 2) / MAP_SCALE;
    const x = (u + v) / Math.SQRT2, z = (v - u) / Math.SQRT2;
    groundColor(x, z, c); const hx = c.getHex(), o = (py * MAP_S + px) * 4;
    img.data[o] = hx >> 16 & 255; img.data[o + 1] = hx >> 8 & 255; img.data[o + 2] = hx & 255; img.data[o + 3] = 255;
  }
  bctx.putImageData(img, 0, 0);
}
const toMap = (x, z) => [MAP_S / 2 + (x - z) / Math.SQRT2 * MAP_SCALE, MAP_S / 2 + (x + z) / Math.SQRT2 * MAP_SCALE];
let mapTimer = 0;
function drawMinimap(dt) {
  if ((mapTimer -= dt) > 0) return; mapTimer = 0.1;
  const c = mctx; c.clearRect(0, 0, MAP_S, MAP_S);
  c.save(); c.beginPath(); c.arc(MAP_S / 2, MAP_S / 2, MAP_S / 2, 0, 7); c.clip();
  c.drawImage(mapBg, 0, 0);
  const dot = (x, z, r, col) => { const [a, b] = toMap(x, z); c.fillStyle = col; c.beginPath(); c.arc(a, b, r, 0, 7); c.fill(); };
  for (const d of drops) dot(d.x, d.z, 1.3, '#ffd84a');
  for (const m of mobs) if (!m.dead && !m.T.boss) dot(m.pos.x, m.pos.z, 1.5, m === player.target ? '#fff' : '#e04040');
  c.font = '13px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  for (const b of bosses) { const [a, bb] = toMap(b.home.x, b.home.z); c.globalAlpha = b.dead ? 0.35 : 1; c.fillText('💀', a, bb); c.globalAlpha = 1; }
  { const [a, b] = toMap(merchant.pos.x, merchant.pos.z); c.fillText('💰', a, b); }
  for (const o of others.values()) dot(o.root.position.x, o.root.position.z, 2.6, '#4fc8ff');
  // игрок — стрелка
  const [px, py] = toMap(player.pos.x, player.pos.z);
  const fx = Math.sin(pModel.rotation.y), fz = Math.cos(pModel.rotation.y);
  const ang = Math.atan2((fx + fz) / Math.SQRT2, (fx - fz) / Math.SQRT2);
  c.translate(px, py); c.rotate(ang);
  c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(6, 0); c.lineTo(-4, 4); c.lineTo(-2, 0); c.lineTo(-4, -4); c.closePath(); c.stroke(); c.fill();
  c.restore();
}

let lastZone = '', zoneTimer = 0;
function updateHUD(dt) {
  const st = player.st;
  $('pf-name').textContent = player.name; $('pf-lvl').textContent = player.level;
  $('hp-fill').style.width = (player.hp / st.maxHp * 100) + '%'; $('hp-text').textContent = `${Math.ceil(player.hp)} / ${st.maxHp}`;
  $('mp-fill').style.width = (player.mp / st.maxMp * 100) + '%'; $('mp-text').textContent = `${Math.floor(player.mp)} / ${st.maxMp}`;
  const need = xpNeed(player.level);
  $('xp-fill').style.width = (player.xp / need * 100) + '%'; $('xp-text').textContent = `${player.xp} / ${need}`;
  $('gold').textContent = player.gold; $('potions').textContent = player.potions; $('potion-count').textContent = player.potions;
  document.querySelectorAll('.skill[data-skill]').forEach(el => {
    const k = el.dataset.skill;
    el.querySelector('.cd').style.height = (player.cd[k] / SKILLS[k].cd * 100) + '%';
    el.classList.toggle('nomana', player.mp < SKILLS[k].mp || (k === 'potion' && !player.potions));
  });
  const t = player.target;
  $('target-frame').classList.toggle('hidden', !t);
  if (t) {
    $('t-name').textContent = t.T.name; $('t-lvl').textContent = t.lvl;
    $('t-fill').style.width = (t.hp / t.maxHp * 100) + '%'; $('t-text').textContent = `${Math.ceil(t.hp)} / ${t.maxHp}`;
  }
  let boss = t?.T.boss ? t : null;
  if (!boss) for (const b of bosses) if (!b.dead && b.state === 'chase' && dist(b.pos, player.pos) < 35) boss = b;
  $('bossbar').classList.toggle('hidden', !boss);
  if (boss) {
    $('boss-name').textContent = `${boss.T.name} · ур. ${boss.lvl}${boss.enraged ? ' · 🔥 ЯРОСТЬ' : ''}`;
    $('boss-fill').style.width = (boss.hp / boss.maxHp * 100) + '%';
    $('boss-text').textContent = `${Math.ceil(boss.hp)} / ${boss.maxHp}`;
  }
  $('online').textContent = net ? `🟢 Онлайн: ${others.size + 1}` : '⚪ Оффлайн';
  const z = zoneAt(player.pos);
  if (z !== lastZone) { lastZone = z; $('zone-banner').textContent = z; $('zone-banner').classList.add('show'); zoneTimer = 3; }
  if ((zoneTimer -= dt) <= 0) $('zone-banner').classList.remove('show');
  if ((toastTimer -= dt) <= 0) $('toast').classList.remove('show');
}

function updateLabels(dt) {
  const place = (lb, p, y) => { const [x, yy] = toScreen(p, y); lb.el.style.transform = `translate(${x}px, ${yy}px) translate(-50%, -100%)`; };
  for (const o of others.values()) {
    place(o.lb, o.root.position, 2.3);
    if (o.lb.bubbleT > 0 && (o.lb.bubbleT -= dt) <= 0) o.lb.bubble.classList.add('hidden');
  }
  place(merchantLabel, merchant.pos, 2.3);
  place(selfBubble, player.pos, 2.2);
  if (selfBubble.bubbleT > 0 && (selfBubble.bubbleT -= dt) <= 0) selfBubble.bubble.classList.add('hidden');
}

// ============================================================ сохранение
function save() {
  if (!started) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ name: player.name, level: player.level, xp: player.xp, gold: player.gold,
      potions: player.potions, inv: player.inv, equip: player.equip }));
  } catch { /* приватный режим */ }
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (!s) return false;
    Object.assign(player, { name: s.name, level: s.level | 0 || 1, xp: s.xp | 0, gold: s.gold | 0, potions: s.potions | 0,
      inv: Array.isArray(s.inv) ? s.inv : [], equip: { weapon: null, armor: null, ring: null, ...s.equip } });
    return true;
  } catch { return false; }
}
addEventListener('beforeunload', save);
setInterval(save, 10000);

// ============================================================ старт
let started = false;
const hasSave = load();
$('name-input').value = hasSave ? player.name : '';
if (hasSave) $('play-btn').textContent = `Продолжить (ур. ${player.level})`;
function start() {
  player.name = cleanName($('name-input').value.trim() || 'Герой' + Math.floor(Math.random() * 1000));
  recalc(); player.hp = player.st.maxHp; player.mp = player.st.maxMp;
  started = true; $('name-input').blur();
  $('start').classList.add('hidden'); $('hud').classList.remove('hidden');
  renderInv(); save();
  sys(`Добро пожаловать в Земли Рассвета, ${player.name}!`);
  sys('Кликай по земле, чтобы идти, по монстру — чтобы атаковать. Боссы отмечены 💀 на карте.');
  startNet();
}
$('play-btn').onclick = start;
$('name-input').addEventListener('keydown', e => { if (e.key === 'Enter') start(); });
$('respawn-btn').onclick = respawnPlayer;

// ============================================================ цикл
let lastT = performance.now(), time = 0, hoverTimer = 0;
const camFocus = new THREE.Vector3().copy(player.pos);

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now(), dt = Math.min((now - lastT) / 1000, 0.05); lastT = now;
  tick(dt);
}
function tick(dt) {
  time += dt;
  if (started) updatePlayer(dt);
  for (const m of [...mobs]) updateMob(m, dt);
  separateMobs();
  updatePending(dt); updateTelegraphs(dt); updateProjectiles(dt); updateDrops(dt); updateParticles(dt); updateOthers(dt);
  for (const a of worldAnims) a(time);
  merchant.model.userData.anim(time, false, 0);

  // маркеры
  const t = player.target;
  targetRing.visible = !!t;
  if (t) { targetRing.position.set(t.pos.x, 0.06, t.pos.z); targetRing.scale.setScalar(t.T.radius + 0.5); targetRing.rotation.y += dt; }
  if (clickMark.visible) { clickMark.scale.multiplyScalar(1 - dt * 3); clickMark.material.opacity = clickMark.scale.x; if (clickMark.scale.x < 0.2) clickMark.visible = false; }

  // камера
  camFocus.lerp(player.pos, Math.min(1, dt * 8)); camFocus.y = 0;
  camera.position.copy(camFocus).add(CAM_OFF);
  if (shakeT > 0) { shakeT -= dt; camera.position.x += rr(-1, 1) * shakeT * 0.8; camera.position.z += rr(-1, 1) * shakeT * 0.8; }
  camera.lookAt(camFocus.x, 0, camFocus.z);
  sun.position.copy(camFocus).add(SUN_OFF); sun.target.position.copy(camFocus);

  renderer.render(scene, camera);
  updateFloats(dt); updateLabels(dt);
  if (started) {
    updateHUD(dt); drawMinimap(dt); netTick(dt);
    if ((hoverTimer -= dt) <= 0) { hoverTimer = 0.08; canvas.style.cursor = pickMob() ? 'crosshair' : pickMerchant() ? 'pointer' : 'default'; }
  }
}
window.game = { player, mobs, bosses, others, recalc, scene, camera, step: (sec = 1) => { for (let i = 0; i < sec * 30; i++) tick(1 / 30); } }; // для отладки из консоли
frame();
