const moment = require('moment-timezone');

class QueueManager {
    constructor(database, bot) {
        this.db = database;
        this.bot = bot;
        this.queues = new Map(); // date -> array of requests
        this.processingTimeouts = new Map(); // date -> timeout reference
        this.isQueueActive = false;
        this.currentQueueEnd = null;
    }

    // Check if we're in Friday 17:00-17:15 GMT-3 period
    isInQueuePeriod() {
        const now = moment().tz('America/Argentina/Buenos_Aires');
        return now.day() === 5 && // Friday
               now.hour() === 17 && // 5 PM
               now.minute() < 15;   // Before 17:15
    }

    // Check if reservation is for next week (the lottery target)
    isNextWeekReservation(targetDate) {
        const now = moment().tz('America/Argentina/Buenos_Aires');
        const nextWeekStart = now.clone().add(1, 'week').day(1); // Next Monday
        const nextWeekEnd = now.clone().add(1, 'week').day(5); // Next Friday
        
        return targetDate.isBetween(nextWeekStart, nextWeekEnd, 'day', '[]');
    }

    // Add request to queue instead of processing immediately
    async addToQueue(userId, user, targetDate, chatId) {
        const dateStr = targetDate.format('YYYY-MM-DD');
        
        if (!this.queues.has(dateStr)) {
            this.queues.set(dateStr, []);
            this.scheduleQueueProcessing(dateStr, targetDate);
        }

        const queue = this.queues.get(dateStr);
        
        // Check if user already in queue for this date
        const existingRequest = queue.find(req => req.userId === userId);
        if (existingRequest) {
            return {
                success: false,
                message: `Ya estás en la cola para ${targetDate.format('dddd DD/MM')}. La asignación será a las 17:15.`
            };
        }

        // Add to queue
        queue.push({
            userId,
            user,
            chatId,
            targetDate,
            timestamp: Date.now(),
            id: `${userId}_${dateStr}_${Date.now()}`
        });

        console.log(`🎲 Usuario ${user.first_name || user.username} añadido a la cola para ${targetDate.format('dddd DD/MM')}`);

        return {
            success: true,
            queued: true,
            message: `📋 Tu solicitud para ${targetDate.format('dddd DD/MM')} está en la cola de lotería.\n\n⏰ La asignación será el viernes a las 17:15.\n🎲 Todos los solicitantes tendrán la misma oportunidad.\n\n👥 Posición en cola: ${queue.length}`
        };
    }

    // Schedule the queue processing for 17:15
    scheduleQueueProcessing(dateStr, targetDate) {
        const now = moment().tz('America/Argentina/Buenos_Aires');
        const processTime = now.clone().hour(17).minute(15).second(0);
        
        // If we're past 17:15 today, schedule for next Friday
        if (now.isAfter(processTime)) {
            processTime.add(1, 'week');
        }

        const timeoutMs = processTime.diff(now);
        
        console.log(`⏰ Cola programada para procesarse en: ${processTime.format('dddd DD/MM HH:mm')}`);

        const timeoutId = setTimeout(() => {
            this.processQueue(dateStr, targetDate);
        }, timeoutMs);

        this.processingTimeouts.set(dateStr, timeoutId);
    }

    // Process queue at 17:15 - randomly assign spots
    async processQueue(dateStr, targetDate) {
        const queue = this.queues.get(dateStr);
        if (!queue || queue.length === 0) {
            console.log(`📭 No hay solicitudes en cola para ${dateStr}`);
            return;
        }

        console.log(`🎲 Procesando cola para ${dateStr} con ${queue.length} solicitudes`);

        // Randomly shuffle the queue for fairness
        const shuffledQueue = [...queue].sort(() => Math.random() - 0.5);
        
        const results = [];
        
        for (const request of shuffledQueue) {
            try {
                const result = await this.processQueuedReservation(request);
                results.push({ ...request, result });
            } catch (error) {
                console.error('Error procesando reserva de cola:', error);
                results.push({ 
                    ...request, 
                    result: { 
                        success: false, 
                        message: 'Error procesando tu solicitud' 
                    } 
                });
            }
        }

        // Send results to users
        await this.notifyQueueResults(results, targetDate);

        // Clean up
        this.queues.delete(dateStr);
        this.processingTimeouts.delete(dateStr);
    }

    // Process individual queued reservation
    async processQueuedReservation(request) {
        const { userId, user, targetDate } = request;
        const dateStr = targetDate.format('YYYY-MM-DD');

        // Check if user already has reservation for this date
        const existing = await this.db.getReservation(userId, dateStr);
        if (existing) {
            return { 
                success: false, 
                message: `Ya tienes reservado el estacionamiento ${existing.spot_number}` 
            };
        }

        // Try to get available spot
        const availableSpot = await this.db.getAvailableSpot(dateStr);
        if (availableSpot) {
            await this.db.createReservation(userId, user, dateStr, availableSpot.number);
            return { 
                success: true, 
                spotNumber: availableSpot.number 
            };
        }

        // No spots available, add to regular waitlist
        await this.db.addToWaitlist(userId, user, dateStr);
        return { 
            success: false, 
            waitlist: true,
            message: 'Todos los espacios fueron asignados. Fuiste añadido a la lista de espera.' 
        };
    }

    // Notify all users of queue results
    async notifyQueueResults(results, targetDate) {
        console.log(`📢 Enviando resultados de lotería para ${targetDate.format('dddd DD/MM')}`);

        const successful = results.filter(r => r.result.success);
        const waitlisted = results.filter(r => r.result.waitlist);
        
        // Send individual notifications
        for (const { chatId, result, user } of results) {
            try {
                let message = `🎲 **Resultado de Lotería - ${targetDate.format('dddd DD/MM')}**\n\n`;
                
                if (result.success) {
                    message += `🎉 ¡Felicitaciones! Tienes asignado el estacionamiento **${result.spotNumber}**`;
                } else if (result.waitlist) {
                    message += `📝 No obtuviste espacio en la lotería, pero fuiste añadido a la lista de espera.\n\nSi alguien libera su espacio, te notificaremos inmediatamente.`;
                } else {
                    message += `❌ ${result.message}`;
                }

                await this.bot.sendMessage(chatId, message);
            } catch (error) {
                console.error(`Error enviando notificación a ${user.first_name}:`, error);
            }
        }

        // Send summary to supervisor if configured
        if (process.env.SUPERVISOR_USER_ID) {
            const summary = `📊 **Resumen Lotería ${targetDate.format('dddd DD/MM')}:**\n\n` +
                           `🎯 Solicitudes totales: ${results.length}\n` +
                           `✅ Espacios asignados: ${successful.length}\n` +
                           `📝 En lista de espera: ${waitlisted.length}`;
            
            try {
                await this.bot.sendMessage(process.env.SUPERVISOR_USER_ID, summary);
            } catch (error) {
                console.error('Error enviando resumen al supervisor:', error);
            }
        }
    }

    // Get queue status for a specific date
    getQueueStatus(dateStr) {
        const queue = this.queues.get(dateStr);
        if (!queue) return null;

        return {
            total: queue.length,
            date: dateStr,
            processingScheduled: this.processingTimeouts.has(dateStr)
        };
    }

    // Get all active queues
    getAllQueues() {
        const activeQueues = {};
        for (const [dateStr, queue] of this.queues) {
            activeQueues[dateStr] = {
                total: queue.length,
                users: queue.map(r => ({
                    name: r.user.first_name || r.user.username,
                    timestamp: r.timestamp
                }))
            };
        }
        return activeQueues;
    }

    // Clear all queues (for testing or emergency)
    clearAllQueues() {
        for (const timeoutId of this.processingTimeouts.values()) {
            clearTimeout(timeoutId);
        }
        this.queues.clear();
        this.processingTimeouts.clear();
        console.log('🧹 Todas las colas han sido limpiadas');
    }
}

module.exports = QueueManager;