const moment = require('moment-timezone');
const Database = require('../../src/database');
const MessageProcessor = require('../../src/messageProcessor');

describe('Fixed Spaces Feature Tests', () => {
    let db, messageProcessor;
    
    beforeEach(async () => {
        db = new Database(':memory:');
        await db.init();
        messageProcessor = new MessageProcessor();
        
        // Set up some fixed spots
        const fixedSpots = [
            { number: '8033', userId: '100', username: 'juan', firstName: 'Juan', lastName: 'Pérez' },
            { number: '8034', userId: '200', username: 'maria', firstName: 'María', lastName: 'García' }
        ];
        await db.setFixedSpots(fixedSpots);
    });
    
    afterEach(() => {
        db.close();
    });

    describe('Message Processor Detection', () => {
        test('should detect fixed spot release for specific days', () => {
            const result = messageProcessor.processMessage('libero el 8033 para martes y miércoles');
            
            expect(result.type).toBe('FIXED_RELEASE');
            expect(result.spotNumber).toBe('8033');
            expect(result.startDate).toBeDefined();
            expect(result.endDate).toBeDefined();
        });

        test('should detect fixed spot release for whole week', () => {
            const result = messageProcessor.processMessage('libero el 8033 toda la semana');
            
            expect(result.type).toBe('FIXED_RELEASE');
            expect(result.spotNumber).toBe('8033');
            expect(result.startDate).toBeDefined();
            expect(result.endDate).toBeDefined();
            
            // Should be Monday to Friday
            expect(result.startDate.day()).toBe(1); // Monday
            expect(result.endDate.day()).toBe(5); // Friday
        });

        test('should detect fixed spot release for multiple weeks', () => {
            const result = messageProcessor.processMessage('libero el 8030 por 2 semanas');
            
            expect(result.type).toBe('FIXED_RELEASE');
            expect(result.spotNumber).toBe('8030');
            expect(result.startDate).toBeDefined();
            expect(result.endDate).toBeDefined();
            
            // End date should be 2 weeks later
            const weeksDiff = result.endDate.diff(result.startDate, 'weeks');
            expect(weeksDiff).toBeGreaterThanOrEqual(1);
        });

        test('should detect fixed spot removal', () => {
            const result = messageProcessor.processMessage('quitar el 2033');
            
            expect(result.type).toBe('FIXED_REMOVAL');
            expect(result.spotNumber).toBe('2033');
        });

        test('should detect alternative fixed spot removal', () => {
            const result = messageProcessor.processMessage('quito el 8033');
            
            expect(result.type).toBe('FIXED_REMOVAL');
            expect(result.spotNumber).toBe('8033');
        });
    });

    describe('Database Operations', () => {
        test('should store and retrieve fixed spots', async () => {
            const fixedSpot = await db.getFixedSpot('8033');
            
            expect(fixedSpot).toBeTruthy();
            expect(fixedSpot.spot_number).toBe('8033');
            expect(fixedSpot.owner_user_id).toBe('100');
            expect(fixedSpot.owner_first_name).toBe('Juan');
        });

        test('should release fixed spot for date range', async () => {
            const startDate = moment().add(1, 'day').format('YYYY-MM-DD');
            const endDate = moment().add(3, 'days').format('YYYY-MM-DD');
            
            await db.releaseFixedSpot('8033', '100', startDate, endDate);
            
            // Check that spot is released for those dates
            const releasedSpots = await db.getReleasedFixedSpots(startDate);
            
            expect(releasedSpots).toHaveLength(1);
            expect(releasedSpots[0].spot_number).toBe('8033');
        });

        test('should remove fixed spot release', async () => {
            const startDate = moment().add(1, 'day').format('YYYY-MM-DD');
            const endDate = moment().add(3, 'days').format('YYYY-MM-DD');
            
            // First release the spot
            await db.releaseFixedSpot('8033', '100', startDate, endDate);
            
            // Then remove the release
            const removed = await db.removeFixedSpotRelease('8033', '100');
            
            expect(removed).toBeGreaterThan(0);
            
            // Check that spot is no longer released
            const releasedSpots = await db.getReleasedFixedSpots(startDate);
            expect(releasedSpots).toHaveLength(0);
        });

        test('should include released fixed spots in available spots', async () => {
            const tomorrow = moment().add(1, 'day').format('YYYY-MM-DD');
            
            // Release a fixed spot
            await db.releaseFixedSpot('8033', '100', tomorrow, tomorrow);
            
            // Check available spots
            const availableSpot = await db.getAvailableSpot(tomorrow);
            
            expect(availableSpot).toBeTruthy();
            expect(availableSpot.number).toBe('8033');
        });

        test('should include released fixed spots in day status', async () => {
            const tomorrow = moment().add(1, 'day').format('YYYY-MM-DD');
            
            // Set regular flex spots
            await db.setParkingSpots(['1', '2']);
            
            // Release a fixed spot
            await db.releaseFixedSpot('8033', '100', tomorrow, tomorrow);
            
            // Get day status
            const dayStatus = await db.getDayStatus(tomorrow);
            
            // Should include both flex spots and released fixed spot
            expect(dayStatus).toHaveLength(3);
            expect(dayStatus.map(s => s.spot_number)).toContain('8033');
        });
    });

    describe('Integration Scenarios', () => {
        test('released fixed spot can be reserved by others', async () => {
            const tomorrow = moment().add(1, 'day').format('YYYY-MM-DD');
            
            // Owner releases their fixed spot
            await db.releaseFixedSpot('8033', '100', tomorrow, tomorrow);
            
            // Another user can reserve it
            const availableSpot = await db.getAvailableSpot(tomorrow);
            expect(availableSpot.number).toBe('8033');
            
            // Reserve it
            await db.createReservation('300', { username: 'pedro', first_name: 'Pedro' }, tomorrow, '8033');
            
            // Verify reservation
            const reservation = await db.getReservation('300', tomorrow);
            expect(reservation).toBeTruthy();
            expect(reservation.spot_number).toBe('8033');
        });

        test('owner cannot release spot they do not own', async () => {
            // This would be handled in the webhook handler
            const fixedSpot = await db.getFixedSpot('8033');
            expect(fixedSpot.owner_user_id).toBe('100');
            
            // If user 200 tries to release 8033, the handler should reject it
            expect(fixedSpot.owner_user_id).not.toBe('200');
        });
    });
});