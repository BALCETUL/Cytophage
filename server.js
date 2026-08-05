const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// ============================================================
// ================= КОНФИГУРАЦИЯ =============================
// ============================================================

const CONFIG = {
    aquarium: { width: 1400, height: 800, sandHeight: 80, waterLevel: 50 },
    time: { tickMs: 50, ticksPerDay: 1200, ticksPerHour: 50 },
    ecosystem: {
        targetFishCount: 25,
        maxFishCount: 60,
        minFishCount: 8,
        feedIntervalDays: 0.5,
    },
    // ⭐ ЛИМИТЫ — защита от взрыва популяции и лагов
    limits: {
        maxFood: 120,
        maxEggs: 400,
        maxFry: 120,
        maxCorpses: 30,
        maxBacteria: 50,
    },
    plants: { count: 6, oxygenPerTick: 0.012 },
    water: {
        initialOxygen: 100, initialQuality: 100,
        minOxygenForLife: 20,
        oxygenConsumptionPerFish: 0.004,
        surfaceExchange: 0.002,
    },
};

const SPECIES = {
    guppy: { name: "Гуппи", nameLatin: "Poecilia reticulata", reproduction: "livebearer",
        size: { min: 12, max: 18 }, speed: { min: 0.8, max: 1.2 },
        color: { body: "#FF6B9D", tail: "#FFA500" },
        lifespan: { min: 365, max: 730 }, maturity: 60, gestation: 25,
        litter: { min: 3, max: 8 }, breedInterval: 14, visionRange: 150,
        diet: ["food"], canEatFish: false, schooling: true },
    neon: { name: "Неон", nameLatin: "Paracheirodon innesi", reproduction: "egg",
        size: { min: 8, max: 12 }, speed: { min: 1.0, max: 1.5 },
        color: { body: "#00D4FF", tail: "#FF0040", stripe: "#00FFFF" },
        lifespan: { min: 1095, max: 1825 }, maturity: 90, incubation: 3,
        clutch: { min: 50, max: 150 }, breedInterval: 21, visionRange: 120,
        diet: ["food"], canEatFish: false, schooling: true, eggLaying: "water" },
    angelfish: { name: "Скалярия", nameLatin: "Pterophyllum scalare", reproduction: "egg",
        size: { min: 35, max: 50 }, speed: { min: 0.5, max: 0.8 },
        color: { body: "#F5F5DC", tail: "#C0C0C0", stripes: "#333333" },
        lifespan: { min: 2920, max: 3650 }, maturity: 240, incubation: 5,
        clutch: { min: 100, max: 300 }, breedInterval: 30, visionRange: 200,
        diet: ["food", "fry"], canEatFish: true, maxPreySize: 15,
        schooling: false, eggLaying: "plant" },
    swordtail: { name: "Меченосец", nameLatin: "Xiphophorus hellerii", reproduction: "livebearer",
        size: { min: 20, max: 30 }, speed: { min: 0.9, max: 1.3 },
        color: { body: "#FF4444", tail: "#FF0000", sword: "#FFD700" },
        lifespan: { min: 1095, max: 1825 }, maturity: 90, gestation: 28,
        litter: { min: 5, max: 15 }, breedInterval: 18, visionRange: 160,
        diet: ["food"], canEatFish: false, schooling: false, hasSword: true },
    corydoras: { name: "Коридорас", nameLatin: "Corydoras paleatus", reproduction: "egg",
        size: { min: 15, max: 22 }, speed: { min: 0.4, max: 0.7 },
        color: { body: "#8B7355", tail: "#696969" },
        lifespan: { min: 1460, max: 1825 }, maturity: 120, incubation: 4,
        clutch: { min: 20, max: 60 }, breedInterval: 21, visionRange: 100,
        diet: ["food", "detritus"], canEatFish: false, schooling: true,
        bottomDweller: true, eggLaying: "glass" },
    cichlid: { name: "Цихлида", nameLatin: "Astronotus ocellatus", reproduction: "egg",
        size: { min: 40, max: 65 }, speed: { min: 0.7, max: 1.0 },
        color: { body: "#2F2F2F", tail: "#1a1a1a", spots: "#FF6600" },
        lifespan: { min: 3650, max: 5475 }, maturity: 365, incubation: 7,
        clutch: { min: 200, max: 500 }, breedInterval: 45, visionRange: 250,
        diet: ["food", "fry", "smallfish"], canEatFish: true, maxPreySize: 25,
        schooling: false, eggLaying: "rock" },
};

const FISH_NAMES = {
    male: ["Аркадий","Борис","Владимир","Геннадий","Дмитрий","Евгений","Жан","Захар","Игорь","Кирилл","Леонид","Максим","Николай","Олег","Пётр","Роман","Степан","Тимофей","Фёдор","Харитон","Эдуард","Юрий","Яков","Альфред","Бруно","Вальтер","Густав","Диего","Жак","Карл","Нептун","Посейдон","Тритон","Одиссей","Атлас"],
    female: ["Алиса","Белла","Венера","Глория","Диана","Ева","Жасмин","Злата","Изабелла","Клеопатра","Луна","Марина","Нефера","Офелия","Пенелопа","Роза","Селена","Тея","Ундина","Фиалка","Хлоя","Царина","Шакира","Эльза","Юнона","Ариэль","Бриджит","Грейс","Долорес","Есения","Корал","Нимфа","Океана","Пёрл"],
};

function getRandomName(g) { const n = FISH_NAMES[g] || FISH_NAMES.male; return n[Math.floor(Math.random() * n.length)]; }
function rand(a, b) { return Math.random() * (b - a) + a; }
function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
function distance(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx*dx + dy*dy); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

let nextId = 1;
const generateId = () => nextId++;

// ============================================================
// =================== СОСТОЯНИЕ ==============================
// ============================================================

const STATE_FILE = path.join(__dirname, "world_state.json");
const SAVE_VERSION = 4; // ⭐ новая версия — старое раздутое сохранение игнорируется

let state = {
    fishes: [], eggs: [], fry: [], corpses: [], bacteria: [],
    food: [], bubbles: [], plants: [], rocks: [],
    environment: { oxygen: 100, quality: 100, temperature: 25, ph: 7.0 },
    gameTime: { ticks: 0, days: 0, hours: 0 },
    stats: {
        totalBorn: 0, totalDied: 0, totalEggsLaid: 0, totalFryBorn: 0,
        manualFeeds: 0, autoFeeds: 0,
        serverStartedAt: new Date().toISOString(), lastSavedAt: null,
    },
    events: [], lastFeedTime: 0,
};

// ⭐ АСИНХРОННОЕ сохранение — не блокирует сервер
function saveState() {
    try {
        state.stats.lastSavedAt = new Date().toISOString();
        const data = JSON.stringify({
            version: SAVE_VERSION,
            fishes: state.fishes, eggs: state.eggs, fry: state.fry,
            corpses: state.corpses, bacteria: state.bacteria,
            plants: state.plants, rocks: state.rocks,
            environment: state.environment, gameTime: state.gameTime,
            stats: state.stats, lastFeedTime: state.lastFeedTime, nextId,
        });
        fs.writeFile(STATE_FILE, data, (e) => { if (e) console.error("Save error:", e.message); });
    } catch (e) { console.error("Save error:", e.message); }
}

function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
            if (data.version !== SAVE_VERSION) { console.log("⚠️ Старое сохранение — новый мир"); return false; }
            Object.assign(state, {
                fishes: data.fishes || [], eggs: data.eggs || [], fry: data.fry || [],
                corpses: data.corpses || [], bacteria: data.bacteria || [],
                plants: data.plants || [], rocks: data.rocks || [],
                environment: data.environment || state.environment,
                gameTime: data.gameTime || state.gameTime,
                lastFeedTime: data.lastFeedTime || 0,
            });
            state.stats = { ...state.stats, ...data.stats };
            nextId = data.nextId || nextId;
            console.log(`✅ Загружено: рыб ${state.fishes.length}, икры ${state.eggs.length}, день ${state.gameTime.days}`);
            addEvent("🔄 Мир восстановлен", "system");
            return true;
        }
    } catch (e) { console.error("Load error:", e.message); }
    return false;
}

setInterval(saveState, 30000);

// ============================================================
// =================== ИНИЦИАЛИЗАЦИЯ ==========================
// ============================================================

function initWorld() {
    if (loadState()) return;

    for (let i = 0; i < CONFIG.plants.count; i++) {
        state.plants.push({
            id: generateId(), x: rand(100, CONFIG.aquarium.width - 100),
            baseY: CONFIG.aquarium.height - CONFIG.aquarium.sandHeight,
            height: rand(150, 300), leaves: randInt(4, 8),
            swayOffset: Math.random() * Math.PI * 2,
        });
    }
    for (let i = 0; i < 5; i++) {
        state.rocks.push({
            id: generateId(), x: rand(50, CONFIG.aquarium.width - 50),
            y: CONFIG.aquarium.height - CONFIG.aquarium.sandHeight + rand(0, 40),
            width: rand(30, 80), height: rand(20, 50),
            color: `hsl(${randInt(20,40)}, ${randInt(10,30)}%, ${randInt(30,50)}%)`,
        });
    }
    for (const sp of Object.keys(SPECIES)) {
        const n = randInt(2, 3);
        for (let i = 0; i < n; i++) {
            const f = createFish(sp);
            f.age = SPECIES[sp].maturity + randInt(10, 50);
            f.size = SPECIES[sp].size.max * rand(0.8, 1);
            state.fishes.push(f);
        }
    }
    for (let i = 0; i < 20; i++) spawnFood();
    addEvent("🌊 Аквариум создан! Экосистема развивается...", "system");
}

function createFish(spKey, x = null, y = null) {
    const spec = SPECIES[spKey];
    const gender = Math.random() < 0.5 ? "male" : "female";
    return {
        id: generateId(), name: getRandomName(gender), species: spKey, gender, generation: 1,
        x: x ?? rand(100, CONFIG.aquarium.width - 100),
        y: y ?? rand(100, CONFIG.aquarium.height - CONFIG.aquarium.sandHeight - 50),
        vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 0.5,
        facingRight: Math.random() < 0.5,
        size: rand(spec.size.min, spec.size.max), baseSize: rand(spec.size.min, spec.size.max),
        speed: rand(spec.speed.min, spec.speed.max),
        energy: 100, maxEnergy: 100, hp: 100, maxHp: 100,
        age: 0, lifespan: randInt(spec.lifespan.min, spec.lifespan.max),
        maturity: spec.maturity, breedCooldown: 0, pregnant: false, gestationLeft: 0,
        target: null, targetType: "wander",
        wanderAngle: Math.random() * Math.PI * 2, behaviorTimer: 0,
        swimPhase: Math.random() * Math.PI * 2, dead: false,
    };
}

function spawnFood() {
    if (state.food.length >= CONFIG.limits.maxFood) return;
    state.food.push({
        id: generateId(), x: rand(50, CONFIG.aquarium.width - 50),
        y: CONFIG.aquarium.waterLevel + 10, vy: rand(0.2, 0.5),
        size: rand(2, 4), nutrition: rand(15, 25), sinking: true,
    });
}

function feedFish() {
    const count = Math.max(12, Math.round((state.fishes.length + state.fry.length) * 1.2));
    for (let i = 0; i < count; i++) spawnFood();
    state.stats.autoFeeds++;
    state.lastFeedTime = state.gameTime.ticks / CONFIG.time.ticksPerDay;
    addEvent(`🍽️ Авто-кормушка: ${count} порций`, "system");
}

// ============================================================
// ==================== ЛОГИКА РЫБ ============================
// ============================================================

function updateFish(fish) {
    if (fish.dead) return;
    const spec = SPECIES[fish.species];

    fish.age += 1 / CONFIG.time.ticksPerDay;
    fish.swimPhase += 0.15 * fish.speed;
    fish.breedCooldown = Math.max(0, fish.breedCooldown - 1 / CONFIG.time.ticksPerDay);

    if (fish.pregnant && spec.reproduction === "livebearer") {
        fish.gestationLeft -= 1 / CONFIG.time.ticksPerDay;
        if (fish.gestationLeft <= 0) giveBirth(fish);
    }

    fish.energy -= 0.02 * (fish.size / 20) * (fish.speed / spec.speed.min);

    if (state.environment.oxygen < CONFIG.water.minOxygenForLife) { fish.hp -= 0.5; fish.vy -= 0.1; }

    const lifeP = fish.age / fish.lifespan;
    if (lifeP > 0.8) { fish.hp -= (lifeP - 0.8) * 0.5; fish.speed *= 0.999; }

    if (fish.energy <= 0 || fish.hp <= 0 || fish.age >= fish.lifespan) { killFish(fish); return; }

    if (spec.bottomDweller) {
        const bY = CONFIG.aquarium.height - CONFIG.aquarium.sandHeight - fish.size;
        if (fish.y < bY - 30) fish.vy += 0.05;
        fish.y = Math.min(fish.y, bY);
    }

    findTarget(fish);
    moveFish(fish);
    interactFish(fish);
    tryBreed(fish);

    if (fish.age < fish.maturity) {
        fish.size = spec.size.min + (fish.baseSize - spec.size.min) * (fish.age / fish.maturity);
    }
}

function findTarget(fish) {
    const spec = SPECIES[fish.species];
    let nFood = null, dFood = Infinity, nPrey = null, dPrey = Infinity;
    let nMate = null, dMate = Infinity, nPred = null, dPred = Infinity;

    if (fish.energy < 70) {
        for (const f of state.food) {
            const d = distance(fish, f);
            if (d < spec.visionRange && d < dFood) { nFood = f; dFood = d; }
        }
    }
    if (spec.canEatFish && fish.energy < 80) {
        for (const f of state.fishes) {
            if (f.id === fish.id || f.dead || f.size > spec.maxPreySize) continue;
            const d = distance(fish, f);
            if (d < spec.visionRange && d < dPrey) { nPrey = f; dPrey = d; }
        }
        for (const f of state.fry) {
            const d = distance(fish, f);
            if (d < spec.visionRange * 0.8 && d < dPrey) { nPrey = f; dPrey = d; }
        }
    }
    for (const f of state.fishes) {
        if (f.id === fish.id || f.dead) continue;
        if (SPECIES[f.species].canEatFish && f.size > fish.size * 1.5) {
            const d = distance(fish, f);
            if (d < spec.visionRange && d < dPred) { nPred = f; dPred = d; }
        }
    }
    if (fish.age > fish.maturity && fish.breedCooldown === 0 && fish.energy > 60) {
        for (const f of state.fishes) {
            if (f.id === fish.id || f.dead || f.species !== fish.species) continue;
            if (f.gender === fish.gender || f.age < f.maturity || f.breedCooldown > 0 || f.energy < 60) continue;
            const d = distance(fish, f);
            if (d < spec.visionRange && d < dMate) { nMate = f; dMate = d; }
        }
    }

    if (nPred && dPred < 80) { fish.target = nPred; fish.targetType = "flee"; }
    else if (nFood && fish.energy < 60) { fish.target = nFood; fish.targetType = "food"; }
    else if (nPrey && fish.energy < 70) { fish.target = nPrey; fish.targetType = "prey"; }
    else if (nMate && fish.energy > 70) { fish.target = nMate; fish.targetType = "mate"; }
    else { fish.target = null; fish.targetType = "wander"; }
}

function moveFish(fish) {
    const spec = SPECIES[fish.species];
    const speed = fish.speed * 0.5;

    if (fish.target && fish.targetType !== "wander" && !fish.target.dead) {
        let tx = fish.target.x, ty = fish.target.y;
        if (fish.targetType === "flee") { tx = fish.x * 2 - fish.target.x; ty = fish.y * 2 - fish.target.y; }
        const dx = tx - fish.x, dy = ty - fish.y, d = Math.sqrt(dx*dx + dy*dy);
        if (d > 0) {
            const ms = fish.targetType === "flee" ? speed * 2 : speed;
            fish.vx += dx / d * ms * 0.1; fish.vy += dy / d * ms * 0.1;
        }
    } else {
        fish.behaviorTimer++;
        if (fish.behaviorTimer > 60) { fish.wanderAngle += (Math.random() - 0.5); fish.behaviorTimer = 0; }
        fish.vx += Math.cos(fish.wanderAngle) * speed * 0.03;
        fish.vy += Math.sin(fish.wanderAngle) * speed * 0.02;

        if (spec.schooling) {
            let cx = 0, cy = 0, n = 0;
            for (const f of state.fishes) {
                if (f.id !== fish.id && !f.dead && f.species === fish.species && distance(fish, f) < 100) {
                    cx += f.x; cy += f.y; n++;
                }
            }
            if (n > 0) { fish.vx += (cx / n - fish.x) * 0.001; fish.vy += (cy / n - fish.y) * 0.001; }
        }
    }

    fish.vx *= 0.95; fish.vy *= 0.95;
    const cur = Math.hypot(fish.vx, fish.vy);
    if (cur > fish.speed) { fish.vx = fish.vx / cur * fish.speed; fish.vy = fish.vy / cur * fish.speed; }

    fish.x += fish.vx; fish.y += fish.vy;
    if (Math.abs(fish.vx) > 0.1) fish.facingRight = fish.vx > 0;

    const top = CONFIG.aquarium.waterLevel + 20;
    const bottom = CONFIG.aquarium.height - CONFIG.aquarium.sandHeight - fish.size;
    if (fish.x < 30) fish.vx += 0.2;
    if (fish.x > CONFIG.aquarium.width - 30) fish.vx -= 0.2;
    if (fish.y < top) fish.vy += 0.2;
    if (fish.y > bottom && !spec.bottomDweller) fish.vy -= 0.2;
    fish.x = clamp(fish.x, 10, CONFIG.aquarium.width - 10);
    fish.y = clamp(fish.y, top, bottom);
}

function interactFish(fish) {
    const spec = SPECIES[fish.species];

    for (let i = state.food.length - 1; i >= 0; i--) {
        const f = state.food[i];
        if (distance(fish, f) < fish.size + f.size) {
            fish.energy = Math.min(fish.maxEnergy, fish.energy + f.nutrition);
            fish.hp = Math.min(fish.maxHp, fish.hp + 2);
            state.food.splice(i, 1);
            break;
        }
    }

    if (fish.targetType === "prey" && fish.target && !fish.target.dead) {
        const prey = fish.target;
        if (distance(fish, prey) < fish.size + (prey.size || 5)) {
            const fi = state.fry.indexOf(prey);
            if (fi !== -1) {
                state.fry.splice(fi, 1);
                fish.energy = Math.min(fish.maxEnergy, fish.energy + 30);
                addEvent(`🦈 "${fish.name}" съела малька`, "combat");
            } else {
                prey.dead = true;
                makeCorpse(prey);
                state.stats.totalDied++;
                fish.energy = Math.min(fish.maxEnergy, fish.energy + 50);
                addEvent(`🦈 ${spec.name} "${fish.name}" съела ${SPECIES[prey.species].name} "${prey.name}"`, "combat");
            }
            fish.target = null;
        }
    }

    if (spec.diet.includes("detritus")) {
        for (const c of state.corpses) {
            if (distance(fish, c) < fish.size + 10) {
                fish.energy = Math.min(fish.maxEnergy, fish.energy + 20);
                c.decomposition += 5;
                break;
            }
        }
    }
}

function tryBreed(fish) {
    if (fish.targetType !== "mate" || !fish.target || fish.target.dead) return;
    const spec = SPECIES[fish.species];
    const mate = fish.target;
    if (distance(fish, mate) > fish.size + mate.size + 10) return;
    if (state.fishes.length + state.fry.length >= CONFIG.ecosystem.maxFishCount) return;

    const mother = fish.gender === "female" ? fish : mate;
    const father = fish.gender === "male" ? fish : mate;

    if (spec.reproduction === "egg") layEggs(mother, father);
    else {
        mother.pregnant = true;
        mother.gestationLeft = spec.gestation;
        addEvent(`🤰 ${spec.name} "${mother.name}" беременна от "${father.name}"`, "birth");
    }
    mother.breedCooldown = spec.breedInterval + (spec.gestation || 0);
    father.breedCooldown = spec.breedInterval;
    mother.target = null; father.target = null;
}

function layEggs(mother, father) {
    const spec = SPECIES[mother.species];
    // ⭐ лимит икры
    const room = CONFIG.limits.maxEggs - state.eggs.length;
    if (room <= 0) return;
    const count = Math.min(randInt(spec.clutch.min, spec.clutch.max), room);

    let baseX = mother.x, baseY = mother.y;
    if (spec.eggLaying === "plant" && state.plants.length) {
        const p = state.plants[randInt(0, state.plants.length - 1)];
        baseX = p.x + rand(-20, 20); baseY = p.baseY - p.height * rand(0.3, 0.8);
    } else if (spec.eggLaying === "rock" && state.rocks.length) {
        const r = state.rocks[randInt(0, state.rocks.length - 1)];
        baseX = r.x + rand(-10, 10); baseY = r.y - r.height / 2;
    } else if (spec.eggLaying === "glass") {
        baseX = Math.random() < 0.5 ? 20 : CONFIG.aquarium.width - 20;
        baseY = rand(100, CONFIG.aquarium.height - 200);
    }

    for (let i = 0; i < count; i++) {
        state.eggs.push({
            id: generateId(), x: baseX + rand(-15, 15), y: baseY + rand(-15, 15),
            species: mother.species, motherGen: mother.generation, fatherGen: father.generation,
            incubationLeft: spec.incubation, size: rand(1.5, 3),
        });
    }
    state.stats.totalEggsLaid += count;
    addEvent(`🥚 ${spec.name} "${mother.name}" отложила ${count} икринок`, "birth");
}

function makeFry(spKey, x, y, gen) {
    const spec = SPECIES[spKey];
    return {
        id: generateId(), species: spKey,
        name: getRandomName(Math.random() < 0.5 ? "male" : "female"),
        x, y, vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5),
        facingRight: Math.random() < 0.5, size: 3 + Math.random() * 2,
        maxSize: spec.size.min, speed: spec.speed.min * 1.2,
        energy: 50, growthDays: 0, generation: gen,
        swimPhase: Math.random() * Math.PI * 2,
    };
}

function giveBirth(mother) {
    const spec = SPECIES[mother.species];
    // ⭐ лимит мальков
    const room = CONFIG.limits.maxFry - state.fry.length;
    const count = Math.min(randInt(spec.litter.min, spec.litter.max), Math.max(0, room));
    for (let i = 0; i < count; i++) {
        state.fry.push(makeFry(mother.species, mother.x + rand(-10, 10), mother.y + rand(-10, 10), mother.generation + 1));
    }
    mother.pregnant = false; mother.gestationLeft = 0;
    state.stats.totalFryBorn += count;
    if (count > 0) addEvent(`👶 "${mother.name}" родила ${count} мальков`, "birth");
}

function makeCorpse(fish) {
    // ⭐ лимит трупов
    if (state.corpses.length >= CONFIG.limits.maxCorpses) state.corpses.shift();
    state.corpses.push({
        id: fish.id, x: fish.x, y: fish.y, species: fish.species, name: fish.name,
        size: fish.size, decomposition: 0, facingRight: fish.facingRight,
    });
    state.environment.quality = Math.max(0, state.environment.quality - 0.5);
}

function killFish(fish) {
    if (fish.dead) return;
    fish.dead = true;
    const cause = fish.energy <= 0 ? "голод" : fish.hp <= 0 ? "болезнь" : "старость";
    makeCorpse(fish);
    state.stats.totalDied++;
    addEvent(`💀 ${SPECIES[fish.species].name} "${fish.name}" умерла (${cause}, ${Math.floor(fish.age)} дн.)`, "death");
}

// ============================================================
// ==================== МАЛЬКИ ================================
// ============================================================

function updateFry() {
    for (let i = state.fry.length - 1; i >= 0; i--) {
        const fry = state.fry[i];
        const spec = SPECIES[fry.species];

        fry.growthDays += 1 / CONFIG.time.ticksPerDay;
        fry.swimPhase += 0.2;
        fry.energy -= 0.03;
        fry.size = 3 + (fry.maxSize - 3) * Math.min(1, fry.growthDays / spec.maturity);

        if (fry.energy <= 0) { state.fry.splice(i, 1); state.stats.totalDied++; continue; }

        for (let j = state.food.length - 1; j >= 0; j--) {
            if (distance(fry, state.food[j]) < fry.size + 3) {
                fry.energy = Math.min(100, fry.energy + state.food[j].nutrition);
                state.food.splice(j, 1);
                break;
            }
        }

        if (fry.growthDays >= spec.maturity * 0.7) {
            const adult = createFish(fry.species, fry.x, fry.y);
            adult.name = fry.name; adult.generation = fry.generation;
            adult.age = fry.growthDays; adult.size = fry.size;
            state.fishes.push(adult);
            state.fry.splice(i, 1);
            state.stats.totalBorn++;
            addEvent(`🎉 Малёк "${fry.name}" (${spec.name}) вырос!`, "birth");
            continue;
        }

        fry.vx += (Math.random() - 0.5) * 0.3;
        fry.vy += (Math.random() - 0.5) * 0.2;
        fry.vx *= 0.9; fry.vy *= 0.9;
        fry.x += fry.vx; fry.y += fry.vy;
        if (Math.abs(fry.vx) > 0.1) fry.facingRight = fry.vx > 0;
        const top = CONFIG.aquarium.waterLevel + 20;
        const bottom = CONFIG.aquarium.height - CONFIG.aquarium.sandHeight - 10;
        fry.x = clamp(fry.x, 10, CONFIG.aquarium.width - 10);
        fry.y = clamp(fry.y, top, bottom);
        if (fry.x <= 10 || fry.x >= CONFIG.aquarium.width - 10) fry.vx *= -1;
        if (fry.y <= top || fry.y >= bottom) fry.vy *= -1;
    }
}

// ============================================================
// ====================== ИКРА ================================
// ============================================================

function updateEggs() {
    for (let i = state.eggs.length - 1; i >= 0; i--) {
        const egg = state.eggs[i];
        egg.incubationLeft -= 1 / CONFIG.time.ticksPerDay;

        // ⭐ естественная смертность икры (грибок) — выживают не все
        if (Math.random() < 0.00005) { state.eggs.splice(i, 1); continue; }

        if (SPECIES[egg.species].eggLaying === "water") {
            egg.y += 0.3;
            const b = CONFIG.aquarium.height - CONFIG.aquarium.sandHeight - 5;
            if (egg.y > b) egg.y = b;
        }

        // ⭐ икру едят только голодные рыбы
        let eaten = false;
        for (const fish of state.fishes) {
            if (fish.dead || fish.energy > 85) continue;
            if (distance(fish, egg) < fish.size + egg.size) {
                fish.energy = Math.min(fish.maxEnergy, fish.energy + 5);
                eaten = true;
                break;
            }
        }
        if (eaten) { state.eggs.splice(i, 1); continue; }

        if (egg.incubationLeft <= 0) {
            state.eggs.splice(i, 1);
            // ⭐ если малёк не влезает в лимит — погибает (природа сурова)
            if (state.fry.length >= CONFIG.limits.maxFry) continue;
            const fry = makeFry(egg.species, egg.x, egg.y, Math.max(egg.motherGen, egg.fatherGen) + 1);
            state.fry.push(fry);
            state.stats.totalFryBorn++;
            addEvent(`🐣 Вылупился "${fry.name}" (${SPECIES[egg.species].name})`, "birth");
        }
    }
}

// ============================================================
// ================== ТРУПЫ И БАКТЕРИИ ========================
// ============================================================

function updateCorpses() {
    for (let i = state.corpses.length - 1; i >= 0; i--) {
        const c = state.corpses[i];
        const bY = CONFIG.aquarium.height - CONFIG.aquarium.sandHeight - c.size / 2;
        if (c.y < bY) c.y += 0.5; else c.y = bY;

        c.decomposition += 0.05 + state.bacteria.length * 0.002;

        if (Math.random() < 0.01 && state.bacteria.length < CONFIG.limits.maxBacteria) {
            state.bacteria.push({
                id: generateId(), x: c.x + rand(-5, 5), y: c.y + rand(-5, 5),
                vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.5) * 0.5,
                life: randInt(100, 300),
            });
        }
        if (c.decomposition >= 100) {
            state.corpses.splice(i, 1);
            state.environment.quality = Math.min(100, state.environment.quality + 2);
        }
    }
}

function updateBacteria() {
    for (let i = state.bacteria.length - 1; i >= 0; i--) {
        const b = state.bacteria[i];
        if (--b.life <= 0) { state.bacteria.splice(i, 1); continue; }
        let nearest = null, nd = Infinity;
        for (const c of state.corpses) {
            const d = distance(b, c);
            if (d < nd) { nd = d; nearest = c; }
        }
        if (nearest && nd > 5) { b.vx += (nearest.x - b.x) / nd * 0.1; b.vy += (nearest.y - b.y) / nd * 0.1; }
        b.vx *= 0.95; b.vy *= 0.95;
        b.x = clamp(b.x + b.vx, 5, CONFIG.aquarium.width - 5);
        b.y = clamp(b.y + b.vy, CONFIG.aquarium.waterLevel, CONFIG.aquarium.height - 10);
    }
}

function updateFood() {
    for (let i = state.food.length - 1; i >= 0; i--) {
        const f = state.food[i];
        if (f.sinking) {
            f.vy += 0.005; f.y += f.vy; f.x += Math.sin(f.y * 0.05) * 0.1;
            const b = CONFIG.aquarium.height - CONFIG.aquarium.sandHeight - f.size;
            if (f.y >= b) { f.y = b; f.sinking = false; f.life = 500; }
        } else if (--f.life <= 0) state.food.splice(i, 1);
    }
}

function updateBubbles() {
    if (Math.random() < 0.05 && state.plants.length) {
        const p = state.plants[randInt(0, state.plants.length - 1)];
        state.bubbles.push({
            x: p.x + rand(-10, 10), y: p.baseY - p.height * 0.5,
            size: rand(1, 4), speed: rand(0.5, 1.5), wobble: rand(0, Math.PI * 2),
        });
    }
    for (let i = state.bubbles.length - 1; i >= 0; i--) {
        const b = state.bubbles[i];
        b.y -= b.speed; b.x += Math.sin(b.wobble) * 0.3; b.wobble += 0.05;
        if (b.y < CONFIG.aquarium.waterLevel) state.bubbles.splice(i, 1);
    }
}

function updateEnvironment() {
    const w = CONFIG.water;
    const fishO2 = (state.fishes.length + state.fry.length * 0.3) * w.oxygenConsumptionPerFish;
    const plantO2 = state.plants.length * CONFIG.plants.oxygenPerTick;
    const surface = (100 - state.environment.oxygen) * w.surfaceExchange;
    state.environment.oxygen = clamp(state.environment.oxygen + plantO2 + surface - fishO2, 0, 100);
    state.environment.quality = clamp(
        state.environment.quality + state.bacteria.length * 0.0001 - state.corpses.length * 0.0005, 0, 100);
    state.environment.temperature = 25 + Math.sin(state.gameTime.ticks * 0.001) * 0.5;
}

// ⭐ стресс от перенаселения — экосистема сама балансируется
function crowdingStress() {
    const pop = state.fishes.length + state.fry.length * 0.5;
    const over = pop - CONFIG.ecosystem.maxFishCount;
    if (over > 0) {
        const stress = over * 0.0015;
        for (const f of state.fishes) f.hp -= stress;
        for (const f of state.fry) f.energy -= stress * 5;
    }
}

function populationControl() {
    if (state.fishes.length < CONFIG.ecosystem.minFishCount && state.fry.length < 5) {
        const keys = Object.keys(SPECIES);
        const sp = keys[randInt(0, keys.length - 1)];
        const f = createFish(sp);
        f.age = SPECIES[sp].maturity + 20;
        f.size = SPECIES[sp].size.max * 0.9;
        state.fishes.push(f);
        addEvent(`⚡ Экстренный спавн: ${SPECIES[sp].name}`, "system");
    }
}

function addEvent(msg, type = "info") {
    state.events.push({
        id: generateId(), message: msg, type,
        time: new Date().toISOString(),
        gameDay: Math.floor(state.gameTime.ticks / CONFIG.time.ticksPerDay),
    });
    if (state.events.length > 100) state.events = state.events.slice(-100);
}

// ============================================================
// =================== ГЛАВНЫЙ ЦИКЛ ===========================
// ============================================================

function tick() {
    state.gameTime.ticks++;
    state.gameTime.days = Math.floor(state.gameTime.ticks / CONFIG.time.ticksPerDay);
    state.gameTime.hours = Math.floor((state.gameTime.ticks % CONFIG.time.ticksPerDay) / CONFIG.time.ticksPerHour);

    for (const f of state.fishes) updateFish(f);
    state.fishes = state.fishes.filter(f => !f.dead);

    updateFry(); updateEggs(); updateCorpses(); updateBacteria();
    updateFood(); updateBubbles(); updateEnvironment();
    crowdingStress(); populationControl();

    const days = state.gameTime.ticks / CONFIG.time.ticksPerDay;
    if (days - state.lastFeedTime >= CONFIG.ecosystem.feedIntervalDays) feedFish();
}

// ============================================================
// ======================= API ================================
// ============================================================

const serverStartTime = Date.now();

app.get("/state", (req, res) => {
    const speciesStats = {};
    for (const k in SPECIES) speciesStats[k] = { name: SPECIES[k].name, nameLatin: SPECIES[k].nameLatin, adults: 0, fry: 0, eggs: 0 };
    for (const f of state.fishes) if (speciesStats[f.species]) speciesStats[f.species].adults++;
    for (const f of state.fry) if (speciesStats[f.species]) speciesStats[f.species].fry++;
    for (const e of state.eggs) if (speciesStats[e.species]) speciesStats[e.species].eggs++;

    res.json({
        config: { aquarium: CONFIG.aquarium },
        fishes: state.fishes, fry: state.fry, eggs: state.eggs,
        corpses: state.corpses, bacteria: state.bacteria,
        food: state.food, bubbles: state.bubbles,
        plants: state.plants, rocks: state.rocks,
        environment: state.environment, gameTime: state.gameTime,
        species: SPECIES, speciesStats,
        stats: { ...state.stats, serverUptime: Math.floor((Date.now() - serverStartTime) / 1000) },
        events: state.events.slice(-30),
    });
});

app.get("/ping", (req, res) => {
    res.json({ status: "alive", uptime: Math.floor((Date.now() - serverStartTime) / 1000), population: state.fishes.length });
});

function doFeed(res) {
    for (let i = 0; i < 10; i++) spawnFood();
    state.stats.manualFeeds++;
    addEvent(`🍞 Посетитель покормил рыбок! (всего: ${state.stats.manualFeeds})`, "system");
    res.json({ ok: true, manualFeeds: state.stats.manualFeeds, autoFeeds: state.stats.autoFeeds });
}
app.post("/feed", (req, res) => doFeed(res));
app.get("/feed", (req, res) => doFeed(res));

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

// ============================================================
// ================== SELF-PING ===============================
// ============================================================

const SERVER_URL = process.env.RENDER_EXTERNAL_URL || "http://localhost:3000";
function selfPing() {
    const client = SERVER_URL.startsWith("https") ? require("https") : require("http");
    client.get(`${SERVER_URL}/ping`, (r) => {
        console.log(`🏓 ping ${r.statusCode} | рыб ${state.fishes.length} | день ${state.gameTime.days}`);
    }).on("error", (e) => console.error("❌ ping:", e.message));
}

initWorld();
setInterval(tick, CONFIG.time.tickMs);
setInterval(selfPing, 5 * 60 * 1000);
process.on("SIGINT", () => { saveState(); process.exit(); });
process.on("SIGTERM", () => { saveState(); process.exit(); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🐠 Аквариум на порту ${PORT} | рыб: ${state.fishes.length}`));
