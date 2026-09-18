const http = require('http')
const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const collectBlock = require('mineflayer-collectblock').plugin

// =====================================================
// WEB SERVER
// Required by the hosting provider
// =====================================================

const PORT = Number(process.env.PORT) || 3000

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('Sharpness SMP bot is running')
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Web server listening on port ${PORT}`)
})

// =====================================================
// MINECRAFT SERVER
// =====================================================

const HOST = 'SharpnessSMP00.aternos.me'
const MINECRAFT_PORT = 59889

let bot = null
let reconnecting = false

function createMinecraftBot() {
  console.log('🤖 Starting Minecraft bot...')
  console.log(`📡 Connecting to ${HOST}:${MINECRAFT_PORT}`)

  bot = mineflayer.createBot({
    host: HOST,
    port: MINECRAFT_PORT,
    username: 'BladeBot',

    // Change to 'online' if your server requires Microsoft authentication
    auth: 'offline',

    // Official Mineflayer currently supports 26.1
    version: '26.1',

    hideErrors: false
  })

  bot.loadPlugin(pathfinder)
  bot.loadPlugin(collectBlock)

  let mcData = null
  let movements = null
  let busy = false
  let loopStarted = false

  bot.once('spawn', () => {
    console.log('=================================')
    console.log('✅ BOT JOINED SHARPNESS SMP')
    console.log(`👤 Username: ${bot.username}`)
    console.log(`❤️ Health: ${bot.health}`)
    console.log(`🍖 Food: ${bot.food}`)
    console.log('=================================')

    try {
      mcData = require('minecraft-data')(bot.version)

      movements = new Movements(bot, mcData)

      movements.canDig = false
      movements.allow1by1towers = false

      bot.pathfinder.setMovements(movements)

      if (!loopStarted) {
        loopStarted = true
        setInterval(mainLoop, 5000)
      }
    } catch (error) {
      console.log('❌ Setup error:', error.message)
    }
  })

  // ===================================================
  // MAIN AI LOOP
  // ===================================================

  async function mainLoop() {
    if (!bot || !bot.entity || busy || !mcData) return

    try {
      // Eat when hungry
      if (bot.food !== undefined && bot.food <= 14) {
        await eatFood()
        return
      }

      // Fight nearby hostile mob
      const mob = findHostileMob()

      if (mob) {
        await fightMob(mob)
        return
      }

      // Collect nearby wood
      const wood = findWood()

      if (wood) {
        await collectWood(wood)
        return
      }

      // Otherwise walk around
      walkAround()
    } catch (error) {
      console.log('❌ AI error:', error.message)
      busy = false
    }
  }

  // ===================================================
  // FIND HOSTILE MOB
  // ===================================================

  function findHostileMob() {
    const hostileMobs = [
      'zombie',
      'skeleton',
      'spider',
      'husk',
      'drowned',
      'stray',
      'witch',
      'creeper'
    ]

    let closest = null
    let closestDistance = 10

    for (const entity of Object.values(bot.entities)) {
      if (!entity || !entity.position || !entity.isValid) continue

      if (!hostileMobs.includes(entity.name)) continue

      const distance = bot.entity.position.distanceTo(entity.position)

      if (distance < closestDistance) {
        closest = entity
        closestDistance = distance
      }
    }

    return closest
  }

  // ===================================================
  // FIGHT MOB
  // ===================================================

  async function fightMob(mob) {
    if (!mob || !mob.isValid) return

    busy = true

    try {
      console.log(`⚔️ Fighting ${mob.name}`)

      const startTime = Date.now()

      while (
        mob.isValid &&
        bot.entity &&
        Date.now() - startTime < 15000
      ) {
        const distance = bot.entity.position.distanceTo(
          mob.position
        )

        if (distance > 3) {
          bot.pathfinder.setGoal(
            new goals.GoalNear(
              mob.position.x,
              mob.position.y,
              mob.position.z,
              2
            )
          )
        } else {
          bot.pathfinder.setGoal(null)

          await bot.lookAt(
            mob.position.offset(0, 1, 0),
            true
          )

          bot.attack(mob)

          await sleep(700)
        }

        await sleep(100)
      }
    } catch (error) {
      console.log('❌ Fight error:', error.message)
    }

    bot.pathfinder.setGoal(null)
    busy = false
  }

  // ===================================================
  // FOOD
  // ===================================================

  async function eatFood() {
    const foods = [
      'bread',
      'apple',
      'carrot',
      'potato',
      'baked_potato',
      'cooked_beef',
      'cooked_porkchop',
      'cooked_chicken',
      'cooked_mutton',
      'cooked_rabbit',
      'cooked_cod',
      'cooked_salmon'
    ]

    const food = bot.inventory.items().find(item =>
      foods.includes(item.name)
    )

    if (!food) {
      console.log('🍖 No food in inventory')
      return
    }

    busy = true

    try {
      console.log(`🍖 Eating ${food.name}`)

      await bot.equip(food, 'hand')
      await bot.consume()

      console.log('✅ Food eaten')
    } catch (error) {
      console.log('❌ Eating error:', error.message)
    }

    busy = false
  }

  // ===================================================
  // FIND WOOD
  // ===================================================

  function findWood() {
    if (!mcData) return null

    const woodNames = [
      'oak_log',
      'birch_log',
      'spruce_log',
      'jungle_log',
      'acacia_log',
      'dark_oak_log',
      'mangrove_log',
      'cherry_log'
    ]

    const ids = woodNames
      .map(name => mcData.blocksByName[name]?.id)
      .filter(id => id !== undefined)

    if (ids.length === 0) return null

    return bot.findBlock({
      matching: ids,
      maxDistance: 24
    })
  }

  // ===================================================
  // COLLECT WOOD
  // ===================================================

  async function collectWood(block) {
    if (!block) return

    busy = true

    try {
      console.log('🌳 Collecting wood...')

      await bot.collectBlock.collect(block)

      console.log('✅ Wood collected')
    } catch (error) {
      console.log('❌ Wood error:', error.message)
    }

    busy = false
  }

  // ===================================================
  // WALK AROUND
  // ===================================================

  function walkAround() {
    if (!bot.entity) return

    const x =
      Math.floor(bot.entity.position.x) +
      Math.floor(Math.random() * 21) - 10

    const z =
      Math.floor(bot.entity.position.z) +
      Math.floor(Math.random() * 21) - 10

    const y = Math.floor(bot.entity.position.y)

    console.log(`🚶 Walking toward ${x}, ${y}, ${z}`)

    bot.pathfinder.setGoal(
      new goals.GoalNear(x, y, z, 2)
    )
  }

  // ===================================================
  // CHAT COMMANDS
  // ===================================================

  bot.on('chat', (username, message) => {
    if (!bot || username === bot.username) return

    if (message === '!come') {
      const player = bot.players[username]

      if (player && player.entity) {
        const position = player.entity.position

        bot.pathfinder.setGoal(
          new goals.GoalNear(
            position.x,
            position.y,
            position.z,
            2
          )
        )

        bot.chat('Coming!')
      }
    }

    if (message === '!stop') {
      bot.pathfinder.setGoal(null)
      bot.clearControlStates()

      bot.chat('Stopped!')
      console.log('🛑 Bot stopped by command')
    }

    if (message === '!status') {
      bot.chat(
        `Health: ${Math.round(bot.health)} | Food: ${bot.food}`
      )
    }
  })

  // ===================================================
  // EVENTS
  // ===================================================

  bot.on('error', error => {
    console.log('❌ MINECRAFT ERROR:', error.message)
  })

  bot.on('kicked', reason => {
    console.log('❌ BOT KICKED:', reason)
  })

  bot.on('end', () => {
    console.log('❌ BOT DISCONNECTED')

    if (!reconnecting) {
      reconnecting = true

      console.log('🔄 Reconnecting in 10 seconds...')

      setTimeout(() => {
        reconnecting = false
        createMinecraftBot()
      }, 10000)
    }
  })
}

// =====================================================
// START BOT
// =====================================================

createMinecraftBot()

// =====================================================
// HELPER
// =====================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
