#!/usr/bin/env node

/**
 * Interactive Test Runner
 * Run specific test scenarios without Telegram
 */

const TelegramBotMock = require('./mocks/TelegramBotMock');
const Database = require('../src/database');
const ParkingManager = require('../src/parkingManager');
const MessageProcessor = require('../src/messageProcessor');
const moment = require('moment-timezone');

class TestRunner {
    constructor() {
        this.bot = new TelegramBotMock('test-token');
        this.db = new Database(':memory:');
        this.messageProcessor = new MessageProcessor();
    }

    async init() {
        await this.db.init();
        this.parkingManager = new ParkingManager(this.db);
        console.log('✅ Test environment initialized\n');
    }

    async cleanup() {
        this.db.close();
        console.log('\n✅ Test environment cleaned up');
    }

    // Test Scenarios
    async testBasicReservation() {
        console.log('🧪 TEST: Basic Reservation Flow');
        console.log('================================');
        
        // Setup parking spots
        await this.parkingManager.setParkingSpots(['1', '2', '3']);
        console.log('✓ Set up 3 parking spots');

        // User 1 reserves
        const user1 = { username: 'alice', first_name: 'Alice' };
        const tomorrow = moment().add(1, 'day');
        const result1 = await this.parkingManager.reserveSpot(111, user1, tomorrow);
        console.log(`✓ Alice reserves: ${result1.success ? 'Success - Spot ' + result1.spotNumber : 'Failed'}`);

        // User 2 reserves
        const user2 = { username: 'bob', first_name: 'Bob' };
        const result2 = await this.parkingManager.reserveSpot(222, user2, tomorrow);
        console.log(`✓ Bob reserves: ${result2.success ? 'Success - Spot ' + result2.spotNumber : 'Failed'}`);

        // Check status
        const status = await this.parkingManager.getWeekStatus();
        const tomorrowStatus = status[tomorrow.format('YYYY-MM-DD')];
        const available = tomorrowStatus.filter(s => !s.reserved).length;
        console.log(`✓ Available spots for tomorrow: ${available}/3`);
    }

    async testWaitlistFlow() {
        console.log('\n🧪 TEST: Waitlist Flow');
        console.log('=====================');
        
        // Setup only 2 spots
        await this.parkingManager.setParkingSpots(['1', '2']);
        console.log('✓ Set up 2 parking spots');

        const tomorrow = moment().add(1, 'day');

        // Fill all spots
        await this.parkingManager.reserveSpot(111, { first_name: 'Alice' }, tomorrow);
        await this.parkingManager.reserveSpot(222, { first_name: 'Bob' }, tomorrow);
        console.log('✓ Alice and Bob reserved all spots');

        // Third user should get waitlist
        const result3 = await this.parkingManager.reserveSpot(333, { first_name: 'Carlos' }, tomorrow);
        console.log(`✓ Carlos tries to reserve: ${result3.waitlist ? 'Offered waitlist' : 'Failed'}`);

        // Add Carlos to waitlist
        if (result3.waitlist) {
            await this.parkingManager.addToWaitlist(333, { first_name: 'Carlos' }, tomorrow);
            console.log('✓ Carlos added to waitlist');
        }

        // Check who's next in waitlist
        const nextInLine = await this.parkingManager.getNextInWaitlist(tomorrow);
        console.log(`✓ Next in waitlist: ${nextInLine ? nextInLine.first_name : 'None'}`);

        // Alice releases her spot
        const releaseResult = await this.parkingManager.releaseSpot(111, tomorrow);
        console.log(`✓ Alice releases spot ${releaseResult.spotNumber}`);

        // Check who should be notified
        const shouldNotify = await this.parkingManager.getNextInWaitlist(tomorrow);
        console.log(`✓ Should notify: ${shouldNotify ? shouldNotify.first_name : 'None'}`);
    }

    async testMessageProcessing() {
        console.log('\n🧪 TEST: Message Processing');
        console.log('==========================');
        
        const testMessages = [
            'voy el martes',
            'libero el miércoles',
            'reservo lunes y viernes',
            'voy toda la semana',
            'la próxima semana voy el jueves',
            'estado',
            'mis reservas'
        ];

        testMessages.forEach(msg => {
            const result = this.messageProcessor.processMessage(msg);
            console.log(`✓ "${msg}" → Type: ${result.type}`);
            if (result.date) {
                console.log(`  Date: ${result.date.format('dddd DD/MM')}`);
            }
            if (result.dates) {
                console.log(`  Dates: ${result.dates.map(d => d.format('dddd')).join(', ')}`);
            }
        });
    }

    async testQueueSystem() {
        console.log('\n🧪 TEST: Friday Queue System (17:00-17:15)');
        console.log('=========================================');
        
        const QueueManager = require('../src/queueManager');
        const queueManager = new QueueManager(this.db, this.bot);
        
        // Simulate Friday at 17:05
        const isFriday5PM = queueManager.isInQueuePeriod();
        console.log(`✓ Is queue period active now? ${isFriday5PM ? 'YES' : 'NO'}`);
        
        // Test next week detection
        const nextMonday = moment().add(1, 'week').day(1);
        const isNextWeek = queueManager.isNextWeekReservation(nextMonday);
        console.log(`✓ Is next Monday a next week reservation? ${isNextWeek ? 'YES' : 'NO'}`);
        
        if (!isFriday5PM) {
            console.log('  (Queue system only active Fridays 17:00-17:15)');
        }
    }

    async runAllTests() {
        await this.init();
        
        await this.testBasicReservation();
        await this.testWaitlistFlow();
        await this.testMessageProcessing();
        await this.testQueueSystem();
        
        await this.cleanup();
    }
}

// Run tests
const runner = new TestRunner();
runner.runAllTests().catch(console.error);