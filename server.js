const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());

const STATE_FILE = path.join(__dirname, "world_state.json");
const EVENTS_FILE = path.join(__dirname, "events.log");

const WORLD_WIDTH = 8000;
const WORLD_HEIGHT = 8000;
const TARGET_FOOD_COUNT = 4000;
const TICK_INTERVAL = 80;

function randRange(min, max) {
  return Math.random() * (max - min) + min;
}

const NAMES_LIST = [
  "Leonardo DiCaprio","Brad Pitt","Johnny Depp","Tom Hardy","Christian Bale",
  "Joaquin Phoenix","Robert De Niro","Al Pacino","Gary Oldman","Matt Damon",
  "Keanu Reeves","Hugh Jackman","Ryan Gosling","Ryan Reynolds","Jake Gyllenhaal",
  "Edward Norton","Samuel L. Jackson","Scarlett Johansson","Natalie Portman",
  "Emma Stone","Anne Hathaway","Morgan Freeman","Denzel Washington","Tom Hanks",
  "Keira Knightley","Kate Winslet","Jennifer Lawrence","Charlize Theron","Gal Gadot"
];

function getRandomName() {
  const index = Math.floor(Math.random() * NAMES_LIST.length);
  return NAMES_LIST[index];
}

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

class FoodParticle {
  constructor(x, y) {
    this.id = nextFoodId++;
    this.x = x;
    this.y = y;
  }
}

class Cytophage {
  constructor(x, y, generation = 0, parentId = null) {
    this.id = nextBacteriaId++;
    this.name = getRandomName();

    this.x = x;
    this.y = y;

    this.vx = randRange(-0.1, 0.1);
    this.vy = randRange(-0.1, 0.1);

    this.maxSpeed = 2.5;
    this.acceleration = 0.15;
    this.friction = 0.98;

    this.energy = 50;
    this.maxEnergy = 100;

    this.size = 3;
    this.visionRadius = 250;

    this.ageTicks = 0;
    this.generation = generation;
    this.parentId = parentId;

    stats.totalBorn += 1;
    logEvent({
      type: "birth",
      id: this.id,
      parentId: parentId,
      generation: generation,
      x: x,
      y: y,
      tick: stats.tickCount,
      time: new Date().toISOString()
    });
  }
}

function saveState() {
  const data = {
    world,
    nextBacteriaId,
    nextFoodId,
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
    stats = {
      ...stats,
      ...data.stats
    };

    bacteriaArray = (data.bacteria || []).map(b => {
      const c = new Cytophage(b.x, b.y, b.generation || 0, b.parentId ?? null);
      c.id = b.id;
      c.name = b.name;
      c.vx = b.vx;
      c.vy = b.vy;
      c.maxSpeed = b.maxSpeed;
      c.acceleration = b.acceleration;
      c.friction = b.friction;
      c.energy = b.energy;
      c.maxEnergy = b.maxEnergy;
      c.size = b.size;
      c.visionRadius = b.visionRadius;
      c.ageTicks = b.ageTicks || 0;
      stats.totalBorn -= 1;
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

    console.log("World state loaded from file");
  } catch (err) {
    console.error("Error loading state, init new world:", err);
    initWorld();
    saveState();
  }
}

function logEvent(obj) {
  const line = JSON.stringify(obj) + "\n";
  try {
    fs.appendFileSync(EVENTS_FILE, line, "utf-8");
  } catch (err) {
    console.error("Error writing event:", err);
  }
}

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

  const startX = world.width / 2;
  const startY = world.height / 2;
  bacteriaArray.push(new Cytophage(startX, startY, 0, null));

  for (let i = 0; i < TARGET_FOOD_COUNT; i++) {
    spawnFoodRandom();
  }
}

function maintainFood() {
  while (foodArray.length < TARGET_FOOD_COUNT) {
    spawnFoodRandom();
  }
}

function distanceSq(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  return dx*dx + dy*dy;
}

function findBestFoodFor(bacteria) {
  let bestFood = null;
  let bestScore = Infinity;
  const visionRadiusSq = bacteria.visionRadius * bacteria.visionRadius;

  for (const food of foodArray) {
    const distSq = distanceSq(bacteria.x, bacteria.y, food.x, food.y);
    if (distSq > visionRadiusSq) continue;
    const dist = Math.sqrt(distSq);

    let competitionPenalty = 0;
    for (const other of bacteriaArray) {
      if (other === bacteria) continue;
      if (other.targetFoodId === food.id) {
        const odSq = distanceSq(other.x, other.y, food.x, food.y);
        const od = Math.sqrt(odSq) || 1;
        competitionPenalty += 500 / od;
      }
    }

    const score = dist + competitionPenalty;
    if (score < bestScore) {
      bestScore = score;
      bestFood = food;
    }
  }

  return bestFood;
}

function handleCompetitionFor(b) {
  let repelX = 0;
  let repelY = 0;

  for (const other of bacteriaArray) {
    if (other === b) continue;
    const dx = b.x - other.x;
    const dy = b.y - other.y;
    const distSq = dx * dx + dy * dy;
    const minDist = (b.size + other.size) * 2;

    if (distSq < minDist * minDist && distSq > 0.0001) {
      const dist = Math.sqrt(distSq);
      const nx = dx / dist;
      const ny = dy / dist;

      const force = 0.8 * (1 - dist / (minDist * 2));
      const slideForce = force * 0.5;

      repelX += nx * force;
      repelY += ny * force;

      repelX += -ny * slideForce;
      repelY += nx * slideForce;
    }
  }

  b.vx += repelX * 0.1;
  b.vy += repelY * 0.1;
}

function updateBacteria() {
  const deadIds = new Set();
  const newChildren = [];

  for (const b of bacteriaArray) {
    b.ageTicks += 1;

    const baseSize = 3;
    const energyDrain = 0.02 * (b.size / baseSize);
    b.energy -= energyDrain;

    if (b.energy <= 0) {
      deadIds.add(b.id);
      stats.totalDied += 1;
      logEvent({
        type: "death",
        id: b.id,
        reason: "energy_zero",
        ageTicks: b.ageTicks,
        generation: b.generation,
        tick: stats.tickCount,
        time: new Date().toISOString()
      });
      continue;
    }

    if (b.energy >= b.maxEnergy) {
      const offset = 10;

      const childGen = b.generation + 1;
      const child1 = new Cytophage(b.x - offset, b.y, childGen, b.id);
      const child2 = new Cytophage(b.x + offset, b.y, childGen, b.id);

      child1.energy = b.maxEnergy * 0.45;
      child2.energy = b.maxEnergy * 0.45;

      newChildren.push(child1, child2);
      deadIds.add(b.id);
      stats.totalDied += 1;
      logEvent({
        type: "death",
        id: b.id,
        reason: "reproduce",
        ageTicks: b.ageTicks,
        generation: b.generation,
        tick: stats.tickCount,
        time: new Date().toISOString()
      });
      continue;
    }

    handleCompetitionFor(b);

    const bestFood = findBestFoodFor(b);
    if (bestFood) {
      b.targetFoodId = bestFood.id;
      const dx = bestFood.x - b.x;
      const dy = bestFood.y - b.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;

      const desiredVx = (dx / dist) * b.maxSpeed;
      const desiredVy = (dy / dist) * b.maxSpeed;

      b.vx += (desiredVx - b.vx) * b.acceleration;
      b.vy += (desiredVy - b.vy) * b.acceleration;
    } else {
      b.targetFoodId = null;
      b.vx += (Math.random() - 0.5) * 0.2;
      b.vy += (Math.random() - 0.5) * 0.2;
      b.vx *= b.friction;
      b.vy *= b.friction;
    }

    const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    if (speed > b.maxSpeed) {
      b.vx = (b.vx / speed) * b.maxSpeed;
      b.vy = (b.vy / speed) * b.maxSpeed;
    }

    b.x += b.vx;
    b.y += b.vy;

    if (b.x < 0) {
      b.x = 0;
      b.vx = Math.abs(b.vx) * 0.9;
    } else if (b.x > world.width) {
      b.x = world.width;
      b.vx = -Math.abs(b.vx) * 0.9;
    }

    if (b.y < 0) {
      b.y = 0;
      b.vy = Math.abs(b.vy) * 0.9;
    } else if (b.y > world.height) {
      b.y = world.height;
      b.vy = -Math.abs(b.vy) * 0.9;
    }

    b.size = 3 + (b.energy / b.maxEnergy) * 12;
  }

  if (deadIds.size > 0 || newChildren.length > 0) {
    bacteriaArray = bacteriaArray.filter(b => !deadIds.has(b.id));
    bacteriaArray.push(...newChildren);
  }
}

function handleEating() {
  const eatenFoodIds = new Set();

  for (const b of bacteriaArray) {
    for (const f of foodArray) {
      if (eatenFoodIds.has(f.id)) continue;
      const distSq = distanceSq(b.x, b.y, f.x, f.y);
      const eatRadius = b.size * 1.2;
      if (distSq < eatRadius * eatRadius) {
        eatenFoodIds.add(f.id);
        b.energy += 3;
        if (b.energy > b.maxEnergy) {
          b.energy = b.maxEnergy;
        }
      }
    }
  }

  if (eatenFoodIds.size > 0) {
    foodArray = foodArray.filter(f => !eatenFoodIds.has(f.id));
  }
}

function tick() {
  stats.tickCount += 1;

  if (bacteriaArray.length === 0) {
    initWorld();
    saveState();
    return;
  }

  updateBacteria();
  handleEating();
  maintainFood();

  if (stats.tickCount % Math.round(1000 / TICK_INTERVAL) === 0) {
    saveState();
  }
}

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
      energy: b.energy,
      maxEnergy: b.maxEnergy,
      generation: b.generation,
      ageTicks: b.ageTicks
    })),
    food: foodArray.map(f => ({
      id: f.id,
      x: f.x,
      y: f.y
    }))
  });
});

app.get("/stats", (req, res) => {
  res.json(stats);
});

loadState();
setInterval(tick, TICK_INTERVAL);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Cytophage world server running on port ${PORT}`);
});
