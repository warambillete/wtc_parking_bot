const TelegramBot = require('node-telegram-bot-api');
const moment = require('moment-timezone');
const Database = require('./database');
const MessageProcessor = require('./messageProcessor');
const ParkingManager = require('./parkingManager');
const QueueManager = require('./queueManager');

moment.locale('es');
moment.tz.setDefault('America/Mexico_City');

class WTCParkBot {
    constructor() {
        this.token = process.env.TELEGRAM_BOT_TOKEN;
        this.supervisorId = process.env.SUPERVISOR_USER_ID;
        
        if (!this.token) {
            throw new Error('TELEGRAM_BOT_TOKEN no está configurado');
        }
        
        // Usar webhook solo si está explícitamente configurado
        const useWebhook = process.env.WEBHOOK_URL && process.env.WEBHOOK_URL !== '';
        
        if (useWebhook) {
            this.bot = new TelegramBot(this.token);
            const webhookUrl = process.env.WEBHOOK_URL;
            this.bot.setWebHook(`${webhookUrl}/bot${this.token}`);
            
            // Configurar express para recibir webhooks
            const express = require('express');
            const app = express();
            app.use(express.json());
            
            app.post(`/bot${this.token}`, (req, res) => {
                this.bot.processUpdate(req.body);
                res.sendStatus(200);
            });
            
            const port = process.env.PORT || 3000;
            app.listen(port, () => {
                console.log(`🌐 Webhook servidor corriendo en puerto ${port}`);
            });
        } else {
            console.log('🤖 Bot iniciando en modo POLLING (sin webhook)');
            this.bot = new TelegramBot(this.token, { polling: true });
            
            // Crear servidor HTTP para health checks de Render
            const express = require('express');
            const app = express();
            
            app.get('/', (req, res) => {
                res.send('WTC Parking Bot is running!');
            });
            
            app.get('/health', (req, res) => {
                res.json({ status: 'ok', timestamp: new Date().toISOString() });
            });
            
            const port = process.env.PORT || 3000;
            app.listen(port, () => {
                console.log(`🌐 Health check server running on port ${port}`);
            });
        }
        this.db = new Database();
        this.messageProcessor = new MessageProcessor();
        this.parkingManager = new ParkingManager(this.db);
        this.queueManager = new QueueManager(this.db, this.bot);
        
        this.setupHandlers();
        this.setupScheduler();
        console.log('🚗 WTC ParkBot iniciado correctamente');
    }
    
    setupHandlers() {
        this.bot.on('message', (msg) => this.handleMessage(msg));
        this.bot.on('polling_error', (error) => {
            console.error('Error de polling:', error);
        });
    }
    
    setupScheduler() {
        // Verificar cada hora si es viernes a las 17:00 GMT-3
        setInterval(() => {
            this.checkWeeklyReset();
        }, 60 * 60 * 1000); // Cada hora
        
        console.log('📅 Scheduler configurado - Reset automático viernes 17:00 GMT-3');
    }
    
    async checkWeeklyReset() {
        const now = moment().tz('America/Argentina/Buenos_Aires');
        
        // Verificar si es viernes y son las 17:00
        if (now.day() === 5 && now.hour() === 17 && now.minute() === 0) {
            console.log('🔄 Ejecutando reset semanal...');
            await this.parkingManager.clearAllReservations();
            
            // Opcional: notificar en un canal específico
            if (this.supervisorId) {
                this.bot.sendMessage(this.supervisorId, 
                    '🔄 Reset semanal ejecutado automáticamente.\n' +
                    '🗑️ Todas las reservas y listas de espera han sido eliminadas.');
            }
        }
    }
    
    async handleMessage(msg) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const text = msg.text?.toLowerCase().trim();
        
        if (!text) return;
        
        console.log(`Mensaje de ${msg.from.first_name}: ${text}`);
        
        try {
            // Comandos generales
            if (text === '/start' || text === '/help' || text === '/ayuda') {
                await this.handleHelp(chatId, userId);
                return;
            }
            
            // Comandos de supervisor
            if (userId.toString() === this.supervisorId) {
                if (text.startsWith('/setparking')) {
                    await this.handleSetParking(chatId, text);
                    return;
                } else if (text === '/clearall') {
                    await this.handleClearAll(chatId);
                    return;
                } else if (text === '/status') {
                    await this.handleAdminStatus(chatId);
                    return;
                } else if (text === '/debug') {
                    await this.handleDebug(chatId);
                    return;
                } else if (text === '/queues') {
                    await this.handleQueuesStatus(chatId);
                    return;
                } else if (text === '/clearqueues') {
                    await this.handleClearQueues(chatId);
                    return;
                }
            }
            
            // Procesar mensaje normal
            const intent = this.messageProcessor.processMessage(text);
            
            if (intent.type === 'RESERVE') {
                await this.handleReservation(chatId, userId, msg.from, intent);
            } else if (intent.type === 'RESERVE_MULTIPLE') {
                await this.handleMultipleReservations(chatId, userId, msg.from, intent);
            } else if (intent.type === 'RELEASE') {
                await this.handleRelease(chatId, userId, msg.from, intent);
            } else if (intent.type === 'RELEASE_MULTIPLE') {
                await this.handleMultipleReleases(chatId, userId, msg.from, intent);
            } else if (intent.type === 'STATUS') {
                await this.handleStatus(chatId);
            } else if (intent.type === 'MY_RESERVATIONS') {
                await this.handleMyReservations(chatId, userId);
            } else if (intent.type === 'HELP') {
                await this.handleHelp(chatId, userId);
            }
            
        } catch (error) {
            console.error('Error procesando mensaje:', error);
            this.bot.sendMessage(chatId, '❌ Ocurrió un error procesando tu mensaje');
        }
    }
    
    async handleReservation(chatId, userId, user, intent) {
        const now = moment().tz('America/Argentina/Buenos_Aires');
        const targetDate = intent.date;
        
        // Validar reglas de tiempo
        if (!this.isValidReservationTime(now, targetDate)) {
            this.bot.sendMessage(chatId, 
                '⏰ Solo puedes reservar para esta semana, o para la próxima semana los viernes después de las 5 PM');
            return;
        }
        
        // Check if should use queue system (Friday 17:00-17:15 for next week reservations)
        if (this.queueManager.isInQueuePeriod() && this.queueManager.isNextWeekReservation(targetDate)) {
            console.log(`🎲 Usando sistema de cola para ${user.first_name || user.username}`);
            const queueResult = await this.queueManager.addToQueue(userId, user, targetDate, chatId);
            this.bot.sendMessage(chatId, queueResult.message);
            return;
        }

        // Normal reservation processing
        const result = await this.parkingManager.reserveSpot(userId, user, targetDate);
        
        if (result.success) {
            this.bot.sendMessage(chatId, 
                `✅ Estacionamiento ${result.spotNumber} reservado para ${targetDate.format('dddd DD/MM')}`);
        } else if (result.waitlist) {
            this.bot.sendMessage(chatId, 
                `🚫 No hay espacios disponibles para ${targetDate.format('dddd DD/MM')}. ¿Lo pongo en lista de espera?`,
                {
                    reply_markup: {
                        inline_keyboard: [[
                            { text: 'Sí, lista de espera', callback_data: `waitlist_yes_${userId}_${targetDate.format('YYYY-MM-DD')}` },
                            { text: 'No, gracias', callback_data: 'waitlist_no' }
                        ]]
                    }
                });
        } else {
            this.bot.sendMessage(chatId, '❌ ' + result.message);
        }
    }
    
    async handleRelease(chatId, userId, user, intent) {
        const result = await this.parkingManager.releaseSpot(userId, intent.date);
        
        if (result.success) {
            this.bot.sendMessage(chatId, 
                `✅ Estacionamiento ${result.spotNumber} liberado para ${intent.date.format('dddd DD/MM')}`);
            
            // Notificar a lista de espera
            await this.notifyWaitlist(chatId, intent.date, result.spotNumber);
        } else {
            this.bot.sendMessage(chatId, '❌ ' + result.message);
        }
    }
    
    async notifyWaitlist(chatId, date, spotNumber) {
        const waitlistUser = await this.parkingManager.getNextInWaitlist(date);
        
        if (waitlistUser) {
            this.bot.sendMessage(chatId, 
                `🎉 @${waitlistUser.username || waitlistUser.first_name}, se liberó el estacionamiento ${spotNumber} para ${date.format('dddd DD/MM')}. ¿Lo quieres?`,
                {
                    reply_markup: {
                        inline_keyboard: [[
                            { text: 'Sí, lo tomo', callback_data: `take_spot_${waitlistUser.user_id}_${date.format('YYYY-MM-DD')}_${spotNumber}` },
                            { text: 'No, gracias', callback_data: `decline_spot_${waitlistUser.user_id}_${date.format('YYYY-MM-DD')}` }
                        ]]
                    }
                });
        }
    }
    
    async handleStatus(chatId) {
        const week = await this.parkingManager.getWeekStatus();
        this.bot.sendMessage(chatId, this.formatWeekStatus(week));
    }
    
    async handleSetParking(chatId, text) {
        // /setparking 1,2,3,4,5,6,7,8,9,10
        const numbers = text.replace('/setparking', '').trim().split(',').map(n => n.trim());
        await this.parkingManager.setParkingSpots(numbers);
        this.bot.sendMessage(chatId, `✅ Lista de estacionamientos actualizada: ${numbers.join(', ')}\n🗑️ Todas las reservas anteriores han sido eliminadas.`);
    }
    
    async handleClearAll(chatId) {
        await this.parkingManager.clearAllReservations();
        this.bot.sendMessage(chatId, '🗑️ Todas las reservas y listas de espera han sido eliminadas.');
    }
    
    async handleAdminStatus(chatId) {
        const stats = await this.parkingManager.getSystemStats();
        const message = `📊 **Estado del Sistema:**

🚗 **Estacionamientos:** ${stats.totalSpots}
📅 **Reservas activas:** ${stats.totalReservations}
⏳ **En lista de espera:** ${stats.totalWaitlist}

**Próximo reset:** Viernes 17:00 GMT-3`;
        
        this.bot.sendMessage(chatId, message);
    }
    
    async handleDebug(chatId) {
        const now = moment().tz('America/Argentina/Buenos_Aires');
        const startOfCurrentWeek = now.clone().startOf('week').add(1, 'day');
        const endOfCurrentWeek = now.clone().endOf('week').subtract(1, 'day');
        
        const message = `🔍 **Debug Info:**
        
**Fecha/Hora actual (GMT-3):** ${now.format('dddd DD/MM/YYYY HH:mm')}
**Día de la semana:** ${now.day()} (0=domingo, 1=lunes...)
**Semana actual:**
- Inicio: ${startOfCurrentWeek.format('dddd DD/MM')}
- Fin: ${endOfCurrentWeek.format('dddd DD/MM')}

**Ejemplo - Si digo "voy el martes":**
- Martes esta semana: ${now.clone().day(2).format('dddd DD/MM')}
- ¿Es válido?: ${this.isValidReservationTime(now, now.clone().day(2))}`;
        
        this.bot.sendMessage(chatId, message);
    }
    
    async handleQueuesStatus(chatId) {
        const queues = this.queueManager.getAllQueues();
        const now = moment().tz('America/Argentina/Buenos_Aires');
        
        let message = `🎲 **Estado de Colas de Lotería:**\n\n`;
        message += `**Fecha/Hora actual:** ${now.format('dddd DD/MM HH:mm')}\n`;
        message += `**Período de cola activo:** ${this.queueManager.isInQueuePeriod() ? '✅ SÍ' : '❌ NO'}\n\n`;
        
        if (Object.keys(queues).length === 0) {
            message += `📭 No hay colas activas.\n\n`;
        } else {
            message += `**Colas activas:**\n`;
            for (const [dateStr, queueInfo] of Object.entries(queues)) {
                const date = moment(dateStr).format('dddd DD/MM');
                message += `\n**${date}:**\n`;
                message += `👥 Usuarios en cola: ${queueInfo.total}\n`;
                message += `📋 Usuarios:\n`;
                queueInfo.users.forEach((user, index) => {
                    const timestamp = moment(user.timestamp).format('HH:mm:ss');
                    message += `   ${index + 1}. ${user.name} (${timestamp})\n`;
                });
            }
        }
        
        message += `\n**Comandos:**\n`;
        message += `• /clearqueues - Limpiar todas las colas\n`;
        message += `• /queues - Ver este estado`;
        
        this.bot.sendMessage(chatId, message);
    }
    
    async handleClearQueues(chatId) {
        this.queueManager.clearAllQueues();
        this.bot.sendMessage(chatId, '🧹 Todas las colas de lotería han sido limpiadas.');
    }
    
    async handleHelp(chatId, userId) {
        const message = `🚗 **WTC ParkBot - Ayuda**

**📝 Cómo reservar:**
• "voy el martes"
• "reservar el lunes"
• "reservo martes y miércoles"
• "necesito estacionamiento mañana"
• "voy toda la semana"
• "reservo lunes, martes y miércoles"
• "la próxima semana reservo el viernes"

**🗑️ Cómo liberar:**
• "libero el miércoles"
• "mañana queda libre"
• "no voy el viernes"
• "libero el lunes y martes"
• "libero el martes que es feriado"

**📊 Ver estado:**
• "estado" - Ver disponibilidad semanal
• "disponibles" - Ver espacios libres
• "mis reservas" - Ver mis reservas

**⏰ Reglas:**
• Semana actual: reserva cuando quieras
• Próxima semana: solo viernes después de 17:00
• Solo días laborables (lunes a viernes)
• Reset automático: viernes 17:00 GMT-3

**🎲 Sistema de Lotería (Viernes 17:00-17:15):**
• Durante estos 15 minutos, las reservas para la próxima semana entran en una cola
• A las 17:15 se asignan los espacios de forma aleatoria
• ¡Todos tienen la misma oportunidad independientemente de la hora exacta!
• Elimina ventajas por mensajes programados o velocidad de conexión

💡 **Tip:** Escribe de forma natural, el bot entiende tu intención.`;

        this.bot.sendMessage(chatId, message);
    }
    
    async handleMyReservations(chatId, userId) {
        const reservations = await this.parkingManager.getUserReservations(userId);
        
        if (reservations.length === 0) {
            this.bot.sendMessage(chatId, '📋 No tienes reservas activas.');
            return;
        }
        
        let message = '📋 **Mis reservas:**\n\n';
        reservations.forEach(res => {
            const date = moment(res.date).format('dddd DD/MM');
            message += `🚗 **${date}** - Estacionamiento ${res.spot_number}\n`;
        });
        
        this.bot.sendMessage(chatId, message);
    }
    
    async handleMultipleReservations(chatId, userId, user, intent) {
        const now = moment().tz('America/Argentina/Buenos_Aires');
        const results = [];
        
        for (const date of intent.dates) {
            if (!this.isValidReservationTime(now, date)) {
                results.push({
                    date: date.format('dddd DD/MM'),
                    success: false,
                    message: 'Fuera del horario permitido'
                });
                continue;
            }
            
            const result = await this.parkingManager.reserveSpot(userId, user, date);
            results.push({
                date: date.format('dddd DD/MM'),
                ...result
            });
        }
        
        const successful = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);
        
        let message = '';
        if (successful.length > 0) {
            message += `✅ **Reservas exitosas:**\n`;
            successful.forEach(r => {
                message += `• ${r.date} - Estacionamiento ${r.spotNumber}\n`;
            });
        }
        
        if (failed.length > 0) {
            message += `\n❌ **No se pudieron reservar:**\n`;
            failed.forEach(r => {
                message += `• ${r.date} - ${r.message}\n`;
            });
        }
        
        this.bot.sendMessage(chatId, message);
    }
    
    async handleMultipleReleases(chatId, userId, user, intent) {
        const results = [];
        
        for (const date of intent.dates) {
            const result = await this.parkingManager.releaseSpot(userId, date);
            results.push({
                date: date.format('dddd DD/MM'),
                ...result
            });
            
            // Notificar lista de espera si se liberó exitosamente
            if (result.success) {
                await this.notifyWaitlist(chatId, date, result.spotNumber);
            }
        }
        
        const successful = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);
        
        let message = '';
        if (successful.length > 0) {
            message += `✅ **Liberaciones exitosas:**\n`;
            successful.forEach(r => {
                message += `• ${r.date} - Estacionamiento ${r.spotNumber}\n`;
            });
        }
        
        if (failed.length > 0) {
            message += `\n❌ **No se pudieron liberar:**\n`;
            failed.forEach(r => {
                message += `• ${r.date} - ${r.message}\n`;
            });
        }
        
        this.bot.sendMessage(chatId, message);
    }
    
    isValidReservationTime(now, targetDate) {
        // Asegurar que targetDate esté en la misma zona horaria
        const targetDateLocal = targetDate.clone().tz('America/Argentina/Buenos_Aires');
        
        // Calcular semana laboral actual (próximo lunes si hoy es fin de semana)
        let startOfCurrentWeek;
        if (now.day() === 0) { // Si es domingo, la "semana actual" es la que empieza mañana
            startOfCurrentWeek = now.clone().add(1, 'day'); // Lunes
        } else if (now.day() === 6) { // Si es sábado, la "semana actual" es la que empieza en 2 días
            startOfCurrentWeek = now.clone().add(2, 'day'); // Lunes
        } else {
            startOfCurrentWeek = now.clone().day(1); // Lunes de esta semana
        }
        
        const endOfCurrentWeek = startOfCurrentWeek.clone().day(5); // Viernes
        const startOfNextWeek = startOfCurrentWeek.clone().add(1, 'week');
        const endOfNextWeek = endOfCurrentWeek.clone().add(1, 'week');
        
        console.log(`🔍 Debug validación:
        Ahora: ${now.format('dddd DD/MM/YYYY HH:mm')} (día ${now.day()})
        Target: ${targetDateLocal.format('dddd DD/MM/YYYY')} (día ${targetDateLocal.day()})
        Semana actual: ${startOfCurrentWeek.format('DD/MM')} - ${endOfCurrentWeek.format('DD/MM')}
        Próxima semana: ${startOfNextWeek.format('DD/MM')} - ${endOfNextWeek.format('DD/MM')}
        Target es entre semana actual: ${targetDateLocal.isBetween(startOfCurrentWeek, endOfCurrentWeek, 'day', '[]')}
        Target es entre próxima semana: ${targetDateLocal.isBetween(startOfNextWeek, endOfNextWeek, 'day', '[]')}`);
        
        // Solo permitir lunes a viernes
        if (targetDateLocal.day() === 0 || targetDateLocal.day() === 6) {
            console.log('❌ Es fin de semana');
            return false;
        }
        
        // Semana actual (lunes a viernes): siempre permitido
        if (targetDateLocal.isBetween(startOfCurrentWeek, endOfCurrentWeek, 'day', '[]')) {
            console.log('✅ Es semana actual');
            return true;
        }
        
        // Próxima semana: solo viernes después de 5 PM GMT-3
        if (targetDateLocal.isBetween(startOfNextWeek, endOfNextWeek, 'day', '[]')) {
            const isValidTime = now.day() === 5 && now.hour() >= 17;
            console.log(`🔍 Próxima semana - Es viernes después 17h: ${isValidTime}`);
            return isValidTime;
        }
        
        console.log('❌ Fuera de rango permitido');
        return false;
    }
    
    formatWeekStatus(week) {
        let status = '📅 **Estado de la semana:**\n\n';
        for (const [date, spots] of Object.entries(week)) {
            const dayName = moment(date).format('dddd DD/MM');
            status += `**${dayName}:**\n`;
            
            const available = spots.filter(s => !s.reserved).length;
            const total = spots.length;
            status += `🟢 Disponibles: ${available}/${total}\n`;
            
            if (available < total) {
                const reserved = spots.filter(s => s.reserved);
                status += '🔴 Reservados:\n';
                reserved.forEach(s => {
                    const userName = s.first_name || s.username || 'Usuario';
                    status += `   • ${s.spot_number} - ${userName}\n`;
                });
            }
            
            if (available === total) {
                status += '✨ Todos los espacios disponibles\n';
            }
            
            status += '\n';
        }
        return status;
    }
}

// Iniciar bot
if (require.main === module) {
    require('dotenv').config();
    new WTCParkBot();
}

module.exports = WTCParkBot;