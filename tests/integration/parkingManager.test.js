const Database = require('../../src/database');
const ParkingManager = require('../../src/parkingManager');
const moment = require('moment-timezone');
const path = require('path');

describe('ParkingManager Integration Tests', () => {
    let db;
    let parkingManager;
    const testDbPath = path.join(__dirname, '..', 'test-parking.db');

    beforeEach(async () => {
        // Use in-memory database for tests
        db = new Database(':memory:');
        await db.init();
        parkingManager = new ParkingManager(db);
        
        // Set up test parking spots
        await parkingManager.setParkingSpots(['1', '2', '3']);
    });

    afterEach(() => {
        db.close();
    });

    describe('Reservation Flow', () => {
        test('should reserve a spot successfully', async () => {
            const userId = 123456;
            const user = { username: 'testuser', first_name: 'Test' };
            const date = moment().add(1, 'day');

            const result = await parkingManager.reserveSpot(userId, user, date);

            expect(result.success).toBe(true);
            expect(result.spotNumber).toBeDefined();
            expect(['1', '2', '3']).toContain(result.spotNumber);
        });

        test('should prevent double booking for same user and date', async () => {
            const userId = 123456;
            const user = { username: 'testuser', first_name: 'Test' };
            const date = moment().add(1, 'day');

            // First reservation
            await parkingManager.reserveSpot(userId, user, date);
            
            // Second attempt
            const result = await parkingManager.reserveSpot(userId, user, date);

            expect(result.success).toBe(false);
            expect(result.message).toContain('Ya tienes reservado');
        });

        test('should offer waitlist when all spots are taken', async () => {
            const date = moment().add(1, 'day');
            
            // Fill all spots
            await parkingManager.reserveSpot(111, { username: 'user1' }, date);
            await parkingManager.reserveSpot(222, { username: 'user2' }, date);
            await parkingManager.reserveSpot(333, { username: 'user3' }, date);

            // Fourth user should get waitlist option
            const result = await parkingManager.reserveSpot(444, { username: 'user4' }, date);

            expect(result.success).toBe(false);
            expect(result.waitlist).toBe(true);
        });
    });

    describe('Release Flow', () => {
        test('should release a spot successfully', async () => {
            const userId = 123456;
            const user = { username: 'testuser', first_name: 'Test' };
            const date = moment().add(1, 'day');

            // Reserve first
            await parkingManager.reserveSpot(userId, user, date);
            
            // Then release
            const result = await parkingManager.releaseSpot(userId, date);

            expect(result.success).toBe(true);
            expect(result.spotNumber).toBeDefined();
        });

        test('should fail to release non-existent reservation', async () => {
            const userId = 123456;
            const date = moment().add(1, 'day');

            const result = await parkingManager.releaseSpot(userId, date);

            expect(result.success).toBe(false);
            expect(result.message).toContain('No tienes reserva');
        });
    });

    describe('Waitlist Management', () => {
        test('should add user to waitlist', async () => {
            const userId = 123456;
            const user = { username: 'testuser', first_name: 'Test' };
            const date = moment().add(1, 'day');

            await parkingManager.addToWaitlist(userId, user, date);
            const nextInLine = await parkingManager.getNextInWaitlist(date);

            expect(nextInLine).toBeDefined();
            expect(nextInLine.user_id).toBe(userId.toString()); // Database stores as string
        });

        test('should maintain waitlist order', async () => {
            const date = moment().add(1, 'day');

            // Add multiple users to waitlist
            await parkingManager.addToWaitlist(111, { username: 'user1' }, date);
            await parkingManager.addToWaitlist(222, { username: 'user2' }, date);
            await parkingManager.addToWaitlist(333, { username: 'user3' }, date);

            // Check order
            const first = await parkingManager.getNextInWaitlist(date);
            expect(first.user_id).toBe('111'); // Database stores as string

            // Remove first
            await parkingManager.removeFromWaitlist(111, date);

            // Check next
            const second = await parkingManager.getNextInWaitlist(date);
            expect(second.user_id).toBe('222'); // Database stores as string
        });

        test('should assign spot from waitlist', async () => {
            const date = moment().add(1, 'day');
            const waitlistUser = { username: 'waituser', first_name: 'Wait' };

            // Add to waitlist
            await parkingManager.addToWaitlist(999, waitlistUser, date);

            // Assign spot
            const result = await parkingManager.assignWaitlistSpot(999, date, '1');

            expect(result).toBe(true);
            
            // Verify reservation was created
            const reservations = await parkingManager.getUserReservations(999);
            expect(reservations).toHaveLength(1);
            expect(reservations[0].spot_number).toBe('1');
        });
    });

    describe('Week Status', () => {
        test('should get correct week status', async () => {
            const now = moment().tz('America/Montevideo');
            const userId = 123456;
            const user = { username: 'testuser', first_name: 'Test' };

            // Get week status to see what dates are being shown
            const status = await parkingManager.getWeekStatus();
            const statusDates = Object.keys(status);
            
            // Find a valid weekday date from the status
            let firstDate;
            for (const dateStr of statusDates) {
                const testDate = moment(dateStr);
                const now = moment().tz('America/Montevideo');
                // Use a date that's today or future and not weekend
                if (testDate.isSameOrAfter(now, 'day') && testDate.day() !== 0 && testDate.day() !== 6) {
                    firstDate = testDate;
                    break;
                }
            }
            
            // If no valid date found, use tomorrow (ensure it's not weekend)
            if (!firstDate) {
                firstDate = moment().tz('America/Montevideo').add(1, 'day');
                if (firstDate.day() === 0) firstDate.add(1, 'day'); // Skip Sunday
                if (firstDate.day() === 6) firstDate.add(2, 'days'); // Skip Saturday
            }
            
            // Make a reservation for that date
            const reservationResult = await parkingManager.reserveSpot(userId, user, firstDate);
            expect(reservationResult.success).toBe(true);

            // Get week status again
            const updatedStatus = await parkingManager.getWeekStatus();
            const firstDateStr = firstDate.format('YYYY-MM-DD');

            expect(updatedStatus[firstDateStr]).toBeDefined();
            expect(updatedStatus[firstDateStr].length).toBe(3); // 3 total spots
            
            const reservedCount = updatedStatus[firstDateStr].filter(s => s.reserved).length;
            expect(reservedCount).toBe(1);
        });

        test('should only show Monday to Friday', async () => {
            const status = await parkingManager.getWeekStatus();
            const dates = Object.keys(status);

            dates.forEach(dateStr => {
                const day = moment(dateStr).day();
                expect(day).toBeGreaterThanOrEqual(1); // Monday
                expect(day).toBeLessThanOrEqual(5);    // Friday
            });
        });
    });

    describe('Multiple Reservations', () => {
        test('should handle multiple day reservations', async () => {
            const userId = 123456;
            const user = { username: 'testuser', first_name: 'Test' };
            const dates = [
                moment().add(1, 'day'),
                moment().add(2, 'days'),
                moment().add(3, 'days')
            ];

            const results = await parkingManager.reserveMultipleDays(userId, user, dates);

            const successful = results.filter(r => r.success);
            expect(successful.length).toBe(3);
        });
    });

    describe('Clear Operations', () => {
        test('should clear all reservations', async () => {
            // Add some reservations
            await parkingManager.reserveSpot(111, { username: 'user1' }, moment().add(1, 'day'));
            await parkingManager.reserveSpot(222, { username: 'user2' }, moment().add(2, 'days'));

            // Clear all
            await parkingManager.clearAllReservations();

            // Check status
            const stats = await parkingManager.getSystemStats();
            expect(stats.totalReservations).toBe(0);
        });

        test('should preserve reservations when setting new parking spots', async () => {
            // Add reservation
            await parkingManager.reserveSpot(111, { username: 'user1' }, moment().add(1, 'day'));

            // Set new spots (should NOT clear reservations anymore)
            await parkingManager.setParkingSpots(['A', 'B']);

            const stats = await parkingManager.getSystemStats();
            expect(stats.totalSpots).toBe(2);
            expect(stats.totalReservations).toBe(1); // Reservation should still exist
        });
    });
});