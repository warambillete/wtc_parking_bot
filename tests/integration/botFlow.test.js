const TelegramBotMock = require('../mocks/TelegramBotMock');
const Database = require('../../src/database');
const MessageProcessor = require('../../src/messageProcessor');
const ParkingManager = require('../../src/parkingManager');
const QueueManager = require('../../src/queueManager');
const moment = require('moment-timezone');

// Simplified Bot class for testing
class TestBot {
    constructor(bot, db) {
        this.bot = bot;
        this.db = db;
        this.messageProcessor = new MessageProcessor();
        this.parkingManager = new ParkingManager(db);
        this.queueManager = new QueueManager(db, bot);
        this.supervisorId = '999999';
        
        this.setupHandlers();
    }

    setupHandlers() {
        this.bot.on('message', async (msg) => {
            const chatId = msg.chat.id;
            const userId = msg.from.id;
            const text = msg.text?.trim(); // Don't lowercase for commands
            
            if (!text) return;

            // Handle supervisor commands
            if (userId.toString() === this.supervisorId && text.startsWith('/')) {
                if (text.startsWith('/setparking')) {
                    const numbers = text.replace('/setparking', '').trim().split(',').map(n => n.trim());
                    await this.parkingManager.setParkingSpots(numbers);
                    await this.bot.sendMessage(chatId, `✅ Estacionamientos: ${numbers.join(', ')}`);
                    return;
                }
            }

            // Process normal messages - lowercase for parsing
            const intent = this.messageProcessor.processMessage(text.toLowerCase());
            
            if (intent.type === 'RESERVE') {
                const result = await this.parkingManager.reserveSpot(userId, msg.from, intent.date);
                if (result.success) {
                    await this.bot.sendMessage(chatId, `✅ Estacionamiento ${result.spotNumber} reservado`);
                } else if (result.waitlist) {
                    await this.bot.sendMessage(chatId, '🚫 No hay espacios. ¿Lista de espera?', {
                        reply_markup: {
                            inline_keyboard: [[
                                { text: 'Sí', callback_data: `waitlist_yes_${userId}_${intent.date.format('YYYY-MM-DD')}` },
                                { text: 'No', callback_data: 'waitlist_no' }
                            ]]
                        }
                    });
                } else {
                    await this.bot.sendMessage(chatId, '❌ ' + result.message);
                }
            } else if (intent.type === 'RELEASE') {
                const result = await this.parkingManager.releaseSpot(userId, intent.date);
                if (result.success) {
                    await this.bot.sendMessage(chatId, `✅ Liberado estacionamiento ${result.spotNumber}`);
                }
            } else if (intent.type === 'STATUS') {
                const status = await this.parkingManager.getWeekStatus();
                const formattedStatus = await this.parkingManager.formatWeekStatus(status);
                await this.bot.sendMessage(chatId, formattedStatus);
            }
        });

        this.bot.on('callback_query', async (query) => {
            const data = query.data;
            const userId = query.from.id;
            
            if (data.startsWith('waitlist_yes_')) {
                const parts = data.split('_');
                const dateStr = parts[3];
                const date = moment(dateStr);
                
                await this.parkingManager.addToWaitlist(userId, query.from, date);
                await this.bot.editMessageText('📝 Añadido a lista de espera', {
                    chat_id: query.message.chat.id,
                    message_id: query.message.message_id
                });
            }
        });
    }
}

describe('Bot Complete Flow Tests', () => {
    let bot;
    let db;
    let testBot;

    beforeEach(async () => {
        bot = new TelegramBotMock('test-token');
        db = new Database(':memory:');
        await db.init();
        testBot = new TestBot(bot, db);
        // Clear messages before each test
        bot.clearMessages();
    });

    afterEach(() => {
        db.close();
    });

    test('Complete reservation flow', async () => {
        // 1. Supervisor sets parking spots
        bot.simulateMessage(999999, '/setparking 1,2,3');
        await new Promise(resolve => setTimeout(resolve, 10)); // Allow async processing
        expect(bot.getLastMessage().text).toContain('Estacionamientos: 1, 2, 3');

        // 2. User reserves a spot
        bot.simulateMessage(111, 'voy mañana', 'Alice');
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(bot.getLastMessage().text).toContain('✅ Estacionamiento');
        expect(bot.getLastMessage().text).toMatch(/[123]/);

        // 3. Another user reserves
        bot.simulateMessage(222, 'reservo mañana', 'Bob');
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(bot.getLastMessage().text).toContain('✅ Estacionamiento');

        // 4. Third user reserves
        bot.simulateMessage(333, 'necesito mañana', 'Carlos');
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(bot.getLastMessage().text).toContain('✅ Estacionamiento');

        // 5. Fourth user gets waitlist option
        bot.simulateMessage(444, 'voy mañana', 'Diana');
        await new Promise(resolve => setTimeout(resolve, 10));
        const lastMsg = bot.getLastMessage();
        expect(lastMsg.text).toContain('No hay espacios');
        expect(lastMsg.options.reply_markup.inline_keyboard).toBeDefined();
    });

    test('Waitlist flow', async () => {
        // Setup
        bot.simulateMessage(999999, '/setparking 1,2');
        await new Promise(resolve => setTimeout(resolve, 10));
        
        // Fill all spots
        bot.simulateMessage(111, 'voy mañana', 'Alice');
        await new Promise(resolve => setTimeout(resolve, 10));
        bot.simulateMessage(222, 'voy mañana', 'Bob');
        await new Promise(resolve => setTimeout(resolve, 10));
        
        // Third user gets waitlist
        bot.simulateMessage(333, 'voy mañana', 'Carlos');
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(bot.getLastMessage().text).toContain('No hay espacios');
        
        // Carlos accepts waitlist
        const tomorrow = moment().add(1, 'day').format('YYYY-MM-DD');
        bot.simulateCallbackQuery(333, `waitlist_yes_333_${tomorrow}`);
        await new Promise(resolve => setTimeout(resolve, 50)); // Longer timeout
        expect(bot.getLastActivity().text).toContain('Añadido a lista de espera');
        
        // Alice releases her spot
        bot.simulateMessage(111, 'libero mañana', 'Alice');
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(bot.getLastMessage().text).toContain('Liberado estacionamiento');
    });

    test('Status command', async () => {
        bot.simulateMessage(999999, '/setparking 1,2,3');
        await new Promise(resolve => setTimeout(resolve, 10));
        bot.simulateMessage(111, 'voy mañana');
        await new Promise(resolve => setTimeout(resolve, 10));
        
        bot.simulateMessage(111, 'estado');
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(bot.getLastMessage().text).toMatch(/Estado de la (semana|próxima semana)/);
    });

    test('Double booking prevention', async () => {
        bot.simulateMessage(999999, '/setparking 1,2,3');
        await new Promise(resolve => setTimeout(resolve, 10));
        
        // First reservation
        bot.simulateMessage(111, 'voy mañana');
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(bot.getLastMessage().text).toContain('✅');
        
        // Try to book again
        bot.simulateMessage(111, 'reservo mañana');
        await new Promise(resolve => setTimeout(resolve, 50)); // Longer timeout
        expect(bot.getLastMessage().text).toContain('Ya tienes reservado');
    });

    test('Release and re-reserve', async () => {
        bot.simulateMessage(999999, '/setparking 1,2,3');
        await new Promise(resolve => setTimeout(resolve, 10));
        
        // Reserve
        bot.simulateMessage(111, 'voy mañana');
        await new Promise(resolve => setTimeout(resolve, 10));
        const firstReservation = bot.getLastMessage().text;
        
        // Release
        bot.simulateMessage(111, 'libero mañana');
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(bot.getLastMessage().text).toContain('Liberado');
        
        // Reserve again
        bot.simulateMessage(111, 'voy mañana');
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(bot.getLastMessage().text).toContain('✅ Estacionamiento');
    });
});