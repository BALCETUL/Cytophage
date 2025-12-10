const fs = require("fs");
const path = require("path");
const express = require("express");

const app = express();
app.use(express.json());

// --------- НАСТРОЙКИ МИРА ---------
const WORLD_WIDTH = 8000;
const WORLD_HEIGHT = 8000;

const TICK_INTERVAL_MS = 120;
const MS_PER_YEAR = 60 * 60 * 1000; // 1 игровой год = 1 час реального времени
const YEARS_PER_TICK = TICK_INTERVAL_MS / MS_PER_YEAR;

// Еда
const TARGET_FOOD_COUNT = 8000;
const FOOD_HUNGER_GAIN = 6;       // сколько голода восстанавливает один кусочек еды
const SIZE_PER_FOOD = 10;         // сколько очков размера даёт один кусочек еды

// Голод и размер
const MAX_HUNGER = 100;
const BASE_HUNGER_DRAIN = 0.35;   // базовая скорость голодания (в "единицах голода" в год)
const SIZE_HUNGER_FACTOR = 0.0006; // добавка голода от размера (чем больше, тем прожорливее)
const MAX_SIZE_POINTS = 1000;

// Возраст и жизнь
const MIN_LIFESPAN_YEARS = 60;
const MAX_LIFESPAN_YEARS = 100;

// Размножение
const MIN_REPRO_AGE_YEARS = 0.5;  // примерно "Юный" и старше
const BIRTH_COOLDOWN_YEARS = 5;   // раз в 5 лет можно рожать
const BIRTH_HUNGER_COST = 30;     // цена рождения ребёнка в голоде
const CHILD_START_SIZE = 80;
const CHILD_START_HUNGER = 70;

// Движение
const MAX_SPEED = 1.4;
const WANDER_STRENGTH = 0.18;
const FOOD_ATTRACTION = 0.22;
const FRICTION = 0.88;
const VISION_RADIUS = 450;

// Файлы
const WORLD_FILE = path.join(__dirname, "world_state.json");
const EVENTS_FILE = path.join(__dirname, "events.log");
const LINEAGE_FILE = path.join(__dirname, "lineage.json");

// --------- ГЛОБАЛЬНОЕ СОСТОЯНИЕ ---------
let nextBacteriumId = 1;
let nextFamilyId = 1;
let world = {
  width: WORLD_WIDTH,
  height: WORLD_HEIGHT,
};
let bacteria = [];
let food = [];
let stats = {
  tick: 0,
  totalBorn: 0,
  totalDied: 0,
};

// Родословная: id -> запись
let lineage = {};

// --------- УТИЛИТЫ ---------
function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function randomPoint() {
  return {
    x: Math.random() * WORLD_WIDTH,
    y: Math.random() * WORLD_HEIGHT,
  };
}

function randomFamilyColor() {
  const hue = Math.floor(Math.random() * 360);
  const sat = 70 + Math.random() * 20;
  const light = 55 + Math.random() * 10;
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

const FAMILY_NAMES = [
  "Альфа", "Бета", "Гамма", "Дельта", "Эпсилон", "Зета", "Омега",
  "Феникс", "Титаны", "Ветра", "Тени", "Космос", "Спираль",
  "Квант", "Неон", "Пульс", "Стая", "Клан Дюна", "Поток",
  "Пламя", "Химера", "Орбита", "Сингулярность", "Мираж",
  "Север", "Юг", "Восток", "Запад", "Хвост Кометы"
];

const BACTERIA_NAMES = [
  "Луна", "Светик", "Тень", "Яра", "Рекс", "Джино", "Базз", "Флип",
  "Немо", "Дори", "Грут", "Рокко", "Мия", "Кира", "Дино", "Флора",
  "Пиксель", "Космо", "Рататуй", "Симба", "Муфаса", "Нала", "Тимон",
  "Пумба", "Гоку", "Веджита", "Наруто", "Саске", "Луффи", "Зоро",
  "Марио", "Луиджи", "Соник", "Тэйлз", "Крипто", "Феникс", "Ария",
  "Орфей", "Астра", "Нео", "Тринити", "Морфиус", "Лис", "Блик", "Нова",
  "Зета", "Омни", "Флэш", "Шэдоу", "Спайк", "Дрейк", "Лисса", "Волна",
  "Клык", "Спарк", "Искра", "Гроза", "Шторм", "Грог", "Скиф", "Клыксон",
  "Ангел", "Фея", "Титан", "Хантер", "Кибер", "Байт", "Профи"
];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getFamilyNameById(id) {
  const index = (id - 1) % FAMILY_NAMES.length;
  const base = FAMILY_NAMES[index];
  if (id <= FAMILY_NAMES.length) return base;
  return `${base} #${Math.ceil(id / FAMILY_NAMES.length)}`;
}

// --------- РОДОСЛОВНАЯ ---------
function loadLineage() {
  try {
    if (fs.existsSync(LINEAGE_FILE)) {
      const txt = fs.readFileSync(LINEAGE_FILE, "utf8");
      lineage = JSON.parse(txt);
      if (typeof lineage !== "object" || lineage === null) lineage = {};
    } else {
      lineage = {};
    }
    console.log("Lineage loaded, records:", Object.keys(lineage).length);
  } catch (err) {
    console.error("Failed to load lineage:", err);
    lineage = {};
  }
}

function saveLineage() {
  try {
    fs.writeFileSync(LINEAGE_FILE, JSON.stringify(lineage, null, 2));
  } catch (err) {
    console.error("Failed to save lineage:", err);
  }
}

function registerBirth(b, parent) {
  const now = Date.now();
  const rec = {
    id: b.id,
    name: b.name,
    familyId: b.familyId,
    familyName: b.familyName,
    familyColor: b.familyColor,
    generation: b.generation,
    parentId: parent ? parent.id : null,
    childrenIds: [],
    birthTime: now,
    birthTick: stats.tick,
    deathTime: null,
    deathTick: null,
    deathReason: null
  };
  lineage[b.id] = rec;
  if (parent && lineage[parent.id]) {
    lineage[parent.id].childrenIds.push(b.id);
  }
  saveLineage();
}

function registerDeath(b, reason) {
  const rec = lineage[b.id];
  if (rec) {
    rec.deathTime = Date.now();
    rec.deathTick = stats.tick;
    rec.deathReason = reason;
    saveLineage();
  }
}

// --------- СОБЫТИЯ / ЛОГ ---------
function logEvent(type, payload) {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    tick: stats.tick,
    type,
    payload
  });
  fs.appendFile(EVENTS_FILE, line + "\n", () => {});
}

// --------- КЛАСС БАКТЕРИИ ---------
class Bacterium {
  constructor(opts = {}) {
    this.id = opts.id ?? nextBacteriumId++;
    this.name = opts.name ?? pickRandom(BACTERIA_NAMES);
    const p = opts.position ?? randomPoint();
    this.x = opts.x ?? p.x;
    this.y = opts.y ?? p.y;
    this.vx = opts.vx ?? 0;
    this.vy = opts.vy ?? 0;

    this.familyId = opts.familyId ?? nextFamilyId++;
    this.familyName = opts.familyName ?? getFamilyNameById(this.familyId);
    this.familyColor = opts.familyColor ?? randomFamilyColor();

    this.sizePoints = opts.sizePoints ?? 200;
    this.maxSizePoints = MAX_SIZE_POINTS;

    this.hunger = opts.hunger ?? MAX_HUNGER * 0.8;
    this.maxHunger = MAX_HUNGER;

    this.ageYears = opts.ageYears ?? 0;
    this.maxAgeYears = opts.maxAgeYears ?? randRange(MIN_LIFESPAN_YEARS, MAX_LIFESPAN_YEARS);
    this.lastBirthAgeYears = opts.lastBirthAgeYears ?? 0;
    this.generation = opts.generation ?? 0;
    this.childrenCount = opts.childrenCount ?? 0;

    this.isLeader = false; // назначается снаружи каждый тик
  }

  get radius() {
    const base = 4;
    const sizeFactor = this.sizePoints / this.maxSizePoints;
    return base + sizeFactor * 10;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      x: this.x,
      y: this.y,
      vx: this.vx,
      vy: this.vy,
      familyId: this.familyId,
      familyName: this.familyName,
      familyColor: this.familyColor,
      sizePoints: this.sizePoints,
      maxSizePoints: this.maxSizePoints,
      hunger: this.hunger,
      maxHunger: this.maxHunger,
      ageYears: this.ageYears,
      maxAgeYears: this.maxAgeYears,
      lastBirthAgeYears: this.lastBirthAgeYears,
      generation: this.generation,
      childrenCount: this.childrenCount
    };
  }
}

// --------- ЗАГРУЗКА / СОХРАНЕНИЕ МИРА ---------
function loadWorld() {
  try {
    if (!fs.existsSync(WORLD_FILE)) {
      console.log("No world_state.json, starting new world");
      initWorld();
      return;
    }
    const txt = fs.readFileSync(WORLD_FILE, "utf8");
    const data = JSON.parse(txt);

    world = data.world || world;
    nextBacteriumId = data.nextBacteriumId ?? nextBacteriumId;
    nextFamilyId = data.nextFamilyId ?? nextFamilyId;
    stats = data.stats || stats;

    bacteria = (data.bacteria || []).map(bd => {
      const b = new Bacterium();
      Object.assign(b, bd);
      return b;
    });
    food = data.food || [];

    console.log("World state loaded from file, bacteria:", bacteria.length, "food:", food.length);

    // убедимся, что в родословной есть записи для всех живых
    for (const b of bacteria) {
      if (!lineage[b.id]) {
        registerBirth(b, null);
      }
    }
  } catch (err) {
    console.error("Failed to load world state, starting new:", err);
    initWorld();
  }
}

function saveWorld() {
  const data = {
    world,
    nextBacteriumId,
    nextFamilyId,
    stats,
    bacteria: bacteria.map(b => b.toJSON()),
    food
  };
  try {
    fs.writeFileSync(WORLD_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Failed to save world:", err);
  }
}

// --------- ИНИЦИАЛИЗАЦИЯ МИРА ---------
function initWorld() {
  world = { width: WORLD_WIDTH, height: WORLD_HEIGHT };
  bacteria = [];
  food = [];
  stats = { tick: 0, totalBorn: 0, totalDied: 0 };
  nextBacteriumId = 1;
  nextFamilyId = 1;

  const seed = new Bacterium({
    generation: 0,
    sizePoints: 300,
    hunger: MAX_HUNGER * 0.9
  });
  bacteria.push(seed);
  stats.totalBorn++;

  registerBirth(seed, null);
  logEvent("init_seed", { id: seed.id, name: seed.name, familyId: seed.familyId });

  maintainFood();
  saveWorld();
}

// --------- ЕДА ---------
function maintainFood() {
  const need = TARGET_FOOD_COUNT - food.length;
  for (let i = 0; i < need; i++) {
    const p = randomPoint();
    food.push({
      id: `f${Date.now()}_${Math.random().toString(16).slice(2)}`,
      x: p.x,
      y: p.y
    });
  }
}

function tryEatFood(b) {
  const eatRadius = b.radius + 6;
  const eatR2 = eatRadius * eatRadius;
  for (let i = 0; i < food.length; i++) {
    const f = food[i];
    const dx = f.x - b.x;
    const dy = f.y - b.y;
    const dist2 = dx * dx + dy * dy;
    if (dist2 <= eatR2) {
      // съели
      food.splice(i, 1);
      b.hunger = Math.min(b.maxHunger, b.hunger + FOOD_HUNGER_GAIN);
      b.sizePoints = Math.min(b.maxSizePoints, b.sizePoints + SIZE_PER_FOOD);
      return true;
    }
  }
  return false;
}

// --------- ЛОГИКА ТИКА ---------
function updateBacteria(dtYears) {
  // сначала найдём лидеров семей (по возрасту)
  const leadersByFamily = new Map();
  for (const b of bacteria) {
    const current = leadersByFamily.get(b.familyId);
    if (!current || b.ageYears > current.ageYears) {
      leadersByFamily.set(b.familyId, b);
    }
  }
  for (const b of bacteria) {
    b.isLeader = leadersByFamily.get(b.familyId) === b;
  }

  const deadIds = new Set();
  const newBabies = [];

  for (const b of bacteria) {
    // возраст
    b.ageYears += dtYears;

    // голод: базовый + от размера
    const hungerDrainPerYear = BASE_HUNGER_DRAIN + b.sizePoints * SIZE_HUNGER_FACTOR;
    b.hunger -= hungerDrainPerYear * dtYears;
    if (b.hunger < 0) b.hunger = 0;

    // смерть от голода
    if (b.hunger <= 0) {
      deadIds.add(b.id);
      stats.totalDied++;
      logEvent("death", { id: b.id, reason: "hunger" });
      registerDeath(b, "hunger");
      continue;
    }

    // смерть от старости
    if (b.ageYears >= b.maxAgeYears) {
      deadIds.add(b.id);
      stats.totalDied++;
      logEvent("death", { id: b.id, reason: "old_age" });
      registerDeath(b, "old_age");
      continue;
    }

    // движение к ближайшей еде
    let targetFood = null;
    let bestDist2 = Infinity;
    const visionR2 = VISION_RADIUS * VISION_RADIUS;

    for (const f of food) {
      const dx = f.x - b.x;
      const dy = f.y - b.y;
      const dist2 = dx * dx + dy * dy;
      if (dist2 < visionR2 && dist2 < bestDist2) {
        bestDist2 = dist2;
        targetFood = f;
      }
    }

    if (targetFood) {
      const dx = targetFood.x - b.x;
      const dy = targetFood.y - b.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const desiredVx = (dx / dist) * MAX_SPEED;
      const desiredVy = (dy / dist) * MAX_SPEED;
      b.vx += (desiredVx - b.vx) * FOOD_ATTRACTION;
      b.vy += (desiredVy - b.vy) * FOOD_ATTRACTION;
    }

    // небольшой рандом
    b.vx += (Math.random() * 2 - 1) * WANDER_STRENGTH;
    b.vy += (Math.random() * 2 - 1) * WANDER_STRENGTH;

    // трение
    b.vx *= FRICTION;
    b.vy *= FRICTION;

    const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    if (speed > MAX_SPEED) {
      const k = MAX_SPEED / speed;
      b.vx *= k;
      b.vy *= k;
    }

    // обновляем позицию
    b.x += b.vx;
    b.y += b.vy;

    // стены мира (мягкое отталкивание)
    if (b.x < 0) {
      b.x = 0;
      b.vx = Math.abs(b.vx) * 0.5;
    } else if (b.x > WORLD_WIDTH) {
      b.x = WORLD_WIDTH;
      b.vx = -Math.abs(b.vx) * 0.5;
    }
    if (b.y < 0) {
      b.y = 0;
      b.vy = Math.abs(b.vy) * 0.5;
    } else if (b.y > WORLD_HEIGHT) {
      b.y = WORLD_HEIGHT;
      b.vy = -Math.abs(b.vy) * 0.5;
    }

    // попытка съесть еду
    tryEatFood(b);

    // размножение
    const isReproAge = b.ageYears >= MIN_REPRO_AGE_YEARS;
    const hasMaxSize = b.sizePoints >= b.maxSizePoints;
    const isWellFed = b.hunger >= b.maxHunger * 0.9;
    const sinceLastBirth = b.ageYears - b.lastBirthAgeYears;

    if (isReproAge && hasMaxSize && isWellFed && sinceLastBirth >= BIRTH_COOLDOWN_YEARS) {
      // цена рождения
      b.hunger = Math.max(0, b.hunger - BIRTH_HUNGER_COST);
      b.lastBirthAgeYears = b.ageYears;
      b.childrenCount++;

      // ребёнок
      const childPos = {
        x: b.x + randRange(-15, 15),
        y: b.y + randRange(-15, 15),
      };

      const childOpts = {
        position: childPos,
        sizePoints: CHILD_START_SIZE,
        hunger: CHILD_START_HUNGER,
        ageYears: 0,
        lastBirthAgeYears: 0,
        generation: b.generation + 1
      };

      // если родитель — лидер клана, ребёнок может основать новую семью
      if (b.isLeader) {
        childOpts.familyId = nextFamilyId++;
        childOpts.familyName = getFamilyNameById(childOpts.familyId);
        childOpts.familyColor = randomFamilyColor();
      } else {
        childOpts.familyId = b.familyId;
        childOpts.familyName = b.familyName;
        childOpts.familyColor = b.familyColor;
      }

      const child = new Bacterium(childOpts);
      newBabies.push(child);
      stats.totalBorn++;
      logEvent("birth", { id: child.id, parentId: b.id, familyId: child.familyId });
      registerBirth(child, b);
    }
  }

  if (deadIds.size > 0) {
    bacteria = bacteria.filter(b => !deadIds.has(b.id));
  }
  if (newBabies.length > 0) {
    bacteria.push(...newBabies);
  }
}

// --------- ТИК МИРА ---------
let lastTickTime = Date.now();

function tick() {
  const now = Date.now();
  const dtMs = now - lastTickTime;
  lastTickTime = now;

  const dtYears = dtMs * YEARS_PER_TICK / TICK_INTERVAL_MS; // нормируем к базовому шагу
  stats.tick++;

  updateBacteria(dtYears);
  maintainFood();

  // периодическое сохранение
  if (stats.tick % 50 === 0) {
    saveWorld();
  }
}

// --------- API ---------
app.get("/state", (req, res) => {
  // при каждом запросе мы отдаём "плоское" состояние для фронта
  const leadersByFamily = new Map();
  for (const b of bacteria) {
    const current = leadersByFamily.get(b.familyId);
    if (!current || b.ageYears > current.ageYears) {
      leadersByFamily.set(b.familyId, b);
    }
  }

  const bactView = bacteria.map(b => ({
    id: b.id,
    name: b.name,
    x: b.x,
    y: b.y,
    size: b.radius,
    sizePoints: b.sizePoints,
    maxSizePoints: b.maxSizePoints,
    hunger: b.hunger,
    maxHunger: b.maxHunger,
    ageYears: b.ageYears,
    generation: b.generation,
    familyId: b.familyId,
    familyName: b.familyName,
    familyColor: b.familyColor,
    childrenCount: b.childrenCount,
    isLeader: leadersByFamily.get(b.familyId) === b
  }));

  res.json({
    world,
    stats,
    bacteria: bactView,
    food
  });
});

// Вернуть родословную по id бактерии (предки + дети)
app.get("/lineage/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "invalid id" });
  }
  const rec = lineage[id];
  if (!rec) {
    return res.status(404).json({ error: "not found" });
  }
  // найдём предков наверх
  const ancestors = [];
  let current = rec;
  const visited = new Set();
  while (current && current.parentId && !visited.has(current.id)) {
    visited.add(current.id);
    const parent = lineage[current.parentId];
    if (!parent) break;
    ancestors.push(parent);
    current = parent;
  }
  // прямые дети
  const children = (rec.childrenIds || []).map(cid => lineage[cid]).filter(Boolean);

  res.json({
    self: rec,
    ancestors,
    children
  });
});

// Вернуть краткую статистику всех кланов (для будущих UI)
app.get("/families", (req, res) => {
  const families = new Map();
  for (const idStr of Object.keys(lineage)) {
    const rec = lineage[idStr];
    const fid = rec.familyId || 0;
    if (!families.has(fid)) {
      families.set(fid, {
        familyId: fid,
        familyName: rec.familyName,
        familyColor: rec.familyColor,
        totalMembers: 0,
        aliveNow: 0,
        maxGeneration: 0
      });
    }
    const f = families.get(fid);
    f.totalMembers += 1;
    if (!rec.deathTime) {
      f.aliveNow += 1;
    }
    if (rec.generation > f.maxGeneration) {
      f.maxGeneration = rec.generation;
    }
  }

  res.json({
    families: Array.from(families.values())
  });
});

// --------- СТАРТ ---------
loadLineage();
loadWorld();

setInterval(tick, TICK_INTERVAL_MS);

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Cytophage world server with lineage running on port ${PORT}`);
});
