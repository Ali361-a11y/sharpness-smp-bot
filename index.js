"use strict";

const express = require("express");
const http = require("http");
const mineflayer = require("mineflayer");
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder");
const collectBlock = require("mineflayer-collectblock").plugin;

const config = require("./settings.json");

// =====================================================
// WEB SERVER
// =====================================================

const app = express();
const WEB_PORT = Number(process.env.PORT) || 3000;

let bot = null;
let mcData = null;
let movements = null;

let connected = false;
let aiRunning = true;
let busy = false;
let reconnectTimer = null;

app.get("/", (req, res) => {
  res.status(200).send(`
    <h1>BladeBot</h1>
    <p>Status: ${connected ? "ONLINE" : "CONNECTING/OFFLINE"}</p>
    <p>Server: ${config.server.host}:${config.server.port}</p>
    <p>AI: ${aiRunning ? "ON" : "OFF"}</p>
  `);
});

app.get("/health", (req, res) => {
  res.status(200).send("BladeBot is alive");
});

const webServer = http.createServer(app);

webServer.listen(WEB_PORT, "0.0.0.0", () => {
  console.log(`🌐 Web server listening on port ${WEB_PORT}`);
});

// =====================================================
// CREATE BOT
// =====================================================

function startBot() {
  if (bot) {
    try {
      bot.quit();
    } catch {}
  }

  console.log("");
  console.log("=================================");
  console.log("🤖 STARTING BLADEBOT");
  console.log("=================================");
  console.log(`👤 Username: ${config.botName}`);
  console.log(`🌍 Host: ${config.server.host}`);
  console.log(`🔌 Port: ${config.server.port}`);
  console.log(`🎮 Version: ${config.server.version}`);
  console.log("=================================");

  connected = false;

  try {
    bot = mineflayer.createBot({
      host: config.server.host,
      port: Number(config.server.port),
      username: config.botName,
      auth: config.server.auth,
      version: config.server.version,
      hideErrors: false
    });
  } catch (error) {
    console.log("❌ Could not create bot:");
    console.log(error);
    scheduleReconnect();
    return;
  }

  bot.loadPlugin(pathfinder);
  bot.loadPlugin(collectBlock);

  registerEvents();
}

// =====================================================
// EVENTS
// =====================================================

function registerEvents() {

  bot.once("spawn", () => {

    connected = true;
    busy = false;

    console.log("");
    console.log("=================================");
    console.log("✅ BLADEBOT JOINED");
    console.log("=================================");
    console.log(`👤 ${bot.username}`);
    console.log(`❤️ Health: ${bot.health}`);
    console.log(`🍖 Food: ${bot.food}`);
    console.log(
      `📍 ${Math.floor(bot.entity.position.x)}, ` +
      `${Math.floor(bot.entity.position.y)}, ` +
      `${Math.floor(bot.entity.position.z)}`
    );
    console.log("=================================");

    // Try to load Minecraft data.
    try {
      mcData = require("minecraft-data")(bot.version);

      movements = new Movements(bot, mcData);

      movements.canDig = true;
      movements.allow1by1towers = false;

      bot.pathfinder.setMovements(movements);

      console.log("🧠 Pathfinder ready");

    } catch (error) {

      console.log("⚠️ Minecraft data could not be loaded:");
      console.log(error.message);
      console.log(
        "The protocol may be connected, but advanced block AI will be disabled."
      );
    }

    setTimeout(() => {
      runAI();
    }, 5000);
  });

  // ---------------------------------------------------
  // CHAT COMMANDS
  // ---------------------------------------------------

  bot.on("chat", (username, message) => {

    if (username === bot.username) return;

    const command = message.trim().toLowerCase();

    // !stop
    if (command === "!stop") {

      aiRunning = false;
      busy = false;

      try {
        bot.pathfinder.setGoal(null);
        bot.clearControlStates();
      } catch {}

      bot.chat("BladeBot AI stopped.");
      console.log("🛑 AI stopped.");

      return;
    }

    // !start
    if (command === "!start") {

      aiRunning = true;

      bot.chat("BladeBot AI started.");
      console.log("▶️ AI started.");

      return;
    }

    // !status
    if (command === "!status") {

      const pos = bot.entity?.position;

      if (!pos) return;

      bot.chat(
        `HP ${Math.round(bot.health)} | ` +
        `Food ${Math.round(bot.food)} | ` +
        `X ${Math.floor(pos.x)} ` +
        `Y ${Math.floor(pos.y)} ` +
        `Z ${Math.floor(pos.z)}`
      );

      return;
    }

    // !come
    if (command === "!come") {

      const player = bot.players[username];

      if (!player || !player.entity) {
        bot.chat("I can't see you.");
        return;
      }

      const pos = player.entity.position;

      try {

        bot.pathfinder.setGoal(
          new goals.GoalNear(
            pos.x,
            pos.y,
            pos.z,
            2
          )
        );

        bot.chat("Coming!");

      } catch (error) {
        console.log("❌ Come command error:", error.message);
      }

      return;
    }
  });

  // ---------------------------------------------------
  // HEALTH
  // ---------------------------------------------------

  bot.on("health", () => {

    if (!bot.entity) return;

    if (bot.health <= 5) {
      console.log(`⚠️ LOW HEALTH: ${bot.health}`);
    }

    if (bot.food <= 6) {
      console.log(`🍖 LOW FOOD: ${bot.food}`);
    }
  });

  // ---------------------------------------------------
  // DEATH
  // ---------------------------------------------------

  bot.on("death", () => {

    console.log("💀 BladeBot died.");
    connected = false;
    busy = false;

    setTimeout(() => {

      if (!bot) return;

      try {
        bot.respawn();
        console.log("🔄 Respawn requested.");
      } catch (error) {
        console.log("⚠️ Respawn error:", error.message);
      }

    }, 3000);
  });

  // ---------------------------------------------------
  // KICK
  // ---------------------------------------------------

  bot.on("kicked", reason => {

    console.log("🚪 BladeBot was kicked.");
    console.log("Reason:", reason);
  });

  // ---------------------------------------------------
  // ERROR
  // ---------------------------------------------------

  bot.on("error", error => {

    console.log("❌ Minecraft error:");
    console.log(error.message);
  });

  // ---------------------------------------------------
  // DISCONNECT
  // ---------------------------------------------------

  bot.on("end", reason => {

    connected = false;
    busy = false;

    console.log("🔌 BladeBot disconnected.");

    if (reason) {
      console.log("Reason:", reason);
    }

    scheduleReconnect();
  });
}

// =====================================================
// RECONNECT
// =====================================================

function scheduleReconnect() {

  if (reconnectTimer) return;

  console.log(
    `🔄 Reconnecting in ${
      Number(config.behavior.reconnectDelay) / 1000
    } seconds...`
  );

  reconnectTimer = setTimeout(() => {

    reconnectTimer = null;

    startBot();

  }, Number(config.behavior.reconnectDelay));
}

// =====================================================
// MAIN AI
// =====================================================

async function runAI() {

  if (!connected || !bot || !bot.entity) {
    setTimeout(runAI, 5000);
    return;
  }

  if (!aiRunning || busy) {
    setTimeout(runAI, 5000);
    return;
  }

  try {

    // 1. EAT
    if (bot.food <= Number(config.behavior.eatAtFoodLevel)) {

      const ate = await eatFood();

      if (ate) {
        setTimeout(runAI, 3000);
        return;
      }
    }

    // 2. FIGHT
    const enemy = findEnemy();

    if (enemy) {

      await fight(enemy);

      setTimeout(runAI, 3000);
      return;
    }

    // 3. COLLECT WOOD
    if (mcData && movements) {

      const wood = findWood();

      if (wood) {

        await collectWood(wood);

        setTimeout(runAI, 3000);
        return;
      }
    }

    // 4. PICK UP ITEMS
    const item = findDroppedItem();

    if (item) {

      await collectItem(item);

      setTimeout(runAI, 3000);
      return;
    }

    // 5. WALK
    wander();

  } catch (error) {

    console.log("⚠️ AI error:");
    console.log(error.message);
  }

  setTimeout(runAI, 5000);
}

// =====================================================
// FOOD
// =====================================================

async function eatFood() {

  if (!bot.inventory) return false;

  const foods = [
    "bread",
    "cooked_beef",
    "cooked_porkchop",
    "cooked_chicken",
    "cooked_mutton",
    "cooked_rabbit",
    "baked_potato",
    "golden_carrot",
    "carrot",
    "potato",
    "apple",
    "melon_slice",
    "sweet_berries"
  ];

  const food = bot.inventory
    .items()
    .find(item => foods.includes(item.name));

  if (!food) {
    console.log("🍖 No food available.");
    return false;
  }

  try {

    busy = true;

    console.log(`🍎 Eating ${food.name}`);

    await bot.equip(food, "hand");
    await bot.consume();

    console.log("✅ Food eaten.");

    busy = false;

    return true;

  } catch (error) {

    console.log("⚠️ Could not eat:", error.message);

    busy = false;

    return false;
  }
}

// =====================================================
// FIND HOSTILE MOB
// =====================================================

function findEnemy() {

  if (!bot.entities) return null;

  const hostile = [
    "zombie",
    "skeleton",
    "spider",
    "cave_spider",
    "husk",
    "drowned",
    "stray",
    "witch",
    "creeper",
    "pillager",
    "vindicator",
    "phantom"
  ];

  let nearest = null;
  let nearestDistance = Number(config.behavior.fightDistance);

  for (const id of Object.keys(bot.entities)) {

    const entity = bot.entities[id];

    if (!entity) continue;
    if (!entity.position) continue;
    if (!hostile.includes(entity.name)) continue;

    const distance = bot.entity.position.distanceTo(
      entity.position
    );

    if (distance < nearestDistance) {
      nearest = entity;
      nearestDistance = distance;
    }
  }

  return nearest;
}

// =====================================================
// FIGHT
// =====================================================

async function fight(enemy) {

  if (!enemy || !enemy.position) return;

  console.log(`⚔️ Enemy detected: ${enemy.name}`);

  busy = true;

  try {

    bot.pathfinder.setGoal(
      new goals.GoalFollow(enemy, 2),
      true
    );

    const endTime = Date.now() + 15000;

    while (
      connected &&
      enemy.isValid &&
      Date.now() < endTime
    ) {

      if (!enemy.position) break;

      const distance = bot.entity.position.distanceTo(
        enemy.position
      );

      if (distance <= 3.2) {
        bot.attack(enemy);
      }

      await sleep(400);
    }

  } catch (error) {

    console.log("⚠️ Combat error:", error.message);

  } finally {

    try {
      bot.pathfinder.setGoal(null);
    } catch {}

    busy = false;
  }
}

// =====================================================
// FIND WOOD
// =====================================================

function findWood() {

  if (!mcData || !bot) return null;

  const woods = [
    "oak_log",
    "birch_log",
    "spruce_log",
    "jungle_log",
    "acacia_log",
    "dark_oak_log",
    "mangrove_log",
    "cherry_log"
  ];

  let closest = null;
  let closestDistance = Number(config.behavior.woodDistance);

  for (const name of woods) {

    const blockInfo = mcData.blocksByName[name];

    if (!blockInfo) continue;

    const block = bot.findBlock({
      matching: blockInfo.id,
      maxDistance: Number(config.behavior.woodDistance)
    });

    if (!block) continue;

    const distance = bot.entity.position.distanceTo(
      block.position
    );

    if (distance < closestDistance) {

      closest = block;
      closestDistance = distance;
    }
  }

  return closest;
}

// =====================================================
// COLLECT WOOD
// =====================================================

async function collectWood(block) {

  if (!block) return;

  busy = true;

  try {

    console.log(`🌳 Found ${block.name}`);
    console.log(`📍 ${block.position}`);

    await bot.collectBlock.collect(block);

    console.log("🪵 Wood collected!");

  } catch (error) {

    console.log(
      "⚠️ Wood collection failed:",
      error.message
    );

  } finally {

    busy = false;
  }
}

// =====================================================
// FIND DROPPED ITEM
// =====================================================

function findDroppedItem() {

  let nearest = null;
  let distance = 6;

  for (const id of Object.keys(bot.entities)) {

    const entity = bot.entities[id];

    if (!entity) continue;
    if (entity.name !== "item") continue;
    if (!entity.position) continue;

    const d = bot.entity.position.distanceTo(
      entity.position
    );

    if (d < distance) {
      nearest = entity;
      distance = d;
    }
  }

  return nearest;
}

// =====================================================
// PICK UP ITEM
// =====================================================

async function collectItem(entity) {

  if (!entity || !entity.position) return;

  busy = true;

  try {

    console.log("📦 Moving toward dropped item.");

    bot.pathfinder.setGoal(
      new goals.GoalNear(
        entity.position.x,
        entity.position.y,
        entity.position.z,
        1
      )
    );

    await sleep(3000);

    bot.pathfinder.setGoal(null);

  } catch (error) {

    console.log(
      "⚠️ Item pickup error:",
      error.message
    );

  } finally {

    busy = false;
  }
}

// =====================================================
// WANDER
// =====================================================

function wander() {

  if (!bot.entity || !movements) return;

  const pos = bot.entity.position;

  const x =
    Math.floor(pos.x) +
    Math.floor(Math.random() * 25) - 12;

  const z =
    Math.floor(pos.z) +
    Math.floor(Math.random() * 25) - 12;

  console.log(`🚶 Wandering toward ${x}, ${Math.floor(pos.y)}, ${z}`);

  try {

    bot.pathfinder.setGoal(
      new goals.GoalNear(
        x,
        Math.floor(pos.y),
        z,
        2
      )
    );

    setTimeout(() => {

      if (bot && bot.pathfinder) {
        bot.pathfinder.setGoal(null);
      }

    }, 7000);

  } catch (error) {

    console.log("⚠️ Wander error:", error.message);
  }
}

// =====================================================
// UTILITY
// =====================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =====================================================
// START
// =====================================================

console.log("");
console.log("=================================");
console.log("🚀 BLADEBOT BOOTING");
console.log("=================================");

startBot();

// =====================================================
// CRASH PROTECTION
// =====================================================

process.on("uncaughtException", error => {

  console.log("❌ Uncaught exception:");
  console.log(error);
});

process.on("unhandledRejection", error => {

  console.log("❌ Unhandled rejection:");
  console.log(error);
});
