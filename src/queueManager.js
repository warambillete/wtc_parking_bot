const moment = require('moment-timezone');

class QueueManager {
    constructor(database, bot, parkingManager = null) {
        this.db = database;
        this.bot = bot;
        this.parkingManager = parkingManager;
        this.queues = new Map(); // date -> array of requests
        this.processingTimeouts = new Map(); // date -> timeout reference
        this.isQueueActive = false;
        this.currentQueueEnd = null;
    }

    // Check if we're in Friday 17:00-17:15 GMT-3 period
    isInQueuePeriod() {
        const now = moment().tz('America/Montevideo');
        return now.day() === 5 && // Friday
               now.hour() === 17 && // 5 PM
               now.minute() < 15;   // Before 17:15
    }

    // Check if reservation is for next week (the lottery target)
    // "Next week" means the work week that starts after the next Friday 5PM reset
    isNextWeekReservation(targetDate) {
        const now = moment().tz('America/Montevideo');
        
        // Find the next Friday 5PM reset point
        let nextReset;
        if (now.day() === 5 && now.hour() < 17) {
            // Today is Friday before 5PM - next reset is today at 5PM
            nextReset = now.clone().hour(17).minute(0).second(0);
        } else {
            // Next reset is next Friday at 5PM
            nextReset = now.clone().day(5 + 7).hour(17).minute(0).second(0);
        }
        
        // "Next week" is Monday to Friday AFTER the next reset
        const nextWeekStart = nextReset.clone().add(3, 'days').day(1); // Monday after reset Friday
        const nextWeekEnd = nextReset.clone().add(1, 'week').day(5); // Friday after reset Friday
        
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
        const now = moment().tz('America/Montevideo');
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

    // Check if we're after Friday 5PM reset but before next Friday 5PM
    isNextWeekBookingAllowed() {
        const now = moment().tz('America/Montevideo');
        
        // Find when the current booking period started (last Friday 5PM)
        let lastReset;
        if (now.day() === 5 && now.hour() >= 17) {
            // Today is Friday after 5PM - reset happened today
            lastReset = now.clone().hour(17).minute(0).second(0);
        } else {
            // Last reset was previous Friday
            lastReset = now.clone().day(5 - 7).hour(17).minute(0).second(0);
        }
        
        // Find next Friday 5PM (end of booking period)
        let nextReset = now.clone().day(5 + 7).hour(17).minute(0).second(0);
        if (now.day() === 5 && now.hour() < 17) {
            nextReset = now.clone().hour(17).minute(0).second(0);
        }
        
        // We're in the booking period if we're after last reset and before next reset
        return now.isAfter(lastReset);
    }

    // Handle reservation - main entry point called by webhook bot
    async handleReservation(userId, user, targetDate) {
        const now = moment().tz('America/Montevideo');
        
        // Check if trying to reserve for a past date
        if (targetDate.isBefore(now, 'day')) {
            return {
                success: false,
                message: `No puedes hacer reservas para fechas pasadas. La fecha ${targetDate.format('dddd DD/MM')} ya ha pasado.`
            };
        }
        
        // Check if trying to reserve for weekend (Saturday=6, Sunday=0)
        if (targetDate.day() === 0 || targetDate.day() === 6) {
            return {
                success: false,
                message: `No se pueden hacer reservas para fines de semana. Solo días laborables (lunes a viernes).`
            };
        }
        
        // Check if this is a next-week reservation
        if (this.isNextWeekReservation(targetDate)) {
            // Check if we're in the lottery period (Friday 17:00-17:15)
            if (this.isInQueuePeriod()) {
                // Add to lottery queue
                return await this.addToQueue(userId, user, targetDate, userId); // Use userId as chatId fallback
            } 
            // Check if we're after Friday 17:15 (normal booking period)
            else if (this.isNextWeekBookingAllowed()) {
                // Regular booking for next week after lottery period
                if (!this.parkingManager) {
                    const ParkingManager = require('./parkingManager');
                    this.parkingManager = new ParkingManager(this.db);
                }
                
                const result = await this.parkingManager.reserveSpot(userId, user, targetDate);
                
                if (result.success) {
                    return {
                        success: true,
                        spotNumber: result.spotNumber
                    };
                } else if (result.waitlist) {
                    return {
                        success: false,
                        waitlist: true
                    };
                } else {
                    return {
                        success: false,
                        message: result.message
                    };
                }
            } else {
                // Before Friday 5PM - no next week bookings allowed
                return {
                    success: false,
                    message: `Las reservas para la próxima semana estarán disponibles después del viernes 17:00. Durante 17:00-17:15 habrá un período de lotería, después será reserva normal.`
                };
            }
        } else {
            // Regular immediate reservation for current week using ParkingManager
            if (!this.parkingManager) {
                // Fallback: create ParkingManager if not provided (should not happen in production)
                const ParkingManager = require('./parkingManager');
                this.parkingManager = new ParkingManager(this.db);
            }
            
            const result = await this.parkingManager.reserveSpot(userId, user, targetDate);
            
            if (result.success) {
                return {
                    success: true,
                    spotNumber: result.spotNumber
                };
            } else if (result.waitlist) {
                return {
                    success: false,
                    waitlist: true
                };
            } else {
                return {
                    success: false,
                    message: result.message
                };
            }
        }
    }

    // Notify waitlist when a spot is released
    async notifyWaitlist(date, spotNumber) {
        const dateStr = date.format('YYYY-MM-DD');
        const nextInLine = await this.db.getNextInWaitlist(dateStr);
        
        if (nextInLine) {
            console.log(`📢 Notificando a ${nextInLine.first_name || nextInLine.username} sobre espacio liberado`);
            
            try {
                // Assign the spot to the next person in waitlist
                await this.db.createReservation(nextInLine.user_id, nextInLine, dateStr, spotNumber);
                await this.db.removeFromWaitlist(nextInLine.user_id, dateStr);
                
                // Notify the user
                try {
                    await this.bot.sendMessage(nextInLine.user_id, 
                        `🎉 ¡Buenas noticias! Se liberó un espacio y te hemos asignado el estacionamiento ${spotNumber} para ${date.format('dddd DD/MM')}`);
                    
                    console.log(`✅ Notificación enviada a ${nextInLine.first_name || nextInLine.username}`);
                    return true;
                } catch (error) {
                    console.error('❌ Error enviando notificación de lista de espera:', error);
                    // If notification fails, we should still keep the reservation assigned
                    return true; // Reservation was successful, just notification failed
                }
            } catch (error) {
                console.error('❌ Error asignando espacio de lista de espera:', error);
                // Could be because spot is already taken or user already has reservation
                return false;
            }
        }
        
        return false; // No one in waitlist
    }
}

module.exports = QueueManager;