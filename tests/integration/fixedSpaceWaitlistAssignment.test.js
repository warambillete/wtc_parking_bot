const Database = require('../../src/database');
const QueueManager = require('../../src/queueManager');
const moment = require('moment-timezone');

describe('Fixed Space Release and Waitlist Assignment', () => {
    let db;
    let queueManager;
    let mockBot;
    
    beforeEach(async () => {
        db = new Database(':memory:');
        await db.init();
        
        // Mock bot for notifications
        mockBot = {
            sendMessage: jest.fn().mockResolvedValue(true)
        };
        
        queueManager = new QueueManager(db, mockBot);
        
        // Set up parking spots
        await db.setParkingSpots([1, 2, 3]);
        
        // Set up fixed spots
        await db.setFixedSpotNumbers(['222', '4122']);
    });
    
    afterEach(async () => {
        await db.close();
    });
    
    describe('Fixed Space Release with Waitlist', () => {
        test('should assign freed fixed space to person in waitlist', async () => {
            const tomorrow = moment().add(1, 'day');
            if (tomorrow.day() === 0) tomorrow.add(1, 'day'); // Skip Sunday
            if (tomorrow.day() === 6) tomorrow.add(2, 'days'); // Skip Saturday
            const tomorrowStr = tomorrow.format('YYYY-MM-DD');
            
            // Add user to waitlist
            const waitlistUser = {
                user_id: '100',
                first_name: 'Juan',
                last_name: 'Perez',
                username: 'juanperez'
            };
            await db.addToWaitlist(waitlistUser.user_id, waitlistUser, tomorrowStr);
            
            // Release fixed spot
            await db.releaseFixedSpot('222', tomorrowStr, tomorrowStr);
            
            // Call notifyWaitlist to assign the space
            const assigned = await queueManager.notifyWaitlist(tomorrow, '222');
            
            expect(assigned).toBe(true);
            
            // Verify user now has reservation
            const reservation = await db.getReservation(waitlistUser.user_id, tomorrowStr);
            expect(reservation).toBeTruthy();
            expect(reservation.spot_number).toBe('222');
            
            // Verify user was removed from waitlist
            const waitlistCount = await db.getWaitlistCount(tomorrowStr);
            expect(waitlistCount).toBe(0);
            
            // Verify notification was sent
            expect(mockBot.sendMessage).toHaveBeenCalledWith(
                waitlistUser.user_id,
                expect.stringContaining('222')
            );
        });
        
        test('should handle multiple people in waitlist', async () => {
            const tomorrow = moment().add(1, 'day');
            if (tomorrow.day() === 0) tomorrow.add(1, 'day');
            if (tomorrow.day() === 6) tomorrow.add(2, 'days');
            const tomorrowStr = tomorrow.format('YYYY-MM-DD');
            
            // Add multiple users to waitlist
            const users = [
                { user_id: '101', first_name: 'First', username: 'first' },
                { user_id: '102', first_name: 'Second', username: 'second' },
                { user_id: '103', first_name: 'Third', username: 'third' }
            ];
            
            for (const user of users) {
                await db.addToWaitlist(user.user_id, user, tomorrowStr);
            }
            
            // Release one fixed spot
            await db.releaseFixedSpot('222', tomorrowStr, tomorrowStr);
            
            // Assign to first in waitlist
            await queueManager.notifyWaitlist(tomorrow, '222');
            
            // Verify first user got the spot
            const reservation = await db.getReservation('101', tomorrowStr);
            expect(reservation).toBeTruthy();
            expect(reservation.spot_number).toBe('222');
            
            // Verify others are still in waitlist
            const waitlistCount = await db.getWaitlistCount(tomorrowStr);
            expect(waitlistCount).toBe(2);
            
            // Verify order is maintained
            const nextInLine = await db.getNextInWaitlist(tomorrowStr);
            expect(nextInLine.user_id).toBe('102');
        });
    });
    
    describe('Waitlist Display Format', () => {
        test('should return waitlist users with proper format', async () => {
            const tomorrow = moment().add(1, 'day');
            if (tomorrow.day() === 0) tomorrow.add(1, 'day');
            if (tomorrow.day() === 6) tomorrow.add(2, 'days');
            const tomorrowStr = tomorrow.format('YYYY-MM-DD');
            
            // Add users to waitlist
            await db.addToWaitlist('201', { first_name: 'Juan', last_name: 'Perez' }, tomorrowStr);
            await db.addToWaitlist('202', { first_name: 'Maria', last_name: 'Garcia' }, tomorrowStr);
            await db.addToWaitlist('203', { username: 'usuario3' }, tomorrowStr); // No first name
            
            // Get waitlist for date
            const waitlistUsers = await db.getWaitlistForDate(tomorrowStr);
            
            expect(waitlistUsers).toHaveLength(3);
            expect(waitlistUsers[0].first_name).toBe('Juan');
            expect(waitlistUsers[1].first_name).toBe('Maria');
            expect(waitlistUsers[2].username).toBe('usuario3');
            
            // Verify they're in order
            expect(waitlistUsers[0].position).toBe(1);
            expect(waitlistUsers[1].position).toBe(2);
            expect(waitlistUsers[2].position).toBe(3);
        });
    });
    
    describe('Reassignment Command', () => {
        test('should reassign all freed spaces to waitlist users', async () => {
            const tomorrow = moment().add(1, 'day');
            if (tomorrow.day() === 0) tomorrow.add(1, 'day');
            if (tomorrow.day() === 6) tomorrow.add(2, 'days');
            const dayAfter = tomorrow.clone().add(1, 'day');
            if (dayAfter.day() === 0) dayAfter.add(1, 'day');
            if (dayAfter.day() === 6) dayAfter.add(2, 'days');
            
            const tomorrowStr = tomorrow.format('YYYY-MM-DD');
            const dayAfterStr = dayAfter.format('YYYY-MM-DD');
            
            // Release fixed spots for multiple days
            await db.releaseFixedSpot('222', tomorrowStr, dayAfterStr);
            await db.releaseFixedSpot('4122', tomorrowStr, tomorrowStr);
            
            // Add users to waitlist for both days
            await db.addToWaitlist('301', { first_name: 'User1' }, tomorrowStr);
            await db.addToWaitlist('302', { first_name: 'User2' }, tomorrowStr);
            await db.addToWaitlist('303', { first_name: 'User3' }, dayAfterStr);
            
            // Simulate reassignment process
            const releasedSpots = await db.query(`
                SELECT DISTINCT fsr.spot_number, fsr.start_date, fsr.end_date
                FROM fixed_spot_releases fsr
                WHERE fsr.end_date >= date('now')
                ORDER BY fsr.start_date
            `);
            
            expect(releasedSpots.length).toBeGreaterThan(0);
            
            // Process reassignments
            for (const release of releasedSpots) {
                const startDate = moment(release.start_date);
                const endDate = moment(release.end_date);
                const currentDate = startDate.clone();
                
                while (currentDate.isSameOrBefore(endDate, 'day')) {
                    if (currentDate.day() !== 0 && currentDate.day() !== 6) {
                        const dateStr = currentDate.format('YYYY-MM-DD');
                        
                        // Check if spot is available
                        const reservation = await db.query(`
                            SELECT * FROM reservations 
                            WHERE date = ? AND spot_number = ?
                        `, [dateStr, release.spot_number]);
                        
                        if (!reservation || reservation.length === 0) {
                            await queueManager.notifyWaitlist(currentDate, release.spot_number);
                        }
                    }
                    currentDate.add(1, 'day');
                }
            }
            
            // Verify assignments
            const res1 = await db.getReservation('301', tomorrowStr);
            const res2 = await db.getReservation('302', tomorrowStr);
            const res3 = await db.getReservation('303', dayAfterStr);
            
            expect(res1).toBeTruthy();
            expect(res2).toBeTruthy();
            expect(res3).toBeTruthy();
            
            // Verify waitlists are empty
            expect(await db.getWaitlistCount(tomorrowStr)).toBe(0);
            expect(await db.getWaitlistCount(dayAfterStr)).toBe(0);
        });
    });
});