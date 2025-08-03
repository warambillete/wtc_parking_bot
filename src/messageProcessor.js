const moment = require('moment-timezone');

class MessageProcessor {
    constructor() {
        this.reservePatterns = [
            /\b(voy|vengo|necesito|quiero|reservo|reservar)\s+(el\s+)?(lunes|martes|mi[eé]rcoles|jueves|viernes)\b/i,
            /\b(voy|vengo|necesito|quiero|reservo|reservar)\s+(ma[ñn]ana)\b/i,
            /\b(voy|vengo|necesito|quiero|reservo|reservar)\s+(hoy)\b/i,
            // Removed "toda la semana" pattern for flex spots
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
        
        this.fixedListPatterns = [
            /\b(ver\s+fijos|espacios\s+fijos|lista\s+fijos)\b/i,
            /\b(mostrar\s+fijos|cu[aá]les\s+son\s+los\s+fijos)\b/i
        ];
        
        // Fixed spot release patterns
        this.fixedReleasePatterns = [
            /\b(libero|liberar)\s+(el\s+)?(\d{4})\s+(para|por)\s+(el\s+)?(lunes|martes|mi[eé]rcoles|jueves|viernes)/i,
            /\b(libero|liberar)\s+(el\s+)?(\d{4})\s+(toda\s+la\s+semana|por\s+toda\s+la\s+semana)/i,
            /\b(libero|liberar)\s+(el\s+)?(\d{4})\s+(por\s+)?(\d+)\s+semanas?/i,
            /\b(libero|liberar)\s+(el\s+)?(\d{4})\s+(para|por)\s+.*?(lunes|martes|mi[eé]rcoles|jueves|viernes).*?(y|,).*?(lunes|martes|mi[eé]rcoles|jueves|viernes)/i
        ];
        
        // Fixed spot removal patterns
        this.fixedRemovalPatterns = [
            /\b(quitar|quito|sacar|saco)\s+(el\s+)?(\d{4})\b/i,
            /\b(quiero|necesito)\s+(el\s+)?(\d{4})\s+(de\s+vuelta|devuelta)\b/i
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
        
        // Verificar si es solicitud de ver espacios fijos
        if (this.fixedListPatterns.some(pattern => pattern.test(text))) {
            return { type: 'FIXED_LIST' };
        }
        
        // Check for fixed spot removal (quitar el 8033)
        for (const pattern of this.fixedRemovalPatterns) {
            const match = text.match(pattern);
            if (match) {
                const spotNumber = match[3] || match[2]; // Capture the spot number
                return { type: 'FIXED_REMOVAL', spotNumber };
            }
        }
        
        // Check for fixed spot release (libero el 8033...)
        for (const pattern of this.fixedReleasePatterns) {
            const match = text.match(pattern);
            if (match) {
                const spotNumber = match[3]; // The spot number
                const releaseInfo = this.parseFixedRelease(text, match, spotNumber);
                if (releaseInfo) {
                    return releaseInfo;
                }
            }
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
        const now = moment().tz('America/Montevideo');
        
        // Verificar si menciona "próxima semana"
        const isNextWeek = /pr[oó]xim[ao]\s+semana|la\s+pr[oó]xim[ao]\s+semana/i.test(text);
        
        // Check if it's after Friday 17:00 reset (same logic as parkingManager)
        const isAfterFridayReset = now.day() === 5 && now.hour() >= 17;
        const isSaturday = now.day() === 6;
        // Sunday (day 0) should allow booking for this week (Monday-Friday coming up)
        // Saturday should use next week since work week is over
        const shouldUseNextWeek = isSaturday || isAfterFridayReset;
        
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
                } else if (shouldUseNextWeek) {
                    // Después del viernes 17:00 o en fin de semana, usar próxima semana
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
            const now = moment().tz('America/Montevideo');
            const isNextWeek = /pr[oó]xim[ao]\s+semana|la\s+pr[oó]xim[ao]\s+semana/i.test(text);
            
            // Check if it's after Friday 17:00 reset (same logic as extractDate)
            const isAfterFridayReset = now.day() === 5 && now.hour() >= 17;
            const isSaturday = now.day() === 6;
            // Sunday (day 0) should allow booking for this week (Monday-Friday coming up)
            const shouldUseNextWeek = isSaturday || isAfterFridayReset;
            
            dayMatches.forEach(dayName => {
                const targetDay = this.dayMap[dayName.toLowerCase()] || 
                                this.dayMap[dayName.toLowerCase().replace('é', 'e')];
                
                if (targetDay) {
                    let targetDate;
                    
                    if (isNextWeek) {
                        targetDate = now.clone().add(1, 'week').day(targetDay);
                    } else if (shouldUseNextWeek) {
                        targetDate = now.clone().add(1, 'week').day(targetDay);
                    } else {
                        targetDate = now.clone().day(targetDay);
                        
                        if (targetDate.isBefore(now, 'day')) {
                            targetDate.add(1, 'week');
                        }
                    }
                    
                    days.push(targetDate);
                }
            });
        }
        
        return days;
    }
    
    // Método para obtener toda la semana (lunes a viernes)
    getWholeWeek(text) {
        const now = moment().tz('America/Montevideo');
        const isNextWeek = /pr[oó]xim[ao]\s+semana|la\s+pr[oó]xim[ao]\s+semana/i.test(text);
        
        // Check if it's after Friday 17:00 reset (same logic as other methods)
        const isAfterFridayReset = now.day() === 5 && now.hour() >= 17;
        const isSaturday = now.day() === 6;
        // Sunday (day 0) should allow booking for this week (Monday-Friday coming up)
        const shouldUseNextWeek = isSaturday || isAfterFridayReset;
        
        const days = [];
        const weekDays = [1, 2, 3, 4, 5]; // Lunes a viernes
        
        weekDays.forEach(dayNumber => {
            let targetDate;
            
            if (isNextWeek) {
                targetDate = now.clone().add(1, 'week').day(dayNumber);
            } else if (shouldUseNextWeek) {
                targetDate = now.clone().add(1, 'week').day(dayNumber);
            } else {
                targetDate = now.clone().day(dayNumber);
                
                // Si el día ya pasó esta semana, mover a la siguiente
                if (targetDate.isBefore(now, 'day')) {
                    targetDate.add(1, 'week');
                }
            }
            
            days.push(targetDate);
        });
        
        return days;
    }
    
    // Parse fixed spot release information
    parseFixedRelease(text, match, spotNumber) {
        const now = moment().tz('America/Montevideo');
        
        // Check for "toda la semana" (whole week)
        if (/toda\s+la\s+semana|por\s+toda\s+la\s+semana/i.test(text)) {
            const dates = this.getWholeWeek(text);
            return { 
                type: 'FIXED_RELEASE', 
                spotNumber, 
                startDate: dates[0], 
                endDate: dates[dates.length - 1] 
            };
        }
        
        // Check for "por X semanas" (for X weeks)
        const weeksMatch = text.match(/por\s+(\d+)\s+semanas?/i);
        if (weeksMatch) {
            const weeks = parseInt(weeksMatch[1]);
            const startDate = now.clone().day(1); // Start from Monday
            if (startDate.isBefore(now, 'day')) {
                startDate.add(1, 'week');
            }
            const endDate = startDate.clone().add(weeks, 'weeks').day(5); // End on Friday
            
            return { 
                type: 'FIXED_RELEASE', 
                spotNumber, 
                startDate, 
                endDate 
            };
        }
        
        // Check for specific day(s)
        const days = this.processMultipleDays(text);
        if (days.length > 0) {
            return { 
                type: 'FIXED_RELEASE', 
                spotNumber, 
                startDate: days[0], 
                endDate: days[days.length - 1] 
            };
        }
        
        return null;
    }
}

module.exports = MessageProcessor;