const http = require('http')

const PORT = process.env.PORT || 3000

http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('Sharpness SMP bot is running')
}).listen(PORT, '0.0.0.0')
const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const collectBlock = require('mineflayer-collectblock').plugin

const bot = mineflayer.createBot({
  host: 'SharpnessSMP00.aternos.me',
  port: 59889,
  username: 'BladeBot',
  version: '26.1',
  auth: 'offline'
})

bot.loadPlugin(pathfinder)
bot.loadPlugin(collectBlock)

let mcData
let movements
let busy = false

bot.once('spawn', () => {
  console.log('✅ BOT JOINED SHARPNESS SMP')

  mcData = require('minecraft-data')(bot.version)
  movements = new Movements(bot, mcData)

  movements.canDig = false
  movements.allow1by1towers = false

  bot.pathfinder.setMovements(movements)

  setInterval(mainLoop, 4000)
})

async function mainLoop() {
  if (!bot.entity || busy) return

  try {
    if (bot.food !== undefined && bot.food <= 14) {
      await eatFood()
      return
    }

    const mob = findMob()

    if (mob) {
      await fightMob(mob)
      return
    }

    const wood = findWood()

    if (wood) {
      await collectWood(wood)
      return
    }

    walkAround()
  } catch (error) {
    console.log('AI error:', error.message)
    busy = false
  }
}

function findMob() {
  const hostile = [
    'zombie',
    'skeleton',
    'spider',
    'husk',
    'drowned',
    'stray',
    'witch'
  ]

  let closest = null
  let closestDistance = 10

  for (const entity of Object.values(bot.entities)) {
    if (!entity.position) continue
    if (!hostile.includes(entity.name)) continue

    const distance =
      bot.entity.position.distanceTo(entity.position)

    if (distance < closestDistance) {
      closest = entity
      closestDistance = distance
    }
  }

  return closest
}

async function fightMob(mob) {
  if (!mob || !mob.isValid) return

  busy = true

  try {
    console.log('⚔️ Fighting:', mob.name)

    const start = Date.now()

    while (
      mob.isValid &&
      Date.now() - start < 15000
    ) {
      const distance =
        bot.entity.position.distanceTo(mob.position)

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
    console.log('Fight error:', error.message)
  }

  bot.pathfinder.setGoal(null)
  busy = false
}

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
    'cooked_mutton'
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
    console.log('🍖 Eating:', food.name)

    await bot.equip(food, 'hand')
    await bot.consume()
  } catch (error) {
    console.log('Eat error:', error.message)
  }

  busy = false
}

function findWood() {
  const names = [
    'oak_log',
    'birch_log',
    'spruce_log',
    'jungle_log',
    'acacia_log',
    'dark_oak_log'
  ]

  const ids = names
    .map(name => mcData.blocksByName[name]?.id)
    .filter(id => id !== undefined)

  return bot.findBlock({
    matching: ids,
    maxDistance: 24
  })
}

async function collectWood(block) {
  if (!block) return

  busy = true

  try {
    console.log('🌳 Collecting wood...')
    await bot.collectBlock.collect(block)
  } catch (error) {
    console.log('Wood error:', error.message)
  }

  busy = false
}

function walkAround() {
  const x =
    Math.floor(bot.entity.position.x) +
    Math.floor(Math.random() * 21) - 10

  const z =
    Math.floor(bot.entity.position.z) +
    Math.floor(Math.random() * 21) - 10

  const y = Math.floor(bot.entity.position.y)

  console.log('🚶 Walking...')

  bot.pathfinder.setGoal(
    new goals.GoalNear(x, y, z, 2)
  )
}

bot.on('chat', (username, message) => {
  if (username === bot.username) return

  if (message === '!come') {
    const player = bot.players[username]

    if (player && player.entity) {
      const p = player.entity.position

      bot.pathfinder.setGoal(
        new goals.GoalNear(p.x, p.y, p.z, 2)
      )

      bot.chat('Coming!')
    }
  }

  if (message === '!stop') {
    bot.pathfinder.setGoal(null)
    bot.clearControlStates()
    bot.chat('Stopped!')
  }

  if (message === '!status') {
    bot.chat(
      `Health: ${Math.round(bot.health)} Food: ${bot.food}`
    )
  }
})

bot.on('error', error => {
  console.log('❌ ERROR:', error.message)
})

bot.on('kicked', reason => {
  console.log('❌ KICKED:', reason)
})

bot.on('end', () => {
  console.log('❌ Bot disconnected')
})

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
