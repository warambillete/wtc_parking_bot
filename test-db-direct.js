const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Open the local database
const dbPath = path.join(__dirname, 'data', 'parking.db');
const db = new sqlite3.Database(dbPath);

console.log('📂 Database:', dbPath);
console.log('');

// Helper function to run queries
function runQuery(query, params = []) {
    return new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

async function inspectDatabase() {
    try {
        // Show parking spots
        console.log('🚗 PARKING SPOTS:');
        const spots = await runQuery('SELECT * FROM parking_spots WHERE active = 1');
        console.table(spots);
        
        // Show reservations
        console.log('\n📅 RESERVATIONS:');
        const reservations = await runQuery('SELECT * FROM reservations ORDER BY date');
        console.table(reservations);
        
        // Show waitlist
        console.log('\n⏳ WAITLIST:');
        const waitlist = await runQuery('SELECT * FROM waitlist ORDER BY date, position');
        console.table(waitlist);
        
        // Add test data to waitlist
        console.log('\n➕ Want to add test data? Run:');
        console.log(`
// Add to waitlist
db.run(\`INSERT INTO waitlist (user_id, username, first_name, date, position) 
        VALUES (?, ?, ?, ?, ?)\`, 
        [123456, 'testuser', 'Test User', '2025-07-30', 1]);

// Add reservation
db.run(\`INSERT INTO reservations (user_id, username, first_name, date, spot_number) 
        VALUES (?, ?, ?, ?, ?)\`, 
        [789012, 'alice', 'Alice', '2025-07-30', '1']);
        `);
        
    } catch (error) {
        console.error('Error:', error);
    } finally {
        db.close();
    }
}

inspectDatabase();