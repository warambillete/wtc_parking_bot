const Database = require('./src/database');
const ParkingManager = require('./src/parkingManager');
const moment = require('moment-timezone');

async function testWaitlist() {
    console.log('🧪 Starting local waitlist test...\n');
    
    // Initialize database and manager
    const db = new Database();
    const parkingManager = new ParkingManager(db);
    
    // Test data
    const testUsers = [
        { userId: 111111, username: 'alice', first_name: 'Alice' },
        { userId: 222222, username: 'bob', first_name: 'Bob' },
        { userId: 333333, username: 'carlos', first_name: 'Carlos' }
    ];
    
    const testDate = moment().tz('America/Argentina/Buenos_Aires').add(1, 'day');
    console.log(`📅 Test date: ${testDate.format('dddd DD/MM/YYYY')}\n`);
    
    try {
        // Step 1: Set up parking spots
        console.log('1️⃣ Setting up 2 parking spots...');
        await parkingManager.setParkingSpots(['1', '2']);
        
        // Step 2: Fill all spots
        console.log('\n2️⃣ Alice and Bob reserve spots...');
        const res1 = await parkingManager.reserveSpot(testUsers[0].userId, testUsers[0], testDate);
        console.log(`   Alice: ${res1.success ? '✅ Got spot ' + res1.spotNumber : '❌ Failed'}`);
        
        const res2 = await parkingManager.reserveSpot(testUsers[1].userId, testUsers[1], testDate);
        console.log(`   Bob: ${res2.success ? '✅ Got spot ' + res2.spotNumber : '❌ Failed'}`);
        
        // Step 3: Third person tries to reserve (should get waitlist option)
        console.log('\n3️⃣ Carlos tries to reserve (spots full)...');
        const res3 = await parkingManager.reserveSpot(testUsers[2].userId, testUsers[2], testDate);
        console.log(`   Carlos: ${res3.waitlist ? '⏳ Offered waitlist' : '❌ No waitlist offered'}`);
        
        // Step 4: Add Carlos to waitlist
        if (res3.waitlist) {
            console.log('\n4️⃣ Adding Carlos to waitlist...');
            await parkingManager.addToWaitlist(testUsers[2].userId, testUsers[2], testDate);
            console.log('   ✅ Carlos added to waitlist');
        }
        
        // Step 5: Check waitlist
        console.log('\n5️⃣ Checking waitlist...');
        const nextInLine = await parkingManager.getNextInWaitlist(testDate);
        console.log(`   Next in waitlist: ${nextInLine ? nextInLine.first_name : 'None'}`);
        
        // Step 6: Alice releases her spot
        console.log('\n6️⃣ Alice releases her spot...');
        const release = await parkingManager.releaseSpot(testUsers[0].userId, testDate);
        console.log(`   Alice released spot: ${release.spotNumber}`);
        
        // Step 7: Check who should be notified
        console.log('\n7️⃣ Who gets notified?');
        const shouldNotify = await parkingManager.getNextInWaitlist(testDate);
        console.log(`   Should notify: ${shouldNotify ? shouldNotify.first_name + ' (userId: ' + shouldNotify.user_id + ')' : 'None'}`);
        
        // Step 8: Show final status
        console.log('\n8️⃣ Final status:');
        const status = await parkingManager.getWeekStatus();
        const dateStatus = status[testDate.format('YYYY-MM-DD')];
        console.log(`   Available spots: ${dateStatus.filter(s => !s.reserved).length}`);
        console.log(`   Reserved by: ${dateStatus.filter(s => s.reserved).map(s => s.first_name).join(', ')}`);
        
    } catch (error) {
        console.error('❌ Test error:', error);
    } finally {
        // Clean up
        db.close();
        console.log('\n✅ Test completed!');
    }
}

// Run the test
testWaitlist();