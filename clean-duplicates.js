#!/usr/bin/env node

const Database = require('./src/database');
const moment = require('moment-timezone');
require('dotenv').config();

async function cleanDuplicates() {
    const db = new Database();
    
    try {
        await db.init();
        console.log('🔍 Checking for users in both reservations and waitlist...\n');
        
        // Get all future dates
        const now = moment().tz('America/Montevideo').format('YYYY-MM-DD');
        
        // Find users who have both a reservation and are in waitlist for the same date
        const duplicates = await db.query(`
            SELECT 
                w.user_id,
                w.date,
                w.first_name,
                w.username,
                r.spot_number
            FROM waitlist w
            INNER JOIN reservations r ON w.user_id = r.user_id AND w.date = r.date
            WHERE w.date >= ?
            ORDER BY w.date, w.position
        `, [now]);
        
        if (!duplicates || duplicates.length === 0) {
            console.log('✅ No duplicates found. Database is clean.');
            return;
        }
        
        console.log(`⚠️  Found ${duplicates.length} duplicate entries:\n`);
        
        for (const dup of duplicates) {
            const date = moment(dup.date);
            const name = dup.first_name || dup.username || 'Unknown';
            console.log(`• ${date.format('dddd DD/MM')}: ${name} has spot ${dup.spot_number} but is also in waitlist`);
        }
        
        console.log('\n🧹 Cleaning duplicates...\n');
        
        // Remove from waitlist anyone who has a reservation
        for (const dup of duplicates) {
            await db.removeFromWaitlist(dup.user_id, dup.date);
            const name = dup.first_name || dup.username || 'Unknown';
            console.log(`✅ Removed ${name} from waitlist for ${moment(dup.date).format('dddd DD/MM')} (has spot ${dup.spot_number})`);
        }
        
        console.log('\n✅ Cleanup completed!');
        
        // Show summary
        console.log('\n📊 Summary after cleanup:');
        const remainingWaitlist = await db.query(`
            SELECT date, COUNT(*) as count 
            FROM waitlist 
            WHERE date >= ?
            GROUP BY date
            ORDER BY date
        `, [now]);
        
        if (remainingWaitlist && remainingWaitlist.length > 0) {
            console.log('\nRemaining waitlist by date:');
            for (const row of remainingWaitlist) {
                const date = moment(row.date);
                
                // Get the actual users in waitlist for this date
                const users = await db.getWaitlistForDate(row.date);
                console.log(`\n${date.format('dddd DD/MM')}:`);
                users.forEach((user, index) => {
                    const name = user.first_name || user.username || 'Unknown';
                    console.log(`  ${index + 1}. ${name}`);
                });
            }
        } else {
            console.log('No one currently on waitlist.');
        }
        
    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await db.close();
    }
}

// Add helper method to Database class for raw queries if not exists
if (!Database.prototype.query) {
    Database.prototype.query = function(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    };
}

// Run the cleanup
if (require.main === module) {
    console.log('🔧 WTC Parking - Clean Duplicates Tool\n');
    console.log('This tool will:');
    console.log('1. Find users who have a reservation AND are in waitlist for the same date');
    console.log('2. Remove them from the waitlist (keeping their reservation)\n');
    
    const readline = require('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    rl.question('Do you want to proceed? (yes/no): ', (answer) => {
        if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
            rl.close();
            cleanDuplicates().then(() => {
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

module.exports = { cleanDuplicates };