const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// ============================================================
// ================= КОНФИГУРАЦИЯ МИРА ========================
// ============================================================

const CONFIG = {
    // Аквариум
    aquarium: {
        width: 1400,
        height: 800,
        sandHeight: 80,        // высота песка
        waterLevel: 50,        // уровень воды сверху (для пузырьков)
    },

    // ВРЕМЯ: 1 игровой день = 60 секунд реального времени
    time: {
        tickMs: 50,                        // 50мс = 1 тик
        ticksPerSecond: 20,                // 20 тиков в секунду
        secondsPerDay: 60,                 // 1 день = 60 сек
        ticksPerDay: 20 * 60,              // 1200 тиков в день
        ticksPerHour: 1200 / 24,           // 50 тиков в час
    },

    // Экосистема
    ecosystem: {
        targetFishCount: 25,               // целевое количество рыб
        maxFishCount: 60,                  // максимум
        minFishCount: 8,                   // минимум (перед спавном)
        maxFoodParticles: 40,              // максимум корма в воде
        feedIntervalDays: 0.5,             // кормить каждые 0.5 дня (12 часов)
        foodPerFeed: 15,                   // частиц корма за раз
    },

    // Растения
    plants: {
        count: 6,                          // количество растений
        oxygenPerTick: 0.02,               // кислорода за тик
    },

    // Вода
    water: {
        initialOxygen: 100,                // начальный уровень кислорода
        initialQuality: 100,               // начальное качество воды
        minOxygenForLife: 20,              // ниже этого рыба задыхается
        oxygenConsumptionPerFish: 0.015,   // потребление кислорода рыбой за тик
        qualityDecayPerCorpse: 0.5,        // ухудшение качества от трупа в день
    },
};

// ============================================================
// =================== ВИДЫ РЫБ ===============================
// ============================================================

const SPECIES = {
    guppy: {
        name: "Гуппи",
        nameLatin: "Poecilia reticulata",
        reproduction: "livebearer",        // живородящая
        size: { min: 12, max: 18 },
        speed: { min: 0.8, max: 1.2 },
        color: { body: "#FF6B9D", tail: "#FFA500" },
        lifespan: { min: 365, max: 730 },  // дни
        maturity: 60,                      // дней до зрелости
        gestation: 25,                     // дней беременности
        litter: { min: 3, max: 8 },        // мальков в помёте
        breedInterval: 14,                 // дней между родами
        visionRange: 150,
        aggression: 0.05,
        diet: ["food"],                    // ест корм
        oxygenNeed: 0.8,
        canEatFish: false,
        schooling: true,                   // стайная
        eggLaying: null,                   // не мечет икру
    },
    neon: {
        name: "Неон",
        nameLatin: "Paracheirodon innesi",
        reproduction: "egg",
        size: { min: 8, max: 12 },
        speed: { min: 1.0, max: 1.5 },
        color: { body: "#00D4FF", tail: "#FF0040", stripe: "#00FFFF" },
        lifespan: { min: 1095, max: 1825 }, // 3-5 лет
        maturity: 90,
        incubation: 3,                     // дней инкубации икры
        clutch: { min: 50, max: 150 },     // икринок
        breedInterval: 21,
        visionRange: 120,
        aggression: 0.02,
        diet: ["food"],
        oxygenNeed: 0.6,
        canEatFish: false,
        schooling: true,
        eggLaying: "water",                // мечет икру в воду
        glow: true,                        // светящаяся полоса
    },
    angelfish: {
        name: "Скалярия",
        nameLatin: "Pterophyllum scalare",
        reproduction: "egg",
        size: { min: 35, max: 50 },
        speed: { min: 0.5, max: 0.8 },
        color: { body: "#F5F5DC", tail: "#C0C0C0", stripes: "#333333" },
        lifespan: { min: 2920, max: 3650 }, // 8-10 лет
        maturity: 240,
        incubation: 5,
        clutch: { min: 100, max: 300 },
        breedInterval: 30,
        visionRange: 200,
        aggression: 0.3,
        diet: ["food", "fry"],             // ест мальков!
        oxygenNeed: 1.5,
        canEatFish: true,
        maxPreySize: 15,                   // может съесть рыбу меньше 15px
        schooling: false,
        eggLaying: "plant",                // икра на растениях
        shape: "triangle",                 // треугольная форма
    },
    swordtail: {
        name: "Меченосец",
        nameLatin: "Xiphophorus hellerii",
        reproduction: "livebearer",
        size: { min: 20, max: 30 },
        speed: { min: 0.9, max: 1.3 },
        color: { body: "#FF4444", tail: "#FF0000", sword: "#FFD700" },
        lifespan: { min: 1095, max: 1825 },
        maturity: 90,
        gestation: 28,
        litter: { min: 5, max: 15 },
        breedInterval: 18,
        visionRange: 160,
        aggression: 0.15,
        diet: ["food"],
        oxygenNeed: 1.0,
        canEatFish: false,
        schooling: false,
        hasSword: true,                    // меч на хвосте у самцов
    },
    corydoras: {
        name: "Коридорас",
        nameLatin: "Corydoras paleatus",
        reproduction: "egg",
        size: { min: 15, max: 22 },
        speed: { min: 0.4, max: 0.7 },
        color: { body: "#8B7355", tail: "#696969", spots: "#333" },
        lifespan: { min: 1460, max: 1825 }, // 4-5 лет
        maturity: 120,
        incubation: 4,
        clutch: { min: 20, max: 60 },
        breedInterval: 21,
        visionRange: 100,
        aggression: 0.01,
        diet: ["food", "detritus"],        // ест остатки со дна
        oxygenNeed: 0.7,
        canEatFish: false,
        schooling: true,
        bottomDweller: true,               // живёт на дне
        eggLaying: "glass",                // икра на стекле
    },
    cichlid: {
        name: "Цихлида",
        nameLatin: "Astronotus ocellatus",
        reproduction: "egg",
        size: { min: 40, max: 65 },
        speed: { min: 0.7, max: 1.0 },
        color: { body: "#2F2F2F", tail: "#1a1a1a", spots: "#FF6600" },
        lifespan: { min: 3650, max: 5475 }, // 10-15 лет
        maturity: 365,
        incubation: 7,
        clutch: { min: 200, max: 500 },
        breedInterval: 45,
        visionRange: 250,
        aggression: 0.7,
        diet: ["food", "fry", "smallfish"],
        oxygenNeed: 2.0,
        canEatFish: true,
        maxPreySize: 25,
        schooling: false,
        eggLaying: "rock",                 // икра на камнях
        intelligent: true,
    },
};

// ============================================================
// =================== ИМЕНА РЫБ ==============================
// ============================================================

const FISH_NAMES = {
    male: [
        "Аркадий", "Борис", "Владимир", "Геннадий", "Дмитрий",
        "Евгений", "Жан", "Захар", "Игорь", "Кирилл",
        "Леонид", "Максим", "Николай", "Олег", "Пётр",
        "Роман", "Степан", "Тимофей", "Фёдор", "Харитон",
        "Эдуард", "Юрий", "Яков", "Альфред", "Бруно",
        "Вальтер", "Густав", "Диего", "Жак", "Карл",
        "Нептун", "Посейдон", "Тритон", "Одиссей", "Атлас",
    ],
    female: [
        "Алиса", "Белла", "Венера", "Глория", "Диана",
        "Ева", "Жасмин", "Злата", "Изабелла", "Клеопатра",
        "Луна", "Марина", "Нефера", "Офелия", "Пенелопа",
        "Роза", "Селена", "Тея", "Ундина", "Фиалка",
        "Хлоя", "Царина", "Шакира", "Эльза", "Юнона",
        "Ариэль", "Бриджит", "Грейс", "Долорес", "Есения",
        "Корал", "Марина", "Нимфа", "Океана", "Пёрл",
    ],
};

function getRandomName(gender) {
    const names = FISH_NAMES[gender] || FISH_NAMES.male;
    return names[Math.floor(Math.random() * names.length)];
}

// ============================================================
// ================= УТИЛИТЫ ==================================
// ============================================================

function rand(min, max) {
    return Math.random() * (max - min) + min;
}

function randInt(min, max) {
    return Math.floor(rand(min, max + 1));
}

function distance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}

function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
}

// ============================================================
// ================== ID GENERATOR ============================
// ============================================================

let nextId = 1;
function generateId() {
    return nextId++;
}

// ============================================================
// =================== СОСТОЯНИЕ ==============================
// ============================================================

const STATE_FILE = path.join(__dirname, "world_state.json");

let state = {
    fishes: [],
    eggs: [],
    fry: [],           // мальки
    corpses: [],
    bacteria: [],      // бактерии-разлагатели
    food: [],
    bubbles: [],       // визуальные пузырьки
    plants: [],
    rocks: [],

    environment: {
        oxygen: CONFIG.water.initialOxygen,
        quality: CONFIG.water.initialQuality,
        temperature: 25,       // °C
        ph: 7.0,
    },

    gameTime: {
        ticks: 0,
        days: 0,
        hours: 0,
    },

    stats: {
        totalBorn: 0,
        totalDied: 0,
        totalEggsLaid: 0,
        totalFryBorn: 0,
        serverStartedAt: new Date().toISOString(),
        lastSavedAt: null,
    },

    events: [],
    lastFeedTime: 0,
};

// ============================================================
// ================== СОХРАНЕНИЕ ==============================
// ============================================================

function saveState() {
    try {
        state.stats.lastSavedAt = new Date().toISOString();
        // Сохраняем только важные данные (без визуала)
        const saveData = {
            fishes: state.fishes,
            eggs: state.eggs,
            fry: state.fry,
            corpses: state.corpses,
            bacteria: state.bacteria,
            plants: state.plants,
            rocks: state.rocks,
            environment: state.environment,
            gameTime: state.gameTime,
            stats: state.stats,
            lastFeedTime: state.lastFeedTime,
            nextId: nextId,
        };
        fs.writeFileSync(STATE_FILE, JSON.stringify(saveData, null, 2));
    } catch (e) {
        console.error("Ошибка сохранения:", e.message);
    }
}

function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
            state.fishes = data.fishes || [];
            state.eggs = data.eggs || [];
            state.fry = data.fry || [];
            state.corpses = data.corpses || [];
            state.bacteria = data.bacteria || [];
            state.plants = data.plants || [];
            state.rocks = data.rocks || [];
            state.environment = data.environment || state.environment;
            state.gameTime = data.gameTime || state.gameTime;
            state.stats = data.stats || state.stats;
            state.lastFeedTime = data.lastFeedTime || 0;
            nextId = data.nextId || nextId;
            console.log(`✅ Загружено состояние: ${state.fishes.length} рыб, ${state.gameTime.days} дней`);
            addEvent("🔄 Мир восстановлен из сохранения", "system");
            return true;
        }
    } catch (e) {
        console.error("Ошибка загрузки:", e.message);
    }
    return false;
}

// Сохраняем каждые 30 секунд
setInterval(saveState, 30000);

// ============================================================
// =================== ИНИЦИАЛИЗАЦИЯ ==========================
// ============================================================

function initWorld() {
    if (loadState()) return; // загружаем сохранение

    // Создаём растения
    for (let i = 0; i < CONFIG.plants.count; i++) {
        state.plants.push({
            id: generateId(),
            x: rand(100, CONFIG.aquarium.width - 100),
            baseY: CONFIG.aquarium.height - CONFIG.aquarium.sandHeight,
            height: rand(150, 300),
            width: rand(40, 80),
            leaves: randInt(4, 8),
            swayOffset: Math.random() * Math.PI * 2,
            type: randInt(0, 2),           // тип растения
        });
    }

    // Создаём камни
    for (let i = 0; i < 5; i++) {
        state.rocks.push({
            id: generateId(),
            x: rand(50, CONFIG.aquarium.width - 50),
            y: CONFIG.aquarium.height - CONFIG.aquarium.sandHeight + rand(0, 40),
            width: rand(30, 80),
            height: rand(20, 50),
            color: `hsl(${randInt(20, 40)}, ${randInt(10, 30)}%, ${randInt(30, 50)}%)`,
        });
    }

    // Создаём начальных рыб (по 2-3 каждого вида)
    const speciesKeys = Object.keys(SPECIES);
    for (const species of speciesKeys) {
        const count = randInt(2, 3);
        for (let i = 0; i < count; i++) {
            const fish = createFish(species);
            fish.age = SPECIES[species].maturity + randInt(10, 50); // уже взрослые
            fish.size = SPECIES[species].size.max * rand(0.8, 1.0);
            state.fishes.push(fish);
        }
    }

    // Начальная еда
    for (let i = 0; i < 20; i++) {
        spawnFood();
    }

    addEvent("🌊 Аквариум создан! Экосистема начинает развиваться...", "system");
    saveState();
}

function createFish(speciesKey, x = null, y = null) {
    const spec = SPECIES[speciesKey];
    const gender = Math.random() < 0.5 ? "male" : "female";

    return {
        id: generateId(),
        name: getRandomName(gender),
        species: speciesKey,
        gender: gender,
        generation: 1,

        // Позиция
        x: x ?? rand(100, CONFIG.aquarium.width - 100),
        y: y ?? rand(100, CONFIG.aquarium.height - CONFIG.aquarium.sandHeight - 50),
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 0.5,
        facingRight: Math.random() < 0.5,

        // Характеристики
        size: rand(spec.size.min, spec.size.max),
        baseSize: rand(spec.size.min, spec.size.max),
        speed: rand(spec.speed.min, spec.speed.max),
        energy: 100,
        maxEnergy: 100,
        hp: 100,
        maxHp: 100,

        // Возраст (в днях)
        age: 0,
        lifespan: randInt(spec.lifespan.min, spec.lifespan.max),

        // Размножение
        maturity: spec.maturity,
        breedCooldown: 0,
        pregnant: false,
        gestationLeft: 0,
        mate: null,

        // AI
        target: null,
        targetType: "wander",
        wanderAngle: Math.random() * Math.PI * 2,
        behaviorTimer: 0,

        // Визуальное
        swimPhase: Math.random() * Math.PI * 2,
        color: { ...spec.color },
    };
}

function spawnFood() {
    if (state.food.length >= CONFIG.ecosystem.maxFoodParticles) return;

    state.food.push({
        id: generateId(),
        x: rand(50, CONFIG.aquarium.width - 50),
        y: CONFIG.aquarium.waterLevel + 10,  // падает сверху
        vy: rand(0.2, 0.5),
        size: rand(2, 4),
        nutrition: rand(15, 25),
        sinking: true,
    });
}

function feedFish() {
    const count = CONFIG.ecosystem.foodPerFeed;
    for (let i = 0; i < count; i++) {
        spawnFood();
    }
    state.lastFeedTime = state.gameTime.days;
    addEvent(`🍽️ Авто-кормушка: насыпано ${count} порций корма`, "system");
}

// ============================================================
// ==================== ЛОГИКА РЫБ ============================
// ============================================================

function updateFish(fish, index) {
    const spec = SPECIES[fish.species];

    // Обновляем возраст (в игровых днях)
    fish.age += 1 / CONFIG.time.ticksPerDay;
    fish.swimPhase += 0.15 * fish.speed;

    // Кулдауны
    fish.breedCooldown = Math.max(0, fish.breedCooldown - 1 / CONFIG.time.ticksPerDay);

    // Проверка зрелости и беременности
    if (fish.pregnant && spec.reproduction === "livebearer") {
        fish.gestationLeft -= 1 / CONFIG.time.ticksPerDay;
        if (fish.gestationLeft <= 0) {
            giveBirth(fish);
        }
    }

    // Трата энергии
    const energyCost = 0.02 * (fish.size / 20) * (fish.speed / spec.speed.min);
    fish.energy -= energyCost;

    // Кислород
    if (state.environment.oxygen < CONFIG.water.minOxygenForLife) {
        fish.hp -= 0.5;
        // Рыба всплывает к поверхности
        fish.vy -= 0.1;
    }

    // Старение - после 80% жизни начинает слабеть
    const lifeProgress = fish.age / fish.lifespan;
    if (lifeProgress > 0.8) {
        const decay = (lifeProgress - 0.8) * 5;
        fish.hp -= decay * 0.1;
        fish.speed *= 0.999;
    }

    // Смерть
    if (fish.energy <= 0 || fish.hp <= 0 || fish.age >= fish.lifespan) {
        killFish(fish, index);
        return false;
    }

    // Донные рыбы держатся у дна
    if (spec.bottomDweller) {
        const bottomY = CONFIG.aquarium.height - CONFIG.aquarium.sandHeight - fish.size;
        if (fish.y < bottomY - 30) {
            fish.vy += 0.05;
        }
        fish.y = Math.min(fish.y, bottomY);
    }

    // ИИ: поиск цели
    findTarget(fish);

    // Движение
    moveFish(fish);

    // Взаимодействия
    interactFish(fish);

    // Размножение
    tryBreed(fish);

    // Рост
    if (fish.age < fish.maturity) {
        const growthProgress = fish.age / fish.maturity;
        fish.size = spec.size.min + (fish.baseSize - spec.size.min) * growthProgress;
    }

    return true;
}

function findTarget(fish) {
    const spec = SPECIES[fish.species];

    // Приоритеты
    let nearestFood = null, nearestFoodDist = Infinity;
    let nearestPrey = null, nearestPreyDist = Infinity;
    let nearestMate = null, nearestMateDist = Infinity;
    let nearestPredator = null, nearestPredatorDist = Infinity;

    // Ищем еду
    if (fish.energy < 70) {
        for (const f of state.food) {
            const d = distance(fish, f);
            if (d < spec.visionRange && d < nearestFoodDist) {
                nearestFood = f;
                nearestFoodDist = d;
            }
        }
    }

    // Ищем добычу (для хищников)
    if (spec.canEatFish && fish.energy < 80) {
        for (const f of state.fishes) {
            if (f.id === fish.id) continue;
            if (f.size > spec.maxPreySize) continue;
            const d = distance(fish, f);
            if (d < spec.visionRange && d < nearestPreyDist) {
                nearestPrey = f;
                nearestPreyDist = d;
            }
        }
        // Мальки тоже добыча
        for (const f of state.fry) {
            const d = distance(fish, f);
            if (d < spec.visionRange * 0.8 && d < nearestPreyDist) {
                nearestPrey = f;
                nearestPreyDist = d;
            }
        }
    }

    // Ищем хищника (бежим)
    for (const f of state.fishes) {
        if (f.id === fish.id) continue;
        const fSpec = SPECIES[f.species];
        if (fSpec.canEatFish && f.size > fish.size * 1.5) {
            const d = distance(fish, f);
            if (d < spec.visionRange && d < nearestPredatorDist) {
                nearestPredator = f;
                nearestPredatorDist = d;
            }
        }
    }

    // Ищем партнёра
    if (fish.age > fish.maturity && fish.breedCooldown === 0 && fish.energy > 60) {
        for (const f of state.fishes) {
            if (f.id === fish.id) continue;
            if (f.species !== fish.species) continue;
            if (f.gender === fish.gender) continue;
            if (f.age < f.maturity) continue;
            if (f.breedCooldown > 0) continue;
            if (f.energy < 60) continue;
            const d = distance(fish, f);
            if (d < spec.visionRange && d < nearestMateDist) {
                nearestMate = f;
                nearestMateDist = d;
            }
        }
    }

    // Определяем цель
    if (nearestPredator && nearestPredatorDist < 80) {
        fish.target = nearestPredator;
        fish.targetType = "flee";
    } else if (nearestFood && fish.energy < 60) {
        fish.target = nearestFood;
        fish.targetType = "food";
    } else if (nearestPrey && spec.canEatFish && fish.energy < 70) {
        fish.target = nearestPrey;
        fish.targetType = "prey";
    } else if (nearestMate && fish.energy > 70) {
        fish.target = nearestMate;
        fish.targetType = "mate";
    } else {
        fish.target = null;
        fish.targetType = "wander";
    }
}

function moveFish(fish) {
    const spec = SPECIES[fish.species];
    const speed = fish.speed * 0.5;

    if (fish.target && fish.targetType !== "wander") {
        let tx = fish.target.x;
        let ty = fish.target.y;

        if (fish.targetType === "flee") {
            // Бежим в противоположную сторону
            tx = fish.x - (fish.target.x - fish.x);
            ty = fish.y - (fish.target.y - fish.y);
        }

        const dx = tx - fish.x;
        const dy = ty - fish.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > 0) {
            const moveSpeed = fish.targetType === "flee" ? speed * 2 : speed;
            fish.vx += (dx / dist) * moveSpeed * 0.1;
            fish.vy += (dy / dist) * moveSpeed * 0.1;
        }
    } else {
        // Блуждание
        fish.behaviorTimer++;
        if (fish.behaviorTimer > randInt(30, 90)) {
            fish.wanderAngle += (Math.random() - 0.5) * 1;
            fish.behaviorTimer = 0;
        }
        fish.vx += Math.cos(fish.wanderAngle) * speed * 0.03;
        fish.vy += Math.sin(fish.wanderAngle) * speed * 0.02;

        // Стайное поведение
        if (spec.schooling) {
            let centerX = 0, centerY = 0, count = 0;
            for (const f of state.fishes) {
                if (f.id === fish.id) continue;
                if (f.species !== fish.species) continue;
                const d = distance(fish, f);
                if (d < 100) {
                    centerX += f.x;
                    centerY += f.y;
                    count++;
                }
            }
            if (count > 0) {
                centerX /= count;
                centerY /= count;
                fish.vx += (centerX - fish.x) * 0.001;
                fish.vy += (centerY - fish.y) * 0.001;
            }
        }
    }

    // Применяем скорость с затуханием
    fish.vx *= 0.95;
    fish.vy *= 0.95;

    // Ограничение скорости
    const maxSpeed = fish.speed;
    const currentSpeed = Math.sqrt(fish.vx * fish.vx + fish.vy * fish.vy);
    if (currentSpeed > maxSpeed) {
        fish.vx = (fish.vx / currentSpeed) * maxSpeed;
        fish.vy = (fish.vy / currentSpeed) * maxSpeed;
    }

    // Обновляем позицию
    fish.x += fish.vx;
    fish.y += fish.vy;

    // Направление взгляда
    if (Math.abs(fish.vx) > 0.1) {
        fish.facingRight = fish.vx > 0;
    }

    // Границы аквариума
    const margin = 30;
    const topLimit = CONFIG.aquarium.waterLevel + 20;
    const bottomLimit = CONFIG.aquarium.height - CONFIG.aquarium.sandHeight - fish.size;

    if (fish.x < margin) fish.vx += 0.2;
    if (fish.x > CONFIG.aquarium.width - margin) fish.vx -= 0.2;
    if (fish.y < topLimit) fish.vy += 0.2;
    if (fish.y > bottomLimit && !spec.bottomDweller) fish.vy -= 0.2;

    fish.x = clamp(fish.x, 10, CONFIG.aquarium.width - 10);
    fish.y = clamp(fish.y, topLimit, bottomLimit);
}

function interactFish(fish) {
    const spec = SPECIES[fish.species];

    // Едим корм
    for (let i = state.food.length - 1; i >= 0; i--) {
        const f = state.food[i];
        if (distance(fish, f) < fish.size + f.size) {
            fish.energy = Math.min(fish.maxEnergy, fish.energy + f.nutrition);
            fish.hp = Math.min(fish.maxHp, fish.hp + 2);
            state.food.splice(i, 1);
            break;
        }
    }

    // Хищник ест других рыб
    if (fish.targetType === "prey" && fish.target) {
        const dist = distance(fish, fish.target);
        if (dist < fish.size + (fish.target.size || 5)) {
            // Съедаем
            const prey = fish.target;

            // Если это малёк
            const fryIndex = state.fry.indexOf(prey);
            if (fryIndex !== -1) {
                state.fry.splice(fryIndex, 1);
                fish.energy = Math.min(fish.maxEnergy, fish.energy + 30);
                addEvent(`🦈 ${SPECIES[fish.species].name} "${fish.name}" съела малька`, "combat");
            } else {
                // Взрослая рыба
                const fishIndex = state.fishes.indexOf(prey);
                if (fishIndex !== -1) {
                    killFish(prey, fishIndex);
                    fish.energy = Math.min(fish.maxEnergy, fish.energy + 50);
                    addEvent(`🦈 ${SPECIES[fish.species].name} "${fish.name}" съела ${SPECIES[prey.species].name} "${prey.name}"`, "combat");
                }
            }
            fish.target = null;
        }
    }

    // Поедание детрита (для сомиков)
    if (spec.diet.includes("detritus")) {
        for (let i = state.corpses.length - 1; i >= 0; i--) {
            const c = state.corpses[i];
            if (distance(fish, c) < fish.size + 10) {
                fish.energy = Math.min(fish.maxEnergy, fish.energy + 20);
                c.decomposition += 5;
                if (c.decomposition >= 100) {
                    state.corpses.splice(i, 1);
                }
                break;
            }
        }
    }
}

function tryBreed(fish) {
    if (fish.targetType !== "mate" || !fish.target) return;

    const spec = SPECIES[fish.species];
    const mate = fish.target;

    // Проверяем дистанцию
    if (distance(fish, mate) > fish.size + mate.size + 10) return;

    // Проверка лимитов
    if (state.fishes.length >= CONFIG.ecosystem.maxFishCount) return;

    // Определяем родителей
    const mother = fish.gender === "female" ? fish : mate;
    const father = fish.gender === "male" ? fish : mate;

    // Если это икромечущая и самка уже отложила икру
    if (spec.reproduction === "egg") {
        layEggs(mother, father);
        mother.breedCooldown = spec.breedInterval;
        father.breedCooldown = spec.breedInterval;
        mother.target = null;
        father.target = null;
        return;
    }

    // Живородящая - беременность
    if (spec.reproduction === "livebearer") {
        mother.pregnant = true;
        mother.gestationLeft = spec.gestation;
        mother.mate = father.id;
        mother.breedCooldown = spec.breedInterval + spec.gestation;
        father.breedCooldown = spec.breedInterval;
        mother.target = null;
        father.target = null;
        addEvent(`🤰 ${spec.name} "${mother.name}" беременна от "${father.name}"`, "birth");
    }
}

function layEggs(mother, father) {
    const spec = SPECIES[mother.species];
    const count = randInt(spec.clutch.min, spec.clutch.max);

    // Определяем место для икры
    let baseX = mother.x;
    let baseY = mother.y;

    if (spec.eggLaying === "plant" && state.plants.length > 0) {
        const plant = state.plants[randInt(0, state.plants.length - 1)];
        baseX = plant.x + rand(-20, 20);
        baseY = plant.baseY - plant.height * rand(0.3, 0.8);
    } else if (spec.eggLaying === "rock" && state.rocks.length > 0) {
        const rock = state.rocks[randInt(0, state.rocks.length - 1)];
        baseX = rock.x + rand(-10, 10);
        baseY = rock.y - rock.height / 2;
    } else if (spec.eggLaying === "glass") {
        // На стекле - слева или справа
        baseX = Math.random() < 0.5 ? 20 : CONFIG.aquarium.width - 20;
        baseY = rand(100, CONFIG.aquarium.height - 200);
    }
    // "water" - просто в воде, упадёт на дно

    for (let i = 0; i < count; i++) {
        state.eggs.push({
            id: generateId(),
            x: baseX + rand(-15, 15),
            y: baseY + rand(-15, 15),
            species: mother.species,
            motherId: mother.id,
            fatherId: father.id,
            motherGen: mother.generation,
            fatherGen: father.generation,
            incubationLeft: SPECIES[mother.species].incubation,
            fertilized: true,
            hp: 100,
            size: rand(1.5, 3),
        });
    }

    state.stats.totalEggsLaid += count;
    addEvent(`🥚 ${spec.name} "${mother.name}" отложила ${count} икринок`, "birth");
}

function giveBirth(mother) {
    const spec = SPECIES[mother.species];
    const count = randInt(spec.litter.min, spec.litter.max);

    for (let i = 0; i < count; i++) {
        const fry = {
            id: generateId(),
            species: mother.species,
            name: getRandomName(Math.random() < 0.5 ? "male" : "female"),
            x: mother.x + rand(-10, 10),
            y: mother.y + rand(-10, 10),
            vx: (Math.random() - 0.5) * 2,
            vy: (Math.random() - 0.5) * 1,
            facingRight: Math.random() < 0.5,
            size: 3 + Math.random() * 2,
            maxSize: SPECIES[mother.species].size.min,
            speed: SPECIES[mother.species].speed.min * 1.2,
            energy: 50,
            hp: 50,
            age: 0,
            growthDays: 0,
            generation: mother.generation + 1,
            swimPhase: Math.random() * Math.PI * 2,
            color: { ...SPECIES[mother.species].color },
        };
        state.fry.push(fry);
    }

    mother.pregnant = false;
    mother.gestationLeft = 0;
    state.stats.totalFryBorn += count;
    addEvent(`👶 ${spec.name} "${mother.name}" родила ${count} мальков (gen ${mother.generation + 1})`, "birth");
}

function killFish(fish, index) {
    // Создаём труп
    state.corpses.push({
        id: fish.id,
        x: fish.x,
        y: fish.y,
        species: fish.species,
        name: fish.name,
        size: fish.size,
        age: fish.age,
        color: { ...fish.color },
        decomposition: 0,          // процент разложения
        deathDay: state.gameTime.days,
        facingRight: fish.facingRight,
    });

    // Удаляем рыбу
    state.fishes.splice(index, 1);
    state.stats.totalDied++;

    const spec = SPECIES[fish.species];
    const cause = fish.energy <= 0 ? "голод" :
                  fish.hp <= 0 ? "болезнь" :
                  "старость";
    addEvent(`💀 ${spec.name} "${fish.name}" умерла (${cause}, возраст ${Math.floor(fish.age)} дней)`, "death");

    // Ухудшаем качество воды
    state.environment.quality -= CONFIG.water.qualityDecayPerCorpse;
}

// ============================================================
// ==================== МАЛЬКИ ================================
// ============================================================

function updateFry() {
    for (let i = state.fry.length - 1; i >= 0; i--) {
        const fry = state.fry[i];
        const spec = SPECIES[fry.species];

        fry.age += 1 / CONFIG.time.ticksPerDay;
        fry.growthDays += 1 / CONFIG.time.ticksPerDay;
        fry.swimPhase += 0.2;

        // Рост
        const growthProgress = Math.min(1, fry.growthDays / spec.maturity);
        fry.size = 3 + (fry.maxSize - 3) * growthProgress;
        fry.speed = spec.speed.min + (spec.speed.max - spec.speed.min) * growthProgress * 0.5;

        // Энергия
        fry.energy -= 0.03;

        // Смерть
        if (fry.energy <= 0) {
            state.fry.splice(i, 1);
            state.stats.totalDied++;
            continue;
        }

        // Ест корм
        for (let j = state.food.length - 1; j >= 0; j--) {
            if (distance(fry, state.food[j]) < fry.size + 3) {
                fry.energy = Math.min(100, fry.energy + state.food[j].nutrition);
                state.food.splice(j, 1);
                break;
            }
        }

        // Превращение во взрослую
        if (fry.growthDays >= spec.maturity * 0.7) {
            const adult = createFish(fry.species, fry.x, fry.y);
            adult.name = fry.name;
            adult.generation = fry.generation;
            adult.age = fry.growthDays;
            adult.size = fry.size;
            state.fishes.push(adult);
            state.fry.splice(i, 1);
            addEvent(`🎉 Малёк "${fry.name}" (${spec.name}) вырос во взрослую рыбу`, "birth");
            continue;
        }

        // Движение
        fry.vx += (Math.random() - 0.5) * 0.3;
        fry.vy += (Math.random() - 0.5) * 0.2;
        fry.vx *= 0.9;
        fry.vy *= 0.9;

        const maxSpeed = fry.speed * 0.8;
        const speed = Math.sqrt(fry.vx * fry.vx + fry.vy * fry.vy);
        if (speed > maxSpeed) {
            fry.vx = (fry.vx / speed) * maxSpeed;
            fry.vy = (fry.vy / speed) * maxSpeed;
        }

        fry.x += fry.vx;
        fry.y += fry.vy;

        if (Math.abs(fry.vx) > 0.1) fry.facingRight = fry.vx > 0;

        // Границы
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

        // Падает на дно если в воде
        const spec = SPECIES[egg.species];
        if (spec.eggLaying === "water") {
            egg.y += 0.3;
            if (egg.y > CONFIG.aquarium.height - CONFIG.aquarium.sandHeight - 5) {
                egg.y = CONFIG.aquarium.height - CONFIG.aquarium.sandHeight - 5;
            }
        }

        // Съедена?
        for (const fish of state.fishes) {
            if (distance(fish, egg) < fish.size + egg.size) {
                fish.energy = Math.min(fish.maxEnergy, fish.energy + 5);
                state.eggs.splice(i, 1);
                break;
            }
        }

        // Вылупление
        if (egg.incubationLeft <= 0) {
            // Создаём малька
            const fry = {
                id: generateId(),
                species: egg.species,
                name: getRandomName(Math.random() < 0.5 ? "male" : "female"),
                x: egg.x,
                y: egg.y,
                vx: (Math.random() - 0.5),
                vy: (Math.random() - 0.5),
                facingRight: Math.random() < 0.5,
                size: 2 + Math.random() * 2,
                maxSize: SPECIES[egg.species].size.min,
                speed: SPECIES[egg.species].speed.min * 1.3,
                energy: 40,
                hp: 40,
                age: 0,
                growthDays: 0,
                generation: Math.max(egg.motherGen, egg.fatherGen) + 1,
                swimPhase: Math.random() * Math.PI * 2,
                color: { ...SPECIES[egg.species].color },
            };
            state.fry.push(fry);
            state.stats.totalFryBorn++;
            state.eggs.splice(i, 1);
            addEvent(`🐣 Из икринки вылупился малёк "${fry.name}" (${SPECIES[egg.species].name})`, "birth");
        }
    }
}

// ============================================================
// ===================== ТРУПЫ ================================
// ============================================================

function updateCorpses() {
    for (let i = state.corpses.length - 1; i >= 0; i--) {
        const corpse = state.corpses[i];

        // Труп падает на дно
        const bottomY = CONFIG.aquarium.height - CONFIG.aquarium.sandHeight - corpse.size / 2;
        if (corpse.y < bottomY) {
            corpse.y += 0.5;
        } else {
            corpse.y = bottomY;
            // Переворачивается
        }

        // Разложение (естественное + бактерии)
        corpse.decomposition += 0.05 + state.bacteria.length * 0.002;

        // Создаём бактерии
        if (Math.random() < 0.01 && state.bacteria.length < 50) {
            state.bacteria.push({
                id: generateId(),
                x: corpse.x + rand(-5, 5),
                y: corpse.y + rand(-5, 5),
                vx: (Math.random() - 0.5) * 0.5,
                vy: (Math.random() - 0.5) * 0.5,
                life: randInt(100, 300),
                corpseId: corpse.id,
            });
        }

        // Полностью разложился
        if (corpse.decomposition >= 100) {
            state.corpses.splice(i, 1);
            // Удобрение для растений
            state.environment.quality = Math.min(100, state.environment.quality + 2);
        }
    }
}

// ============================================================
// ==================== БАКТЕРИИ ==============================
// ============================================================

function updateBacteria() {
    for (let i = state.bacteria.length - 1; i >= 0; i--) {
        const b = state.bacteria[i];

        b.life--;
        if (b.life <= 0) {
            state.bacteria.splice(i, 1);
            continue;
        }

        // Движение к трупам
        let nearestCorpse = null;
        let nearestDist = Infinity;
        for (const c of state.corpses) {
            const d = distance(b, c);
            if (d < nearestDist) {
                nearestDist = d;
                nearestCorpse = c;
            }
        }

        if (nearestCorpse && nearestDist > 5) {
            const dx = nearestCorpse.x - b.x;
            const dy = nearestCorpse.y - b.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            b.vx += (dx / dist) * 0.1;
            b.vy += (dy / dist) * 0.1;
        }

        b.vx *= 0.95;
        b.vy *= 0.95;
        b.x += b.vx;
        b.y += b.vy;

        // Границы
        b.x = clamp(b.x, 5, CONFIG.aquarium.width - 5);
        b.y = clamp(b.y, CONFIG.aquarium.waterLevel, CONFIG.aquarium.height - 10);
    }
}

// ============================================================
// ===================== ЕДА ==================================
// ============================================================

function updateFood() {
    for (let i = state.food.length - 1; i >= 0; i--) {
        const f = state.food[i];

        // Падение
        if (f.sinking) {
            f.vy += 0.005;  // гравитация
            f.y += f.vy;

            // Лёгкое покачивание
            f.x += Math.sin(f.y * 0.05) * 0.1;

            // Достигла дна
            const bottomY = CONFIG.aquarium.height - CONFIG.aquarium.sandHeight - f.size;
            if (f.y >= bottomY) {
                f.y = bottomY;
                f.sinking = false;
                f.life = 500; // тиков до исчезновения
            }
        } else {
            f.life--;
            if (f.life <= 0) {
                state.food.splice(i, 1);
                continue;
            }
        }
    }
}

// ============================================================
// =================== ПУЗЫРЬКИ ===============================
// ============================================================

function updateBubbles() {
    // Создаём пузырьки от растений и фильтра
    if (Math.random() < 0.05) {
        const source = Math.random() < 0.5 ? state.plants[randInt(0, state.plants.length - 1)] : null;
        if (source) {
            state.bubbles.push({
                x: source.x + rand(-10, 10),
                y: source.baseY - source.height * 0.5,
                size: rand(1, 4),
                speed: rand(0.5, 1.5),
                wobble: rand(0, Math.PI * 2),
            });
        }
    }

    for (let i = state.bubbles.length - 1; i >= 0; i--) {
        const b = state.bubbles[i];
        b.y -= b.speed;
        b.x += Math.sin(b.wobble) * 0.3;
        b.wobble += 0.05;

        if (b.y < CONFIG.aquarium.waterLevel) {
            state.bubbles.splice(i, 1);
        }
    }
}

// ============================================================
// =================== ОКРУЖЕНИЕ ==============================
// ============================================================

function updateEnvironment() {
    // Кислород: рыбы потребляют, растения производят
    const fishOxygen = state.fishes.length * CONFIG.water.oxygenConsumptionPerFish;
    const fryOxygen = state.fry.length * CONFIG.water.oxygenConsumptionPerFish * 0.3;
    const plantOxygen = state.plants.length * CONFIG.plants.oxygenPerTick;

    state.environment.oxygen += plantOxygen - fishOxygen - fryOxygen;
    state.environment.oxygen = clamp(state.environment.oxygen, 0, 100);

    // Качество воды: трупы ухудшают, бактерии улучшают
    const corpseDecay = state.corpses.length * 0.0005;
    const bacteriaRecovery = state.bacteria.length * 0.0001;
    state.environment.quality += bacteriaRecovery - corpseDecay;
    state.environment.quality = clamp(state.environment.quality, 0, 100);

    // Температура слегка колеблется
    state.environment.temperature = 25 + Math.sin(state.gameTime.ticks * 0.001) * 0.5;
}

// ============================================================
// =================== КОНТРОЛЬ ПОПУЛЯЦИИ =====================
// ============================================================

function populationControl() {
    // Экстренный спавн если слишком мало рыб
    if (state.fishes.length < CONFIG.ecosystem.minFishCount && state.fry.length < 5) {
        const speciesKeys = Object.keys(SPECIES);
        const species = speciesKeys[randInt(0, speciesKeys.length - 1)];
        const fish = createFish(species);
        fish.age = SPECIES[species].maturity + 20;
        fish.size = SPECIES[species].size.max * 0.9;
        state.fishes.push(fish);
        addEvent(`⚡ Экстренный спавн: ${SPECIES[species].name} добавлена в аквариум`, "system");
    }

    // Если слишком много - уменьшаем корм
    if (state.fishes.length > CONFIG.ecosystem.targetFishCount + 15) {
        // Меньше кормим
    }
}

// ============================================================
// =================== СОБЫТИЯ ================================
// ============================================================

const MAX_EVENTS = 100;

function addEvent(message, type = "info") {
    state.events.push({
        id: generateId(),
        message,
        type,
        time: new Date().toISOString(),
        gameDay: state.gameTime.days,
    });

    if (state.events.length > MAX_EVENTS) {
        state.events = state.events.slice(-MAX_EVENTS);
    }

    console.log(`[${type}] ${message}`);
}

// ============================================================
// =================== ГЛАВНЫЙ ЦИКЛ ===========================
// ============================================================

function tick() {
    state.gameTime.ticks++;
    state.gameTime.days = Math.floor(state.gameTime.ticks / CONFIG.time.ticksPerDay);
    state.gameTime.hours = Math.floor((state.gameTime.ticks % CONFIG.time.ticksPerDay) / CONFIG.time.ticksPerHour);

    // Обновляем рыб
    state.fishes = state.fishes.filter((f, i) => updateFish(f, i));

    // Обновляем остальные сущности
    updateFry();
    updateEggs();
    updateCorpses();
    updateBacteria();
    updateFood();
    updateBubbles();
    updateEnvironment();
    populationControl();

    // Авто-кормление
    if (state.gameTime.days - state.lastFeedTime >= CONFIG.ecosystem.feedIntervalDays) {
        feedFish();
    }
}

// ============================================================
// ======================= API ================================
// ============================================================

const serverStartTime = Date.now();
let tickCount = 0;
let avgTickMs = 0;

app.get("/state", (req, res) => {
    const uptime = Math.floor((Date.now() - serverStartTime) / 1000);

    // Статистика по видам
    const speciesStats = {};
    for (const key in SPECIES) {
        speciesStats[key] = {
            name: SPECIES[key].name,
            nameLatin: SPECIES[key].nameLatin,
            adults: 0,
            fry: 0,
            eggs: 0,
        };
    }

    for (const f of state.fishes) {
        if (speciesStats[f.species]) speciesStats[f.species].adults++;
    }
    for (const f of state.fry) {
        if (speciesStats[f.species]) speciesStats[f.species].fry++;
    }
    for (const e of state.eggs) {
        if (speciesStats[e.species]) speciesStats[e.species].eggs++;
    }

    res.json({
        config: {
            aquarium: CONFIG.aquarium,
        },
        fishes: state.fishes,
        fry: state.fry,
        eggs: state.eggs,
        corpses: state.corpses,
        bacteria: state.bacteria,
        food: state.food,
        bubbles: state.bubbles,
        plants: state.plants,
        rocks: state.rocks,
        environment: state.environment,
        gameTime: state.gameTime,
        species: SPECIES,
        speciesStats,
        stats: {
            ...state.stats,
            serverUptime: uptime,
            tickCount: state.gameTime.ticks,
            avgTickMs: Math.round(avgTickMs * 100) / 100,
        },
        events: state.events.slice(-30),
    });
});

app.get("/ping", (req, res) => {
    res.json({
        status: "alive",
        uptime: Math.floor((Date.now() - serverStartTime) / 1000),
        tickCount: state.gameTime.ticks,
        population: state.fishes.length,
        timestamp: new Date().toISOString(),
    });
});

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

// ============================================================
// ================== SELF-PING ===============================
// ============================================================

const SERVER_URL = process.env.RENDER_EXTERNAL_URL || "http://localhost:3000";

function selfPing() {
    const https = require("https");
    const http = require("http");
    const client = SERVER_URL.startsWith("https") ? https : http;

    client.get(`${SERVER_URL}/ping`, (res) => {
        console.log(`🏓 Self-ping: ${res.statusCode} | Fish: ${state.fishes.length} | Day: ${state.gameTime.days}`);
    }).on("error", (e) => {
        console.error(`❌ Self-ping error: ${e.message}`);
    });
}

// ============================================================
// ====================== ЗАПУСК ==============================
// ============================================================

initWorld();

// Главный цикл
const gameInterval = setInterval(() => {
    const start = Date.now();
    tick();
    tickCount++;
    avgTickMs = avgTickMs * 0.95 + (Date.now() - start) * 0.05;
}, CONFIG.time.tickMs);

// Self-ping каждые 5 минут (чтобы Render не спал)
setInterval(selfPing, 5 * 60 * 1000);

// Сохранение при выходе
process.on("SIGINT", () => { saveState(); process.exit(); });
process.on("SIGTERM", () => { saveState(); process.exit(); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🐠 Аквариум запущен на порту ${PORT}`);
    console.log(`🌍 Мир: ${CONFIG.aquarium.width}x${CONFIG.aquarium.height}`);
    console.log(`⏱️ 1 игровой день = ${CONFIG.time.secondsPerDay} секунд реального времени`);
    console.log(`🐟 Стартовая популяция: ${state.fishes.length} рыб\n`);
});
