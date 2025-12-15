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
const BACTERIA_MEMORY_DIR = path.join(__dirname, "bacteria_memory");

// Создать папку для памяти бактерий
if (!fs.existsSync(BACTERIA_MEMORY_DIR)) {
  fs.mkdirSync(BACTERIA_MEMORY_DIR);
}

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

// ---- НОВОЕ: 15 ФИКСИРОВАННЫХ ЦВЕТОВ КЛАНОВ ----
const MAX_CLANS = 15;
const CLAN_COLORS = [
  "#CD5C5C", "#E9967A", "#DC143C", "#FF0000", "#FFC0CB",
  "#FFA07A", "#FFFF00", "#EE82EE", "#483D8B", "#0000CD",
  "#5F9EA0", "#00FF00", "#20B2AA", "#696969", "#FFFFF0"
];

// ---- РАДИУС КЛАНА ----
const CLAN_RADIUS_MIN = 40;
const CLAN_RADIUS_MAX = 500;
const CLAN_RADIUS_LEADER_GROWTH = 260;
const CLAN_RADIUS_PER_SQRT_MEMBER = 12;
const EMPEROR_RADIUS_THRESHOLD = 500; // Великий император

// Стена круга
const CLAN_EDGE_SOFT_ZONE = 0.85;
const CLAN_EDGE_PULL = 0.2;
const CLAN_EDGE_HARD_WALL = 0.95; // Жесткая стена при 15 кланах

// Преемник
const SUCCESSION_AGE_THRESHOLD = 0.8;

// ---- НОВОЕ: HP И БОЙ ----
const BASE_HP = 100;
const HP_PER_YEAR_GROWTH = 10; // До 40 лет
const HP_PER_YEAR_DECLINE = 8;  // После 40 лет
const PEAK_AGE = 40;
const MAX_HP = 500;

const BASE_STRENGTH = 10;
const STRENGTH_PER_YEAR = 2;
const STRENGTH_DECLINE = 3;

const MIN_DAMAGE = 1;
const MAX_DAMAGE = 5;

// Вероятность агрессии лидера (0.05% за тик = ~1 раз в 33 секунды)
const AGGRESSION_CHANCE = 0.0005;
const AGGRESSION_COOLDOWN_YEARS = 5; // Кулдаун агрессии

// ---- НОВОЕ: ИНВЕНТАРЬ ----
const BASE_INVENTORY = 50; // кг
const INVENTORY_PER_MEMBER = 2; // кг за члена клана
const INVENTORY_PER_YEAR = 3; // кг за год возраста лидера
const MAX_INVENTORY = 5000; // 5 тонн

// ---- НОВОЕ: ИНТЕЛЛЕКТ ----
const BASE_INTELLIGENCE = 10;
const EXPERIENCE_PER_TICK = 0.1;
const EXPERIENCE_PER_FOOD = 1;
const EXPERIENCE_PER_KILL = 50;
const EXPERIENCE_PER_BIRTH = 10;

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
  "Искры","Пламя","Луна","Солнце","Тени"
];

function getColonyNameById(id) {
  if (id >= 1 && id <= COLONY_NAMES.length) {
    return COLONY_NAMES[id - 1];
  }
  return "Клан-" + id;
}

// ---- FAMILY SYSTEM ----
let nextFamilyId = 1;
let usedClanSlots = new Set(); // Отслеживаем занятые слоты

function getActiveClanCount() {
  const activeClans = new Set();
  for (const b of bacteriaArray) {
    if (b.isLeader) {
      activeClans.add(b.familyId);
    }
  }
  return activeClans.size;
}

function createFamily() {
  // Проверяем лимит кланов
  if (getActiveClanCount() >= MAX_CLANS) {
    console.log("⚠️ Достигнут лимит кланов (15). Новый клан не создан.");
    return null;
  }

  const id = nextFamilyId++;
  const colorIndex = (id - 1) % CLAN_COLORS.length;
  const color = CLAN_COLORS[colorIndex];
  const name = getColonyNameById(id);
  usedClanSlots.add(id);
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
  totalKills: 0,
  tickCount: 0
};

let childrenMap = new Map();

// ---- РАСЧЕТ HP И СИЛЫ ----
function calculateMaxHP(ageYears) {
  if (ageYears <= PEAK_AGE) {
    return Math.min(MAX_HP, BASE_HP + (ageYears * HP_PER_YEAR_GROWTH));
  } else {
    const decline = (ageYears - PEAK_AGE) * HP_PER_YEAR_DECLINE;
    return Math.max(BASE_HP, MAX_HP - decline);
  }
}

function calculateStrength(ageYears) {
  if (ageYears <= PEAK_AGE) {
    return BASE_STRENGTH + (ageYears * STRENGTH_PER_YEAR);
  } else {
    const decline = (ageYears - PEAK_AGE) * STRENGTH_DECLINE;
    return Math.max(BASE_STRENGTH, BASE_STRENGTH + (PEAK_AGE * STRENGTH_PER_YEAR) - decline);
  }
}

function calculateDamage(strength) {
  const bonus = Math.floor(strength / 20);
  return randInt(MIN_DAMAGE, MAX_DAMAGE) + bonus;
}

// ---- РАСЧЕТ ИНВЕНТАРЯ ----
function calculateMaxInventory(clanSize, leaderAge) {
  const inv = BASE_INVENTORY + (clanSize * INVENTORY_PER_MEMBER) + (leaderAge * INVENTORY_PER_YEAR);
  return Math.min(MAX_INVENTORY, inv);
}

// ---- РАСЧЕТ РАДИУСА КЛАНА ----
function computeClanRadius(memberCount, leaderSizePoints = 20) {
  const leaderGrowthFactor = Math.max(0, Math.min(1, (leaderSizePoints - 20) / (MAX_SIZE_POINTS - 20)));
  const baseRadius = CLAN_RADIUS_MIN + leaderGrowthFactor * CLAN_RADIUS_LEADER_GROWTH;
  const memberBonus = Math.sqrt(Math.max(1, memberCount)) * CLAN_RADIUS_PER_SQRT_MEMBER;
  const totalRadius = baseRadius + memberBonus;
  return Math.min(CLAN_RADIUS_MAX, totalRadius);
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
      leaderAge: 0
    };
    rec.memberCount += 1;
    
    if (b.isLeader) {
      rec.leaderId = b.id;
      rec.leaderX = b.x;
      rec.leaderY = b.y;
      rec.leaderSizePoints = b.sizePoints || 20;
      rec.leaderAge = b.ageYears || 0;
    }
    tmp.set(famId, rec);
  }

  for (const [famId, rec] of tmp.entries()) {
    if (rec.leaderId == null) continue;
    rec.radius = computeClanRadius(rec.memberCount, rec.leaderSizePoints);
    tmp.set(famId, rec);
  }

  familyCircles = tmp;
}

function getFamilyCircle(familyId) {
  return familyCircles.get(familyId || 0) || null;
}

// ---- СОХРАНЕНИЕ ПАМЯТИ БАКТЕРИИ ----
function saveBacteriumMemory(b) {
  const memoryFile = path.join(BACTERIA_MEMORY_DIR, `bacteria_${b.id}.json`);
  const memory = {
    id: b.id,
    name: b.name,
    familyId: b.familyId,
    familyName: b.familyName,
    generation: b.generation,
    bornAt: b.bornAt,
    ageYears: b.ageYears,
    hp: b.hp,
    maxHp: b.maxHp,
    strength: b.strength,
    intelligence: b.intelligence,
    experience: b.experience,
    learnedSkills: b.learnedSkills,
    totalKills: b.totalKills,
    totalFood: b.totalFood,
    isLeader: b.isLeader,
    isEmperor: b.isEmperor,
    inventory: b.inventory || 0,
    maxInventory: b.maxInventory || 0
  };
  
  try {
    fs.writeFileSync(memoryFile, JSON.stringify(memory, null, 2), "utf-8");
  } catch (err) {
    console.error(`Error saving memory for bacteria ${b.id}:`, err);
  }
}

function deleteBacteriumMemory(bacteriumId) {
  const memoryFile = path.join(BACTERIA_MEMORY_DIR, `bacteria_${bacteriumId}.json`);
  try {
    if (fs.existsSync(memoryFile)) {
      fs.unlinkSync(memoryFile);
    }
  } catch (err) {
    console.error(`Error deleting memory for bacteria ${bacteriumId}:`, err);
  }
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
      experience = 0,
      totalKills = 0,
      totalFood = 0,
      learnedSkills = null
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
    this.bornAt = new Date().toISOString();

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
      } else {
        // Если лимит достигнут - присоединяемся к случайному клану
        const randomBact = bacteriaArray[randInt(0, bacteriaArray.length - 1)];
        if (randomBact) {
          this.familyId = randomBact.familyId;
          this.familyColor = randomBact.familyColor;
          this.familyName = randomBact.familyName;
        }
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
    this.hasBranched = false;
    this.isSuccessor = false;
    this.isOrphaned = false;
    this.childrenAlive = 0;
    this.childrenDead = 0;

    // ---- НОВОЕ: HP И БОЙ ----
    const ageYears = this.ageTicks / TICKS_PER_YEAR;
    this.maxHp = calculateMaxHP(ageYears);
    this.hp = hp !== null ? hp : this.maxHp;
    this.strength = calculateStrength(ageYears);
    this.isAggressive = false;
    this.lastAggressionYear = -999;

    // ---- НОВОЕ: ИНТЕЛЛЕКТ ----
    this.intelligence = BASE_INTELLIGENCE;
    this.experience = experience;
    this.totalKills = totalKills;
    this.totalFood = totalFood;
    this.learnedSkills = learnedSkills || {
      hunting: 1,
      combat: 1,
      survival: 1
    };

    // ---- НОВОЕ: ИНВЕНТАРЬ (ТОЛЬКО ДЛЯ ЛИДЕРОВ) ----
    this.inventory = 0;
    this.maxInventory = BASE_INVENTORY;

    // ---- НОВОЕ: ИМПЕРАТОР ----
    this.isEmperor = false;

    stats.totalBorn += 1;
    
    if (parentId) {
      if (!childrenMap.has(parentId)) {
        childrenMap.set(parentId, new Set());
      }
      childrenMap.get(parentId).add(this.id);
    }

    saveBacteriumMemory(this);

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

  updateStats() {
    const age = this.ageYears;
    this.maxHp = calculateMaxHP(age);
    if (this.hp > this.maxHp) this.hp = this.maxHp;
    this.strength = calculateStrength(age);
    this.intelligence = BASE_INTELLIGENCE + Math.floor(this.experience / 100);
    
    // Обучение навыкам
    if (this.totalFood > 50) this.learnedSkills.hunting = Math.min(10, Math.floor(this.totalFood / 50));
    if (this.totalKills > 5) this.learnedSkills.combat = Math.min(10, Math.floor(this.totalKills / 5));
    if (age > 20) this.learnedSkills.survival = Math.min(10, Math.floor(age / 20));
  }
}

// ---- PERSISTENCE ----
function saveState() {
  const data = {
    world,
    nextBacteriaId,
    nextFoodId,
    nextFamilyId,
    bacteria: bacteriaArray,
    food: foodArray,
    stats: { ...stats, lastSavedAt: new Date().toISOString() }
  };
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2), "utf-8");
    stats.lastSavedAt = data.stats.lastSavedAt;
    
    // Сохранить память всех живых бактерий
    for (const b of bacteriaArray) {
      saveBacteriumMemory(b);
    }
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
    stats = { ...stats, ...data.stats };

    // ИСПРАВЛЕНИЕ: Если bacteria пустой - инициализируем новый мир
    if (!data.bacteria || data.bacteria.length === 0) {
      console.log("State file exists but bacteria array is empty, init new world");
      initWorld();
      saveState();
      return;
    }

    bacteriaArray = (data.bacteria || []).map(b => {
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
        hp: b.hp ?? null,
        experience: b.experience ?? 0,
        totalKills: b.totalKills ?? 0,
        totalFood: b.totalFood ?? 0,
        learnedSkills: b.learnedSkills ?? null
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
      c.isAggressive = b.isAggressive ?? false;
      c.lastAggressionYear = b.lastAggressionYear ?? -999;
      c.inventory = b.inventory ?? 0;
      c.maxInventory = b.maxInventory ?? BASE_INVENTORY;
      c.isEmperor = b.isEmperor ?? false;
      c.bornAt = b.bornAt ?? new Date().toISOString();
      if (!c.familyName && c.familyId) {
        c.familyName = getColonyNameById(c.familyId);
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
  usedClanSlots.clear();

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
      console.log(`👑 ${b.name} стал лидером клана ${b.familyName}`);
    }
    
    // Обновить инвентарь для лидеров
    if (b.isLeader) {
      const rec = getFamilyCircle(b.familyId);
      const memberCount = rec ? rec.memberCount : 1;
      b.maxInventory = calculateMaxInventory(memberCount, b.ageYears);
    }
    
    // Проверить статус императора
    if (b.isLeader) {
      const rec = getFamilyCircle(b.familyId);
      const wasEmperor = b.isEmperor;
      b.isEmperor = rec && rec.radius >= EMPEROR_RADIUS_THRESHOLD;
      if (!wasEmperor && b.isEmperor) {
        console.log(`👑⭐ ${b.name} стал ВЕЛИКИМ ИМПЕРАТОРОМ! Радиус: ${Math.round(rec.radius)}`);
      }
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
  
  // Проверяем лимит кланов
  if (getActiveClanCount() >= MAX_CLANS) {
    // Не можем создать новый клан - остаемся в текущем
    return;
  }

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

// ---- НОВОЕ: СИСТЕМА БОЕВ ----
function handleCombat() {
  const activeClanCount = getActiveClanCount();
  
  // Агрессия лидеров
  for (const leader of bacteriaArray) {
    if (!leader.isLeader) continue;
    
    // Проверка кулдауна агрессии
    if (leader.ageYears - leader.lastAggressionYear > AGGRESSION_COOLDOWN_YEARS) {
      // Шанс стать агрессивным (зависит от голода и силы)
      const hungerFactor = leader.hunger < 30 ? 2 : 1;
      const chance = AGGRESSION_CHANCE * hungerFactor;
      
      if (Math.random() < chance) {
        leader.isAggressive = true;
        leader.lastAggressionYear = leader.ageYears;
        console.log(`⚔️ ${leader.name} (${leader.familyName}) становится агрессивным!`);
      }
    }
    
    // Агрессия длится 10 тиков
    if (leader.isAggressive) {
      const ticksSinceAggression = (leader.ageYears - leader.lastAggressionYear) * TICKS_PER_YEAR;
      if (ticksSinceAggression > 10) {
        leader.isAggressive = false;
      }
    }
  }
  
  // Битвы при пересечении кругов
  for (const b of bacteriaArray) {
    if (b.hp <= 0) continue;
    
    // Найти врагов в радиусе атаки
    const myCircle = getFamilyCircle(b.familyId);
    if (!myCircle) continue;
    
    for (const enemy of bacteriaArray) {
      if (enemy === b) continue;
      if (enemy.familyId === b.familyId) continue;
      if (enemy.hp <= 0) continue;
      
      const enemyCircle = getFamilyCircle(enemy.familyId);
      if (!enemyCircle) continue;
      
      // Проверка: пересекаются ли круги кланов?
      const distBetweenLeaders = Math.sqrt(distanceSq(myCircle.leaderX, myCircle.leaderY, enemyCircle.leaderX, enemyCircle.leaderY));
      const circlesOverlap = distBetweenLeaders < (myCircle.radius + enemyCircle.radius);
      
      if (!circlesOverlap) continue;
      
      // Проверка: один из лидеров агрессивен?
      const myLeader = bacteriaArray.find(l => l.id === myCircle.leaderId);
      const enemyLeader = bacteriaArray.find(l => l.id === enemyCircle.leaderId);
      
      const isAggressiveSituation = (myLeader && myLeader.isAggressive) || (enemyLeader && enemyLeader.isAggressive);
      
      if (!isAggressiveSituation) continue;
      
      // Проверка: враг в радиусе атаки (размер бактерии * 3)?
      const distToEnemy = Math.sqrt(distanceSq(b.x, b.y, enemy.x, enemy.y));
      const attackRange = (b.size + enemy.size) * 3;
      
      if (distToEnemy > attackRange) continue;
      
      // Лидер НЕ может заходить за чужой круг
      if (b.isLeader) {
        const distToEnemyLeader = Math.sqrt(distanceSq(b.x, b.y, enemyCircle.leaderX, enemyCircle.leaderY));
        if (distToEnemyLeader < enemyCircle.radius) {
          // Отталкиваем лидера от чужого круга
          const dx = b.x - enemyCircle.leaderX;
          const dy = b.y - enemyCircle.leaderY;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const ux = dx / dist;
          const uy = dy / dist;
          b.vx += ux * 2;
          b.vy += uy * 2;
          continue; // Лидер не может атаковать из-за границы
        }
      }
      
      // АТАКА!
      const damage = calculateDamage(b.strength);
      enemy.hp -= damage;
      
      if (enemy.hp <= 0) {
        enemy.hp = 0;
        b.totalKills++;
        b.experience += EXPERIENCE_PER_KILL;
        stats.totalKills++;
        console.log(`⚔️ ${b.name} убил ${enemy.name}! Урон: ${damage}`);
        
        logEvent({
          type: "kill",
          killerId: b.id,
          victimId: enemy.id,
          damage: damage,
          time: new Date().toISOString()
        });
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
  const activeClanCount = getActiveClanCount();
  const strictWall = activeClanCount >= MAX_CLANS;
  
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

    // Мягкая зона
    const softZone = strictWall ? CLAN_EDGE_HARD_WALL : CLAN_EDGE_SOFT_ZONE;
    
    if (dist > r * softZone && dist <= r) {
      const ux = dx / dist;
      const uy = dy / dist;
      const pullStrength = strictWall ? CLAN_EDGE_PULL * 3 : CLAN_EDGE_PULL;
      b.vx -= ux * pullStrength;
      b.vy -= uy * pullStrength;
    }

    if (dist <= r) continue;

    // Жесткая стена
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

// ---- РАЗМНОЖЕНИЕ (ТОЛЬКО ЛИДЕРЫ) ----
function maybeReproduce(b, newChildren) {
  try {
    // ТОЛЬКО ЛИДЕРЫ МОГУТ РАЗМНОЖАТЬСЯ!
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
    b.experience += EXPERIENCE_PER_BIRTH;

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
      
      // Обновить статы
      b.updateStats();
      b.experience += EXPERIENCE_PER_TICK;

      // Голод
      let hungerDrain = BASE_HUNGER_DRAIN + HUNGER_DRAIN_PER_SIZE * b.size;
      
      // Увеличенный расход для лидеров и старших
      if (b.isLeader) hungerDrain *= 1.5;
      if (ageYears > 40) hungerDrain *= 1 + ((ageYears - 40) / 100);
      
      if (b.isOrphaned) {
        hungerDrain += ORPHAN_HUNGER_DRAIN;
      }
      
      b.hunger -= hungerDrain;
      if (b.hunger < 0) b.hunger = 0;

      // Смерть от голода
      if (b.hunger <= 0) {
        deadIds.add(b.id);
        stats.totalDied += 1;
        deleteBacteriumMemory(b.id);
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
      
      // Смерть от HP
      if (b.hp <= 0) {
        deadIds.add(b.id);
        stats.totalDied += 1;
        deleteBacteriumMemory(b.id);
        logEvent({
          type: "death",
          id: b.id,
          reason: "combat",
          ageYears,
          familyName: b.familyName,
          time: new Date().toISOString()
        });
        continue;
      }

      // Смерть от старости
      if (ageYears >= b.lifespanYears) {
        deadIds.add(b.id);
        stats.totalDied += 1;
        deleteBacteriumMemory(b.id);
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
        
        // Базовое насыщение
        b.hunger += FOOD_HUNGER_GAIN;
        if (b.hunger > b.maxHunger) b.hunger = b.maxHunger;
        b.sizePoints = (b.sizePoints || 0) + SIZE_GAIN_PER_FOOD;
        if (b.sizePoints > b.maxSizePoints) b.sizePoints = b.maxSizePoints;
        
        b.totalFood++;
        b.experience += EXPERIENCE_PER_FOOD;
        
        // НОВАЯ ЛОГИКА: Только соклановцы приносят еду в инвентарь лидера
        if (!b.isLeader) {
          // Найти лидера клана
          const leader = bacteriaArray.find(l => l.isLeader && l.familyId === b.familyId);
          if (leader) {
            // Если НЕ лидер наелся и вырос - отдаёт лишнее лидеру
            if (b.hunger >= b.maxHunger && b.sizePoints >= b.maxSizePoints) {
              const foodWeight = 0.5; // кг за единицу еды
              if (leader.inventory < leader.maxInventory) {
                leader.inventory += foodWeight;
                if (leader.inventory > leader.maxInventory) leader.inventory = leader.maxInventory;
              }
            }
          }
        }
        
        // Лидер кормит семью из своих запасов
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

// ---- ЛИДЕР ЕСТ ИЗ ИНВЕНТАРЯ ----
function leaderEatFromInventory() {
  for (const b of bacteriaArray) {
    if (!b.isLeader) continue;
    
    // Лидер ест из инвентаря только когда голод < 20
    if (b.hunger < 20 && b.inventory > 0) {
      // Умное потребление: берёт ровно столько сколько нужно до 50 голода
      const neededHunger = 50 - b.hunger;
      const foodToEat = Math.min(neededHunger / FOOD_HUNGER_GAIN, b.inventory / 0.5);
      
      // Конвертируем еду в голод
      const hungerGained = foodToEat * FOOD_HUNGER_GAIN;
      b.hunger += hungerGained;
      if (b.hunger > b.maxHunger) b.hunger = b.maxHunger;
      
      // Уменьшаем инвентарь
      const inventoryUsed = foodToEat * 0.5;
      b.inventory -= inventoryUsed;
      if (b.inventory < 0) b.inventory = 0;
      
      // Логирование
      console.log(`🍖 ${b.name} съел ${inventoryUsed.toFixed(1)} кг из запасов. Голод: ${b.hunger.toFixed(1)}, Осталось: ${b.inventory.toFixed(1)} кг`);
      
      logEvent({
        type: "inventory_eat",
        leaderId: b.id,
        leaderName: b.name,
        familyName: b.familyName,
        inventoryUsed: inventoryUsed.toFixed(2),
        hungerAfter: b.hunger.toFixed(1),
        inventoryLeft: b.inventory.toFixed(1),
        time: new Date().toISOString()
      });
    }
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
    handleCombat();
    enforceClanWalls();
    handleEating();
    leaderEatFromInventory(); // НОВОЕ: Лидер ест из инвентаря
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
    foodCount: foodArray.length,
    activeClans: getActiveClanCount()
  });
});

app.get("/state", (req, res) => {
  res.json({
    world,
    stats: { ...stats, activeClans: getActiveClanCount() },
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
      hp: b.hp,
      maxHp: b.maxHp,
      strength: b.strength,
      intelligence: b.intelligence,
      experience: b.experience,
      totalKills: b.totalKills,
      totalFood: b.totalFood,
      learnedSkills: b.learnedSkills,
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
      isEmperor: b.isEmperor,
      inventory: b.inventory,
      maxInventory: b.maxInventory,
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
    lastSelfPing: lastPingTime,
    activeClans: getActiveClanCount()
  });
});

// ---- START ----
loadState();
setInterval(tick, TICK_INTERVAL);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Cytophage world server running on port ${PORT}`);
  console.log(`🌍 Server URL: ${SERVER_URL}`);
  console.log(`⚔️ Combat system: ENABLED`);
  console.log(`👑 Max clans: ${MAX_CLANS}`);
  console.log(`📦 Inventory system: ENABLED (SMART LEADERS)`);
  console.log(`🧠 Intelligence system: ENABLED`);
  
  setTimeout(() => {
    console.log('🚀 Self-ping system started');
    selfPing();
    setInterval(selfPing, PING_INTERVAL);
  }, 2 * 60 * 1000);
});
