// index.js
require('dotenv').config(); // Якщо тестуєш локально
const { Telegraf, Markup } = require('telegraf');
const mineflayer = require('mineflayer');
const util = require('minecraft-server-util');
const express = require('express');
const fs = require('fs');

// --- НАЛАШТУВАННЯ ---
const BOT_TOKEN = "7515754799:AAHfVpM55L_lmv5wGeDsIOJQzbYyY6M126w"; // На Render додай це в Environment Variables
const ADMIN_ID = 123456789; // Заміни на свій ID для тестів

const bot = new Telegraf(BOT_TOKEN);
const app = express();

// --- БАЗА ДАНИХ (Проста JSON версія) ---
const DB_FILE = 'database.json';
let users = {};

function loadDB() {
    if (fs.existsSync(DB_FILE)) {
        users = JSON.parse(fs.readFileSync(DB_FILE));
    }
}

function saveDB() {
    fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));
}

loadDB();

// --- ВЕБ-СЕРВЕР (Для Render Keep-Alive) ---
app.get('/', (req, res) => res.send('Aternos Bot is Alive!'));
app.listen(process.env.PORT || 3000, () => console.log('✅ Web Server running'));

// --- ЛОГІКА MINECRAFT ---
const activeBots = {}; // Зберігаємо активних ботів: { chatId: botInstance }

async function runMinecraftLoop() {
    for (const chatId in users) {
        const user = users[chatId];
        
        // Перевірка підписки
        if (new Date(user.subscriptionEnd) < new Date()) {
            if (activeBots[chatId]) {
                activeBots[chatId].quit();
                delete activeBots[chatId];
                bot.telegram.sendMessage(chatId, '❌ Ваша підписка закінчилась! Продовжте її для роботи бота.');
            }
            continue;
        }

        if (!user.ip || !user.isRunning) continue;

        try {
            // Перевіряємо статус сервера
            const status = await util.status(user.ip, user.port, { timeout: 2000, enableSRV: true });
            const onlineCount = status.players.online;

            // Логіка: Заходимо тільки якщо 0 гравців. Виходимо, якщо > 1 (бо наш бот це 1)
            // Примітка: Aternos показує 0, якщо сервер вимкнено, тому треба ловити помилки
            
            if (onlineCount === 0 && !activeBots[chatId]) {
                startMineflayerBot(chatId, user);
            } else if (onlineCount > 1 && activeBots[chatId]) {
                // Хтось зайшов (гравців > 1, бо наш бот теж рахується)
                activeBots[chatId].quit();
                delete activeBots[chatId];
                bot.telegram.sendMessage(chatId, '👤 Гравець зайшов на сервер. Бот виходить.');
            }

        } catch (error) {
            // Сервер офлайн або недоступний
            if (activeBots[chatId]) {
                activeBots[chatId].quit();
                delete activeBots[chatId];
            }
        }
    }
}

function startMineflayerBot(chatId, user) {
    if (activeBots[chatId]) return;

    bot.telegram.sendMessage(chatId, '🟢 Сервер порожній. Бот заходить...');

    const mcBot = mineflayer.createBot({
        host: user.ip,
        port: user.port,
        username: user.botName,
        version: user.version === 'auto' ? false : user.version
    });

    activeBots[chatId] = mcBot;

    mcBot.on('spawn', () => {
        // Реєстрація / Логін
        setTimeout(() => {
            if(user.password) {
                mcBot.chat(`/register ${user.password} ${user.password}`);
                mcBot.chat(`/login ${user.password}`);
            }
        }, 3000);

        // Anti-AFK
        let forward = true;
        setInterval(() => {
            if(!mcBot) return;
            mcBot.setControlState('forward', forward);
            mcBot.setControlState('back', !forward);
            forward = !forward;
            mcBot.look(Math.random() * Math.PI * 2, 0);
        }, 5000);
    });

    mcBot.on('kicked', (reason) => {
        bot.telegram.sendMessage(chatId, `⚠️ Бота кікнули: ${reason}`);
        delete activeBots[chatId];
    });

    mcBot.on('error', (err) => {
        console.log(`Bot error for ${chatId}: ${err.message}`);
        delete activeBots[chatId];
    });
    
    // Якщо заходить справжній гравець
    mcBot.on('playerJoined', (player) => {
        if (player.username !== user.botName) {
            mcBot.quit();
            delete activeBots[chatId];
            bot.telegram.sendMessage(chatId, `👤 Зайшов гравець ${player.username}. Бот звільняє місце.`);
        }
    });
}

// Запускаємо цикл перевірки кожні 10 секунд
setInterval(runMinecraftLoop, 10000);

// --- TELEGRAM COMMANDS ---

bot.start((ctx) => {
    const userId = ctx.from.id;
    if (!users[userId]) {
        // 7 днів безкоштовно
        const expiry = new Date();
        expiry.setDate(expiry.getDate() + 7);
        
        users[userId] = {
            ip: null,
            port: 25565,
            version: 'auto',
            botName: 'AFK_Bot',
            password: null,
            subscriptionEnd: expiry,
            isRunning: false
        };
        saveDB();
        ctx.reply('👋 Привіт! Це Aternos Anti-AFK Bot.\n🎁 Ти отримав 7 днів безкоштовного користування!\n\nНалаштуй бота командою: /setup');
    } else {
        ctx.reply('З поверненням! Перевір статус: /status');
    }
});

bot.command('setup', (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    // Формат: /setup IP PORT NICK PASS VERSION
    if (args.length < 4) {
        return ctx.reply('⚠️ Формат: `/setup <IP> <PORT> <NICK> <PASS> [VERSION]`\nПриклад: `/setup myserver.aternos.me 12345 MyBot 123456 1.16.5`', { parse_mode: 'Markdown' });
    }

    users[ctx.from.id].ip = args[0];
    users[ctx.from.id].port = parseInt(args[1]);
    users[ctx.from.id].botName = args[2];
    users[ctx.from.id].password = args[3];
    users[ctx.from.id].version = args[4] || 'auto';
    users[ctx.from.id].isRunning = true;
    saveDB();

    ctx.reply('✅ Налаштування збережено! Бот почне моніторити сервер.');
});

bot.command('status', (ctx) => {
    const user = users[ctx.from.id];
    if (!user) return ctx.reply('Спочатку натисни /start');

    const daysLeft = Math.ceil((new Date(user.subscriptionEnd) - new Date()) / (1000 * 60 * 60 * 24));
    const active = activeBots[ctx.from.id] ? '🟢 Онлайн на сервері' : '⚪ Очікує / Сервер офлайн';

    ctx.reply(
        `📊 **Статус**\n` +
        `📡 Сервер: ${user.ip || 'Не встановлено'}:${user.port}\n` +
        `🤖 Бот: ${user.botName}\n` +
        `⏳ Підписка: ще ${daysLeft} днів\n` +
        `⚙️ Стан: ${active}`,
        { parse_mode: 'Markdown' }
    );
});

bot.command('stop', (ctx) => {
    if (users[ctx.from.id]) {
        users[ctx.from.id].isRunning = false;
        saveDB();
        if (activeBots[ctx.from.id]) {
            activeBots[ctx.from.id].quit();
            delete activeBots[ctx.from.id];
        }
        ctx.reply('🛑 Моніторинг зупинено.');
    }
});

// --- ОПЛАТА TELEGRAM STARS ---
bot.command('buy', (ctx) => {
    ctx.reply('Оберіть кількість днів:', Markup.inlineKeyboard([
        [Markup.button.callback('1 день (1 ⭐)', 'buy_1')],
        [Markup.button.callback('10 днів (9 ⭐) -10%', 'buy_10')],
        [Markup.button.callback('30 днів (24 ⭐) -20%', 'buy_30')]
    ]));
});

bot.action(/buy_(\d+)/, async (ctx) => {
    const days = parseInt(ctx.match[1]);
    let price = days; // 1 зірка за день

    // Логіка знижок
    if (days >= 10 && days < 30) price = Math.floor(days * 0.9); // 10% знижка
    if (days >= 30) price = Math.floor(days * 0.8); // 20% знижка

    // Створення інвойсу
    await ctx.replyWithInvoice({
        title: `Підписка на ${days} днів`,
        description: `Доступ до Aternos BOT на ${days} днів`,
        payload: `sub_${days}`, // Внутрішній ID покупки
        currency: 'XTR', // Валюта для Stars
        prices: [{ label: 'Price', amount: price }], // Ціна в зірках
        provider_token: '' // Для Stars це поле порожнє
    });
});

// Обробка успішної оплати
bot.on('pre_checkout_query', (ctx) => ctx.answerPreCheckoutQuery(true));

bot.on('successful_payment', (ctx) => {
    const payload = ctx.message.successful_payment.invoice_payload;
    const days = parseInt(payload.split('_')[1]);
    const userId = ctx.from.id;

    if (users[userId]) {
        const currentEnd = new Date(users[userId].subscriptionEnd);
        // Якщо підписка вже закінчилась, додаємо до поточної дати, інакше до дати закінчення
        const baseDate = currentEnd > new Date() ? currentEnd : new Date();
        baseDate.setDate(baseDate.getDate() + days);
        users[userId].subscriptionEnd = baseDate;
        saveDB();
        ctx.reply(`🎉 Оплата успішна! Підписку продовжено на ${days} днів.`);
    }
});

// ЗАПУСК
bot.launch().then(() => console.log('🚀 Bot started'));

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
