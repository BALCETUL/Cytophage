const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const https = require("https");

const app = express();
app.use(cors());

// ---- FILES ----
const STATE_FILE = path.join(__dirname, "world_state.json");
const EVENTS_FILE = path.join(__dirname, "events.log");

// ---- WORLD SETTINGS ----
const WORLD_WIDTH = 8000;
const WORLD_HEIGHT = 8000;
const TARGET_FOOD_COUNT = 8000;
const TICK_INTERVAL = 80;
const MS_PER_TICK = TICK_INTERVAL;

const MS_PER_YEAR = 60 * 60 * 1000;
const TICKS_PER_YEAR = MS_PER_YEAR / MS_PER_TICK;

const ADULT_AGE_YEARS = 18;
const REPRO_MIN_AGE_YEARS = 0.5;
const BIRTH_COOLDOWN_YEARS = 1;
const MIN_LIFESPAN_YEARS = 60;
const MAX_LIFESPAN_YEARS = 100;

// ---- CLANS (LIMIT + FIXED COLORS) ----
// Максимум кланов: 15. Цвета строго фиксированные (как вы дали).
const MAX_CLANS = 15;
const CLAN_COLORS = [
  "#CD5C5C", "#E9967A", "#DC143C", "#FF0000", "#FFC0CB",
  "#FFA07A", "#FFFF00", "#EE82EE", "#483D8B", "#0000CD",
  "#5F9EA0", "#00FF00", "#20B2AA", "#696969", "#FFFFF0"
];

// ---- COMBAT (HP + DAMAGE) ----
const COMBAT_ATTACK_RANGE = 18;               // дистанция удара
const COMBAT_COOLDOWN_TICKS = 10;             // задержка между атаками
const COMBAT_STRIKES_PER_ATTACK = 5;          // "5 случайных ударов" за атаку
const COMBAT_MIN_DAMAGE = 1;                  // нижняя граница удара
const COMBAT_MAX_DAMAGE = 35;                 // верхняя граница удара (с усилениями)

// ---- INVENTORY (FOOD STORAGE) ----
const FOOD_PARTICLE_MASS_KG = 1;              // 1 частица еды = 1 кг
const CLAN_INVENTORY_BASE_KG = 50;            // стартовая емкость
const CLAN_INVENTORY_MAX_KG = 5000;           // максимум 5 тонн
const CLAN_INVENTORY_PER_MEMBER_KG = 10;      // бонус за каждого члена
const CLAN_INVENTORY_PER_LEADER_YEAR_KG = 5;  // бонус за возраст лидера

// ---- AGGRESSION (WAR CONTROL) ----
const AGGRESSION_MIN_COOLDOWN_YEARS = 4;      // чтобы войны не шли бесконечно
const AGGRESSION_DURATION_YEARS = 0.5;        // длительность "агрессивного" состояния
const PAIR_BATTLE_COOLDOWN_YEARS = 1.0;       // откат боев между одной парой кланов

// Голод
const MAX_HUNGER = 100;
const BASE_HUNGER_DRAIN = 0.01;
const HUNGER_DRAIN_PER_SIZE = 0.00005;
const ORPHAN_HUNGER_DRAIN = 2.0;
const FOOD_HUNGER_GAIN = 5;
const BIRTH_HUNGER_COST = 35;
const MIN_HUNGER_TO_REPRODUCE = 50;

// Размер
const MAX_SIZE_POINTS = 1000;
const SIZE_GAIN_PER_FOOD = 1;
const CHILD_START_SIZE = 20;

// ---- РАДИУС КЛАНА (РАСТЕТ С РАЗМЕРОМ ЛИДЕРА!) ----
const CLAN_RADIUS_MIN = 40;           // Минимальный радиус (лидер 20/1000)
const CLAN_RADIUS_MAX = 500;          // Максимальный радиус (лидер 1000/1000 + много членов)
const CLAN_RADIUS_LEADER_GROWTH = 260; // Рост от размера лидера (от 40 до 300)
const CLAN_RADIUS_PER_SQRT_MEMBER = 12; // Бонус от количества членов

// Стена круга
const CLAN_EDGE_SOFT_ZONE = 0.85;
const CLAN_EDGE_PULL = 0.2;

// Преемник
const SUCCESSION_AGE_THRESHOLD = 0.8;

// ---- САМОПИНГ ----
const SERVER_URL = process.env.RENDER_EXTERNAL_URL || 'https://cytophage.onrender.com';
const PING_INTERVAL = 10 * 60 * 1000;
let pingCount = 0;
let lastPingTime = null;

function selfPing() {
  const pingTime = new Date().toISOString();
  https.get(`${SERVER_URL}/ping`, (res) => {
    pingCount++;
    lastPingTime = pingTime;
    console.log(`✅ Self-ping #${pingCount} at ${pingTime} | Status: ${res.statusCode}`);
  }).on('error', (e) => {
    console.error(`❌ Self-ping failed:`, e.message);
  });
}

// ---- RANDOM ----
function randRange(min, max) {
  return Math.random() * (max - min) + min;
}

function randInt(min, max) {
  return Math.floor(randRange(min, max + 1));
}

// ---- ИМЕНА ----
const NAMES_LIST = [
  "Leonardo DiCaprio","Brad Pitt","Johnny Depp","Tom Hardy","Christian Bale",
  "Joaquin Phoenix","Robert De Niro","Al Pacino","Gary Oldman","Matt Damon",
  "Keanu Reeves","Hugh Jackman","Ryan Gosling","Ryan Reynolds","Jake Gyllenhaal",
  "Edward Norton","Samuel L. Jackson","Scarlett Johansson","Natalie Portman",
  "Emma Stone","Anne Hathaway","Morgan Freeman","Denzel Washington","Tom Hanks",
  "Keira Knightley","Kate Winslet","Jennifer Lawrence","Charlize Theron","Gal Gadot",
  "Mickey Mouse","Donald Duck","Goofy","Bugs Bunny","Daffy Duck",
  "SpongeBob","Patrick Star","Squidward","Naruto Uzumaki","Sasuke Uchiha",
  "Son Goku","Vegeta","Luffy","Zoro","Nami",
  "Shrek","Fiona","Donkey","Woody","Buzz Lightyear",
  "Simba","Mufasa","Scar","Timon","Pumbaa",
  "Lionel Messi","Cristiano Ronaldo","Neymar","Kylian Mbappé","Erling Haaland",
  "Robert Lewandowski","Luka Modrić","Kevin De Bruyne","Mohamed Salah","Harry Kane"
];

function getRandomName() {
  return NAMES_LIST[Math.floor(Math.random() * NAMES_LIST.length)];
}

const COLONY_NAMES = [
  "Альфа","Бета","Гамма","Дельта","Эхо","Омега","Титаны","Стражи","Стая","Легион",
  "Искры","Пламя","Луна","Солнце","Тени","Волки","Ястребы","Космос","Гроза","Мираж"
];

// Имена кланов ограничиваем до 15 (как лимит кланов)
const CLAN_NAMES = COLONY_NAMES.slice(0, MAX_CLANS);

function getColonyNameById(id) {
  if (id >= 1 && id <= COLONY_NAMES.length) {
    return COLONY_NAMES[id - 1];
  }
  return "Бродяги-" + id;
}

// ---- FAMILY SYSTEM ----
// nextFamilyId оставляем для совместимости со старым состоянием, но теперь
// ID кланов строго 1..15 и переиспользуются, если клан полностью вымер.
let nextFamilyId = MAX_CLANS + 1;

// Состояние кланов: инвентарь, емкость, агрессия, и т.д.
let clanMeta = new Map();            // familyId -> { inventoryKg, capacityKg, aggressiveUntilTick, lastAggressiveTick, isImperial }
let pairWarState = new Map();        // "a-b" -> { activeUntilTick, cooldownUntilTick }

function getActiveClanIds() {
  const ids = new Set();
  for (const b of bacteriaArray) {
    if (b.familyId) ids.add(b.familyId);
  }
  return ids;
}

function isClanLimitReached() {
  return getActiveClanIds().size >= MAX_CLANS;
}

function ensureClanMeta(familyId) {
  if (!familyId) return null;
  const existing = clanMeta.get(familyId);
  if (existing) return existing;
  const meta = {
    inventoryKg: 0,
    capacityKg: CLAN_INVENTORY_BASE_KG,
    aggressiveUntilTick: 0,
    lastAggressiveTick: -Infinity,
    isImperial: false
  };
  clanMeta.set(familyId, meta);
  return meta;
}

function createFamily() {
  const used = getActiveClanIds();
  let id = null;
  for (let i = 1; i <= MAX_CLANS; i++) {
    if (!used.has(i)) { id = i; break; }
  }
  if (!id) return null;

  const color = CLAN_COLORS[id - 1] || "#58a6ff";
  const name = CLAN_NAMES[id - 1] || getColonyNameById(id);
  ensureClanMeta(id);
  return { familyId: id, familyColor: color, familyName: name };
}

// ---- GLOBAL STATE ----
let world = { width: WORLD_WIDTH, height: WORLD_HEIGHT };
let nextBacteriaId = 1;
let nextFoodId = 1;
let bacteriaArray = [];
let foodArray = [];
let familyCircles = new Map();

let stats = {
  startedAt: new Date().toISOString(),
  lastSavedAt: null,
  totalBorn: 0,
  totalDied: 0,
  tickCount: 0
};

let childrenMap = new Map();

// ---- РАСЧЕТ РАДИУСА КЛАНА (РАСТЕТ С РАЗМЕРОМ ЛИДЕРА) ----
function computeClanRadius(memberCount, leaderSizePoints = 20) {
  // Фактор роста лидера: от 0 (при 20/1000) до 1 (при 1000/1000)
  const leaderGrowthFactor = Math.max(0, Math.min(1, (leaderSizePoints - 20) / (MAX_SIZE_POINTS - 20)));
  
  // Базовый радиус растет с размером лидера
  const baseRadius = CLAN_RADIUS_MIN + leaderGrowthFactor * CLAN_RADIUS_LEADER_GROWTH;
  
  // Бонус от количества членов клана
  const memberBonus = Math.sqrt(Math.max(1, memberCount)) * CLAN_RADIUS_PER_SQRT_MEMBER;
  
  // Итоговый радиус с ограничением
  const totalRadius = baseRadius + memberBonus;
  return Math.min(CLAN_RADIUS_MAX, totalRadius);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// ---- AGE->POWER CURVE ----
// До 40 лет сила/HP растут, после 40 — быстрое старение и ослабление.
function agePowerFactor(ageYears) {
  const a = Math.max(0, ageYears || 0);
  // дети/юные
  if (a < ADULT_AGE_YEARS) {
    return 0.35 + 0.65 * (a / ADULT_AGE_YEARS); // 0.35..1.0
  }
  // пик силы к 40
  if (a <= 40) {
    return 1.0 + 0.35 * ((a - ADULT_AGE_YEARS) / (40 - ADULT_AGE_YEARS)); // 1.0..1.35
  }
  // после 40 — экспоненциальное ослабление
  const decay = Math.exp(-(a - 40) / 16);
  return Math.max(0.15, 1.35 * decay);
}

function computeClanInventoryCapacityKg(memberCount, leaderAgeYears, isImperial) {
  const members = Math.max(1, memberCount || 1);
  const age = Math.max(0, leaderAgeYears || 0);
  const base = CLAN_INVENTORY_BASE_KG;
  const byMembers = (members - 1) * CLAN_INVENTORY_PER_MEMBER_KG;
  const byAge = age * CLAN_INVENTORY_PER_LEADER_YEAR_KG;
  const imperialBonus = isImperial ? 250 : 0;
  return Math.min(CLAN_INVENTORY_MAX_KG, Math.round(base + byMembers + byAge + imperialBonus));
}

function computeCombatStats(b, clanIsImperial) {
  const age = b.ageYears || 0;
  const pow = agePowerFactor(age);
  const sizeFactor = 0.6 + 0.4 * ((b.sizePoints || 0) / (b.maxSizePoints || MAX_SIZE_POINTS));
  const imperial = clanIsImperial ? 1.15 : 1.0;

  // HP
  const maxHp = Math.round((60 + 110 * pow) * sizeFactor * imperial);

  // Урон: диапазон + 5 ударов
  const minD = clamp(Math.round((COMBAT_MIN_DAMAGE + 3 * pow) * imperial), 1, COMBAT_MAX_DAMAGE);
  const maxD = clamp(Math.round((6 + 14 * pow) * sizeFactor * imperial), minD, COMBAT_MAX_DAMAGE);

  return { maxHp, minD, maxD };
}

function rebuildFamilyCircles() {
  const tmp = new Map();
  
  for (const b of bacteriaArray) {
    const famId = b.familyId || 0;
    const rec = tmp.get(famId) || { 
      familyId: famId, 
      memberCount: 0, 
      leaderId: null, 
      leaderX: 0, 
      leaderY: 0,
      leaderSizePoints: 20,
      leaderAgeYears: 0
    };
    rec.memberCount += 1;
    
    if (b.isLeader) {
      rec.leaderId = b.id;
      rec.leaderX = b.x;
      rec.leaderY = b.y;
      rec.leaderSizePoints = b.sizePoints || 20;
      rec.leaderAgeYears = b.ageYears || 0;
    }
    tmp.set(famId, rec);
  }

  for (const [famId, rec] of tmp.entries()) {
    if (rec.leaderId == null) continue;
    rec.radius = computeClanRadius(rec.memberCount, rec.leaderSizePoints);
    rec.isImperial = (rec.radius >= CLAN_RADIUS_MAX);

    // meta (инвентарь, емкость, агрессия)
    const meta = ensureClanMeta(famId);
    if (meta) {
      meta.isImperial = !!rec.isImperial;
      meta.capacityKg = computeClanInventoryCapacityKg(rec.memberCount, rec.leaderAgeYears, rec.isImperial);
      rec.inventoryKg = meta.inventoryKg;
      rec.capacityKg = meta.capacityKg;
      rec.isAggressive = stats.tickCount < (meta.aggressiveUntilTick || 0);
    }
    tmp.set(famId, rec);
  }

  // Удаляем мету кланов, которые полностью вымерли
  const active = new Set([...tmp.keys()].filter(id => id && id > 0));
  for (const id of [...clanMeta.keys()]) {
    if (!active.has(id)) clanMeta.delete(id);
  }
  // чистим войны по вымершим кланам
  for (const key of [...pairWarState.keys()]) {
    const [aStr, bStr] = key.split("-");
    const a = parseInt(aStr, 10);
    const b = parseInt(bStr, 10);
    if (!active.has(a) || !active.has(b)) pairWarState.delete(key);
  }

  familyCircles = tmp;
}

function getFamilyCircle(familyId) {
  return familyCircles.get(familyId || 0) || null;
}

// ---- ENTITIES ----
class FoodParticle {
  constructor(x, y) {
    this.id = nextFoodId++;
    this.x = x;
    this.y = y;
  }
}

class Cytophage {
  constructor(x, y, options = {}) {
    const {
      generation = 0,
      parentId = null,
      familyId = null,
      familyColor = null,
      familyName = null,
      ageTicks = 0,
      hunger = MAX_HUNGER * 0.5,
      lifespanYears = null,
      lastBirthYear = 0,
      childrenCount = 0,
      sizePoints = 20,
      hasBranched = false,
      hp = null,
      lastAttackTick = 0
    } = options;

    this.id = nextBacteriaId++;
    this.name = getRandomName();
    this.x = x;
    this.y = y;
    this.vx = randRange(-0.05, 0.05);
    this.vy = randRange(-0.05, 0.05);
    this.maxSpeed = 1.2;
    this.acceleration = 0.05;
    this.friction = 0.98;
    this.ageTicks = ageTicks;
    this.lifespanYears = lifespanYears ?? randRange(MIN_LIFESPAN_YEARS, MAX_LIFESPAN_YEARS);
    this.lastBirthYear = lastBirthYear;
    this.childrenCount = childrenCount;

    if (familyId) {
      // цвет/имя фиксированные по ID
      this.familyId = clamp(familyId, 1, MAX_CLANS);
      this.familyColor = CLAN_COLORS[this.familyId - 1] || "#58a6ff";
      this.familyName = CLAN_NAMES[this.familyId - 1] || getColonyNameById(this.familyId);
      ensureClanMeta(this.familyId);
    } else {
      const fam = createFamily();
      if (fam) {
        this.familyId = fam.familyId;
        this.familyColor = fam.familyColor;
        this.familyName = fam.familyName;
      } else {
        // если кланы заполнены, привязываем к первому клану
        this.familyId = 1;
        this.familyColor = CLAN_COLORS[0] || "#58a6ff";
        this.familyName = CLAN_NAMES[0] || getColonyNameById(1);
      }
      ensureClanMeta(this.familyId);
    }

    this.generation = generation;
    this.parentId = parentId;
    this.hunger = hunger;
    this.maxHunger = MAX_HUNGER;
    this.sizePoints = sizePoints;
    this.maxSizePoints = MAX_SIZE_POINTS;
    this.size = 3;
    this.visionRadius = 500;
    this.isLeader = false;
    this.hasBranched = !!hasBranched;
    this.isSuccessor = false;
    this.isOrphaned = false;
    this.childrenAlive = 0;
    this.childrenDead = 0;

    // ---- COMBAT STATS ----
    const cs = computeCombatStats(this, false);
    this.maxHp = cs.maxHp;
    this.hp = hp == null ? this.maxHp : clamp(Math.round(hp), 1, this.maxHp);
    this.minDamage = cs.minD;
    this.maxDamage = cs.maxD;
    this.lastAttackTick = lastAttackTick || 0;

    stats.totalBorn += 1;
    
    if (parentId) {
      if (!childrenMap.has(parentId)) {
        childrenMap.set(parentId, new Set());
      }
      childrenMap.get(parentId).add(this.id);
    }

    logEvent({
      type: "birth",
      id: this.id,
      parentId: this.parentId,
      generation: this.generation,
      familyId: this.familyId,
      time: new Date().toISOString()
    });
  }

  get ageYears() {
    return this.ageTicks / TICKS_PER_YEAR;
  }

  get isAdult() {
    return this.ageYears >= ADULT_AGE_YEARS;
  }
}

// ---- PERSISTENCE ----
function saveState() {
  const data = {
    world,
    nextBacteriaId,
    nextFoodId,
    nextFamilyId,
    clanMeta: Array.from(clanMeta.entries()),
    pairWarState: Array.from(pairWarState.entries()),
    bacteria: bacteriaArray,
    food: foodArray,
    stats: { ...stats, lastSavedAt: new Date().toISOString() }
  };
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2), "utf-8");
    stats.lastSavedAt = data.stats.lastSavedAt;
  } catch (err) {
    console.error("Error saving state:", err);
  }
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    console.log("No state file, init new world");
    initWorld();
    saveState();
    return;
  }
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf-8");
    const data = JSON.parse(raw);

    // загрузка меты (если была) + безопасные дефолты
    clanMeta = new Map(Array.isArray(data.clanMeta) ? data.clanMeta : []);
    pairWarState = new Map(Array.isArray(data.pairWarState) ? data.pairWarState : []);

    // жесткий лимит кланов: если в сохранении их больше 15 — стартуем новый мир
    const uniqueClans = new Set((data.bacteria || []).map(b => b.familyId).filter(Boolean));
    if (uniqueClans.size > MAX_CLANS) {
      console.warn(`⚠️ Saved state has ${uniqueClans.size} clans (> ${MAX_CLANS}). Resetting world to comply with limit.`);
      initWorld();
      saveState();
      return;
    }

    world = data.world || world;
    nextBacteriaId = data.nextBacteriaId || 1;
    nextFoodId = data.nextFoodId || 1;
    nextFamilyId = MAX_CLANS + 1;
    stats = { ...stats, ...data.stats };

    bacteriaArray = (data.bacteria || []).map(b => {
      const opts = {
        generation: b.generation ?? 0,
        parentId: b.parentId ?? null,
        familyId: b.familyId ?? null,
        // цвет/имя клана теперь фиксированные — перекрываем при загрузке
        familyColor: null,
        familyName: null,
        ageTicks: b.ageTicks ?? 0,
        hunger: Math.max(0, Math.min(MAX_HUNGER, b.hunger ?? MAX_HUNGER * 0.5)),
        lifespanYears: b.lifespanYears ?? randRange(MIN_LIFESPAN_YEARS, MAX_LIFESPAN_YEARS),
        lastBirthYear: b.lastBirthYear ?? 0,
        childrenCount: b.childrenCount ?? 0,
        sizePoints: b.sizePoints ?? 20,
        hasBranched: b.hasBranched ?? false,
        hp: b.hp ?? null,
        lastAttackTick: b.lastAttackTick ?? 0
      };
      const c = new Cytophage(b.x ?? 0, b.y ?? 0, opts);
      c.id = b.id;
      c.name = b.name ?? c.name;
      c.vx = b.vx ?? c.vx;
      c.vy = b.vy ?? c.vy;
      c.size = b.size ?? c.size;
      c.visionRadius = b.visionRadius ?? c.visionRadius;
      c.isLeader = b.isLeader ?? false;
      c.isSuccessor = b.isSuccessor ?? false;
      c.isOrphaned = b.isOrphaned ?? false;
      c.childrenAlive = b.childrenAlive ?? 0;
      c.childrenDead = b.childrenDead ?? 0;
      // фиксируем цвета/имена кланов (и мету)
      if (c.familyId) {
        if (c.familyId < 1 || c.familyId > MAX_CLANS) {
          c.familyId = 1;
        }
        c.familyColor = CLAN_COLORS[c.familyId - 1] || "#58a6ff";
        c.familyName = CLAN_NAMES[c.familyId - 1] || getColonyNameById(c.familyId);
        ensureClanMeta(c.familyId);
      }
      return c;
    });

    foodArray = (data.food || []).map(f => {
      const fp = new FoodParticle(f.x, f.y);
      fp.id = f.id;
      return fp;
    });

    const maxBId = bacteriaArray.reduce((m, b) => Math.max(m, b.id), 0);
    const maxFId = foodArray.reduce((m, f) => Math.max(m, f.id), 0);
    nextBacteriaId = Math.max(nextBacteriaId, maxBId + 1);
    nextFoodId = Math.max(nextFoodId, maxFId + 1);

    nextFamilyId = MAX_CLANS + 1;

    rebuildChildrenMap();

    console.log("World state loaded from file");
  } catch (err) {
    console.error("Error loading state:", err);
    initWorld();
    saveState();
  }
}

// ---- КАРТА ДЕТЕЙ ----
function rebuildChildrenMap() {
  childrenMap.clear();
  for (const b of bacteriaArray) {
    if (b.parentId) {
      if (!childrenMap.has(b.parentId)) {
        childrenMap.set(b.parentId, new Set());
      }
      childrenMap.get(b.parentId).add(b.id);
    }
  }
}

function updateChildrenStats() {
  for (const b of bacteriaArray) {
    const children = childrenMap.get(b.id);
    if (!children) {
      b.childrenAlive = 0;
      continue;
    }
    
    let alive = 0;
    for (const childId of children) {
      const child = bacteriaArray.find(c => c.id === childId);
      if (child) alive++;
    }
    
    b.childrenAlive = alive;
    b.childrenDead = children.size - alive;
  }
}

// ---- EVENT LOG ----
function logEvent(obj) {
  const line = JSON.stringify(obj) + "\n";
  try {
    fs.appendFileSync(EVENTS_FILE, line, "utf-8");
  } catch (err) {
    console.error("Error writing event:", err);
  }
}

// ---- WORLD INIT ----
function spawnFoodRandom() {
  const x = randRange(0, world.width);
  const y = randRange(0, world.height);
  foodArray.push(new FoodParticle(x, y));
}

function initWorld() {
  world = { width: WORLD_WIDTH, height: WORLD_HEIGHT };
  bacteriaArray = [];
  foodArray = [];
  nextBacteriaId = 1;
  nextFoodId = 1;
  nextFamilyId = 1;
  childrenMap.clear();

  const startX = world.width / 2;
  const startY = world.height / 2;
  bacteriaArray.push(new Cytophage(startX, startY, { generation: 0, parentId: null }));

  for (let i = 0; i < TARGET_FOOD_COUNT; i++) {
    spawnFoodRandom();
  }
}

// ---- HELPERS ----
function distanceSq(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

// ---- FOOD LOGIC ----
function maintainFood() {
  while (foodArray.length < TARGET_FOOD_COUNT) {
    spawnFoodRandom();
  }
}

// ---- FAMILY LEADERS ----
function updateFamilyLeaders() {
  const bestByFamily = new Map();

  for (const b of bacteriaArray) {
    const famId = b.familyId || 0;
    const age = b.ageYears;
    const rec = bestByFamily.get(famId);
    if (!rec || age > rec.ageYears) {
      bestByFamily.set(famId, { id: b.id, ageYears: age });
    }
  }

  for (const b of bacteriaArray) {
    const famId = b.familyId || 0;
    const info = bestByFamily.get(famId);
    const wasLeader = b.isLeader;
    b.isLeader = info ? info.id === b.id : false;
    
    if (!wasLeader && b.isLeader) {
      b.isSuccessor = false;
    }
  }
}

function isMaxSize(b) {
  return (b.sizePoints || 0) >= (b.maxSizePoints || MAX_SIZE_POINTS);
}

function maybeBranchAdult(b) {
  if (b.isLeader) return;
  if (!isMaxSize(b)) return;
  if (b.hasBranched) return;

  // Если кланы заполнены (15/15), никто не может выйти из круга через создание нового клана.
  if (isClanLimitReached()) return;

  const fam = createFamily();
  if (!fam) return;
  b.familyId = fam.familyId;
  b.familyColor = fam.familyColor;
  b.familyName = fam.familyName;
  b.isLeader = true;
  b.hasBranched = true;
  b.isSuccessor = false;
  b.isOrphaned = false;
  
  console.log(`👑 ${b.name} создал новый клан: ${b.familyName}`);
}

// ---- ВЫБОР ПРЕЕМНИКА ----
function maybeSelectSuccessor(leader) {
  if (!leader.isLeader) return;
  
  const ageRatio = leader.ageYears / leader.lifespanYears;
  if (ageRatio < SUCCESSION_AGE_THRESHOLD) return;
  
  const hasSuccessor = bacteriaArray.some(b => 
    b.familyId === leader.familyId && 
    b.isSuccessor && 
    b.id !== leader.id
  );
  if (hasSuccessor) return;
  
  const candidates = bacteriaArray.filter(b => 
    b.familyId === leader.familyId && 
    b.id !== leader.id && 
    !b.isLeader &&
    isMaxSize(b)
  );
  
  if (candidates.length === 0) return;
  
  candidates.sort((a, b) => b.ageYears - a.ageYears);
  const successor = candidates[0];
  
  successor.isSuccessor = true;
  console.log(`⭐ ${leader.name} выбрал преемником ${successor.name}`);
}

// ---- ПРОВЕРКА СИРОТ ----
function markOrphans() {
  const clansWithLeaders = new Set();
  for (const b of bacteriaArray) {
    if (b.isLeader) {
      clansWithLeaders.add(b.familyId);
    }
  }
  
  for (const b of bacteriaArray) {
    if (b.isLeader) continue;
    if (isMaxSize(b)) continue;
    
    const hasLeader = clansWithLeaders.has(b.familyId);
    if (!hasLeader && !b.isOrphaned) {
      b.isOrphaned = true;
      console.log(`💀 ${b.name} стал сиротой`);
    }
  }
}

// ---- ФИЗИКА СТОЛКНОВЕНИЙ ----
function handleCollisions(b) {
  if (b.isLeader) return;
  
  let collisionX = 0;
  let collisionY = 0;

  for (const other of bacteriaArray) {
    if (other === b || !other) continue;

    const dx = b.x - other.x;
    const dy = b.y - other.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < 0.01) continue;

    const dist = Math.sqrt(distSq);
    const minDist = b.size + other.size + 1;
    const collisionRadius = minDist * 2;

    if (dist < collisionRadius && dist > 0.01) {
      const overlap = collisionRadius - dist;
      const strength = (1 / Math.pow(dist, 1.2)) * overlap * 8;
      
      const nx = dx / dist;
      const ny = dy / dist;

      if (other.isLeader && other.familyId === b.familyId) {
        collisionX += nx * strength * 2;
        collisionY += ny * strength * 2;
      } else {
        collisionX += nx * strength;
        collisionY += ny * strength;
      }
    }
  }

  const collisionStrength = 0.12;
  b.vx += collisionX * collisionStrength;
  b.vy += collisionY * collisionStrength;
}

// ---- СТЕНА КРУГА КЛАНА ----
function enforceClanWalls() {
  for (const b of bacteriaArray) {
    maybeBranchAdult(b);

    if (b.isLeader) continue;
    if (isMaxSize(b)) continue;

    const rec = getFamilyCircle(b.familyId);
    if (!rec || rec.leaderId == null) continue;

    const dx = b.x - rec.leaderX;
    const dy = b.y - rec.leaderY;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const r = rec.radius || computeClanRadius(rec.memberCount || 1, rec.leaderSizePoints || 20);

    if (dist > r * CLAN_EDGE_SOFT_ZONE && dist <= r) {
      const ux = dx / dist;
      const uy = dy / dist;
      b.vx -= ux * CLAN_EDGE_PULL;
      b.vy -= uy * CLAN_EDGE_PULL;
    }

    if (dist <= r) continue;

    const ux = dx / dist;
    const uy = dy / dist;
    b.x = rec.leaderX + ux * r;
    b.y = rec.leaderY + uy * r;

    const outward = b.vx * ux + b.vy * uy;
    if (outward > 0) {
      b.vx -= outward * ux;
      b.vy -= outward * uy;
    }
    b.vx *= 0.9;
    b.vy *= 0.9;
  }
}

function feedFamilyFromLeader(leader) {
  const rec = getFamilyCircle(leader.familyId);
  if (!rec || rec.leaderId == null) return;
  const r = rec.radius || computeClanRadius(rec.memberCount || 1, rec.leaderSizePoints || 20);
  const rSq = r * r;

  for (const other of bacteriaArray) {
    if (other.familyId !== leader.familyId) continue;
    if (other.id === leader.id) continue;
    const dSq = distanceSq(other.x, other.y, rec.leaderX, rec.leaderY);
    if (dSq > rSq) continue;

    other.hunger += FOOD_HUNGER_GAIN;
    if (other.hunger > other.maxHunger) other.hunger = other.maxHunger;
    other.sizePoints = (other.sizePoints || 0) + SIZE_GAIN_PER_FOOD;
    if (other.sizePoints > other.maxSizePoints) other.sizePoints = other.maxSizePoints;
  }
}

// ---- ПОИСК ЕДЫ ----
function findBestFoodFor(b) {
  let bestFood = null;
  let bestScore = Infinity;
  const visionRadiusSq = b.visionRadius * b.visionRadius;

  for (const food of foodArray) {
    const distSq = distanceSq(b.x, b.y, food.x, food.y);
    if (distSq > visionRadiusSq) continue;
    const dist = Math.sqrt(distSq);

    let familyBonus = 0;
    for (const other of bacteriaArray) {
      if (other === b) continue;
      if (other.familyId !== b.familyId) continue;
      const odSq = distanceSq(other.x, other.y, food.x, food.y);
      const od = Math.sqrt(odSq) || 1;
      familyBonus += 50 / od;
    }

    const score = dist - familyBonus;
    if (score < bestScore) {
      bestScore = score;
      bestFood = food;
    }
  }

  return bestFood;
}

// ---- РАЗМНОЖЕНИЕ ----
function maybeReproduce(b, newChildren) {
  try {
    const ageYears = b.ageYears;

    if (ageYears < REPRO_MIN_AGE_YEARS) return;
    
    const currentSize = b.sizePoints || 0;
    const maxSize = b.maxSizePoints || MAX_SIZE_POINTS;
    if (currentSize < maxSize) return;
    
    if (b.hunger < MIN_HUNGER_TO_REPRODUCE) return;
    
    if (b.childrenCount > 0 && ageYears - b.lastBirthYear < BIRTH_COOLDOWN_YEARS) return;

    const offset = 20;
    const childX = b.x + randRange(-offset, offset);
    const childY = b.y + randRange(-offset, offset);

    const child = new Cytophage(childX, childY, {
      generation: b.generation + 1,
      parentId: b.id,
      familyId: b.familyId,
      familyColor: b.familyColor,
      familyName: b.familyName,
      hunger: MAX_HUNGER,
      lastBirthYear: 0,
      sizePoints: CHILD_START_SIZE
    });

    b.childrenCount += 1;
    b.lastBirthYear = ageYears;
    b.hunger -= BIRTH_HUNGER_COST;
    if (b.hunger < 0) b.hunger = 0;

    newChildren.push(child);

    console.log(`✨ Birth: ${child.name} (Gen ${child.generation}) from ${b.name}`);
  } catch (err) {
    console.error("❌ Error in maybeReproduce:", err);
  }
}

// ---- UPDATE BACTERIA ----
function updateBacteria() {
  const deadIds = new Set();
  const newChildren = [];

  for (const b of bacteriaArray) {
    try {
      b.ageTicks += 1;
      const ageYears = b.ageYears;

      let hungerDrain = BASE_HUNGER_DRAIN + HUNGER_DRAIN_PER_SIZE * b.size;
      
      if (b.isOrphaned) {
        hungerDrain += ORPHAN_HUNGER_DRAIN;
      }
      
      b.hunger -= hungerDrain;
      if (b.hunger < 0) b.hunger = 0;

      if (b.hunger <= 0) {
        deadIds.add(b.id);
        stats.totalDied += 1;
        logEvent({
          type: "death",
          id: b.id,
          reason: "starvation",
          ageYears,
          familyName: b.familyName,
          time: new Date().toISOString()
        });
        continue;
      }

      if (ageYears >= b.lifespanYears) {
        deadIds.add(b.id);
        stats.totalDied += 1;
        logEvent({
          type: "death",
          id: b.id,
          reason: "old_age",
          ageYears,
          familyName: b.familyName,
          time: new Date().toISOString()
        });
        continue;
      }

      if (b.isLeader) {
        maybeSelectSuccessor(b);
      }

      maybeReproduce(b, newChildren);

      handleCollisions(b);

      if (!b.isOrphaned) {
        const bestFood = findBestFoodFor(b);
        if (bestFood) {
          const dx = bestFood.x - b.x;
          const dy = bestFood.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;

          const desiredVx = (dx / dist) * b.maxSpeed;
          const desiredVy = (dy / dist) * b.maxSpeed;

          b.vx += (desiredVx - b.vx) * b.acceleration;
          b.vy += (desiredVy - b.vy) * b.acceleration;
        } else {
          b.vx += (Math.random() - 0.5) * 0.08;
          b.vy += (Math.random() - 0.5) * 0.08;
        }
      } else {
        b.vx += (Math.random() - 0.5) * 0.15;
        b.vy += (Math.random() - 0.5) * 0.15;
      }

      b.vx *= b.friction;
      b.vy *= b.friction;

      const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      if (speed > b.maxSpeed) {
        b.vx = (b.vx / speed) * b.maxSpeed;
        b.vy = (b.vy / speed) * b.maxSpeed;
      }

      b.x += b.vx;
      b.y += b.vy;

      if (b.x < 0) {
        b.x = 0;
        b.vx = Math.abs(b.vx) * 0.5;
      } else if (b.x > world.width) {
        b.x = world.width;
        b.vx = -Math.abs(b.vx) * 0.5;
      }

      if (b.y < 0) {
        b.y = 0;
        b.vy = Math.abs(b.vy) * 0.5;
      } else if (b.y > world.height) {
        b.y = world.height;
        b.vy = -Math.abs(b.vy) * 0.5;
      }

      const youthFactor = Math.min(1, ageYears / ADULT_AGE_YEARS);
      const foodFactor = Math.min(1, (b.sizePoints || 0) / b.maxSizePoints);
      const baseSize = 4 + youthFactor * 8 + foodFactor * 12;
      b.size = baseSize;
    } catch (err) {
      console.error(`❌ Error processing bacteria ${b.id}:`, err);
    }
  }

  if (deadIds.size > 0 || newChildren.length > 0) {
    bacteriaArray = bacteriaArray.filter(b => !deadIds.has(b.id));
    bacteriaArray.push(...newChildren);
    
    rebuildChildrenMap();
  }
}

// ---- EATING ----
function handleEating() {
  const eatenFoodIds = new Set();

  for (const b of bacteriaArray) {
    if (b.isOrphaned) continue;
    
    for (const f of foodArray) {
      if (eatenFoodIds.has(f.id)) continue;
      const distSq = distanceSq(b.x, b.y, f.x, f.y);
      const eatRadius = b.size * 1.3;
      if (distSq < eatRadius * eatRadius) {
        eatenFoodIds.add(f.id);
        b.hunger += FOOD_HUNGER_GAIN;
        if (b.hunger > b.maxHunger) b.hunger = b.maxHunger;
        b.sizePoints = (b.sizePoints || 0) + SIZE_GAIN_PER_FOOD;
        if (b.sizePoints > b.maxSizePoints) b.sizePoints = b.maxSizePoints;

        if (b.isLeader) {
          feedFamilyFromLeader(b);
        }
      }
    }
  }

  if (eatenFoodIds.size > 0) {
    foodArray = foodArray.filter(f => !eatenFoodIds.has(f.id));
  }
}

// ---- MAIN TICK ----
function tick() {
  try {
    stats.tickCount += 1;

    if (bacteriaArray.length === 0) {
      initWorld();
      saveState();
      return;
    }

    updateFamilyLeaders();
    markOrphans();
    updateBacteria();
    rebuildFamilyCircles();
    enforceClanWalls();
    handleEating();
    maintainFood();
    updateChildrenStats();

    if (stats.tickCount % Math.round(1000 / TICK_INTERVAL) === 0) {
      saveState();
    }
  } catch (err) {
    console.error("❌ Critical error in tick:", err);
  }
}

// ---- API ----
app.get("/ping", (req, res) => {
  res.status(200).json({ 
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    selfPingCount: pingCount,
    lastSelfPing: lastPingTime,
    bacteriaCount: bacteriaArray.length,
    foodCount: foodArray.length
  });
});

app.get("/state", (req, res) => {
  res.json({
    world,
    stats,
    bacteria: bacteriaArray.map(b => ({
      id: b.id,
      name: b.name,
      x: b.x,
      y: b.y,
      size: b.size,
      sizePoints: b.sizePoints,
      maxSizePoints: b.maxSizePoints,
      hunger: b.hunger,
      maxHunger: b.maxHunger,
      generation: b.generation,
      ageYears: b.ageYears,
      lifespanYears: b.lifespanYears,
      familyId: b.familyId,
      familyName: b.familyName,
      familyColor: b.familyColor,
      childrenCount: b.childrenCount,
      childrenAlive: b.childrenAlive,
      childrenDead: b.childrenDead,
      isLeader: b.isLeader,
      isSuccessor: b.isSuccessor,
      isOrphaned: b.isOrphaned,
      clanRadius: b.isLeader ? (getFamilyCircle(b.familyId)?.radius ?? null) : null
    })),
    food: foodArray.map(f => ({ id: f.id, x: f.x, y: f.y }))
  });
});

app.get("/stats", (req, res) => {
  res.json({
    ...stats,
    uptime: process.uptime(),
    selfPingCount: pingCount,
    lastSelfPing: lastPingTime
  });
});

// ---- START ----
loadState();
setInterval(tick, TICK_INTERVAL);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Cytophage world server running on port ${PORT}`);
  console.log(`🌍 Server URL: ${SERVER_URL}`);
  
  setTimeout(() => {
    console.log('🚀 Self-ping system started');
    selfPing();
    setInterval(selfPing, PING_INTERVAL);
  }, 2 * 60 * 1000);
});
