// Генерация предметов
export const RARITY = [
  { name: 'Обычный', color: '#c9c9c9', mult: 1 },
  { name: 'Необычный', color: '#4fdc5a', mult: 1.3 },
  { name: 'Редкий', color: '#4a9dff', mult: 1.7 },
  { name: 'Эпический', color: '#b760ff', mult: 2.2 },
  { name: 'Легендарный', color: '#ff9a2e', mult: 3 },
];
export const SLOT_NAMES = { weapon: 'Оружие', armor: 'Доспех', ring: 'Аксессуар' };
export const STAT_NAMES = { dmg: 'Урон', def: 'Защита', hp: 'Здоровье' };
const ICON = { weapon: '⚔️', armor: '🛡️', ring: '💍' };
const BASES = {
  weapon: ['Меч', 'Топор', 'Клинок', 'Палаш', 'Молот'],
  armor: ['Нагрудник', 'Доспех', 'Панцирь', 'Колет'],
  ring: ['Перстень', 'Амулет', 'Талисман'],
};
const ADJ = [
  ['Потёртый', 'Ржавый', 'Простой'],
  ['Крепкий', 'Добротный', 'Острый'],
  ['Зачарованный', 'Рунный', 'Сияющий'],
  ['Древний', 'Проклятый', 'Небесный'],
  ['Легендарный', 'Мифический', 'Божественный'],
];
const SUFFIX = ['Силы', 'Бури', 'Пламени', 'Теней', 'Льда', 'Королей', 'Дракона', 'Рассвета'];
const pick = a => a[Math.floor(Math.random() * a.length)];
let uid = Date.now() % 1e7;

export function rollRarity(minR = 0, bonus = 0) {
  const w = [60, 28, 9, 2.6, 0.4].map((v, i) => (i < minR ? 0 : v * Math.pow(1 + bonus, i)));
  let r = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < w.length; i++) if ((r -= w[i]) <= 0) return i;
  return w.length - 1;
}

export function makeItem(level, minR = 0, bonus = 0, slot = pick(['weapon', 'armor', 'ring'])) {
  const rar = rollRarity(minR, bonus);
  const m = RARITY[rar].mult, v = () => 0.85 + Math.random() * 0.3;
  const stats = {};
  if (slot === 'weapon') stats.dmg = Math.round((3 + level * 2.2) * m * v());
  if (slot === 'armor') {
    stats.def = Math.round((2 + level * 1.8) * m * v());
    if (rar >= 2) stats.hp = Math.round(level * 4 * m * v());
  }
  if (slot === 'ring') {
    stats.hp = Math.round((10 + level * 6) * m * v());
    if (rar >= 1) stats.dmg = Math.round((1 + level * 0.7) * m * v());
  }
  let name = `${pick(ADJ[rar])} ${pick(BASES[slot]).toLowerCase()}`;
  if (rar >= 2) name += ' ' + pick(SUFFIX);
  return { id: ++uid, slot, rarity: rar, level, name, stats, icon: ICON[slot],
           value: Math.round((4 + level * 3) * (1 + rar * rar * 1.5)) };
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function tooltipHTML(it, equipped, hint) {
  const r = RARITY[it.rarity];
  let h = `<div class="tt-name" style="color:${r.color}">${esc(it.name)}</div>`;
  h += `<div class="tt-sub">${r.name} · ${SLOT_NAMES[it.slot]} · ур. ${it.level}</div>`;
  const keys = new Set([...Object.keys(it.stats), ...Object.keys(equipped?.stats || {})]);
  for (const k of keys) {
    const a = it.stats[k] || 0;
    let diff = '';
    if (equipped && equipped !== it) {
      const d = a - (equipped.stats[k] || 0);
      if (d) diff = ` <span class="${d > 0 ? 'up' : 'down'}">(${d > 0 ? '+' : ''}${d})</span>`;
    }
    if (a || diff) h += `<div>${STAT_NAMES[k]}: <b>${a}</b>${diff}</div>`;
  }
  h += `<div class="tt-val">Цена: ${it.value} 🪙</div>`;
  if (hint) h += `<div class="tt-hint">${hint}</div>`;
  return h;
}
