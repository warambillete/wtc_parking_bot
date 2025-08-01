const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const moment = require('moment-timezone');
const Database = require('./database');
const MessageProcessor = require('./messageProcessor');
const ParkingManager = require('./parkingManager');
const QueueManager = require('./queueManager');

moment.locale('es');
moment.tz.setDefault('America/Montevideo');

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
        this.queueManager = new QueueManager(this.db, this.bot, this.parkingManager);
        
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
        
        // Setup automatic cleanup scheduler
        this.setupAutomaticCleanup();
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
            
            // Handle supervisor commands (use original text for commands)
            if (userId.toString() === this.supervisorId && msg.text.trim().startsWith('/')) {
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
                    
                case 'FIXED_LIST':
                    await this.handleFixedList(msg);
                    break;
                    
                case 'FIXED_RELEASE':
                    await this.handleFixedRelease(msg, intent);
                    break;
                    
                case 'FIXED_REMOVAL':
                    await this.handleFixedRemoval(msg, intent);
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
        else if (text === '/version') {
            const packageInfo = require('../package.json');
            const now = moment().tz('America/Montevideo');
            const uptime = process.uptime();
            const hours = Math.floor(uptime / 3600);
            const minutes = Math.floor((uptime % 3600) / 60);
            
            await this.bot.sendMessage(chatId, 
                `🔧 *WTC Parking Bot*\n\n` +
                `📌 Versión: ${packageInfo.version}\n` +
                `🚀 Modo: Webhook\n` +
                `⏰ Hora actual: ${now.format('DD/MM/YYYY HH:mm:ss')}\n` +
                `⏱️ Uptime: ${hours}h ${minutes}m\n` +
                `🌐 Node: ${process.version}\n` +
                `💾 DB: ${this.db.dbPath}\n` +
                `🏷️ Ambiente: ${process.env.NODE_ENV || 'production'}`,
                { parse_mode: 'Markdown' }
            );
        }
        else if (text === '/clear') {
            await this.parkingManager.clearAllReservations();
            await this.bot.sendMessage(chatId, '🗑️ Todas las reservas han sido eliminadas');
        }
        else if (text.startsWith('/setfixed')) {
            // Format: /setfixed 222,4122,4424
            const fixedStr = text.replace('/setfixed', '').trim();
            if (!fixedStr) {
                await this.bot.sendMessage(chatId, 
                    '❌ Formato: /setfixed 222,4122,4424');
                return;
            }
            
            const spotNumbers = fixedStr.split(',').map(n => n.trim()).filter(n => n.length > 0);
            console.log('🔧 Setting fixed spots:', spotNumbers);
            
            if (spotNumbers.length > 0) {
                try {
                    await this.db.setFixedSpotNumbers(spotNumbers);
                    console.log('✅ Fixed spots saved successfully');
                    
                    // Verify they were saved
                    const savedSpots = await this.db.getFixedSpots();
                    console.log('🔍 Verification - spots in DB:', JSON.stringify(savedSpots));
                    
                    await this.bot.sendMessage(chatId, 
                        `✅ Espacios fijos configurados:\n${spotNumbers.map(s => `• ${s}`).join('\n')}`);
                } catch (error) {
                    console.error('❌ Error saving fixed spots:', error);
                    await this.bot.sendMessage(chatId, '❌ Error guardando espacios fijos');
                }
            } else {
                await this.bot.sendMessage(chatId, '❌ No se pudo procesar ningún espacio fijo');
            }
        }
        else if (text === '/nextreset') {
            const now = moment().tz('America/Montevideo');
            let nextFriday = now.clone();
            
            if (now.day() === 5 && now.hour() < 17) {
                nextFriday = now.clone().hour(17).minute(0).second(0);
            } else {
                nextFriday = now.clone().day(5 + 7).hour(17).minute(0).second(0);
            }
            
            const timeUntilReset = nextFriday.diff(now);
            const duration = moment.duration(timeUntilReset);
            const days = Math.floor(duration.asDays());
            const hours = duration.hours();
            const minutes = duration.minutes();
            
            await this.bot.sendMessage(chatId, 
                `⏰ *Próximo Reset Automático:*\n\n` +
                `📅 Fecha: ${nextFriday.format('dddd DD/MM/YYYY HH:mm')}\n` +
                `⏳ Tiempo restante: ${days}d ${hours}h ${minutes}m\n\n` +
                `🤖 Estado: ${this.fridayResetTimeout ? 'Programado ✅' : 'No programado ❌'}\n` +
                `🌍 Zona horaria: America/Montevideo\n` +
                `🕐 Hora actual: ${now.format('dddd DD/MM/YYYY HH:mm')}`,
                { parse_mode: 'Markdown' }
            );
        }
        else if (text === '/testreset') {
            try {
                console.log('🧪 Test reset ejecutado manualmente por supervisor');
                const result = await this.db.resetCurrentWeekReservations();
                
                await this.bot.sendMessage(chatId, 
                    `🧪 *Test Reset Ejecutado*\n\n` +
                    `✅ Reservas eliminadas: ${result.reservationsCleared}\n` +
                    `✅ Lista de espera eliminada: ${result.waitlistCleared}\n\n` +
                    `⚠️ Esto fue una prueba manual. El reset automático sigue programado.`,
                    { parse_mode: 'Markdown' }
                );
            } catch (error) {
                console.error('Error en test reset:', error);
                await this.bot.sendMessage(chatId, '❌ Error ejecutando test reset: ' + error.message);
            }
        }
        else if (text === '/helpsuper') {
            const helpText = `🔧 *Comandos de Administrador:*

📋 *Configuración:*
• \`/setparking 1,2,3\` - Configurar espacios flex
• \`/setfixed 222,4122,4424\` - Configurar espacios fijos

📊 *Información:*
• \`/stats\` - Ver estadísticas del sistema
• \`/version\` - Ver versión y estado del bot
• \`/nextreset\` - Ver próximo reset automático

🗑️ *Gestión:*
• \`/clear\` - Limpiar todas las reservas
• \`/testreset\` - Ejecutar reset manualmente (test)

ℹ️ *Formato espacios fijos:*
\`/setfixed NUMERO1,NUMERO2,NUMERO3\`
Ejemplo: \`/setfixed 222,4122,4424\`

💡 *Uso:*
Los usuarios pueden liberar espacios fijos diciendo "libero el 222 para martes"
            `;
            await this.bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
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
        const results = [];
        
        // Process each date individually through QueueManager to respect lottery system
        for (const date of intent.dates) {
            try {
                const result = await this.queueManager.handleReservation(msg.from.id, msg.from, date);
                results.push({
                    date: date,
                    success: result.success,
                    spotNumber: result.spotNumber,
                    message: result.message,
                    queued: result.queued,
                    waitlist: result.waitlist
                });
            } catch (error) {
                console.error(`Error processing reservation for ${date.format('YYYY-MM-DD')}:`, error);
                results.push({
                    date: date,
                    success: false,
                    message: 'Error interno procesando la reserva'
                });
            }
        }
        
        const successful = results.filter(r => r.success);
        const queued = results.filter(r => r.queued);
        const waitlisted = results.filter(r => r.waitlist);
        const failed = results.filter(r => !r.success && !r.queued && !r.waitlist);
        
        let responseText = '';
        
        if (successful.length > 0) {
            responseText += `✅ Reservas exitosas:\n`;
            successful.forEach(r => {
                responseText += `• ${r.date.format('dddd DD/MM')}: Estacionamiento ${r.spotNumber}\n`;
            });
        }
        
        if (queued.length > 0) {
            responseText += `\n🎲 En cola de lotería:\n`;
            queued.forEach(r => {
                responseText += `• ${r.date.format('dddd DD/MM')}: En cola para sorteo del viernes 17:15\n`;
            });
        }
        
        if (waitlisted.length > 0) {
            responseText += `\n📝 Ofrecidas para lista de espera:\n`;
            waitlisted.forEach(r => {
                responseText += `• ${r.date.format('dddd DD/MM')}: Sin espacios disponibles\n`;
            });
        }
        
        if (failed.length > 0) {
            responseText += `\n❌ No se pudieron reservar:\n`;
            failed.forEach(r => {
                responseText += `• ${r.date.format('dddd DD/MM')}: ${r.message}\n`;
            });
        }
        
        await this.bot.sendMessage(msg.chat.id, responseText);
        
        // Handle waitlist offers for dates that need it
        const waitlistOffers = results.filter(r => r.waitlist);
        if (waitlistOffers.length > 0) {
            for (const offer of waitlistOffers) {
                await this.bot.sendMessage(msg.chat.id, 
                    `🚫 No hay espacios disponibles para ${offer.date.format('dddd DD/MM')}. ¿Te añado a la lista de espera?`, {
                    reply_markup: {
                        inline_keyboard: [[
                            { text: 'Sí, añádeme', callback_data: `waitlist_yes_${msg.from.id}_${offer.date.format('YYYY-MM-DD')}` },
                            { text: 'No, gracias', callback_data: 'waitlist_no' }
                        ]]
                    }
                });
            }
        }
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
        const results = [];
        
        // Process each release individually to properly handle waitlist notifications
        for (let i = 0; i < intent.dates.length; i++) {
            try {
                const result = await this.parkingManager.releaseSpot(msg.from.id, intent.dates[i]);
                results.push({
                    date: intent.dates[i],
                    success: result.success,
                    spotNumber: result.spotNumber,
                    message: result.message
                });
                
                // Notify waitlist for successful releases
                if (result.success) {
                    await this.queueManager.notifyWaitlist(intent.dates[i], result.spotNumber);
                }
            } catch (error) {
                console.error(`Error releasing spot for ${intent.dates[i].format('YYYY-MM-DD')}:`, error);
                results.push({
                    date: intent.dates[i],
                    success: false,
                    message: 'Error interno liberando la reserva'
                });
            }
        }
        
        const successful = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);
        
        let responseText = '';
        
        if (successful.length > 0) {
            responseText += `✅ Liberaciones exitosas:\n`;
            successful.forEach(r => {
                responseText += `• ${r.date.format('dddd DD/MM')}: Estacionamiento ${r.spotNumber}\n`;
            });
        }
        
        if (failed.length > 0) {
            responseText += `\n❌ No se pudieron liberar:\n`;
            failed.forEach(r => {
                responseText += `• ${r.date.format('dddd DD/MM')}: ${r.message}\n`;
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
        const helpText = `🚗 *WTC Parking Bot*

📅 *Reservar:*
• "voy el lunes" - Un día
• "voy lunes y miércoles" - Múltiples días

🔓 *Liberar:*
• "libero el martes" / "no voy el jueves"

🔐 *Espacios Fijos:*
• "libero el 8033 para martes"
• "libero el 8033 toda la semana"
• "libero el 8033 por 2 semanas"
• "quitar el 8033" - Remover del pool

📊 *Consultar:*
• "estado" - Ver disponibilidad
• "mis reservas" - Ver tus reservas
• "ver fijos" - Ver espacios fijos

⏰ Días: lunes-viernes, "mañana", "hoy"
🎯 Lista de espera automática si no hay espacios
        `;
        
        await this.bot.sendMessage(msg.chat.id, helpText, { parse_mode: 'Markdown' });
    }
    
    async handleFixedList(msg) {
        try {
            console.log('🔍 Getting fixed spots from database...');
            const fixedSpots = await this.db.getFixedSpots();
            console.log('🔍 Fixed spots retrieved:', JSON.stringify(fixedSpots));
            
            if (fixedSpots.length === 0) {
                await this.bot.sendMessage(msg.chat.id, '📋 No hay espacios fijos configurados.');
                return;
            }
            
            const spotNumbers = fixedSpots.map(spot => spot.spot_number).join(', ');
            await this.bot.sendMessage(msg.chat.id, 
                `🔐 *Espacios Fijos:*\n\n${spotNumbers}\n\n💡 Puedes liberar cualquiera de estos diciendo "libero el XXXX para martes"`, 
                { parse_mode: 'Markdown' }
            );
            
        } catch (error) {
            console.error('Error getting fixed spots list:', error);
            await this.bot.sendMessage(msg.chat.id, '❌ Error al obtener la lista de espacios fijos.');
        }
    }
    
    async handleUnknownCommand(msg) {
        await this.bot.sendMessage(msg.chat.id, 
            '🤔 No entiendo ese comando. Escribe "ayuda" para ver los comandos disponibles.');
    }
    
    async handleFixedRelease(msg, intent) {
        const chatId = msg.chat.id;
        
        try {
            // Check if the spot number is in the fixed spots list
            const isFixed = await this.db.isFixedSpot(intent.spotNumber);
            
            if (!isFixed) {
                await this.bot.sendMessage(chatId, 
                    `❌ El espacio ${intent.spotNumber} no es un espacio fijo.`);
                return;
            }
            
            // Release the spot for the specified period
            const startDateStr = intent.startDate.format('YYYY-MM-DD');
            const endDateStr = intent.endDate.format('YYYY-MM-DD');
            
            await this.db.releaseFixedSpot(intent.spotNumber, startDateStr, endDateStr);
            
            await this.bot.sendMessage(chatId, 
                `✅ Espacio ${intent.spotNumber} liberado desde ${intent.startDate.format('dddd DD/MM')} hasta ${intent.endDate.format('dddd DD/MM')}`);
            
        } catch (error) {
            console.error('Error releasing fixed spot:', error);
            await this.bot.sendMessage(chatId, '❌ Error al liberar el espacio fijo.');
        }
    }
    
    async handleFixedRemoval(msg, intent) {
        const chatId = msg.chat.id;
        
        try {
            // Check if the spot number is in the fixed spots list
            const isFixed = await this.db.isFixedSpot(intent.spotNumber);
            
            if (!isFixed) {
                await this.bot.sendMessage(chatId, 
                    `❌ El espacio ${intent.spotNumber} no es un espacio fijo.`);
                return;
            }
            
            // Remove the spot from the pool
            const removed = await this.db.removeFixedSpotRelease(intent.spotNumber);
            
            if (removed > 0) {
                await this.bot.sendMessage(chatId, 
                    `✅ Espacio ${intent.spotNumber} removido del pool de reservas.`);
            } else {
                await this.bot.sendMessage(chatId, 
                    `⚠️ El espacio ${intent.spotNumber} no estaba liberado.`);
            }
            
        } catch (error) {
            console.error('Error removing fixed spot from pool:', error);
            await this.bot.sendMessage(chatId, '❌ Error al remover el espacio fijo del pool.');
        }
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
    
    setupAutomaticCleanup() {
        const scheduleNextFridayReset = () => {
            const now = moment().tz('America/Montevideo');
            
            // Calculate next Friday at 17:00
            let nextFriday = now.clone();
            
            // If today is Friday and we haven't passed 17:00 yet
            if (now.day() === 5 && now.hour() < 17) {
                nextFriday = now.clone().hour(17).minute(0).second(0);
            } else {
                // Go to next Friday
                nextFriday = now.clone().day(5 + 7).hour(17).minute(0).second(0); // Next Friday
            }
            
            const timeUntilReset = nextFriday.diff(now);
            
            console.log(`🔄 Next Friday 5PM reset scheduled for: ${nextFriday.format('dddd DD/MM/YYYY HH:mm')}`);
            
            this.fridayResetTimeout = setTimeout(async () => {
                try {
                    console.log('🔄 Running Friday 5PM reset...');
                    const result = await this.db.resetCurrentWeekReservations();
                    
                    // Send notification to supervisor if configured
                    if (this.supervisorId) {
                        try {
                            await this.bot.sendMessage(this.supervisorId, 
                                `🔄 Reset automático de viernes 17:00 completado: ${result.reservationsCleared} reservas y ${result.waitlistCleared} listas de espera eliminadas.`);
                        } catch (error) {
                            console.error('Error sending Friday reset notification to supervisor:', error);
                        }
                    }
                } catch (error) {
                    console.error('❌ Error during Friday reset:', error);
                }
                
                // Schedule next Friday reset
                scheduleNextFridayReset();
            }, timeUntilReset);
        };
        
        // Only start Friday reset scheduler - no daily cleanup
        scheduleNextFridayReset();
    }
    
    setupGracefulShutdown() {
        const shutdown = async (signal) => {
            console.log(`🛑 ${signal} received. Shutting down gracefully...`);
            
            try {
                // Clear Friday reset timeout
                if (this.fridayResetTimeout) {
                    clearTimeout(this.fridayResetTimeout);
                    console.log('✅ Friday reset scheduler stopped');
                }
                
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