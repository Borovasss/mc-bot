const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const pvp = require('mineflayer-pvp').plugin;
const collectBlock = require('mineflayer-collectblock').plugin;
const http = require('http');

const WORKER_URL = process.env.WORKER_URL || 'https://obscounter-site.buslakovdaniil76.workers.dev';
const ADMIN_PASS = process.env.ADMIN_PASS || '062028';
const PORT = process.env.PORT || 3000;

let config = {
  host: 'mc.2b2t.org.ru',
  port: 25565,
  version: '1.17',
  username: 'bobofpp',
  auth: 'offline'
};

let bot = null;
let isAuthenticated = false;
let followTarget = null;
let messageBuffer = [];
let lastBufferFlush = Date.now();
const FLUSH_INTERVAL = 3000;
let botRunning = false;
let botEnabled = true;
let botconnected = false;

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
  bufferMessage('system', msg);
}

function bufferMessage(sender, text, type) {
  messageBuffer.push({
    ts: Date.now(),
    sender: (sender || '').slice(0, 64),
    text: (text || '').slice(0, 2000),
    type: type || 'chat'
  });
  if (Date.now() - lastBufferFlush > FLUSH_INTERVAL) {
    flushMessages();
  }
}

async function flushMessages() {
  if (!messageBuffer.length) return;
  const msgs = messageBuffer.splice(0, 50);
  lastBufferFlush = Date.now();
  try {
    const body = JSON.stringify({ messages: msgs });
    const url = new URL(WORKER_URL + '/api/bot/push');
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 5000
    };
    const proto = url.protocol === 'https:' ? require('https') : require('http');
    const req = proto.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.commands && json.commands.length) {
            handleRemoteCommands(json.commands);
          }
        } catch {}
      });
    });
    req.on('error', () => {});
    req.write(body);
    req.end();
  } catch {}
}

async function pollCommands() {
  try {
    const body = JSON.stringify({ messages: [] });
    const url = new URL(WORKER_URL + '/api/bot/push');
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 5000
    };
    const proto = url.protocol === 'https:' ? require('https') : require('http');
    const req = proto.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.commands && json.commands.length) {
            handleRemoteCommands(json.commands);
          }
        } catch {}
      });
    });
    req.on('error', () => {});
    req.write(body);
    req.end();
  } catch {}
}

function handleRemoteCommands(commands) {
  for (const cmd of commands) {
    log(`[REMOTE] Команда: ${cmd.type} | ${cmd.data}`);
    switch (cmd.type) {
      case 'restart':
        log('Перезапуск по команде сервера...');
        if (bot) bot.quit();
        setTimeout(createBot, 2000);
        break;
      case 'config_update':
        try {
          const newCfg = JSON.parse(cmd.data);
          if (newCfg.host) config.host = newCfg.host;
          if (newCfg.port) config.port = parseInt(newCfg.port) || 25565;
          if (newCfg.version) config.version = newCfg.version;
          if (newCfg.username) config.username = newCfg.username;
          if (newCfg.auth) config.auth = newCfg.auth;
          log(`Конфиг обновлён: ${config.host}:${config.port} v${config.version} nick=${config.username} auth=${config.auth}`);
        } catch (e) { log(`Ошибка парсинга конфига: ${e.message}`); }
        break;
      case 'chat':
        if (bot && cmd.data) {
          bot.chat(cmd.data);
          log(`>> ${cmd.data}`);
        }
        break;
      case 'goto':
        if (bot && cmd.data) {
          const parts = cmd.data.split(' ').map(Number);
          if (parts.length >= 3 && parts.every(n => !isNaN(n))) {
            bot.pathfinder.setGoal(new goals.GoalBlock(parts[0], parts[1], parts[2]));
            log(`Иду к ${parts[0]} ${parts[1]} ${parts[2]}`);
          }
        }
        break;
      case 'follow':
        if (cmd.data && bot.players[cmd.data]) {
          followTarget = cmd.data;
          log(`Слежу за ${followTarget}`);
        }
        break;
      case 'stop':
        followTarget = null;
        if (bot) { bot.pathfinder.setGoal(null); bot.clearControlStates(); }
        log('Остановлен.');
        break;
      case 'start':
        botEnabled = true;
        if (!bot || !botconnected) {
          log('Запуск бота по команде сервера...');
          createBot();
        } else {
          log('Бот уже запущен.');
        }
        break;
      case 'off':
        botEnabled = false;
        if (bot) {
          log('Остановка бота по команде сервера...');
          bot.quit();
          bot = null;
          botconnected = false;
        }
        log('Бот выключен.');
        break;
    }
  }
}

async function loadRemoteConfig() {
  try {
    const url = new URL(WORKER_URL + '/api/bot/config');
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'GET',
      timeout: 5000
    };
    const proto = url.protocol === 'https:' ? require('https') : require('http');
    return new Promise((resolve) => {
      const req = proto.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.config) {
              if (json.config.host) config.host = json.config.host;
              if (json.config.port) config.port = parseInt(json.config.port) || 25565;
              if (json.config.version) config.version = json.config.version;
              if (json.config.username) config.username = json.config.username;
              if (json.config.auth) config.auth = json.config.auth;
              log(`Конфиг с сервера: ${config.host}:${config.port} v${config.version} nick=${config.username} auth=${config.auth}`);
            }
          } catch {}
          resolve();
        });
      });
      req.on('error', () => resolve());
      req.end();
    });
  } catch { return; }
}

function createBot() {
  if (!botEnabled) {
    log('Бот выключен. Используйте "старт" для запуска.');
    botRunning = false;
    return;
  }
  botRunning = true;
  log(`Подключение к ${config.host}:${config.port}...`);

  bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    version: config.version,
    username: config.username,
    auth: config.auth,
    physicsEnabled: true,
    checkTimeoutInterval: 60000
  });

  bot.loadPlugin(pathfinder);
  bot.loadPlugin(pvp);
  bot.loadPlugin(collectBlock);

  bot.once('spawn', () => {
    log('Бот заспавнился!');
    botconnected = true;
    isAuthenticated = false;

    const mcData = require('minecraft-data')(bot.version);
    const movements = new Movements(bot, mcData);
    movements.allowSprinting = true;
    movements.canDig = true;
    movements.allow1by1towers = true;
    movements.allowDownwards = true;

    bot.pathfinder.setMovements(movements);
    bot.setControlState('jump', false);
    bot.setControlState('sprint', true);

    log('Физика включена. Pathfinder загружен.');

    setTimeout(() => {
      if (!isAuthenticated) {
        log('Нет запроса логина — вход без пароля.');
        isAuthenticated = true;
      }
    }, 5000);
  });

  bot.on('messagestr', (msg) => {
    log(`CHAT: ${msg}`);
    bufferMessage('chat', msg, 'chat');
    if (!isAuthenticated && msg.includes('/login')) {
      log('Сервер запросил логин.');
    }
    if (!isAuthenticated && (msg.includes('Проверка пройдена') || msg.includes('успешно') || msg.includes('Успешная регистрация'))) {
      isAuthenticated = true;
      log('Авторизация подтверждена.');
    }
  });

  bot.on('message', (jsonMsg) => {
    const msg = jsonMsg.toString();
    if (msg.includes('whisper') || msg.includes('ЛС')) {
      log(`WHISPER: ${msg}`);
      bufferMessage('system', msg, 'whisper');
    }
  });

  bot.on('physicsTick', () => {
    if (followTarget) {
      const entity = bot.players[followTarget];
      if (entity) {
        bot.pathfinder.setGoal(new goals.GoalFollow(entity.entity, 2));
      } else {
        log(`${followTarget} не найден. Остановка.`);
        followTarget = null;
        bot.pathfinder.setGoal(null);
      }
    }
  });

  bot.on('health', () => {
    const armor = bot.armorPercentage !== undefined ? (bot.armorPercentage * 100).toFixed(0) + '%' : 'н/д';
    log(`Здоровье: ${bot.health.toFixed(1)} | Голод: ${bot.food.toFixed(1)} | Броня: ${armor}`);
  });

  bot.on('death', () => {
    log('Бот умер! Респавн...');
  });

  bot.on('kicked', (reason) => {
    const reasonStr = typeof reason === 'string' ? reason : JSON.stringify(reason);
    log(`Кикнут: ${reasonStr}`);
    followTarget = null;
  });

  bot.on('error', (err) => {
    log(`Ошибка: ${err.message}`);
  });

  bot.on('end', () => {
    followTarget = null;
    botconnected = false;
    if (!botEnabled) {
      log('Соединение закрыто. Бот выключен — переподключение отменено.');
      botRunning = false;
      return;
    }
    log('Соединение закрыто. Переподключение через 5 сек...');
    setTimeout(createBot, 5000);
  });

  bot.on('windowOpen', (window) => {
    log(`Открыт инвентарь: ${window.title}`);
  });

  bot.on('entityGone', (entity) => {
    if (followTarget && entity.username === followTarget) {
      log(`${followTarget} вышел из видимости.`);
      followTarget = null;
    }
  });
}

function handleCommand(input) {
  const trimmed = input.trim();
  if (!trimmed) return;

  if (!bot || !bot.player) {
    log('Бот ещё не подключён.');
    return;
  }

  const parts = trimmed.split(' ');
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  switch (cmd) {
    case 'goto':
      if (args.length >= 3) {
        const x = parseInt(args[0]), y = parseInt(args[1]), z = parseInt(args[2]);
        if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
          log(`Иду к ${x} ${y} ${z}`);
          bot.pathfinder.setGoal(new goals.GoalBlock(x, y, z));
        } else log('Использование: goto <x> <y> <z>');
      } else log('Использование: goto <x> <y> <z>');
      break;
    case 'follow':
      if (args[0]) { followTarget = args[0]; log(`Слежу за ${followTarget}`); }
      else log('Использование: follow <ник>');
      break;
    case 'stop':
      followTarget = null;
      bot.pathfinder.setGoal(null);
      bot.clearControlStates();
      log('Остановлен.');
      break;
    case 'start':
      botEnabled = true;
      if (!bot || !botconnected) {
        log('Запуск бота...');
        createBot();
      } else {
        log('Бот уже запущен.');
      }
      break;
    case 'off':
      botEnabled = false;
      if (bot) {
        log('Остановка бота...');
        bot.quit();
        bot = null;
        botconnected = false;
      }
      log('Бот выключен.');
      break;
    case 'dig':
      const block = bot.blockAtCursor(5);
      if (block) { log(`Ломаю: ${block.name}`); bot.dig(block).catch(e => log(`Ошибка: ${e.message}`)); }
      else log('Нет блока перед глазами.');
      break;
    case 'look':
      if (args.length >= 2) {
        bot.look(parseFloat(args[0]) * Math.PI / 180, parseFloat(args[1]) * Math.PI / 180);
        log(`Поворот: yaw=${args[0]} pitch=${args[1]}`);
      } else log('Использование: look <yaw> <pitch>');
      break;
    case 'jump':
      bot.setControlState('jump', true);
      setTimeout(() => bot.setControlState('jump', false), 500);
      log('Прыжок!');
      break;
    case 'sprint':
      bot.setControlState('sprint', !bot.getControlState('sprint'));
      log(`Спринт: ${!bot.getControlState('sprint')}`);
      break;
    case 'sneak':
      bot.setControlState('sneak', !bot.getControlState('sneak'));
      log(`Кража: ${!bot.getControlState('sneak')}`);
      break;
    case 'attack':
      if (args[0]) {
        const player = bot.players[args[0]];
        if (player && player.entity) { bot.attack(player.entity); log(`Атакую ${args[0]}`); }
        else log(`${args[0]} не найден.`);
      } else log('Использование: attack <ник>');
      break;
    case 'stats':
      log(`Позиция: ${bot.entity.position.x.toFixed(1)} ${bot.entity.position.y.toFixed(1)} ${bot.entity.position.z.toFixed(1)}`);
      log(`Здоровье: ${bot.health.toFixed(1)} | Голод: ${bot.food.toFixed(1)}`);
      log(`XP: Ур. ${bot.experience.level} | Энтити: ${Object.keys(bot.entities).length}`);
      break;
    case 'inventory':
      log('--- Инвентарь ---');
      bot.inventory.items().forEach(i => log(`  ${i.name} x${i.count}`));
      if (!bot.inventory.items().length) log('  Пусто');
      break;
    case 'players':
      log('--- Онлайн ---');
      Object.values(bot.players).forEach(p => {
        if (p.username !== bot.username) {
          const dist = bot.entity.position.distanceTo(p.entity.position).toFixed(1);
          log(`  ${p.username} (${dist}м)`);
        }
      });
      break;
    case 'pos':
      log(`XYZ: ${bot.entity.position.x.toFixed(2)} ${bot.entity.position.y.toFixed(2)} ${bot.entity.position.z.toFixed(2)}`);
      break;
    case 'equip':
      if (args[0]) {
        const item = bot.inventory.items().find(i => i.name === args[0]);
        if (item) bot.equip(item, 'hand').then(() => log(`Экипировал ${args[0]}`)).catch(e => log(`Ошибка: ${e.message}`));
        else log(`${args[0]} не найден.`);
      } else log('Использование: equip <название>');
      break;
    case 'drop':
      if (args[0]) {
        const item = bot.inventory.items().find(i => i.name === args[0]);
        if (item) { bot.tossStack(item); log(`Выбросил ${args[0]}`); }
        else log(`${args[0]} не найден.`);
      } else log('Использование: drop <название>');
      break;
    default:
      bot.chat(trimmed);
      log(`>> ${trimmed}`);
      break;
  }
}

// ===== HTTP-сервер для Render (health check + keep-alive) =====
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      bot: botconnected ? 'connected' : 'disconnected',
      enabled: botEnabled,
      server: config.host,
      nick: config.username,
      uptime: process.uptime()
    }));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('MC Bot is running');
  }
});

server.listen(PORT, () => {
  log(`HTTP-сервер запущен на порту ${PORT}`);
});

// ===== Keep-alive: пинг себя каждые 10 минут =====
setInterval(() => {
  const proto = require('http');
  const req = proto.get(`http://localhost:${PORT}/health`, (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
      log(`[KEEP-ALIVE] Пинг: ${data}`);
    });
  });
  req.on('error', (e) => log(`[KEEP-ALIVE] Ошибка: ${e.message}`));
  req.setTimeout(5000, () => { req.destroy(); });
}, 10 * 60 * 1000);

log('Keep-alive пинг каждые 10 минут активирован.');

async function main() {
  await loadRemoteConfig();
  createBot();
  setInterval(pollCommands, 10000);
  setInterval(flushMessages, FLUSH_INTERVAL);

  process.on('SIGTERM', () => { log('SIGTERM получен. Завершение...'); if (bot) bot.quit(); process.exit(0); });
  process.on('SIGINT', () => { log('SIGINT получен. Завершение...'); if (bot) bot.quit(); process.exit(0); });
}

main();
