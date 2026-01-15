const { Telegraf } = require('telegraf');
const mineflayer = require('mineflayer');
const util = require('minecraft-server-util');
const express = require('express');

// --- Configuration ---
const BOT_TOKEN = '7515754799:AAHfVpM55L_lmv5wGeDsIOJQzbYyY6M126w';
const tgBot = new Telegraf(BOT_TOKEN);
const app = express();

// Keep-alive server
app.get('/', (req, res) => res.send('Bot Controller is running'));
app.listen(3000, () => console.log('✅ Web server for keep-alive is active'));

// State variables
let config = {
    host: '',
    port: 25565,
    username: 'AFK_Bot',
    version: 'auto'
};

let bot = null;
let isBotOnline = false;
let moveInterval = null;
let monitorInterval = null;
let chatId = null; // To know where to send updates

// --- Helper Functions ---
const sendMsg = (text) => {
    if (chatId) tgBot.telegram.sendMessage(chatId, text);
    console.log(text);
};

function createMinecraftBot() {
    if (bot) return;

    bot = mineflayer.createBot({
        host: config.host,
        port: config.port,
        username: config.username,
        version: config.version
    });

    bot.on('spawn', () => {
        isBotOnline = true;
        sendMsg(`🤖 Bot connected to ${config.host}. Starting AFK movements.`);

        let forward = true;
        moveInterval = setInterval(() => {
            if (!bot || !bot.entity) return;
            bot.setControlState('forward', forward);
            bot.setControlState('back', !forward);
            forward = !forward;
            
            const yaw = Math.random() * Math.PI * 2;
            bot.look(yaw, 0, true);
        }, 4000);
    });

    const cleanup = () => {
        if (moveInterval) clearInterval(moveInterval);
        moveInterval = null;
        bot = null;
        isBotOnline = false;
    };

    bot.on('end', () => {
        sendMsg('🔁 Bot disconnected from server.');
        cleanup();
    });

    bot.on('error', (err) => {
        sendMsg(`❌ Error: ${err.message}`);
        cleanup();
    });

    bot.on('kicked', (reason) => {
        sendMsg(`👢 Kicked: ${reason}`);
        cleanup();
    });
}

async function checkServerStatus() {
    if (!config.host) return;

    try {
        const result = await util.status(config.host, config.port, {
            timeout: 2000,
            enableSRV: true
        });

        const players = result.players.online;

        if (players === 0 && !isBotOnline) {
            sendMsg('🟢 Server is empty — Connecting bot...');
            createMinecraftBot();
        } else if (players > 1 && isBotOnline) {
            sendMsg('🔴 Real players detected — Disconnecting bot to save slot...');
            if (bot) {
                bot.quit('Players joined');
                isBotOnline = false;
            }
        }
    } catch (err) {
        // Server offline or unreachable
    }
}

// --- Telegram Commands ---

tgBot.start((ctx) => {
    chatId = ctx.chat.id;
    ctx.reply('Welcome! I am your Minecraft AFK Bot Controller.\n\n' +
              'Commands:\n' +
              '/setserver <ip> <port> - Set server details\n' +
              '/setname <name> - Set bot nickname\n' +
              '/status - Check current status\n' +
              '/stop - Stop monitoring');
});

tgBot.command('setserver', (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) return ctx.reply('Usage: /setserver <ip> [port]');
    
    config.host = args[1];
    config.port = parseInt(args[2]) || 25565;
    
    ctx.reply(`✅ Target server set to ${config.host}:${config.port}\nMonitoring started.`);
    
    if (monitorInterval) clearInterval(monitorInterval);
    monitorInterval = setInterval(checkServerStatus, 10000); // Check every 10 seconds
});

tgBot.command('setname', (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) return ctx.reply('Usage: /setname <nickname>');
    config.username = args[1];
    ctx.reply(`✅ Bot name set to: ${config.username}`);
});

tgBot.command('status', (ctx) => {
    const status = isBotOnline ? '✅ Online' : '❌ Offline';
    ctx.reply(`Server: ${config.host || 'Not set'}\nBot Name: ${config.username}\nBot Status: ${status}`);
});

tgBot.command('stop', (ctx) => {
    if (monitorInterval) clearInterval(monitorInterval);
    if (bot) bot.quit();
    ctx.reply('🛑 Monitoring stopped and bot disconnected.');
});

tgBot.launch();
console.log('🚀 Telegram Bot is running...');

// Enable graceful stop
process.once('SIGINT', () => tgBot.stop('SIGINT'));
process.once('SIGTERM', () => tgBot.stop('SIGTERM'));