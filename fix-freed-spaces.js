#!/usr/bin/env node

const Database = require('./src/database');
const QueueManager = require('./src/queueManager');
const moment = require('moment-timezone');
require('dotenv').config();

// Mock bot for notifications
const mockBot = {
    sendMessage: async (userId, message) => {
        console.log(`📨 Would send to user ${userId}: ${message}`);
        return true;
    }
};

async function fixFreedSpaces() {
    const db = new Database();
    const queueManager = new QueueManager(db, mockBot);
    
    try {
        await db.init();
        console.log('🔍 Checking for freed fixed spaces that need reassignment...\n');
        
        // Get all released fixed spots
        const releasedSpots = await db.query(`
            SELECT DISTINCT fsr.spot_number, fsr.start_date, fsr.end_date
            FROM fixed_spot_releases fsr
            WHERE fsr.end_date >= date('now')
            ORDER BY fsr.start_date
        `);
        
        if (!releasedSpots || releasedSpots.length === 0) {
            console.log('✅ No freed fixed spaces found.');
            return;
        }
        
        console.log(`Found ${releasedSpots.length} freed fixed space records.\n`);
        
        for (const release of releasedSpots) {
            const startDate = moment(release.start_date);
            const endDate = moment(release.end_date);
            const currentDate = startDate.clone();
            
            console.log(`\n📍 Processing freed space ${release.spot_number} from ${startDate.format('DD/MM')} to ${endDate.format('DD/MM')}`);
            
            while (currentDate.isSameOrBefore(endDate, 'day')) {
                // Skip weekends and past dates
                const now = moment().tz('America/Montevideo').startOf('day');
                if (currentDate.day() === 0 || currentDate.day() === 6 || currentDate.isBefore(now, 'day')) {
                    currentDate.add(1, 'day');
                    continue;
                }
                
                const dateStr = currentDate.format('YYYY-MM-DD');
                
                // Check if this spot is actually available (not reserved)
                const reservation = await db.query(`
                    SELECT * FROM reservations 
                    WHERE date = ? AND spot_number = ?
                `, [dateStr, release.spot_number]);
                
                if (reservation && reservation.length > 0) {
                    console.log(`  ✓ ${currentDate.format('dddd DD/MM')}: Space ${release.spot_number} already assigned to ${reservation[0].first_name || reservation[0].username}`);
                } else {
                    // Space is free, check waitlist
                    const waitlistUsers = await db.getWaitlistForDate(dateStr);
                    
                    if (waitlistUsers.length > 0) {
                        const nextUser = waitlistUsers[0];
                        console.log(`  ⚠️ ${currentDate.format('dddd DD/MM')}: Space ${release.spot_number} is FREE with ${waitlistUsers.length} people waiting`);
                        console.log(`     First in queue: ${nextUser.first_name || nextUser.username}`);
                        
                        // Attempt to assign the space
                        try {
                            await db.createReservation(
                                nextUser.user_id, 
                                nextUser, 
                                dateStr, 
                                release.spot_number
                            );
                            await db.removeFromWaitlist(nextUser.user_id, dateStr);
                            
                            console.log(`     ✅ FIXED: Assigned space ${release.spot_number} to ${nextUser.first_name || nextUser.username}`);
                            
                            // Send notification
                            try {
                                await mockBot.sendMessage(nextUser.user_id, 
                                    `🎉 ¡Buenas noticias! Se te ha asignado el estacionamiento ${release.spot_number} para ${currentDate.format('dddd DD/MM')} (reasignación automática)`);
                            } catch (error) {
                                console.log(`     ⚠️ Could not send notification: ${error.message}`);
                            }
                        } catch (error) {
                            console.log(`     ❌ ERROR: Could not assign space: ${error.message}`);
                        }
                    } else {
                        console.log(`  ✓ ${currentDate.format('dddd DD/MM')}: Space ${release.spot_number} is free (no one waiting)`);
                    }
                }
                
                currentDate.add(1, 'day');
            }
        }
        
        console.log('\n✅ Cleanup process completed!');
        
        // Show summary
        console.log('\n📊 Summary:');
        const totalWaitlist = await db.query(`
            SELECT date, COUNT(*) as count 
            FROM waitlist 
            WHERE date >= date('now')
            GROUP BY date
            ORDER BY date
        `);
        
        if (totalWaitlist && totalWaitlist.length > 0) {
            console.log('\nRemaining waitlist by date:');
            totalWaitlist.forEach(row => {
                const date = moment(row.date);
                console.log(`  ${date.format('dddd DD/MM')}: ${row.count} people waiting`);
            });
        } else {
            console.log('No one currently on waitlist.');
        }
        
    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await db.close();
    }
}

// Add helper method to Database class for raw queries
Database.prototype.query = function(sql, params = []) {
    return new Promise((resolve, reject) => {
        this.db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};

// Run the fix
if (require.main === module) {
    console.log('🔧 WTC Parking - Fix Freed Spaces Tool\n');
    console.log('This tool will:');
    console.log('1. Find all freed fixed spaces');
    console.log('2. Check if they have been assigned');
    console.log('3. Assign them to people in waitlist if available\n');
    
    const readline = require('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    rl.question('Do you want to proceed? (yes/no): ', (answer) => {
        if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
            rl.close();
            fixFreedSpaces().then(() => {
                process.exit(0);
            }).catch(error => {
                console.error('Fatal error:', error);
                process.exit(1);
            });
        } else {
            console.log('Operation cancelled.');
            rl.close();
            process.exit(0);
        }
    });
}

module.exports = { fixFreedSpaces };