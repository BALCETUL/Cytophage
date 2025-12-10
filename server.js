const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const https = require("https"); // ← ДОБАВЛЕНО для самопинга

const app = express();
app.use(cors());

// ---- FILES ----
const STATE_FILE = path.join(__dirname, "world_state.json");
const EVENTS_FILE = path.join(__dirname, "events.log");

// ---- WORLD SETTINGS ----
const WORLD_WIDTH = 8000;
const WORLD_HEIGHT = 8000;
const TARGET_FOOD_COUNT = 8000;
const TICK_INTERVAL = 80; // ms
const MS_PER_TICK = TICK_INTERVAL;

const MS_PER_YEAR = 60 * 60 * 1000;
const TICKS_PER_YEAR = MS_PER_YEAR / MS_PER_TICK;

const ADULT_AGE_YEARS = 18;
const REPRO_MIN_AGE_YEARS = 0.5;
const BIRTH_COOLDOWN_YEARS = 5;
const MIN_LIFESPAN_YEARS = 60;
const MAX_LIFESPAN_YEARS = 100;

const MAX_HUNGER = 100;
const BASE_HUNGER_DRAIN = 0.01;
const HUNGER_DRAIN_PER_SIZE = 0.00005;
const FOOD_HUNGER_GAIN = 5;
const BIRTH_HUNGER_COST = 35;

const MAX_SIZE_POINTS = 1000;
const SIZE_GAIN_PER_FOOD = 1;

// ---- САМОПИНГ (НОВОЕ) ----
const SERVER_URL = process.env.RENDER_EXTERNAL_URL || 'https://cytophage.onrender.com';
const PING_INTERVAL = 10 * 60 * 1000; // 10 минут
let pingCount = 0;
let lastPingTime = null;

function selfPing() {
  const pingTime = new Date().toISOString();
  
  https.get(`${SERVER_URL}/ping`, (res) => {
    pingCount++;
    lastPingTime = pingTime;
    console.log(`✅ Self-ping #${pingCount} successful at ${pingTime} | Status: ${res.statusCode}`);
  }).on('error', (e) => {
    console.error(`❌ Self-ping failed at ${pingTime}:`, e.message);
  });
}

// ---- RANDOM ----
function randRange(min, max) {
  return Math.random() * (max - min) + min;
}

function randInt(min, max) {
  return Math.floor(randRange(min, max + 1));
}

// ---- Имена бактерий ----
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
  "Robert Lewandowski","Luka Modrić","Kevin De Bruyne","Mohamed Salah","Harry Kane",
  "Zlatan Ibrahimović","Andrés Iniesta","Xavi","Ronaldinho","Pelé",
  "Diego Maradona","Paolo Maldini","Sergio Ramos","Gianluigi Buffon","Thierry Henry",
  "Didier Drogba","Frank Lampard","Steven Gerrard","Wayne Rooney","Karim Benzema"
];

function getRandomName() {
  const index = Math.floor(Math.random() * NAMES_LIST.length);
  return NAMES_LIST[index];
}

// ---- Имена кланов ----
const COLONY_NAMES = [
  "Альфа","Бета","Гамма","Дельта","Эхо",
  "Омега","Титаны","Стражи","Стая","Легион",
  "Искры","Пламя","Луна","Солнце","Тени",
  "Волки","Ястребы","Космос","Гроза","Мираж",
  "Кристалл","Улей","Ковчег","Феникс","Призрак",
  "Щит","Коготь","Буря","Цитадель","Портал",
  "Вихрь","Комета","Небула","Спираль","Магма",
  "Химеры","Гидра","Оса","Рой","Лабиринт",
  "Оазис","Пик","Гром","Туман","Сияние",
  "Туманность","Осколки","Стражи Глубин","Созвездие","Обсидиан",
  "Легион Ночи","Пески Времени","Холод Тьмы","Морской Бриз","Ночные Волки",
  "Звёздный Путь","Ледяные Крылья","Чёрный Рассвет","Зелёный Лист","Каменный Круг"
];

function getColonyNameById(id) {
  if (id >= 1 && id <= COLONY_NAMES.length) {
    return COLONY_NAMES[id - 1];
  }
  return "Бродяги-" + id;
}

// ---- FAMILY SYSTEM ----
let nextFamilyId = 1;

function createFamily() {
  const id = nextFamilyId++;
  const hue = randInt(0, 359);
  const color = `hsl(${hue}, 80%, 60%)`;
  const name = getColonyNameById(id);
  return { familyId: id, familyColor: color, familyName: name };
}

// ---- GLOBAL STATE ----
let world = {
  width: WORLD_WIDTH,
  height: WORLD_HEIGHT
};

let nextBacteriaId = 1;
let nextFoodId = 1;

let bacteriaArray = [];
let foodArray = [];

let stats = {
  startedAt: new Date().toISOString(),
  lastSavedAt: null,
  totalBorn: 0,
  totalDied: 0,
  tickCount: 0
};

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
      sizePoints = 20
    } = options;

    this.id = nextBacteriaId++;
    this.name = getRandomName();

    this.x = x;
    this.y = y;

    this.vx = randRange(-0.05, 0.05);
    this.vy = randRange(-0.05, 0.05);

    this.maxSpeed = 1.0;
    this.acceleration = 0.04;
    this.friction = 0.985;

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
      this.familyId = fam.familyId;
      this.familyColor = fam.familyColor;
      this.familyName = fam.familyName;
    }

    this.generation = generation;
    this.parentId = parentId;

    this.hunger = hunger;
    this.maxHunger = MAX_HUNGER;

    this.sizePoints = sizePoints;
    this.maxSizePoints = MAX_SIZE_POINTS;
    this.size = 3;
    this.visionRadius = 450;

    this.isLeader = false;

    stats.totalBorn += 1;
    logEvent({
      type: "birth",
      id: this.id,
      parentId: this.parentId,
      generation: this.generation,
      familyId: this.familyId,
      familyName: this.familyName,
      familyColor: this.familyColor,
      lifespanYears: this.lifespanYears,
      time: new Date().toISOString(),
      tick: stats.tickCount
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
    bacteria: bacteriaArray,
    food: foodArray,
    stats: {
      ...stats,
      lastSavedAt: new Date().toISOString()
    }
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
    stats = {
      ...stats,
      ...data.stats
    };

    bacteriaArray = (data.bacteria || []).map(b => {
      const opts = {
        generation: b.generation ?? 0,
        parentId: b.parentId ?? null,
        familyId: b.familyId ?? null,
        familyColor: b.familyColor ?? null,
        familyName: b.familyName ?? null,
        ageTicks: b.ageTicks ?? 0,
        hunger: (() => {
          let h = typeof b.hunger === "number" ? b.hunger : MAX_HUNGER * 0.5;
          if (h > MAX_HUNGER) h = MAX_HUNGER;
          if (h < 0) h = 0;
          return h;
        })(),
        lifespanYears: b.lifespanYears ?? randRange(MIN_LIFESPAN_YEARS, MAX_LIFESPAN_YEARS),
        lastBirthYear: b.lastBirthYear ?? 0,
        childrenCount: b.childrenCount ?? 0,
        sizePoints: typeof b.sizePoints === "number" ? b.sizePoints : 20
      };
      const c = new Cytophage(b.x ?? 0, b.y ?? 0, opts);
      c.id = b.id;
      c.name = b.name ?? c.name;
      c.vx = b.vx ?? c.vx;
      c.vy = b.vy ?? c.vy;
      c.size = b.size ?? c.size;
      c.visionRadius = b.visionRadius ?? c.visionRadius;
      c.isLeader = b.isLeader ?? false;
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
    nextFamilyId = Math.max(nextFamilyId, maxFamId + 1, nextFamilyId);

    console.log("World state loaded from file");
  } catch (err) {
    console.error("Error loading state, init new world:", err);
    initWorld();
    saveState();
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
  world = {
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT
  };
  bacteriaArray = [];
  foodArray = [];
  nextBacteriaId = 1;
  nextFoodId = 1;
  nextFamilyId = 1;

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
    b.isLeader = info ? info.id === b.id : false;
  }
}

// ---- BACTERIA BEHAVIOUR ----
function findBestFoodFor(bacteria) {
  let bestFood = null;
  let bestScore = Infinity;
  const visionRadiusSq = bacteria.visionRadius * bacteria.visionRadius;

  for (const food of foodArray) {
    const distSq = distanceSq(bacteria.x, bacteria.y, food.x, food.y);
    if (distSq > visionRadiusSq) continue;
    const dist = Math.sqrt(distSq);

    let familyBonus = 0;
    for (const other of bacteriaArray) {
      if (other === bacteria) continue;
      if (other.familyId !== bacteria.familyId) continue;
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

function handleSeparationAndFamily(b) {
  let repelX = 0;
  let repelY = 0;

  let leaderVecX = 0;
  let leaderVecY = 0;
  let leaderDist = Infinity;

  for (const other of bacteriaArray) {
    if (other === b) continue;
    const dx = b.x - other.x;
    const dy = b.y - other.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < 0.0001) continue;

    const dist = Math.sqrt(distSq);
    const minDist = (b.size + other.size) * 1.5;

    if (dist < minDist) {
      const nx = dx / dist;
      const ny = dy / dist;
      const force = 0.4 * (1 - dist / (minDist * 2));
      const slideForce = force * 0.5;

      repelX += nx * force;
      repelY += ny * force;

      repelX += -ny * slideForce;
      repelY += nx * slideForce;
    }

    if (other.familyId === b.familyId && dist > minDist && dist < 600) {
      const nx = -dx / dist;
      const ny = -dy / dist;
      const famPull = 0.03 * (1 - dist / 600);
      repelX += nx * famPull;
      repelY += ny * famPull;
    }

    if (other.familyId === b.familyId && other.isLeader) {
      if (dist < leaderDist) {
        leaderDist = dist;
        leaderVecX = other.x - b.x;
        leaderVecY = other.y - b.y;
      }
    }
  }

  if (!b.isLeader && leaderDist < Infinity) {
    const dist = leaderDist || 1;
    const nx = leaderVecX / dist;
    const ny = leaderVecY / dist;
    const followStrength = 0.08;
    b.vx += nx * followStrength;
    b.vy += ny * followStrength;
  }

  b.vx += repelX * 0.08;
  b.vy += repelY * 0.08;
}

function maybeReproduce(b, newChildren) {
  const ageYears = b.ageYears;

  if (ageYears < REPRO_MIN_AGE_YEARS) return;
  if ((b.sizePoints || 0) < (b.maxSizePoints || MAX_SIZE_POINTS)) return;
  if (b.hunger < MAX_HUNGER * 0.9) return;
  if (ageYears - b.lastBirthYear < BIRTH_COOLDOWN_YEARS) return;

  const offset = 10;
  const childX = b.x + randRange(-offset, offset);
  const childY = b.y + randRange(-offset, offset);

  let familyId = b.familyId;
  let familyColor = b.familyColor;
  let familyName = b.familyName;

  if (b.isLeader) {
    const newFam = createFamily();
    familyId = newFam.familyId;
    familyColor = newFam.familyColor;
    familyName = newFam.familyName;
  }

  const child = new Cytophage(childX, childY, {
    generation: b.generation + 1,
    parentId: b.id,
    familyId,
    familyColor,
    familyName,
    hunger: MAX_HUNGER * 0.6,
    lastBirthYear: 0,
    sizePoints: Math.max(20, b.sizePoints * 0.5)
  });

  b.childrenCount += 1;
  b.lastBirthYear = ageYears;
  b.hunger -= BIRTH_HUNGER_COST;
  if (b.hunger < 0) b.hunger = 0;

  newChildren.push(child);

  logEvent({
    type: "reproduce",
    parentId: b.id,
    childId: child.id,
    parentAgeYears: ageYears,
    familyId,
    familyName,
    time: new Date().toISOString(),
    tick: stats.tickCount
  });
}

function updateBacteria() {
  const deadIds = new Set();
  const newChildren = [];

  for (const b of bacteriaArray) {
    b.ageTicks += 1;
    const ageYears = b.ageYears;

    const hungerDrain = BASE_HUNGER_DRAIN + HUNGER_DRAIN_PER_SIZE * b.size;
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
        generation: b.generation,
        familyId: b.familyId,
        familyName: b.familyName,
        time: new Date().toISOString(),
        tick: stats.tickCount
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
        lifespanYears: b.lifespanYears,
        generation: b.generation,
        familyId: b.familyId,
        familyName: b.familyName,
        time: new Date().toISOString(),
        tick: stats.tickCount
      });
      continue;
    }

    maybeReproduce(b, newChildren);

    handleSeparationAndFamily(b);

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
      b.vx += (Math.random() - 0.5) * 0.05;
      b.vy += (Math.random() - 0.5) * 0.05;
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
    const baseSize = 4 + youthFactor * 8 + foodFactor * 10;
    b.size = baseSize;
  }

  if (deadIds.size > 0 || newChildren.length > 0) {
    bacteriaArray = bacteriaArray.filter(b => !deadIds.has(b.id));
    bacteriaArray.push(...newChildren);
  }
}

// ---- FOOD EATING ----
function handleEating() {
  const eatenFoodIds = new Set();

  for (const b of bacteriaArray) {
    for (const f of foodArray) {
      if (eatenFoodIds.has(f.id)) continue;
      const distSq = distanceSq(b.x, b.y, f.x, f.y);
      const eatRadius = b.size * 1.2;
      if (distSq < eatRadius * eatRadius) {
        eatenFoodIds.add(f.id);
        b.hunger += FOOD_HUNGER_GAIN;
        if (b.hunger > b.maxHunger) b.hunger = b.maxHunger;
        b.sizePoints = (b.sizePoints || 0) + SIZE_GAIN_PER_FOOD;
        if (b.sizePoints > b.maxSizePoints) b.sizePoints = b.maxSizePoints;
      }
    }
  }

  if (eatenFoodIds.size > 0) {
    foodArray = foodArray.filter(f => !eatenFoodIds.has(f.id));
  }
}

// ---- MAIN TICK ----
function tick() {
  stats.tickCount += 1;

  if (bacteriaArray.length === 0) {
    initWorld();
    saveState();
    return;
  }

  updateFamilyLeaders();
  updateBacteria();
  handleEating();
  maintainFood();

  if (stats.tickCount % Math.round(1000 / TICK_INTERVAL) === 0) {
    saveState();
  }
}

// ---- API ----
// НОВЫЙ ENDPOINT для самопинга
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
      isLeader: b.isLeader
    })),
    food: foodArray.map(f => ({
      id: f.id,
      x: f.x,
      y: f.y
    }))
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
  console.log(`Cytophage world server running on port ${PORT}`);
  console.log(`Server URL: ${SERVER_URL}`);
  
  // Запуск самопинга через 2 минуты после старта
  setTimeout(() => {
    console.log('🚀 Self-ping system started');
    selfPing(); // Первый пинг сразу
    setInterval(selfPing, PING_INTERVAL); // Затем каждые 10 минут
  }, 2 * 60 * 1000);
});
