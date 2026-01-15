const { Telegraf } = require('telegraf');
const mineflayer = require('mineflayer');
const util = require('minecraft-server-util');
const express = require('express');

const BOT_TOKEN = '7515754799:AAHfVpM55L_lmv5wGeDsIOJQzbYyY6M126w';
const tgBot = new Telegraf(BOT_TOKEN);
const app = express();

const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot Controller is running'));
app.listen(PORT, '0.0.0.0', () => console.log(`✅ Web server active on port ${PORT}`));

let config = { host: '', port: 25565, username: 'AFK_Bot', version: 'auto' };
let bot = null;
let isBotOnline = false;
let isConnecting = false; // НОВЕ: запобігає спаму під час підключення
let monitorInterval = null;
let chatId = null;

const sendMsg = (text) => {
    if (chatId) tgBot.telegram.sendMessage(chatId, text).catch(e => console.error('TG Error:', e.message));
    console.log(text);
};

function createMinecraftBot() {
    if (bot || isConnecting) return; // Якщо вже підключаємось — ігноруємо

    isConnecting = true;
    sendMsg(`⏳ Attempting to connect ${config.username} to ${config.host}...`);

    bot = mineflayer.createBot({
        host: config.host,
        port: config.port,
        username: config.username,
        version: config.version,
        hideErrors: false
    });

    bot.once('spawn', () => {
        isBotOnline = true;
        isConnecting = false;
        sendMsg(`🤖 Bot successfully spawned! Starting AFK routine.`);
        
        // Рух
        setInterval(() => {
            if (bot && bot.entity) {
                bot.setControlState('jump', true);
                setTimeout(() => bot.setControlState('jump', false), 500);
            }
        }, 10000);
    });

    bot.on('error', (err) => {
        sendMsg(`❌ Connection Error: ${err.message}`);
        cleanup();
    });

    bot.on('end', () => {
        sendMsg('🔁 Bot session ended.');
        cleanup();
    });

    function cleanup() {
        bot = null;
        isBotOnline = false;
        isConnecting = false;
    }
}

async function checkServerStatus() {
    if (!config.host || isConnecting || isBotOnline) return; // Не спамити, якщо бот вже в процесі

    try {
        const result = await util.status(config.host, config.port, { timeout: 3000 });
        const players = result.players.online;

        if (players === 0) {
            createMinecraftBot();
        }
    } catch (err) {
        console.log('Target server is offline/unreachable.');
    }
}

// Команди Telegram
tgBot.command('setserver', (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) return ctx.reply('Usage: /setserver <ip>');
    config.host = args[1];
    config.port = parseInt(args[2]) || 25565;
    chatId = ctx.chat.id;
    
    if (monitorInterval) clearInterval(monitorInterval);
    monitorInterval = setInterval(checkServerStatus, 15000); // Перевірка кожні 15 сек
    ctx.reply(`✅ Monitoring ${config.host}:${config.port}`);
});

tgBot.telegram.deleteWebhook({ drop_pending_updates: true }).then(() => {
    tgBot.launch();
    console.log('🚀 Telegram Bot started');
});
