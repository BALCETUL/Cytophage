const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const https = require("https");

const app = express();
app.use(cors());

// ---- FILES ----
const STATE_FILE = path.join(__dirname, "world_state.json");

// ---- WORLD SETTINGS ----
const WORLD_WIDTH = 15000;
const WORLD_HEIGHT = 15000;
const TARGET_FOOD_COUNT = 20000;
const TARGET_HEALTH_FOOD_COUNT = 800;
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
const BASE_HUNGER_DRAIN = 0.008;
const HUNGER_DRAIN_PER_SIZE = 0.00004;
const FOOD_HUNGER_GAIN = 6;
const BIRTH_HUNGER_COST = 30;
const MIN_HUNGER_TO_REPRODUCE = 55;

// Размер
const MAX_SIZE_POINTS = 1000;
const SIZE_GAIN_PER_FOOD = 1.2;
const CHILD_START_SIZE = 25;

// ---- 15 ФИКСИРОВАННЫХ ЦВЕТОВ КЛАНОВ ----
const MAX_CLANS = 15;
const CLAN_COLORS = [
  "#CD5C5C", "#E9967A", "#DC143C", "#FF0000", "#FFC0CB",
  "#FFA07A", "#FFFF00", "#EE82EE", "#483D8B", "#0000CD",
  "#5F9EA0", "#00FF00", "#20B2AA", "#696969", "#FFFFF0"
];

// ---- РАДИУС КЛАНА ----
const CLAN_RADIUS_MIN = 50;
const CLAN_RADIUS_MAX = 600;
const CLAN_RADIUS_LEADER_GROWTH = 300;
const CLAN_RADIUS_PER_SQRT_MEMBER = 15;
const EMPEROR_RADIUS_THRESHOLD = 550;

// Стена круга
const CLAN_EDGE_SOFT_ZONE = 0.85;
const CLAN_EDGE_PULL = 0.15;
const CLAN_EDGE_HARD_WALL = 0.95;

// Преемник
const SUCCESSION_AGE_THRESHOLD = 0.8;

// ---- HP И БОЙ ----
const BASE_HP = 100;
const HP_PER_YEAR_GROWTH = 12;
const HP_PER_YEAR_DECLINE = 10;
const PEAK_AGE = 40;
const MAX_HP = 600;

const BASE_STRENGTH = 10;
const STRENGTH_PER_YEAR = 2.5;
const STRENGTH_DECLINE = 3.5;

const MIN_DAMAGE = 2;
const MAX_DAMAGE = 6;

const AGGRESSION_CHANCE = 0.0008;
const AGGRESSION_COOLDOWN_YEARS = 4;
const AGGRESSION_DURATION_TICKS = 300;

// ---- HEALTH FOOD ----
const HEALTH_FOOD_HP_RESTORE = 60;

// ---- ИНВЕНТАРЬ (целые числа) ----
const BASE_INVENTORY = 60;
const INVENTORY_PER_MEMBER = 2.5;
const INVENTORY_PER_YEAR = 4;
const MAX_INVENTORY = 6000;

// ---- ИНТЕЛЛЕКТ ----
const BASE_INTELLIGENCE = 10;
const EXPERIENCE_PER_TICK = 0.15;
const EXPERIENCE_PER_FOOD = 1.5;
const EXPERIENCE_PER_KILL = 75;
const EXPERIENCE_PER_BIRTH = 15;

// ---- МУТАЦИИ ----
const MUTATION_CHANCE = 0.15;
const MUTATION_STRENGTH_RANGE = 0.15;
const MUTATION_HP_RANGE = 0.15;
const MUTATION_SPEED_RANGE = 0.15;
const MUTATION_VISION_RANGE = 0.2;

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
let usedClanSlots = new Set();

function getActiveClanCount() {
  const activeClans = new Set();
  for (const b of bacteriaArray) {
    if (b.isLeader && b.familyId) {
      activeClans.add(b.familyId);
    }
  }
  return activeClans.size;
}

function createFamily() {
  if (getActiveClanCount() >= MAX_CLANS) {
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
let nextHealthFoodId = 1;
let bacteriaArray = [];
let foodArray = [];
let healthFoodArray = [];
let familyCircles = new Map();
let eventLog = [];
const MAX_EVENT_LOG = 500;

let stats = {
  startedAt: new Date().toISOString(),
  lastSavedAt: null,
  totalBorn: 0,
  totalDied: 0,
  totalKills: 0,
  totalMutations: 0,
  totalWars: 0,
  tickCount: 0
};

let childrenMap = new Map();

// ---- EVENT LOG ----
function logEvent(message, type = 'info') {
  const event = {
    tick: stats.tickCount,
    timestamp: new Date().toISOString(),
    message,
    type
  };
  eventLog.push(event);
  if (eventLog.length > MAX_EVENT_LOG) {
    eventLog.shift();
  }
  console.log(`[${type.toUpperCase()}] ${message}`);
}

// ---- РАСЧЕТ HP И СИЛЫ ----
function calculateMaxHP(ageYears, mutation = 1) {
  if (ageYears <= PEAK_AGE) {
    return Math.min(MAX_HP, BASE_HP + (ageYears * HP_PER_YEAR_GROWTH * mutation));
  } else {
    const decline = (ageYears - PEAK_AGE) * HP_PER_YEAR_DECLINE;
    return Math.max(BASE_HP, MAX_HP * mutation - decline);
  }
}

function calculateStrength(ageYears, mutation = 1) {
  if (ageYears <= PEAK_AGE) {
    return BASE_STRENGTH + (ageYears * STRENGTH_PER_YEAR * mutation);
  } else {
    const decline = (ageYears - PEAK_AGE) * STRENGTH_DECLINE;
    return Math.max(BASE_STRENGTH, BASE_STRENGTH + (PEAK_AGE * STRENGTH_PER_YEAR * mutation) - decline);
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

// ---- ПРОВЕРКА ПЕРЕСЕЧЕНИЯ КРУГОВ ----
function areCirclesOverlapping(circle1, circle2) {
  if (!circle1 || !circle2) return false;
  const dx = circle1.leaderX - circle2.leaderX;
  const dy = circle1.leaderY - circle2.leaderY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  return dist < (circle1.radius + circle2.radius);
}

// ---- ENTITIES ----
class FoodParticle {
  constructor(x, y) {
    this.id = nextFoodId++;
    this.x = x;
    this.y = y;
  }
}

class HealthFood {
  constructor(x, y) {
    this.id = nextHealthFoodId++;
    this.x = x;
    this.y = y;
  }
}

// ---- МУТАЦИИ ----
function applyMutations(child, parent) {
  if (Math.random() > MUTATION_CHANCE) return;

  const mutations = {
    strength: 1 + randRange(-MUTATION_STRENGTH_RANGE, MUTATION_STRENGTH_RANGE),
    hp: 1 + randRange(-MUTATION_HP_RANGE, MUTATION_HP_RANGE),
    speed: 1 + randRange(-MUTATION_SPEED_RANGE, MUTATION_SPEED_RANGE),
    vision: 1 + randRange(-MUTATION_VISION_RANGE, MUTATION_VISION_RANGE)
  };

  child.strengthMutation = mutations.strength;
  child.hpMutation = mutations.hp;
  child.speedMutation = mutations.speed;
  child.visionMutation = mutations.vision;

  stats.totalMutations++;
  logEvent(`🧬 Мутация: ${child.name} получил новые черты (сила: ${mutations.strength.toFixed(2)}x, HP: ${mutations.hp.toFixed(2)}x)`, 'mutation');
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
      hunger = MAX_HUNGER,
      lifespanYears = null,
      lastBirthYear = 0,
      childrenCount = 0,
      sizePoints = 20,
      hasBranched = false,
      hp = null,
      experience = 0,
      totalKills = 0,
      totalFood = 0,
      learnedSkills = null,
      strengthMutation = 1,
      hpMutation = 1,
      speedMutation = 1,
      visionMutation = 1
    } = options;

    this.id = nextBacteriaId++;
    this.name = getRandomName();
    this.x = x;
    this.y = y;
    this.vx = randRange(-0.05, 0.05);
    this.vy = randRange(-0.05, 0.05);
    this.maxSpeed = 1.2 * speedMutation;
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
        const randomBact = bacteriaArray[randInt(0, Math.max(0, bacteriaArray.length - 1))];
        if (randomBact && randomBact.familyId) {
          this.familyId = randomBact.familyId;
          this.familyColor = randomBact.familyColor;
          this.familyName = randomBact.familyName;
        } else {
          this.familyId = 0;
          this.familyColor = "#FFFFFF";
          this.familyName = "Нейтральные";
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
    this.visionRadius = 500 * visionMutation;
    this.isLeader = false;
    this.hasBranched = false;
    this.isSuccessor = false;
    this.childrenAlive = 0;
    this.childrenDead = 0;
    this.isInCombat = false;

    const ageYears = this.ageTicks / TICKS_PER_YEAR;
    this.maxHp = calculateMaxHP(ageYears, hpMutation);
    this.hp = hp !== null ? hp : this.maxHp;
    this.strength = calculateStrength(ageYears, strengthMutation);
    this.isAggressive = false;
    this.lastAggressionYear = -999;
    this.aggressionTicksLeft = 0;

    this.intelligence = BASE_INTELLIGENCE;
    this.experience = experience;
    this.totalKills = totalKills;
    this.totalFood = totalFood;
    this.learnedSkills = learnedSkills || {
      hunting: 1,
      combat: 1,
      survival: 1
    };

    this.inventory = 0;
    this.maxInventory = BASE_INVENTORY;
    this.isEmperor = false;

    // Мутации
    this.strengthMutation = strengthMutation;
    this.hpMutation = hpMutation;
    this.speedMutation = speedMutation;
    this.visionMutation = visionMutation;

    stats.totalBorn += 1;
    
    if (parentId) {
      if (!childrenMap.has(parentId)) {
        childrenMap.set(parentId, new Set());
      }
      childrenMap.get(parentId).add(this.id);
    }
  }

  get ageYears() {
    return this.ageTicks / TICKS_PER_YEAR;
  }

  get isAdult() {
    return this.ageYears >= ADULT_AGE_YEARS;
  }

  updateStats() {
    const age = this.ageYears;
    this.maxHp = calculateMaxHP(age, this.hpMutation);
    if (this.hp > this.maxHp) this.hp = this.maxHp;
    this.strength = calculateStrength(age, this.strengthMutation);
    this.intelligence = BASE_INTELLIGENCE + Math.floor(this.experience / 100);
    
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
    nextHealthFoodId,
    nextFamilyId,
    bacteria: bacteriaArray,
    food: foodArray,
    healthFood: healthFoodArray,
    stats: { ...stats, lastSavedAt: new Date().toISOString() },
    eventLog: eventLog.slice(-100)
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
    nextHealthFoodId = data.nextHealthFoodId || 1;
    nextFamilyId = data.nextFamilyId || 1;
    stats = { ...stats, ...data.stats };
    eventLog = data.eventLog || [];

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
        hunger: Math.max(0, Math.min(MAX_HUNGER, b.hunger ?? MAX_HUNGER)),
        lifespanYears: b.lifespanYears ?? randRange(MIN_LIFESPAN_YEARS, MAX_LIFESPAN_YEARS),
        lastBirthYear: b.lastBirthYear ?? 0,
        childrenCount: b.childrenCount ?? 0,
        sizePoints: b.sizePoints ?? 20,
        hasBranched: b.hasBranched ?? false,
        hp: b.hp ?? null,
        experience: b.experience ?? 0,
        totalKills: b.totalKills ?? 0,
        totalFood: b.totalFood ?? 0,
        learnedSkills: b.learnedSkills ?? null,
        strengthMutation: b.strengthMutation ?? 1,
        hpMutation: b.hpMutation ?? 1,
        speedMutation: b.speedMutation ?? 1,
        visionMutation: b.visionMutation ?? 1
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
      c.childrenAlive = b.childrenAlive ?? 0;
      c.childrenDead = b.childrenDead ?? 0;
      c.isAggressive = b.isAggressive ?? false;
      c.lastAggressionYear = b.lastAggressionYear ?? -999;
      c.aggressionTicksLeft = b.aggressionTicksLeft ?? 0;
      c.inventory = b.inventory ?? 0;
      c.maxInventory = b.maxInventory ?? BASE_INVENTORY;
      c.isEmperor = b.isEmperor ?? false;
      c.bornAt = b.bornAt ?? new Date().toISOString();
      c.isInCombat = false;
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

    healthFoodArray = (data.healthFood || []).map(hf => {
      const hp = new HealthFood(hf.x, hf.y);
      hp.id = hf.id;
      return hp;
    });

    const maxBId = bacteriaArray.reduce((m, b) => Math.max(m, b.id), 0);
    const maxFId = foodArray.reduce((m, f) => Math.max(m, f.id), 0);
    const maxHFId = healthFoodArray.reduce((m, hf) => Math.max(m, hf.id), 0);
    nextBacteriaId = Math.max(nextBacteriaId, maxBId + 1);
    nextFoodId = Math.max(nextFoodId, maxFId + 1);
    nextHealthFoodId = Math.max(nextHealthFoodId, maxHFId + 1);

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

// ---- WORLD INIT ----
function spawnFoodRandom() {
  const x = randRange(0, world.width);
  const y = randRange(0, world.height);
  foodArray.push(new FoodParticle(x, y));
}

function spawnHealthFoodRandom() {
  const x = randRange(0, world.width);
  const y = randRange(0, world.height);
  healthFoodArray.push(new HealthFood(x, y));
}

function initWorld() {
  world = { width: WORLD_WIDTH, height: WORLD_HEIGHT };
  bacteriaArray = [];
  foodArray = [];
  healthFoodArray = [];
  nextBacteriaId = 1;
  nextFoodId = 1;
  nextHealthFoodId = 1;
  nextFamilyId = 1;
  childrenMap.clear();
  usedClanSlots.clear();
  eventLog = [];

  const startX = world.width / 2;
  const startY = world.height / 2;
  bacteriaArray.push(new Cytophage(startX, startY, { generation: 0, parentId: null }));

  for (let i = 0; i < TARGET_FOOD_COUNT; i++) {
    spawnFoodRandom();
  }

  for (let i = 0; i < TARGET_HEALTH_FOOD_COUNT; i++) {
    spawnHealthFoodRandom();
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
  while (healthFoodArray.length < TARGET_HEALTH_FOOD_COUNT) {
    spawnHealthFoodRandom();
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
      logEvent(`👑 ${b.name} стал лидером клана ${b.familyName}`, 'leader');
    }
    
    if (b.isLeader) {
      const rec = getFamilyCircle(b.familyId);
      const memberCount = rec ? rec.memberCount : 1;
      b.maxInventory = calculateMaxInventory(memberCount, b.ageYears);
    }
    
    if (b.isLeader) {
      const rec = getFamilyCircle(b.familyId);
      const wasEmperor = b.isEmperor;
      b.isEmperor = rec && rec.radius >= EMPEROR_RADIUS_THRESHOLD;
      if (!wasEmperor && b.isEmperor) {
        logEvent(`👑⭐ ${b.name} стал ВЕЛИКИМ ИМПЕРАТОРОМ! Радиус: ${Math.round(rec.radius)}`, 'emperor');
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
  
  if (getActiveClanCount() >= MAX_CLANS) {
    return;
  }

  const fam = createFamily();
  if (!fam) return;
  
  const oldCircle = getFamilyCircle(b.familyId);
  if (oldCircle && oldCircle.leaderId) {
    const dx = b.x - oldCircle.leaderX;
    const dy = b.y - oldCircle.leaderY;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const pushDist = oldCircle.radius + 50;
    b.x = oldCircle.leaderX + (dx / dist) * pushDist;
    b.y = oldCircle.leaderY + (dy / dist) * pushDist;
    
    b.vx = (dx / dist) * 3;
    b.vy = (dy / dist) * 3;
  }
  
  b.familyId = fam.familyId;
  b.familyColor = fam.familyColor;
  b.familyName = fam.familyName;
  b.isLeader = true;
  b.hasBranched = true;
  b.isSuccessor = false;
  
  logEvent(`👑 ${b.name} создал новый клан: ${b.familyName}`, 'branch');
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
  logEvent(`⭐ ${leader.name} выбрал преемником ${successor.name}`, 'succession');
}

// ---- СИСТЕМА БОЕВ И ВОЙН ----
function handleCombat() {
  const activeClanCount = getActiveClanCount();
  
  for (const b of bacteriaArray) {
    b.isInCombat = false;
  }
  
  const circlesInCombat = new Set();
  const warPairs = [];
  
  for (const circle1 of familyCircles.values()) {
    for (const circle2 of familyCircles.values()) {
      if (circle1.familyId === circle2.familyId) continue;
      if (circle1.familyId > circle2.familyId) continue;
      if (areCirclesOverlapping(circle1, circle2)) {
        circlesInCombat.add(circle1.familyId);
        circlesInCombat.add(circle2.familyId);
        warPairs.push([circle1.familyId, circle2.familyId]);
      }
    }
  }
  
  for (const b of bacteriaArray) {
    if (circlesInCombat.has(b.familyId)) {
      b.isInCombat = true;
    }
  }
  
  // Агрессия лидеров
  for (const leader of bacteriaArray) {
    if (!leader.isLeader) continue;
    
    if (leader.aggressionTicksLeft > 0) {
      leader.aggressionTicksLeft--;
      leader.isAggressive = true;
    } else {
      leader.isAggressive = false;
    }
    
    if (!leader.isAggressive && leader.ageYears - leader.lastAggressionYear > AGGRESSION_COOLDOWN_YEARS) {
      const hungerFactor = leader.hunger < 30 ? 2 : 1;
      const chance = AGGRESSION_CHANCE * hungerFactor;
      
      if (Math.random() < chance) {
        leader.isAggressive = true;
        leader.lastAggressionYear = leader.ageYears;
        leader.aggressionTicksLeft = AGGRESSION_DURATION_TICKS;
        
        const circle = getFamilyCircle(leader.familyId);
        if (circle) {
          stats.totalWars++;
          logEvent(`⚔️ ВОЙНА! ${leader.name} (${leader.familyName}) объявляет войну! Радиус атаки: ${Math.round(circle.radius)}`, 'war');
        }
      }
    }
  }
  
  // Боевая механика
  for (const b of bacteriaArray) {
    if (b.hp <= 0) continue;
    if (!b.isInCombat) continue;
    
    const myCircle = getFamilyCircle(b.familyId);
    if (!myCircle) continue;
    
    for (const enemy of bacteriaArray) {
      if (enemy === b) continue;
      if (!enemy.familyId || !b.familyId) continue;
      if (enemy.familyId === b.familyId) continue;
      if (enemy.hp <= 0) continue;
      
      const enemyCircle = getFamilyCircle(enemy.familyId);
      if (!enemyCircle) continue;
      
      const circlesOverlap = areCirclesOverlapping(myCircle, enemyCircle);
      if (!circlesOverlap) continue;
      
      const myLeader = bacteriaArray.find(l => l.id === myCircle.leaderId);
      const enemyLeader = bacteriaArray.find(l => l.id === enemyCircle.leaderId);
      
      const isAggressiveSituation = (myLeader && myLeader.isAggressive) || (enemyLeader && enemyLeader.isAggressive);
      if (!isAggressiveSituation) continue;
      
      const distToEnemy = Math.sqrt(distanceSq(b.x, b.y, enemy.x, enemy.y));
      const attackRange = (b.size + enemy.size) * 3;
      
      if (distToEnemy > attackRange) continue;
      
      const damage = calculateDamage(b.strength);
      enemy.hp -= damage;
      
      if (enemy.hp <= 0) {
        enemy.hp = 0;
        b.totalKills++;
        b.experience += EXPERIENCE_PER_KILL;
        stats.totalKills++;
        logEvent(`⚔️ ${b.name} (${b.familyName}) убил ${enemy.name} (${enemy.familyName})! Урон: ${damage}`, 'kill');
      }
    }
  }
}

// ---- ФИЗИКА СТОЛКНОВЕНИЙ (ИСПРАВЛЕНО) ----
function handleCollisions(b) {
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

      // ИСПРАВЛЕНИЕ: Лидер НЕ чувствует сопротивление от своих членов клана
      if (other.isLeader && other.familyId === b.familyId) {
        // Лидер отталкивает членов, но сам не отталкивается
        continue;
      }
      
      if (b.isLeader && other.familyId === b.familyId) {
        // Члены клана отталкиваются от лидера, но лидер не отталкивается
        continue;
      }

      collisionX += nx * strength;
      collisionY += ny * strength;
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

    if (b.isLeader) {
      for (const otherCircle of familyCircles.values()) {
        if (otherCircle.familyId === b.familyId) continue;
        if (!otherCircle.leaderId) continue;
        
        const dx = b.x - otherCircle.leaderX;
        const dy = b.y - otherCircle.leaderY;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const r = otherCircle.radius || 40;
        
        if (dist < r) {
          const ux = dx / dist;
          const uy = dy / dist;
          b.x = otherCircle.leaderX + ux * r;
          b.y = otherCircle.leaderY + uy * r;
          
          const outward = b.vx * ux + b.vy * uy;
          if (outward < 0) {
            b.vx -= outward * ux * 1.5;
            b.vy -= outward * uy * 1.5;
          }
        }
      }
      continue;
    }
    
    if (isMaxSize(b)) continue;

    const rec = getFamilyCircle(b.familyId);
    if (!rec || rec.leaderId == null) continue;

    const dx = b.x - rec.leaderX;
    const dy = b.y - rec.leaderY;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const r = rec.radius || computeClanRadius(rec.memberCount || 1, rec.leaderSizePoints || 20);

    const softZone = strictWall ? CLAN_EDGE_HARD_WALL : CLAN_EDGE_SOFT_ZONE;
    
    if (dist > r * softZone && dist <= r) {
      const ux = dx / dist;
      const uy = dy / dist;
      const pullStrength = strictWall ? CLAN_EDGE_PULL * 3 : CLAN_EDGE_PULL;
      b.vx -= ux * pullStrength;
      b.vy -= uy * pullStrength;
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

// ---- СИСТЕМА КОРМЛЕНИЯ: ЛИДЕР КОРМИТ ВСЕХ СРАЗУ ОДИНАКОВО ----
function feedFamilyFromLeader(leader) {
  if (!leader.isLeader) return;
  if (leader.inventory <= 0) return;
  
  const rec = getFamilyCircle(leader.familyId);
  if (!rec || rec.leaderId == null) return;
  
  const r = rec.radius || computeClanRadius(rec.memberCount || 1, rec.leaderSizePoints || 20);
  const rSq = r * r;

  // Собираем ВСЕХ голодных членов клана в радиусе
  const hungryMembers = [];
  for (const other of bacteriaArray) {
    if (other.familyId !== leader.familyId) continue;
    if (other.id === leader.id) continue;
    
    const dSq = distanceSq(other.x, other.y, rec.leaderX, rec.leaderY);
    if (dSq > rSq) continue;
    
    // Кормим если голод меньше 80%
    if (other.hunger < other.maxHunger * 0.8) {
      hungryMembers.push(other);
    }
  }

  if (hungryMembers.length === 0) return;

  // Делим еду ПОРОВНУ между ВСЕМИ голодными
  const foodPerMember = Math.floor(leader.inventory / hungryMembers.length);
  
  // Если еды недостаточно даже по 1 на каждого - даём хоть что-то
  if (foodPerMember <= 0 && leader.inventory > 0) {
    let totalFoodUsed = 0;
    for (let i = 0; i < Math.min(hungryMembers.length, leader.inventory); i++) {
      const member = hungryMembers[i];
      const hungerGain = 1 * FOOD_HUNGER_GAIN;
      const sizeGain = 1 * SIZE_GAIN_PER_FOOD;
      
      member.hunger += hungerGain;
      if (member.hunger > member.maxHunger) member.hunger = member.maxHunger;
      
      member.sizePoints = (member.sizePoints || 0) + sizeGain;
      if (member.sizePoints > member.maxSizePoints) member.sizePoints = member.maxSizePoints;
      
      totalFoodUsed += 1;
    }
    
    leader.inventory -= totalFoodUsed;
    if (leader.inventory < 0) leader.inventory = 0;
    
    return;
  }

  if (foodPerMember <= 0) return;

  // КОРМИМ ВСЕХ ОДИНАКОВО!
  let totalFoodUsed = 0;
  for (const member of hungryMembers) {
    const hungerGain = foodPerMember * FOOD_HUNGER_GAIN;
    const sizeGain = foodPerMember * SIZE_GAIN_PER_FOOD;
    
    member.hunger += hungerGain;
    if (member.hunger > member.maxHunger) member.hunger = member.maxHunger;
    
    member.sizePoints = (member.sizePoints || 0) + sizeGain;
    if (member.sizePoints > member.maxSizePoints) member.sizePoints = member.maxSizePoints;
    
    totalFoodUsed += foodPerMember;
  }

  leader.inventory -= totalFoodUsed;
  if (leader.inventory < 0) leader.inventory = 0;
}

// ---- ПОИСК ЕДЫ / HEALTH FOOD / ВРАГОВ ----
function findBestTargetFor(b) {
  if (b.isInCombat) {
    const myCircle = getFamilyCircle(b.familyId);
    if (myCircle) {
      let closestEnemy = null;
      let closestDist = Infinity;
      
      for (const enemy of bacteriaArray) {
        if (enemy === b) continue;
        if (enemy.familyId === b.familyId) continue;
        if (enemy.hp <= 0) continue;
        
        const dist = Math.sqrt(distanceSq(b.x, b.y, enemy.x, enemy.y));
        if (dist < closestDist) {
          closestDist = dist;
          closestEnemy = enemy;
        }
      }
      
      if (closestEnemy) {
        return { target: closestEnemy, type: 'enemy' };
      }
    }
  }
  
  const visionRadiusSq = b.visionRadius * b.visionRadius;
  const hpRatio = b.hp / b.maxHp;
  const needsHealthUrgently = hpRatio < 0.3;
  
  let bestTarget = null;
  let bestScore = Infinity;
  let targetType = null;
  
  if (needsHealthUrgently && b.isLeader) {
    for (const hf of healthFoodArray) {
      const distSq = distanceSq(b.x, b.y, hf.x, hf.y);
      if (distSq > visionRadiusSq) continue;
      const dist = Math.sqrt(distSq);
      
      const score = dist * 0.5;
      if (score < bestScore) {
        bestScore = score;
        bestTarget = hf;
        targetType = 'health';
      }
    }
  }
  
  if (!bestTarget) {
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
        bestTarget = food;
        targetType = 'food';
      }
    }
  }
  
  if (bestTarget && targetType === 'health' && b.isLeader) {
    for (const food of foodArray) {
      const distToFood = Math.sqrt(distanceSq(b.x, b.y, food.x, food.y));
      if (distToFood < b.size * 3) {
        return { target: food, type: 'food' };
      }
    }
  }
  
  return bestTarget ? { target: bestTarget, type: targetType } : null;
}

// ---- РАЗМНОЖЕНИЕ ----
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

    // Применяем мутации
    applyMutations(child, b);

    b.childrenCount += 1;
    b.lastBirthYear = ageYears;
    b.hunger -= BIRTH_HUNGER_COST;
    if (b.hunger < 0) b.hunger = 0;
    b.experience += EXPERIENCE_PER_BIRTH;

    newChildren.push(child);

    logEvent(`✨ Birth: ${child.name} (Gen ${child.generation}) from ${b.name} - Клан: ${child.familyName}`, 'birth');
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
      
      b.updateStats();
      b.experience += EXPERIENCE_PER_TICK;

      // Снижаем потерю голода для молодых
      let hungerDrain = BASE_HUNGER_DRAIN + HUNGER_DRAIN_PER_SIZE * b.size;
      
      if (ageYears < 5) {
        hungerDrain *= 0.3;  // Дети теряют только 30%
      } else if (ageYears < 10) {
        hungerDrain *= 0.6;  // Молодые 60%
      }
      
      if (b.isLeader) hungerDrain *= 1.5;
      if (ageYears > 40) hungerDrain *= 1 + ((ageYears - 40) / 100);
      
      b.hunger -= hungerDrain;
      if (b.hunger < 0) b.hunger = 0;

      if (b.hunger <= 0) {
        deadIds.add(b.id);
        stats.totalDied += 1;
        logEvent(`💀 ${b.name} умер от голода в клане ${b.familyName} (возраст: ${ageYears.toFixed(1)} лет)`, 'death');
        continue;
      }
      
      if (b.hp <= 0) {
        deadIds.add(b.id);
        stats.totalDied += 1;
        logEvent(`💀 ${b.name} умер от ран в клане ${b.familyName}`, 'death');
        continue;
      }

      if (ageYears >= b.lifespanYears) {
        deadIds.add(b.id);
        stats.totalDied += 1;
        logEvent(`💀 ${b.name} умер от старости (${ageYears.toFixed(1)} лет) в клане ${b.familyName}`, 'death');
        continue;
      }

      if (b.isLeader) {
        maybeSelectSuccessor(b);
      }

      maybeReproduce(b, newChildren);
      handleCollisions(b);

      const targetInfo = findBestTargetFor(b);
      if (targetInfo) {
        const dx = targetInfo.target.x - b.x;
        const dy = targetInfo.target.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;

        const desiredVx = (dx / dist) * b.maxSpeed;
        const desiredVy = (dy / dist) * b.maxSpeed;

        b.vx += (desiredVx - b.vx) * b.acceleration;
        b.vy += (desiredVy - b.vy) * b.acceleration;
      } else {
        b.vx += (Math.random() - 0.5) * 0.08;
        b.vy += (Math.random() - 0.5) * 0.08;
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
  const eatenHealthFoodIds = new Set();

  for (const b of bacteriaArray) {
    if (b.isInCombat) continue;
    
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
        
        b.totalFood++;
        b.experience += EXPERIENCE_PER_FOOD;
        
        // Члены клана собирают еду в инвентарь лидера когда сыты > 60%
        if (!b.isLeader) {
          const leader = bacteriaArray.find(l => l.isLeader && l.familyId === b.familyId);
          if (leader) {
            const hungerRatio = b.hunger / b.maxHunger;
            if (hungerRatio > 0.6) {
              const foodWeight = 1;
              if (leader.inventory < leader.maxInventory) {
                leader.inventory += foodWeight;
                if (leader.inventory > leader.maxInventory) leader.inventory = leader.maxInventory;
              }
            }
          }
        }
      }
    }
    
    for (const hf of healthFoodArray) {
      if (eatenHealthFoodIds.has(hf.id)) continue;
      const distSq = distanceSq(b.x, b.y, hf.x, hf.y);
      const eatRadius = b.size * 1.3;
      if (distSq < eatRadius * eatRadius) {
        eatenHealthFoodIds.add(hf.id);
        
        const rec = getFamilyCircle(b.familyId);
        if (rec) {
          for (const member of bacteriaArray) {
            if (member.familyId === b.familyId) {
              member.hp += HEALTH_FOOD_HP_RESTORE;
              if (member.hp > member.maxHp) member.hp = member.maxHp;
            }
          }
        }
        
        logEvent(`❤️ ${b.name} собрал health food! Клан ${b.familyName} восстановил HP`, 'health');
      }
    }
  }

  if (eatenFoodIds.size > 0) {
    foodArray = foodArray.filter(f => !eatenFoodIds.has(f.id));
  }
  
  if (eatenHealthFoodIds.size > 0) {
    healthFoodArray = healthFoodArray.filter(hf => !eatenHealthFoodIds.has(hf.id));
  }
}

// ---- ЛИДЕР ЕСТ ИЗ ИНВЕНТАРЯ (САМ + КОРМИТ КЛАН) ----
function leaderEatFromInventory() {
  for (const b of bacteriaArray) {
    if (!b.isLeader) continue;
    
    // Лидер ест когда голод < 50%
    if (b.hunger < b.maxHunger * 0.5 && b.inventory > 0) {
      // Кормит весь клан!
      feedFamilyFromLeader(b);
      
      // И себя тоже кормит из остатка
      if (b.hunger < b.maxHunger * 0.8 && b.inventory > 0) {
        const neededHunger = b.maxHunger * 0.8 - b.hunger;
        const foodToEat = Math.min(Math.ceil(neededHunger / FOOD_HUNGER_GAIN), b.inventory);
        
        const hungerGained = foodToEat * FOOD_HUNGER_GAIN;
        b.hunger += hungerGained;
        if (b.hunger > b.maxHunger) b.hunger = b.maxHunger;
        
        b.inventory -= foodToEat;
        if (b.inventory < 0) b.inventory = 0;
      }
    }
  }
}

// ---- АВТОМАТИЧЕСКОЕ КОРМЛЕНИЕ КЛАНА ----
function autoFeedClans() {
  for (const b of bacteriaArray) {
    if (!b.isLeader) continue;
    // Автоматически кормим клан если есть еда в инвентаре
    if (b.inventory > 10) {
      feedFamilyFromLeader(b);
    }
  }
}

// ---- MAIN TICK ----
function tick() {
  try {
    stats.tickCount += 1;

    if (bacteriaArray.length === 0) {
      logEvent("⚠️ Все бактерии умерли! Перезапуск мира...", 'warning');
      initWorld();
      saveState();
      return;
    }

    updateFamilyLeaders();
    updateBacteria();
    rebuildFamilyCircles();
    handleCombat();
    enforceClanWalls();
    handleEating();
    leaderEatFromInventory();
    autoFeedClans();
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
    healthFoodCount: healthFoodArray.length,
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
      isAggressive: b.isAggressive,
      isEmperor: b.isEmperor,
      isInCombat: b.isInCombat,
      inventory: b.inventory,
      maxInventory: b.maxInventory,
      clanRadius: b.isLeader ? (getFamilyCircle(b.familyId)?.radius ?? null) : null,
      mutations: {
        strength: b.strengthMutation,
        hp: b.hpMutation,
        speed: b.speedMutation,
        vision: b.visionMutation
      }
    })),
    food: foodArray.map(f => ({ id: f.id, x: f.x, y: f.y })),
    healthFood: healthFoodArray.map(hf => ({ id: hf.id, x: hf.x, y: hf.y })),
    events: eventLog.slice(-50)
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

app.get("/events", (req, res) => {
  res.json({
    events: eventLog.slice(-100),
    totalEvents: eventLog.length
  });
});

// ---- START ----
loadState();
setInterval(tick, TICK_INTERVAL);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Cytophage world server running on port ${PORT}`);
  console.log(`🌍 Server URL: ${SERVER_URL}`);
  console.log(`🗺️ Map size: ${WORLD_WIDTH}x${WORLD_HEIGHT}`);
  console.log(`⚔️ Combat system: ENABLED`);
  console.log(`👑 Max clans: ${MAX_CLANS}`);
  console.log(`📦 Inventory system: ENABLED`);
  console.log(`❤️ Health food system: ENABLED`);
  console.log(`🧠 Intelligence system: ENABLED`);
  console.log(`🍖 Auto-feeding system: ENABLED (EQUAL distribution)`);
  console.log(`🧬 Mutation system: ENABLED`);
  console.log(`⚔️ War system: ENABLED`);
  
  setTimeout(() => {
    console.log('🚀 Self-ping system started');
    selfPing();
    setInterval(selfPing, PING_INTERVAL);
  }, 2 * 60 * 1000);
});
