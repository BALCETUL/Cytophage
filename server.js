const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// ====== КОНФИГУРАЦИЯ МИРА ======
const WORLD = {
    width: 2000,
    height: 1200,
    tickInterval: 50, // 50ms = 20 тиков в секунду
    targetPopulation: 40, // Целевая популяция
    minPopulation: 15,    // Минимум перед экстренным спавном
    maxPopulation: 80,    // Максимум
};

// ====== ЕДА ======
const FOOD = {
    count: 150,
    energyValue: 20,
    spawnRate: 0.3, // шанс спавна за тик
};

// ====== СТАТИСТИКА СЕРВЕРА ======
const serverStartTime = Date.now();
let pingHistory = [];
let tickCount = 0;
let lastTickTime = Date.now();
let avgTickMs = 0;

// ====== ДАННЫЕ ======
let bacteria = [];
let food = [];
let events = [];
let nextId = 1;

// ====== КЛАНЫ (цвета) ======
const CLAN_COLORS = [
    "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4",
    "#FFEAA7", "#DDA0DD", "#98D8C8", "#F7DC6F",
    "#BB8FCE", "#85C1E9", "#F8C471", "#82E0AA",
    "#F1948A", "#AED6F1", "#A3E4D7"
];

let nextClanId = 1;

// ====== КЛАСС БАКТЕРИИ ======
class Bacterium {
    constructor(x, y, clanId = null) {
        this.id = nextId++;
        this.x = x || Math.random() * WORLD.width;
        this.y = y || Math.random() * WORLD.height;
        this.vx = (Math.random() - 0.5) * 2;
        this.vy = (Math.random() - 0.5) * 2;

        // Характеристики
        this.energy = 100;
        this.maxEnergy = 100;
        this.hp = 100;
        this.maxHp = 100;
        this.speed = 1 + Math.random() * 0.5;
        this.size = 5 + Math.random() * 3;
        this.visionRange = 80 + Math.random() * 40;
        this.aggression = Math.random() * 0.3; // 0-1

        // Возраст и жизнь
        this.age = 0; // в тиках
        this.maxAge = 5000 + Math.random() * 3000; // ~5-8 минут жизни

        // Генетика (мутации)
        this.generation = 0;
        this.mutationRate = 0.05;
        this.strengthMultiplier = 1;
        this.efficiencyMultiplier = 1; // эффективность потребления еды

        // Клан
        if (clanId === null) {
            this.clanId = nextClanId++;
            this.clanColor = CLAN_COLORS[(this.clanId - 1) % CLAN_COLORS.length];
        } else {
            this.clanId = clanId;
            this.clanColor = CLAN_COLORS[(clanId - 1) % CLAN_COLORS.length];
        }

        // AI - цели
        this.target = null;
        this.targetType = null; // 'food', 'enemy', 'mate', 'flee'
        this.cooldown = {
            attack: 0,
            reproduce: 0,
        };

        // Поведение
        this.behaviorTimer = 0;
        this.wanderAngle = Math.random() * Math.PI * 2;
    }

    update() {
        this.age++;
        this.cooldown.attack = Math.max(0, this.cooldown.attack - 1);
        this.cooldown.reproduce = Math.max(0, this.cooldown.reproduce - 1);

        // Трата энергии
        const energyCost = 0.05 * this.size * 0.5;
        this.energy -= energyCost / this.efficiencyMultiplier;

        // Старение - после 70% жизни начинает слабеть
        const lifeProgress = this.age / this.maxAge;
        if (lifeProgress > 0.7) {
            this.hp -= 0.02 * (lifeProgress - 0.7) * 10;
        }

        // Смерть от голода или старости
        if (this.energy <= 0 || this.hp <= 0) {
            this.die();
            return false;
        }

        // Поиск целей
        this.findTarget();

        // Движение
        this.move();

        // Взаимодействия
        this.interact();

        // Размножение
        this.tryReproduce();

        return true;
    }

    findTarget() {
        // Приоритеты: еда (если голоден), побег (если мало HP), размножение (если сыт), агрессия
        let nearestFood = null;
        let nearestFoodDist = Infinity;
        let nearestEnemy = null;
        let nearestEnemyDist = Infinity;
        let nearestMate = null;
        let nearestMateDist = Infinity;

        // Ищем еду
        if (this.energy < 70) {
            for (const f of food) {
                const dist = this.distanceTo(f);
                if (dist < this.visionRange && dist < nearestFoodDist) {
                    nearestFood = f;
                    nearestFoodDist = dist;
                }
            }
        }

        // Ищем врагов (другие кланы)
        if (this.energy > 30 && this.aggression > 0.3) {
            for (const b of bacteria) {
                if (b.id === this.id || b.clanId === this.clanId) continue;
                const dist = this.distanceTo(b);
                if (dist < this.visionRange * 0.8 && dist < nearestEnemyDist) {
                    nearestEnemy = b;
                    nearestEnemyDist = dist;
                }
            }
        }

        // Ищем партнёра для размножения
        if (this.energy > 80 && this.cooldown.reproduce === 0) {
            for (const b of bacteria) {
                if (b.id === this.id || b.clanId !== this.clanId) continue;
                if (b.energy < 60) continue;
                const dist = this.distanceTo(b);
                if (dist < this.visionRange && dist < nearestMateDist) {
                    nearestMate = b;
                    nearestMateDist = dist;
                }
            }
        }

        // Определяем цель
        if (this.hp < 30) {
            // Бежим от врагов
            if (nearestEnemy) {
                this.target = nearestEnemy;
                this.targetType = 'flee';
            } else {
                this.target = nearestFood;
                this.targetType = 'food';
            }
        } else if (nearestFood && this.energy < 60) {
            this.target = nearestFood;
            this.targetType = 'food';
        } else if (nearestMate && this.energy > 80) {
            this.target = nearestMate;
            this.targetType = 'mate';
        } else if (nearestEnemy && this.aggression > 0.5 && this.energy > 50) {
            this.target = nearestEnemy;
            this.targetType = 'attack';
        } else {
            this.target = null;
            this.targetType = 'wander';
        }
    }

    move() {
        if (this.target && this.targetType !== 'wander') {
            const dx = this.target.x - this.x;
            const dy = this.target.y - this.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist > 0) {
                let speed = this.speed;
                if (this.targetType === 'flee') {
                    // Убегаем в противоположную сторону
                    this.vx = -(dx / dist) * speed * 1.5;
                    this.vy = -(dy / dist) * speed * 1.5;
                } else {
                    this.vx = (dx / dist) * speed;
                    this.vy = (dy / dist) * speed;
                }
            }
        } else {
            // Блуждание
            this.behaviorTimer++;
            if (this.behaviorTimer > 30 + Math.random() * 60) {
                this.wanderAngle += (Math.random() - 0.5) * 1.5;
                this.behaviorTimer = 0;
            }
            this.vx = Math.cos(this.wanderAngle) * this.speed * 0.5;
            this.vy = Math.sin(this.wanderAngle) * this.speed * 0.5;
        }

        this.x += this.vx;
        this.y += this.vy;

        // Отталкивание от границ
        const margin = 30;
        if (this.x < margin) this.vx += 0.3;
        if (this.x > WORLD.width - margin) this.vx -= 0.3;
        if (this.y < margin) this.vy += 0.3;
        if (this.y > WORLD.height - margin) this.vy -= 0.3;

        // Ограничение
        this.x = Math.max(5, Math.min(WORLD.width - 5, this.x));
        this.y = Math.max(5, Math.min(WORLD.height - 5, this.y));
    }

    interact() {
        // Еда
        for (let i = food.length - 1; i >= 0; i--) {
            if (this.distanceTo(food[i]) < this.size + 3) {
                this.energy = Math.min(this.maxEnergy, this.energy + FOOD.energyValue * this.efficiencyMultiplier);
                this.hp = Math.min(this.maxHp, this.hp + 5);
                this.size = Math.min(15, this.size + 0.1);
                food.splice(i, 1);
                break;
            }
        }

        // Атака (если достаточно близко и кулдаун прошёл)
        if (this.targetType === 'attack' && this.target && this.cooldown.attack === 0) {
            const dist = this.distanceTo(this.target);
            if (dist < this.size + this.target.size + 5) {
                const damage = (5 + this.size * 0.5) * this.strengthMultiplier;
                this.target.hp -= damage;
                this.target.aggression = Math.min(1, this.target.aggression + 0.1);
                this.cooldown.attack = 30;

                if (this.target.hp <= 0) {
                    this.energy = Math.min(this.maxEnergy, this.energy + 30);
                    addEvent(`⚔️ Бактерия #${this.id} победила #${this.target.id}`, 'combat');
                }
            }
        }
    }

    tryReproduce() {
        if (this.targetType !== 'mate' || !this.target) return;
        if (this.cooldown.reproduce > 0 || this.target.cooldown.reproduce > 0) return;
        if (this.energy < 80 || this.target.energy < 80) return;

        const dist = this.distanceTo(this.target);
        if (dist > this.size + this.target.size + 10) return;

        // Проверка лимита популяции
        if (bacteria.length >= WORLD.maxPopulation) return;

        // Создаём потомка
        const child = new Bacterium(
            (this.x + this.target.x) / 2 + (Math.random() - 0.5) * 20,
            (this.y + this.target.y) / 2 + (Math.random() - 0.5) * 20,
            this.clanId
        );

        // Наследование характеристик с мутациями
        child.generation = Math.max(this.generation, this.target.generation) + 1;
        child.speed = this.averageWithMutation(this.speed, this.target.speed);
        child.size = this.averageWithMutation(this.size, this.target.size, 0.8);
        child.visionRange = this.averageWithMutation(this.visionRange, this.target.visionRange);
        child.aggression = this.averageWithMutation(this.aggression, this.target.aggression);
        child.strengthMultiplier = this.averageWithMutation(this.strengthMultiplier, this.target.strengthMultiplier);
        child.efficiencyMultiplier = this.averageWithMutation(this.efficiencyMultiplier, this.target.efficiencyMultiplier);
        child.maxEnergy = Math.min(200, 100 + child.generation * 5);
        child.energy = child.maxEnergy * 0.7;

        bacteria.push(child);

        this.energy -= 40;
        this.target.energy -= 40;
        this.cooldown.reproduce = 200;
        this.target.cooldown.reproduce = 200;

        addEvent(`🧬 Клан ${this.clanId}: новое поколение #${child.id} (gen ${child.generation})`, 'birth');
    }

    averageWithMutation(val1, val2, weight = 1) {
        const avg = (val1 + val2 * weight) / (1 + weight);
        if (Math.random() < this.mutationRate) {
            const mutation = 1 + (Math.random() - 0.4) * 0.3; // лёгкий уклон в плюс
            return avg * mutation;
        }
        return avg;
    }

    die() {
        const idx = bacteria.indexOf(this);
        if (idx !== -1) {
            bacteria.splice(idx, 1);
            // Оставляем "труп" - еду для других
            if (this.size > 6) {
                food.push(new FoodParticle(this.x, this.y, this.size * 2));
            }
        }
    }

    distanceTo(other) {
        const dx = this.x - other.x;
        const dy = this.y - other.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    serialize() {
        return {
            id: this.id,
            x: Math.round(this.x * 10) / 10,
            y: Math.round(this.y * 10) / 10,
            energy: Math.round(this.energy),
            hp: Math.round(this.hp),
            size: Math.round(this.size * 10) / 10,
            clanId: this.clanId,
            clanColor: this.clanColor,
            age: this.age,
            generation: this.generation,
            speed: Math.round(this.speed * 100) / 100,
            aggression: Math.round(this.aggression * 100) / 100,
            target: this.targetType,
        };
    }
}

// ====== ЕДА ======
class FoodParticle {
    constructor(x, y, value = FOOD.energyValue) {
        this.id = nextId++;
        this.x = x || Math.random() * WORLD.width;
        this.y = y || Math.random() * WORLD.height;
        this.value = value;
        this.radius = 2 + value / 20;
    }
}

// ====== ЭКОСИСТЕМА ======
function initWorld() {
    // Создаём начальную популяцию
    const initialCount = WORLD.minPopulation + 5;
    for (let i = 0; i < initialCount; i++) {
        bacteria.push(new Bacterium());
    }

    // Создаём еду
    for (let i = 0; i < FOOD.count; i++) {
        food.push(new FoodParticle());
    }

    addEvent("🌍 Мир создан! Начало эволюции...", "system");
}

function spawnFood() {
    // Постоянное пополнение еды
    const deficit = FOOD.count - food.length;
    if (deficit > 0 && Math.random() < FOOD.spawnRate) {
        food.push(new FoodParticle());
    }
}

function emergencySpawn() {
    // Если популяция падает слишком низко - экстренный спавн
    if (bacteria.length < WORLD.minPopulation) {
        const toSpawn = WORLD.minPopulation - bacteria.length;
        for (let i = 0; i < Math.min(toSpawn, 3); i++) {
            const b = new Bacterium();
            b.energy = 120;
            b.hp = 100;
            bacteria.push(b);
        }
        addEvent(`⚡ Экстренный спавн! Популяция восстановлена.`, "system");
    }
}

function populationControl() {
    // Если слишком много - мягко уменьшаем
    if (bacteria.length > WORLD.targetPopulation + 15) {
        // Ускоряем старение для самых старых
        const oldOnes = bacteria
            .filter(b => b.age > b.maxAge * 0.8)
            .sort((a, b) => b.age - a.age);

        for (let i = 0; i < Math.min(2, oldOnes.length); i++) {
            oldOnes[i].hp -= 2;
        }
    }
}

// ====== ГЛАВНЫЙ ЦИКЛ ======
function tick() {
    const tickStart = Date.now();
    tickCount++;

    // Обновляем бактерии
    bacteria = bacteria.filter(b => b.update());

    // Спавн еды
    spawnFood();

    // Контроль популяции
    emergencySpawn();
    populationControl();

    // Рассчёт среднего времени тика
    const tickDuration = Date.now() - tickStart;
    avgTickMs = avgTickMs * 0.95 + tickDuration * 0.05;

    // Чистка старых событий
    if (events.length > 50) {
        events = events.slice(-50);
    }
}

// ====== СОБЫТИЯ ======
function addEvent(message, type = 'info') {
    events.push({
        id: nextId++,
        time: new Date().toISOString(),
        message,
        type,
        tick: tickCount,
    });
}

// ====== API ======
app.get("/state", (req, res) => {
    const uptime = Math.floor((Date.now() - serverStartTime) / 1000);
    const clanStats = {};
    for (const b of bacteria) {
        if (!clanStats[b.clanId]) {
            clanStats[b.clanId] = { count: 0, color: b.clanColor, totalGen: 0 };
        }
        clanStats[b.clanId].count++;
        clanStats[b.clanId].totalGen += b.generation;
    }

    // Среднее поколение по кланам
    for (const id in clanStats) {
        clanStats[id].avgGen = clanStats[id].count > 0
            ? Math.round(clanStats[id].totalGen / clanStats[id].count * 10) / 10
            : 0;
    }

    res.json({
        world: WORLD,
        bacteria: bacteria.map(b => b.serialize()),
        food: food.map(f => ({ id: f.id, x: f.x, y: f.y, radius: f.radius })),
        events: events.slice(-20),
        stats: {
            uptime,
            tickCount,
            avgTickMs: Math.round(avgTickMs * 100) / 100,
            population: bacteria.length,
            foodCount: food.length,
            clans: Object.keys(clanStats).length,
            clanStats,
        },
    });
});

app.get("/ping", (req, res) => {
    const pingTime = Date.now();
    const uptime = Math.floor((pingTime - serverStartTime) / 1000);
    pingHistory.push(pingTime);
    if (pingHistory.length > 10) pingHistory.shift();

    res.json({
        status: "alive",
        uptime,
        tickCount,
        population: bacteria.length,
        timestamp: new Date().toISOString(),
    });
});

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

// ====== САМОПИНГ ======
const SERVER_URL = process.env.RENDER_EXTERNAL_URL || "http://localhost:3000";

function selfPing() {
    const https = require("https");
    const http = require("http");
    const client = SERVER_URL.startsWith("https") ? https : http;

    client.get(`${SERVER_URL}/ping`, (res) => {
        console.log(`✅ Self-ping: ${res.statusCode} | Pop: ${bacteria.length} | Ticks: ${tickCount}`);
    }).on("error", (e) => {
        console.error(`❌ Self-ping error: ${e.message}`);
    });
}

// ====== ЗАПУСК ======
initWorld();

const interval = setInterval(tick, WORLD.tickInterval);
setInterval(selfPing, 10 * 60 * 1000); // каждые 10 минут

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🧬 Cytophage сервер запущен на порту ${PORT}`);
    console.log(`🌍 Мир: ${WORLD.width}x${WORLD.height} | Целевая популяция: ${WORLD.targetPopulation}`);
});
