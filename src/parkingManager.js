const moment = require('moment-timezone');

class ParkingManager {
    constructor(database) {
        this.db = database;
    }
    
    async reserveSpot(userId, user, date) {
        const dateStr = date.format('YYYY-MM-DD');
        
        // Verificar si el usuario ya tiene reserva para ese día
        const existing = await this.db.getReservation(userId, dateStr);
        if (existing) {
            return { 
                success: false, 
                message: `Ya tienes reservado el estacionamiento ${existing.spot_number} para ${date.format('dddd DD/MM')}` 
            };
        }
        
        // Buscar estacionamiento disponible
        const availableSpot = await this.db.getAvailableSpot(dateStr);
        if (availableSpot) {
            await this.db.createReservation(userId, user, dateStr, availableSpot.number);
            return { 
                success: true, 
                spotNumber: availableSpot.number 
            };
        }
        
        // No hay espacios disponibles, ofrecer lista de espera
        return { 
            success: false, 
            waitlist: true 
        };
    }
    
    async releaseSpot(userId, date) {
        const dateStr = date.format('YYYY-MM-DD');
        const reservation = await this.db.getReservation(userId, dateStr);
        
        if (!reservation) {
            return { 
                success: false, 
                message: `No tienes reserva para ${date.format('dddd DD/MM')}` 
            };
        }
        
        await this.db.deleteReservation(userId, dateStr);
        return { 
            success: true, 
            spotNumber: reservation.spot_number 
        };
    }
    
    async addToWaitlist(userId, user, date) {
        const dateStr = date.format('YYYY-MM-DD');
        await this.db.addToWaitlist(userId, user, dateStr);
    }
    
    async getNextInWaitlist(date) {
        const dateStr = date.format('YYYY-MM-DD');
        return await this.db.getNextInWaitlist(dateStr);
    }
    
    async removeFromWaitlist(userId, date) {
        const dateStr = date.format('YYYY-MM-DD');
        await this.db.removeFromWaitlist(userId, dateStr);
    }
    
    async assignWaitlistSpot(userId, date, spotNumber) {
        const dateStr = date.format('YYYY-MM-DD');
        const user = await this.db.getWaitlistUser(userId, dateStr);
        
        if (user) {
            await this.db.createReservation(userId, user, dateStr, spotNumber);
            await this.db.removeFromWaitlist(userId, dateStr);
            return true;
        }
        return false;
    }
    
    async getWeekStatus() {
        const now = moment().tz('America/Montevideo');
        
        // Calcular semana laboral actual (lunes a viernes)
        let startOfWeek;
        
        if (now.day() === 0) { // Si es domingo, mostrar la semana que empieza mañana
            startOfWeek = now.clone().add(1, 'day'); // Lunes
        } else if (now.day() === 6) { // Si es sábado, mostrar la semana que empieza en 2 días
            startOfWeek = now.clone().add(2, 'day'); // Lunes
        } else {
            // Para días laborables, ir al lunes de esta semana
            startOfWeek = now.clone().day(1); // Día 1 = lunes
        }
        
        // Siempre mostrar exactamente 5 días: lunes a viernes
        const endOfWeek = startOfWeek.clone().day(5); // Día 5 = viernes
        
        const weekStatus = {};
        const current = startOfWeek.clone();
        
        while (current.isSameOrBefore(endOfWeek)) {
            const dateStr = current.format('YYYY-MM-DD');
            weekStatus[dateStr] = await this.db.getDayStatus(dateStr);
            current.add(1, 'day');
        }
        
        return weekStatus;
    }
    
    async setParkingSpots(spotNumbers) {
        // Solo actualizar los espacios, sin limpiar reservas existentes
        await this.db.setParkingSpots(spotNumbers);
    }
    
    async clearAllReservations() {
        await this.db.clearAllReservations();
    }
    
    async getSystemStats() {
        return await this.db.getSystemStats();
    }
    
    async getUserReservations(userId) {
        return await this.db.getUserReservations(userId);
    }
    
    async getDayReservations(date) {
        const dateStr = date.format('YYYY-MM-DD');
        return await this.db.getDayReservations(dateStr);
    }
    
    // Método para manejar múltiples días (próxima semana)
    async reserveMultipleDays(userId, user, dates) {
        const results = [];
        
        for (const date of dates) {
            const result = await this.reserveSpot(userId, user, date);
            results.push({
                date: date.format('dddd DD/MM'),
                ...result
            });
        }
        
        return results;
    }
    
    async releaseMultipleDays(userId, dates) {
        const results = [];
        
        for (const date of dates) {
            const result = await this.releaseSpot(userId, date);
            results.push({
                date: date.format('dddd DD/MM'),
                ...result
            });
        }
        
        return results;
    }
    
    formatWeekStatus(weekStatus) {
        let responseText = '📅 *Estado de la semana:*\n\n';
        
        for (const [dateStr, spots] of Object.entries(weekStatus)) {
            const date = moment(dateStr);
            const dayName = date.format('dddd DD/MM');
            
            const reservedSpots = spots.filter(spot => spot.reserved === 1);
            const availableSpots = spots.filter(spot => spot.reserved === 0);
            
            responseText += `*${dayName}*\n`;
            
            if (reservedSpots.length > 0) {
                responseText += `🚗 Ocupados:\n`;
                reservedSpots.forEach(spot => {
                    const name = spot.first_name || spot.username || 'Usuario';
                    responseText += `   • Espacio ${spot.spot_number}: ${name}\n`;
                });
            }
            
            if (availableSpots.length > 0) {
                responseText += `🅿️ Disponibles: `;
                const availableNumbers = availableSpots.map(spot => spot.spot_number).join(', ');
                responseText += `${availableNumbers}\n`;
            }
            
            if (spots.length === 0) {
                responseText += `⚠️ No hay espacios configurados\n`;
            }
            
            responseText += '\n';
        }
        
        return responseText;
    }
}

module.exports = ParkingManager;