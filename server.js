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

// ---- КОНСТАНТЫ ----
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

// HP и урон
const BASE_HP = 50;
const MAX_HP = 300;
const HP_PEAK_AGE = 40; // Пик силы в 40 лет
const MIN_DAMAGE = 1;
const MAX_DAMAGE = 5;

// Голод
const MAX_HUNGER = 100;
const BASE_HUNGER_DRAIN = 0.01;
const HUNGER_DRAIN_PER_SIZE = 0.00005;
const ORPHAN_HUNGER_DRAIN = 2.0;
const FOOD_HUNGER_GAIN = 5;
const FOOD_WEIGHT_KG = 0.5; // Каждая еда = 0.5 кг
const BIRTH_HUNGER_COST = 35;
const MIN_HUNGER_TO_REPRODUCE = 50;

// Размер
const MAX_SIZE_POINTS = 1000;
const SIZE_GAIN_PER_FOOD = 1;
const CHILD_START_SIZE = 20;

// ---- 15 КЛАНОВ С ФИКСИРОВАННЫМИ ЦВЕТАМИ ----
const MAX_CLANS = 15;
const CLAN_COLORS_FIXED = [
  "#CD5C5C", "#E9967A", "#DC143C", "#FF0000", "#FFC0CB",
  "#FFA07A", "#FFFF00", "#EE82EE", "#483D8B", "#0000CD",
  "#5F9EA0", "#00FF00", "#20B2AA", "#696969", "#FFFFF0"
];
const CLAN_NAMES = [
  "Красные", "Коралловые", "Малиновые", "Алые", "Розовые",
  "Оранжевые", "Жёлтые", "Фиолетовые", "Тёмно-синие", "Синие",
  "Бирюзовые", "Зелёные", "Морские", "Серые", "Белые"
];

// Радиус клана
const CLAN_RADIUS_MIN = 40;
const CLAN_RADIUS_MAX = 500;
const CLAN_RADIUS_LEADER_GROWTH = 260;
const CLAN_RADIUS_PER_SQRT_MEMBER = 12;
const EMPEROR_RADIUS = 500; // Радиус для Императора

// Инвентарь клана
const INVENTORY_BASE = 50;   // 50 кг
const INVENTORY_MAX = 5000;  // 5 тонн
const INVENTORY_PER_MEMBER = 10;      // +10 кг за каждого члена
const INVENTORY_PER_LEADER_YEAR = 5;  // +5 кг за каждый год лидера

// Стена круга
const CLAN_EDGE_SOFT_ZONE = 0.85;
const CLAN_EDGE_PULL = 0.2;

// Преемник
const SUCCESSION_AGE_THRESHOLD = 0.8;

// Агрессия
const AGGRESSION_CHANCE_BASE = 0.001; // 0.1% шанс стать агрессивным каждый тик
const AGGRESSION_DURATION_TICKS = 500; // Агрессия длится 500 тиков
const ATTACK_RANGE = 50; // Дальность атаки

// ---- САМОПИНГ ----
const SERVER_URL = process.env.RENDER_EXTERNAL_URL || "https://cytophage.onrender.com";
const PING_INTERVAL = 10 * 60 * 1000;
let pingCount = 0;
let lastPingTime = null;

function selfPing() {
  const pingTime = new Date().toISOString();
  https
    .get(`${SERVER_URL}/ping`, (res) => {
      pingCount++;
      lastPingTime = pingTime;
      console.log(`✅ Self-ping #${pingCount} at ${pingTime} | Status: ${res.statusCode}`);
    })
    .on("error", (e) => {
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
  "Emma Stone","Anne Hathaway","Morgan Freeman","Denzel Washington","Tom Hanks"
];

function getRandomName() {
  return NAMES_LIST[Math.floor(Math.random() * NAMES_LIST.length)];
}

// ---- FAMILY SYSTEM ----
let nextFamilyId = 1;
let availableClanSlots = Array.from({ length: MAX_CLANS }, (_, i) => i);

function createFamily() {
  if (availableClanSlots.length === 0) {
    return null; // Нет свободных слотов
  }

  const slotIndex = availableClanSlots.shift();
  const id = nextFamilyId++;
  const color = CLAN_COLORS_FIXED[slotIndex];
  const name = CLAN_NAMES[slotIndex];

  return {
    familyId: id,
    familyColor: color,
    familyName: name,
    slotIndex: slotIndex,
    inventoryKg: INVENTORY_BASE,
    isEmperor: false
  };
}

function releaseClanSlot(familyId) {
  const clanInfo = clanInventories.get(familyId);
  if (clanInfo && clanInfo.slotIndex !== undefined) {
    availableClanSlots.push(clanInfo.slotIndex);
    availableClanSlots.sort((a, b) => a - b);
  }
  clanInventories.delete(familyId);
}

// ---- GLOBAL STATE ----
let world = { width: WORLD_WIDTH, height: WORLD_HEIGHT };
let nextBacteriaId = 1;
let nextFoodId = 1;
let bacteriaArray = [];
let foodArray = [];
let familyCircles = new Map();
let clanInventories = new Map(); // familyId -> {inventoryKg, maxInventoryKg, slotIndex, isEmperor}

let stats = {
  startedAt: new Date().toISOString(),
  lastSavedAt: null,
  totalBorn: 0,
  totalDied: 0,
  totalKills: 0,
  tickCount: 0
};

let childrenMap = new Map();

// ---- HP СИСТЕМА ----
function calculateMaxHP(ageYears) {
  if (ageYears <= HP_PEAK_AGE) {
    // Рост до 40 лет
    return BASE_HP + (MAX_HP - BASE_HP) * (ageYears / HP_PEAK_AGE);
  } else {
    // После 40 лет слабеет
    const decline = (ageYears - HP_PEAK_AGE) / (MAX_LIFESPAN_YEARS - HP_PEAK_AGE);
    return MAX_HP - (MAX_HP - BASE_HP) * Math.pow(decline, 2);
  }
}

function calculateDamage(ageYears) {
  const ageRatio = ageYears / HP_PEAK_AGE;
  let baseDamage = MIN_DAMAGE + (MAX_DAMAGE - MIN_DAMAGE) * Math.min(1, ageRatio);

  // После 40 лет слабеет
  if (ageYears > HP_PEAK_AGE) {
    const decline = (ageYears - HP_PEAK_AGE) / (MAX_LIFESPAN_YEARS - HP_PEAK_AGE);
    baseDamage *= (1 - Math.pow(decline, 1.5) * 0.7);
  }

  return Math.max(1, baseDamage + randRange(-1, 1));
}

// ---- РАСЧЕТ РАДИУСА КЛАНА ----
function computeClanRadius(memberCount, leaderSizePoints = 20) {
  const leaderGrowthFactor = Math.max(
    0,
    Math.min(1, (leaderSizePoints - 20) / (MAX_SIZE_POINTS - 20))
  );
  const baseRadius = CLAN_RADIUS_MIN + leaderGrowthFactor * CLAN_RADIUS_LEADER_GROWTH;
  const memberBonus = Math.sqrt(Math.max(1, memberCount)) * CLAN_RADIUS_PER_SQRT_MEMBER;
  const totalRadius = baseRadius + memberBonus;
  return Math.min(CLAN_RADIUS_MAX, totalRadius);
}

function rebuildFamilyCircles() {
  const tmp = new Map();

  for (const b of bacteriaArray) {
    const famId = b.familyId || 0;
    const rec =
      tmp.get(famId) || {
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

    // Обновляем статус Императора
    const clanInfo = clanInventories.get(famId);
    if (clanInfo) {
      clanInfo.isEmperor = rec.radius >= EMPEROR_RADIUS;
    }

    tmp.set(famId, rec);
  }

  familyCircles = tmp;
}

function getFamilyCircle(familyId) {
  return familyCircles.get(familyId || 0) || null;
}

// ---- ИНВЕНТАРЬ КЛАНА ----
function updateClanInventory(familyId) {
  const rec = getFamilyCircle(familyId);
  if (!rec) return;

  let clanInfo = clanInventories.get(familyId);
  if (!clanInfo) {
    clanInfo = { inventoryKg: INVENTORY_BASE, maxInventoryKg: INVENTORY_BASE, slotIndex: 0, isEmperor: false };
    clanInventories.set(familyId, clanInfo);
  }

  // Рассчитываем максимум инвентаря
  const memberBonus = rec.memberCount * INVENTORY_PER_MEMBER;
  const leaderAgeBonus = Math.floor(rec.leaderAgeYears) * INVENTORY_PER_LEADER_YEAR;
  clanInfo.maxInventoryKg = Math.min(INVENTORY_MAX, INVENTORY_BASE + memberBonus + leaderAgeBonus);
}

function addToInventory(familyId, weightKg) {
  const clanInfo = clanInventories.get(familyId);
  if (!clanInfo) return false;

  if (clanInfo.inventoryKg + weightKg <= clanInfo.maxInventoryKg) {
    clanInfo.inventoryKg += weightKg;
    return true;
  }
  return false;
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
      silent = false // чтобы loadState не накручивал статистику/логи
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

    if (familyId && familyColor && familyName) {
      this.familyId = familyId;
      this.familyColor = familyColor;
      this.familyName = familyName;
    } else {
      const fam = createFamily();
      if (fam) {
        this.familyId = fam.familyId;
        this.familyColor = fam.familyColor;
        this.familyName = fam.familyName;
        clanInventories.set(fam.familyId, {
          inventoryKg: fam.inventoryKg,
          maxInventoryKg: INVENTORY_BASE,
          slotIndex: fam.slotIndex,
          isEmperor: false
        });
      } else {
        this.familyId = 0;
        this.familyColor = "#888888";
        this.familyName = "Изгои";
      }
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
    this.hasBranched = hasBranched;
    this.isSuccessor = false;
    this.isOrphaned = false;
    this.childrenAlive = 0;
    this.childrenDead = 0;

    // HP и боевая система
    this.hp = calculateMaxHP(this.ageYears);
    this.maxHP = this.hp;
    this.isAggressive = false;
    this.aggressionTicksLeft = 0;

    if (!silent) {
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
    availableClanSlots,
    bacteria: bacteriaArray,
    food: foodArray,
    clanInventories: Array.from(clanInventories.entries()),
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

    world = data.world || world;
    nextBacteriaId = data.nextBacteriaId || 1;
    nextFoodId = data.nextFoodId || 1;
    nextFamilyId = data.nextFamilyId || 1;
    availableClanSlots = data.availableClanSlots || Array.from({ length: MAX_CLANS }, (_, i) => i);
    stats = { ...stats, ...data.stats };

    if (data.clanInventories) {
      clanInventories = new Map(data.clanInventories);
    }

    bacteriaArray = (data.bacteria || []).map((b) => {
      const opts = {
        generation: b.generation ?? 0,
        parentId: b.parentId ?? null,
        familyId: b.familyId ?? null,
        familyColor: b.familyColor ?? null,
        familyName: b.familyName ?? null,
        ageTicks: b.ageTicks ?? 0,
        hunger: Math.max(0, Math.min(MAX_HUNGER, b.hunger ?? MAX_HUNGER * 0.5)),
        lifespanYears: b.lifespanYears ?? randRange(MIN_LIFESPAN_YEARS, MAX_LIFESPAN_YEARS),
        lastBirthYear: b.lastBirthYear ?? 0,
        childrenCount: b.childrenCount ?? 0,
        sizePoints: b.sizePoints ?? 20,
        hasBranched: b.hasBranched ?? false,
        silent: true
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
      c.hp = b.hp ?? calculateMaxHP(c.ageYears);
      c.maxHP = calculateMaxHP(c.ageYears);
      c.isAggressive = b.isAggressive ?? false;
      c.aggressionTicksLeft = b.aggressionTicksLeft ?? 0;
      return c;
    });

    foodArray = (data.food || []).map((f) => {
      const fp = new FoodParticle(f.x, f.y);
      fp.id = f.id;
      return fp;
    });

    const maxBId = bacteriaArray.reduce((m, b) => Math.max(m, b.id), 0);
    const maxFId = foodArray.reduce((m, f) => Math.max(m, f.id), 0);
    nextBacteriaId = Math.max(nextBacteriaId, maxBId + 1);
    nextFoodId = Math.max(nextFoodId, maxFId + 1);

    const maxFamId = bacteriaArray.reduce((m, b) => Math.max(m, b.familyId || 0), 0);
    nextFamilyId = Math.max(nextFamilyId, maxFamId + 1);

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
      const child = bacteriaArray.find((c) => c.id === childId);
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
  clanInventories.clear();
  availableClanSlots = Array.from({ length: MAX_CLANS }, (_, i) => i);

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

  // ПРОВЕРКА: если 15 кланов, нельзя создать новый
  if (availableClanSlots.length === 0) return;

  const fam = createFamily();
  if (fam) {
    b.familyId = fam.familyId;
    b.familyColor = fam.familyColor;
    b.familyName = fam.familyName;
    b.isLeader = true;
    b.hasBranched = true;
    b.isSuccessor = false;
    b.isOrphaned = false;

    clanInventories.set(fam.familyId, {
      inventoryKg: fam.inventoryKg,
      maxInventoryKg: INVENTORY_BASE,
      slotIndex: fam.slotIndex,
      isEmperor: false
    });

    console.log(`👑 ${b.name} создал новый клан: ${b.familyName}`);
  }
}

// ---- ВЫБОР ПРЕЕМНИКА ----
function maybeSelectSuccessor(leader) {
  if (!leader.isLeader) return;

  const ageRatio = leader.ageYears / leader.lifespanYears;
  if (ageRatio < SUCCESSION_AGE_THRESHOLD) return;

  const hasSuccessor = bacteriaArray.some(
    (b) => b.familyId === leader.familyId && b.isSuccessor && b.id !== leader.id
  );
  if (hasSuccessor) return;

  const candidates = bacteriaArray.filter(
    (b) => b.familyId === leader.familyId && b.id !== leader.id && !b.isLeader && isMaxSize(b)
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

// ---- АГРЕССИЯ ----
function updateAggression() {
  for (const b of bacteriaArray) {
    if (!b.isLeader) continue;

    if (b.isAggressive) {
      b.aggressionTicksLeft--;
      if (b.aggressionTicksLeft <= 0) {
        b.isAggressive = false;
        console.log(`😇 ${b.name} (${b.familyName}) успокоился`);
      }
    } else {
      if (Math.random() < AGGRESSION_CHANCE_BASE) {
        b.isAggressive = true;
        b.aggressionTicksLeft = AGGRESSION_DURATION_TICKS;
        console.log(`😠 ${b.name} (${b.familyName}) стал агрессивным!`);
      }
    }
  }
}

// ---- БОЕВАЯ СИСТЕМА ----
function handleCombat() {
  const attacked = new Set();

  for (const attacker of bacteriaArray) {
    // атакуют только лидеры и только когда они агрессивные
    if (!attacker.isLeader || !attacker.isAggressive) continue;

    for (const defender of bacteriaArray) {
      if (defender === attacker) continue;
      if (defender.familyId === attacker.familyId) continue;
      if (attacked.has(defender.id)) continue;

      const dist = Math.sqrt(distanceSq(attacker.x, attacker.y, defender.x, defender.y));

      // Лидер НЕ может войти в чужой круг
      const defenderClanCircle = getFamilyCircle(defender.familyId);
      if (defenderClanCircle && defenderClanCircle.leaderId !== null) {
        const distToDefenderLeader = Math.sqrt(
          distanceSq(attacker.x, attacker.y, defenderClanCircle.leaderX, defenderClanCircle.leaderY)
        );
        if (distToDefenderLeader < defenderClanCircle.radius) continue;
      }

      if (dist < ATTACK_RANGE) {
        const damage = calculateDamage(attacker.ageYears);
        defender.hp -= damage;
        attacked.add(defender.id);

        if (defender.hp <= 0) {
          defender.hp = 0;
          stats.totalKills++;
          console.log(`⚔️ ${attacker.name} убил ${defender.name}! (урон: ${damage.toFixed(1)})`);
        }
        break; // Один удар за тик
      }
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

// ---- РАЗМНОЖЕНИЕ (ТОЛЬКО ЛИДЕРЫ!) ----
function maybeReproduce(b, newChildren) {
  try {
    if (!b.isLeader) return;

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

      // Обновляем HP
      b.maxHP = calculateMaxHP(ageYears);
      if (b.hp > b.maxHP) b.hp = b.maxHP;

      let hungerDrain = BASE_HUNGER_DRAIN + HUNGER_DRAIN_PER_SIZE * b.size;
      if (b.isOrphaned) hungerDrain += ORPHAN_HUNGER_DRAIN;

      b.hunger -= hungerDrain;
      if (b.hunger < 0) b.hunger = 0;

      // Смерть от HP
      if (b.hp <= 0) {
        deadIds.add(b.id);
        stats.totalDied += 1;

        if (b.isLeader) {
          releaseClanSlot(b.familyId);
        }

        logEvent({
          type: "death",
          id: b.id,
          reason: "killed",
          ageYears,
          familyName: b.familyName,
          time: new Date().toISOString()
        });
        continue;
      }

      if (b.hunger <= 0) {
        deadIds.add(b.id);
        stats.totalDied += 1;

        if (b.isLeader) {
          releaseClanSlot(b.familyId);
        }

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

        if (b.isLeader) {
          releaseClanSlot(b.familyId);
        }

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
    bacteriaArray = bacteriaArray.filter((b) => !deadIds.has(b.id));
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

        // Если голод полный, еда идет в инвентарь
        if (b.hunger >= b.maxHunger) {
          addToInventory(b.familyId, FOOD_WEIGHT_KG);
        } else {
          b.hunger += FOOD_HUNGER_GAIN;
          if (b.hunger > b.maxHunger) b.hunger = b.maxHunger;
        }

        b.sizePoints = (b.sizePoints || 0) + SIZE_GAIN_PER_FOOD;
        if (b.sizePoints > b.maxSizePoints) b.sizePoints = b.maxSizePoints;

        if (b.isLeader) {
          feedFamilyFromLeader(b);
        }
      }
    }
  }

  if (eatenFoodIds.size > 0) {
    foodArray = foodArray.filter((f) => !eatenFoodIds.has(f.id));
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
    updateAggression();
    updateBacteria();
    rebuildFamilyCircles();

    // Обновляем инвентари всех кланов
    for (const [famId] of clanInventories.entries()) {
      updateClanInventory(famId);
    }

    enforceClanWalls();
    handleCombat();
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
    status: "alive",
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
    bacteria: bacteriaArray.map((b) => ({
      id: b.id,
      name: b.name,
      x: b.x,
      y: b.y,
      size: b.size,
      sizePoints: b.sizePoints,
      maxSizePoints: b.maxSizePoints,
      hunger: b.hunger,
      maxHunger: b.maxHunger,
      hp: b.hp,
      maxHP: b.maxHP,
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
      isAggressive: b.isAggressive,
      clanRadius: b.isLeader ? (getFamilyCircle(b.familyId)?.radius ?? null) : null,
      clanInventoryKg: clanInventories.get(b.familyId)?.inventoryKg ?? 0,
      clanMaxInventoryKg: clanInventories.get(b.familyId)?.maxInventoryKg ?? 0,
      isEmperor: clanInventories.get(b.familyId)?.isEmperor ?? false
    })),
    food: foodArray.map((f) => ({ id: f.id, x: f.x, y: f.y })),
    clansCount: MAX_CLANS - availableClanSlots.length
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
    console.log("🚀 Self-ping system started");
    selfPing();
    setInterval(selfPing, PING_INTERVAL);
  }, 2 * 60 * 1000);
});
