const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const moment = require('moment-timezone');
const Database = require('./database');
const MessageProcessor = require('./messageProcessor');
const ParkingManager = require('./parkingManager');
const QueueManager = require('./queueManager');

moment.locale('es');
moment.tz.setDefault('America/Mexico_City');

class WTCParkBotWebhook {
    constructor() {
        this.token = process.env.TELEGRAM_BOT_TOKEN;
        this.supervisorId = process.env.SUPERVISOR_USER_ID;
        
        if (!this.token) {
            throw new Error('TELEGRAM_BOT_TOKEN no está configurado');
        }

        console.log('🚀 Starting WTC Parking Bot (WEBHOOK MODE)...');
        this.initializeBot();
    }
    
    async initializeBot() {
        // Initialize bot WITHOUT polling (webhooks only)
        this.bot = new TelegramBot(this.token, { polling: false });
        
        // Initialize database and managers
        this.db = new Database();
        await this.db.init();
        
        this.messageProcessor = new MessageProcessor();
        this.parkingManager = new ParkingManager(this.db);
        this.queueManager = new QueueManager(this.db, this.bot);
        
        // Set up Express server for webhooks
        this.app = express();
        this.app.use(express.json());
        
        // Health check endpoint
        this.app.get('/', (req, res) => {
            res.json({ 
                status: 'running', 
                bot: 'WTC Parking Bot',
                mode: 'webhook',
                timestamp: new Date().toISOString()
            });
        });
        
        // Webhook endpoint
        this.app.post(`/webhook/${this.token}`, (req, res) => {
            console.log('📨 Webhook received:', JSON.stringify(req.body));
            this.bot.processUpdate(req.body);
            res.sendStatus(200);
        });
        
        // Set up event handlers
        this.setupHandlers();
        
        // Start server
        const port = process.env.PORT || 3000;
        this.server = this.app.listen(port, async () => {
            console.log(`🌐 Webhook server running on port ${port}`);
            
            // Auto-detect webhook URL
            let webhookUrl = process.env.RENDER_EXTERNAL_URL;
            
            if (!webhookUrl) {
                // Try to auto-detect from Render environment
                const serviceName = process.env.RENDER_SERVICE_NAME;
                if (serviceName) {
                    webhookUrl = `https://${serviceName}.onrender.com`;
                    console.log(`🔍 Auto-detected webhook URL: ${webhookUrl}`);
                } else {
                    webhookUrl = `https://your-app.onrender.com`;
                    console.log('⚠️ Could not auto-detect URL. Please set RENDER_EXTERNAL_URL environment variable.');
                }
            }
            
            const fullWebhookUrl = `${webhookUrl}/webhook/${this.token}`;
            
            try {
                // Delete any existing webhook first
                await this.bot.deleteWebHook();
                console.log('🗑️ Deleted existing webhook');
                
                // Set new webhook
                await this.bot.setWebHook(fullWebhookUrl);
                console.log(`✅ Webhook set to: ${fullWebhookUrl}`);
                
                // Verify webhook
                const webhookInfo = await this.bot.getWebHookInfo();
                console.log('📡 Webhook info:', JSON.stringify(webhookInfo, null, 2));
                
            } catch (error) {
                console.error('❌ Error setting webhook:', error);
            }
        });
        
        // Handle graceful shutdown
        this.setupGracefulShutdown();
    }
    
    setupHandlers() {
        // Handle text messages
        this.bot.on('message', async (msg) => {
            if (msg.text) {
                await this.handleTextMessage(msg);
            }
        });
        
        // Handle callback queries (inline keyboard buttons)
        this.bot.on('callback_query', async (query) => {
            await this.handleCallbackQuery(query);
        });
        
        // Handle polling errors (shouldn't happen in webhook mode)
        this.bot.on('polling_error', (error) => {
            console.error('❌ Polling error (unexpected in webhook mode):', error);
        });
        
        // Handle webhook errors
        this.bot.on('webhook_error', (error) => {
            console.error('❌ Webhook error:', error);
        });
    }
    
    async handleTextMessage(msg) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const text = msg.text.toLowerCase().trim();
        
        console.log(`💬 Message from ${msg.from?.first_name} (${userId}): ${msg.text}`);
        
        try {
            // Handle supervisor commands
            if (userId.toString() === this.supervisorId && text.startsWith('/')) {
                await this.handleSupervisorCommand(msg);
                return;
            }
            
            // Process regular messages
            const intent = this.messageProcessor.processMessage(text);
            console.log(`🧠 Intent detected: ${intent.type}`);
            
            switch (intent.type) {
                case 'RESERVE':
                    await this.handleReservation(msg, intent);
                    break;
                    
                case 'RESERVE_MULTIPLE':
                    await this.handleMultipleReservations(msg, intent);
                    break;
                    
                case 'RELEASE':
                    await this.handleRelease(msg, intent);
                    break;
                    
                case 'RELEASE_MULTIPLE':
                    await this.handleMultipleReleases(msg, intent);
                    break;
                    
                case 'STATUS':
                    await this.handleStatusRequest(msg);
                    break;
                    
                case 'MY_RESERVATIONS':
                    await this.handleMyReservations(msg);
                    break;
                    
                case 'HELP':
                    await this.handleHelp(msg);
                    break;
                    
                default:
                    await this.handleUnknownCommand(msg);
            }
            
        } catch (error) {
            console.error('❌ Error handling message:', error);
            await this.bot.sendMessage(chatId, '❌ Error interno. Intenta de nuevo.');
        }
    }
    
    async handleSupervisorCommand(msg) {
        const chatId = msg.chat.id;
        const text = msg.text.trim();
        
        if (text.startsWith('/setparking')) {
            const numbers = text.replace('/setparking', '').trim().split(',').map(n => n.trim());
            await this.parkingManager.setParkingSpots(numbers);
            await this.bot.sendMessage(chatId, `✅ Estacionamientos configurados: ${numbers.join(', ')}`);
        }
        else if (text === '/stats') {
            const stats = await this.parkingManager.getSystemStats();
            await this.bot.sendMessage(chatId, 
                `📊 Estadísticas:\n` +
                `• Espacios totales: ${stats.totalSpots}\n` +
                `• Reservas activas: ${stats.totalReservations}\n` +
                `• En lista de espera: ${stats.totalWaitlist}`
            );
        }
        else if (text === '/clear') {
            await this.parkingManager.clearAllReservations();
            await this.bot.sendMessage(chatId, '🗑️ Todas las reservas han sido eliminadas');
        }
    }
    
    async handleReservation(msg, intent) {
        const result = await this.queueManager.handleReservation(msg.from.id, msg.from, intent.date);
        
        if (result.success) {
            await this.bot.sendMessage(msg.chat.id, 
                `✅ Estacionamiento ${result.spotNumber} reservado para ${intent.date.format('dddd DD/MM')}`);
        } else if (result.waitlist) {
            await this.bot.sendMessage(msg.chat.id, 
                `🚫 No hay espacios disponibles para ${intent.date.format('dddd DD/MM')}. ¿Te añado a la lista de espera?`, {
                reply_markup: {
                    inline_keyboard: [[
                        { text: 'Sí, añádeme', callback_data: `waitlist_yes_${msg.from.id}_${intent.date.format('YYYY-MM-DD')}` },
                        { text: 'No, gracias', callback_data: 'waitlist_no' }
                    ]]
                }
            });
        } else {
            await this.bot.sendMessage(msg.chat.id, `❌ ${result.message}`);
        }
    }
    
    async handleMultipleReservations(msg, intent) {
        const results = await this.parkingManager.reserveMultipleDays(msg.from.id, msg.from, intent.dates);
        
        const successful = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);
        
        let responseText = '';
        
        if (successful.length > 0) {
            responseText += `✅ Reservas exitosas:\n`;
            successful.forEach(r => {
                responseText += `• ${r.date.format('dddd DD/MM')}: Estacionamiento ${r.spotNumber}\n`;
            });
        }
        
        if (failed.length > 0) {
            responseText += `\n❌ No se pudieron reservar:\n`;
            failed.forEach(r => {
                responseText += `• ${r.date.format('dddd DD/MM')}: ${r.message}\n`;
            });
        }
        
        await this.bot.sendMessage(msg.chat.id, responseText);
    }
    
    async handleRelease(msg, intent) {
        const result = await this.parkingManager.releaseSpot(msg.from.id, intent.date);
        
        if (result.success) {
            await this.bot.sendMessage(msg.chat.id, 
                `✅ Liberado estacionamiento ${result.spotNumber} para ${intent.date.format('dddd DD/MM')}`);
            
            // Notify waitlist
            await this.queueManager.notifyWaitlist(intent.date, result.spotNumber);
        } else {
            await this.bot.sendMessage(msg.chat.id, `❌ ${result.message}`);
        }
    }
    
    async handleMultipleReleases(msg, intent) {
        const results = await Promise.all(
            intent.dates.map(date => this.parkingManager.releaseSpot(msg.from.id, date))
        );
        
        const successful = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);
        
        let responseText = '';
        
        if (successful.length > 0) {
            responseText += `✅ Liberaciones exitosas:\n`;
            successful.forEach(r => {
                responseText += `• Estacionamiento ${r.spotNumber}\n`;
            });
        }
        
        if (failed.length > 0) {
            responseText += `\n❌ No se pudieron liberar:\n`;
            failed.forEach(r => {
                responseText += `• ${r.message}\n`;
            });
        }
        
        await this.bot.sendMessage(msg.chat.id, responseText);
    }
    
    async handleStatusRequest(msg) {
        const status = await this.parkingManager.getWeekStatus();
        const responseText = this.parkingManager.formatWeekStatus(status);
        await this.bot.sendMessage(msg.chat.id, responseText);
    }
    
    async handleMyReservations(msg) {
        const reservations = await this.parkingManager.getUserReservations(msg.from.id);
        
        if (reservations.length === 0) {
            await this.bot.sendMessage(msg.chat.id, '📝 No tienes reservas activas');
            return;
        }
        
        let responseText = '📝 Tus reservas:\n\n';
        reservations.forEach(reservation => {
            const date = moment(reservation.date);
            responseText += `• ${date.format('dddd DD/MM')}: Estacionamiento ${reservation.spot_number}\n`;
        });
        
        await this.bot.sendMessage(msg.chat.id, responseText);
    }
    
    async handleHelp(msg) {
        const helpText = `
🚗 *WTC Parking Bot - Ayuda*

*Comandos disponibles:*

📅 *Reservar:*
• "voy el lunes" - Reservar un día
• "reservo lunes y miércoles" - Múltiples días
• "voy toda la semana" - Lunes a viernes

🔓 *Liberar:*
• "libero el martes" - Liberar un día
• "no voy el jueves" - Liberar un día

📊 *Consultar:*
• "estado" - Ver disponibilidad semanal
• "mis reservas" - Ver tus reservas

⏰ *Fechas:*
• "mañana", "hoy"
• Días: lunes, martes, miércoles, jueves, viernes
• "la próxima semana voy el..."

🎯 *Lista de espera:*
Si no hay espacios, te ofreceremos lista de espera automáticamente.
        `;
        
        await this.bot.sendMessage(msg.chat.id, helpText, { parse_mode: 'Markdown' });
    }
    
    async handleUnknownCommand(msg) {
        await this.bot.sendMessage(msg.chat.id, 
            '🤔 No entiendo ese comando. Escribe "ayuda" para ver los comandos disponibles.');
    }
    
    async handleCallbackQuery(query) {
        const data = query.data;
        
        if (data.startsWith('waitlist_yes_')) {
            const parts = data.split('_');
            const userId = parseInt(parts[2]);
            const dateStr = parts[3];
            const date = moment(dateStr);
            
            await this.parkingManager.addToWaitlist(userId, query.from, date);
            
            await this.bot.editMessageText(
                `📝 Añadido a lista de espera para ${date.format('dddd DD/MM')}. Te notificaré si se libera un espacio.`, {
                chat_id: query.message.chat.id,
                message_id: query.message.message_id
            });
        }
        else if (data === 'waitlist_no') {
            await this.bot.editMessageText('👍 Entendido. ¡Que tengas buen día!', {
                chat_id: query.message.chat.id,
                message_id: query.message.message_id
            });
        }
        
        await this.bot.answerCallbackQuery(query.id);
    }
    
    setupGracefulShutdown() {
        const shutdown = async (signal) => {
            console.log(`🛑 ${signal} received. Shutting down gracefully...`);
            
            try {
                // Stop server
                if (this.server) {
                    this.server.close();
                    console.log('✅ HTTP server stopped');
                }
                
                // Close database
                if (this.db) {
                    this.db.close();
                    console.log('✅ Database closed');
                }
                
            } catch (error) {
                console.error('❌ Error during shutdown:', error);
            }
            
            console.log('👋 Shutdown complete');
            process.exit(0);
        };
        
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));
    }
}

// Start the bot
new WTCParkBotWebhook();