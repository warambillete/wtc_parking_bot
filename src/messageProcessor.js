const moment = require('moment-timezone');

class MessageProcessor {
    constructor() {
        this.reservePatterns = [
            /\b(voy|vengo|necesito|quiero|reservo|reservar)\s+(el\s+)?(lunes|martes|mi[eé]rcoles|jueves|viernes)\b/i,
            /\b(voy|vengo|necesito|quiero|reservo|reservar)\s+(ma[ñn]ana)\b/i,
            /\b(voy|vengo|necesito|quiero|reservo|reservar)\s+(hoy)\b/i,
            /\b(voy|vengo|necesito|quiero|reservo|reservar)\s+(toda\s+la\s+semana)\b/i,
            /\b(voy|vengo|necesito|quiero|reservo|reservar)\s+.*?(lunes|martes|mi[eé]rcoles|jueves|viernes).*?(y|,).*?(lunes|martes|mi[eé]rcoles|jueves|viernes)/i,
            /\b(reservar|reservo)\s+(lunes|martes|mi[eé]rcoles|jueves|viernes)\b/i,
            /\b(reservar|reservo)\s+.*?(lunes|martes|mi[eé]rcoles|jueves|viernes).*?(y|,).*?(lunes|martes|mi[eé]rcoles|jueves|viernes)/i,
            /\b(pr[oó]xim[ao]\s+semana)\s+(voy|vengo|reservo|reservar)\s+(el\s+)?(lunes|martes|mi[eé]rcoles|jueves|viernes)\b/i,
            /\b(la\s+pr[oó]xim[ao]\s+semana)\s+(voy|vengo|reservo|reservar)\s+(el\s+)?(lunes|martes|mi[eé]rcoles|jueves|viernes)\b/i
        ];
        
        this.releasePatterns = [
            /\b(libero|dejo\s+libre|queda\s+libre|no\s+voy)\s+(el\s+)?(lunes|martes|mi[eé]rcoles|jueves|viernes)\b/i,
            /\b(libero|dejo\s+libre|queda\s+libre|no\s+voy)\s+(ma[ñn]ana)\b/i,
            /\b(libero|dejo\s+libre|queda\s+libre|no\s+voy)\s+(hoy)\b/i,
            /\b(libero|dejo\s+libre|queda\s+libre|no\s+voy)\s+.*?(lunes|martes|mi[eé]rcoles|jueves|viernes).*?(y|,).*?(lunes|martes|mi[eé]rcoles|jueves|viernes)/i,
            /\b(libero|dejo\s+libre|queda\s+libre|no\s+voy)\s+.*?(que\s+es\s+feriado|feriado)/i,
            /\b(ma[ñn]ana)\s+(queda\s+libre|libero|dejo\s+libre)\b/i,
            /\b(hoy)\s+(queda\s+libre|libero|dejo\s+libre)\b/i
        ];
        
        this.statusPatterns = [
            /\b(estado|disponibles|ocupados|cu[aá]ntos|lista)\b/i,
            /\b(qu[eé]\s+d[ií]as?)\b/i
        ];
        
        this.myReservationsPatterns = [
            /\b(mis\s+reservas|ver\s+mis\s+reservas)\b/i,
            /\b(mi\s+reserva|ver\s+mi\s+reserva)\b/i
        ];
        
        this.helpPatterns = [
            /\b(ayuda|help)\b/i,
            /\b(como\s+funciona|c[oó]mo\s+funciona)\b/i,
            /\b(qu[eé]\s+puedo\s+hacer)\b/i,
            /\b(comandos)\b/i
        ];
        
        this.dayMap = {
            'lunes': 1,
            'martes': 2,
            'miércoles': 3,
            'miercoles': 3,
            'jueves': 4,
            'viernes': 5
        };
    }
    
    processMessage(text) {
        text = text.toLowerCase().trim();
        
        // Verificar si es solicitud de estado
        if (this.statusPatterns.some(pattern => pattern.test(text))) {
            return { type: 'STATUS' };
        }
        
        // Verificar si es solicitud de mis reservas
        if (this.myReservationsPatterns.some(pattern => pattern.test(text))) {
            return { type: 'MY_RESERVATIONS' };
        }
        
        // Verificar si es solicitud de ayuda
        if (this.helpPatterns.some(pattern => pattern.test(text))) {
            return { type: 'HELP' };
        }
        
        // Verificar si es liberación FIRST (has priority over reservations)
        for (const pattern of this.releasePatterns) {
            const match = text.match(pattern);
            if (match) {
                // Verificar si son múltiples días para liberar
                const multipleDays = this.processMultipleDays(text);
                if (multipleDays.length > 1) {
                    return { type: 'RELEASE_MULTIPLE', dates: multipleDays };
                }
                
                // Un solo día
                const date = this.extractDate(text, match);
                if (date) {
                    return { type: 'RELEASE', date };
                }
            }
        }
        
        // Verificar si es reserva
        for (const pattern of this.reservePatterns) {
            const match = text.match(pattern);
            if (match) {
                // Verificar si es "toda la semana"
                if (/toda\s+la\s+semana/i.test(text)) {
                    const dates = this.getWholeWeek(text);
                    if (dates.length > 0) {
                        return { type: 'RESERVE_MULTIPLE', dates };
                    }
                }
                
                // Verificar si son múltiples días
                const multipleDays = this.processMultipleDays(text);
                if (multipleDays.length > 1) {
                    return { type: 'RESERVE_MULTIPLE', dates: multipleDays };
                }
                
                // Un solo día
                const date = this.extractDate(text, match);
                if (date) {
                    return { type: 'RESERVE', date };
                }
            }
        }
        
        return { type: 'UNKNOWN' };
    }
    
    extractDate(text, match) {
        const now = moment().tz('America/Argentina/Buenos_Aires');
        
        // Verificar si menciona "próxima semana"
        const isNextWeek = /pr[oó]xim[ao]\s+semana|la\s+pr[oó]xim[ao]\s+semana/i.test(text);
        
        // Buscar día específico
        const dayMatch = text.match(/(lunes|martes|mi[eé]rcoles|jueves|viernes)/i);
        if (dayMatch) {
            const dayName = dayMatch[1].toLowerCase();
            const targetDay = this.dayMap[dayName] || this.dayMap[dayName.replace('é', 'e')];
            
            if (targetDay) {
                let targetDate;
                
                // Si específicamente mencionó próxima semana
                if (isNextWeek) {
                    targetDate = now.clone().add(1, 'week').day(targetDay);
                } else {
                    // Para esta semana
                    targetDate = now.clone().day(targetDay);
                    
                    // Si el día ya pasó esta semana, usar la próxima semana
                    if (targetDate.isBefore(now, 'day')) {
                        targetDate.add(1, 'week');
                    }
                }
                
                // Only log in non-test environments
                if (process.env.NODE_ENV !== 'test') {
                    console.log(`📅 Procesando fecha:
                    Texto: "${text}"
                    Día solicitado: ${dayName} (${targetDay})
                    Fecha calculada: ${targetDate.format('dddd DD/MM/YYYY')}
                    Es próxima semana: ${isNextWeek}`);
                }
                
                return targetDate;
            }
        }
        
        // Manejar "mañana"
        if (/ma[ñn]ana/i.test(text)) {
            return now.clone().add(1, 'day');
        }
        
        // Manejar "hoy"
        if (/hoy/i.test(text)) {
            return now.clone();
        }
        
        return null;
    }
    
    // Método para procesar múltiples días en un mensaje
    processMultipleDays(text) {
        const days = [];
        const dayMatches = text.match(/(lunes|martes|mi[eé]rcoles|jueves|viernes)/gi);
        
        if (dayMatches) {
            const now = moment().tz('America/Argentina/Buenos_Aires');
            const isNextWeek = /pr[oó]xim[ao]\s+semana|la\s+pr[oó]xim[ao]\s+semana/i.test(text);
            
            dayMatches.forEach(dayName => {
                const targetDay = this.dayMap[dayName.toLowerCase()] || 
                                this.dayMap[dayName.toLowerCase().replace('é', 'e')];
                
                if (targetDay) {
                    let targetDate = now.clone().day(targetDay);
                    
                    if (targetDate.isBefore(now, 'day')) {
                        targetDate.add(1, 'week');
                    }
                    
                    if (isNextWeek) {
                        targetDate = now.clone().add(1, 'week').day(targetDay);
                    }
                    
                    days.push(targetDate);
                }
            });
        }
        
        return days;
    }
    
    // Método para obtener toda la semana (lunes a viernes)
    getWholeWeek(text) {
        const now = moment().tz('America/Argentina/Buenos_Aires');
        const isNextWeek = /pr[oó]xim[ao]\s+semana|la\s+pr[oó]xim[ao]\s+semana/i.test(text);
        
        const days = [];
        const weekDays = [1, 2, 3, 4, 5]; // Lunes a viernes
        
        weekDays.forEach(dayNumber => {
            let targetDate = now.clone().day(dayNumber);
            
            // Si el día ya pasó esta semana, mover a la siguiente
            if (targetDate.isBefore(now, 'day')) {
                targetDate.add(1, 'week');
            }
            
            // Si específicamente mencionó próxima semana
            if (isNextWeek) {
                targetDate = now.clone().add(1, 'week').day(dayNumber);
            }
            
            days.push(targetDate);
        });
        
        return days;
    }
}

module.exports = MessageProcessor;