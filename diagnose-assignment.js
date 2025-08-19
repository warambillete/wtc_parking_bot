#!/usr/bin/env node

const Database = require('./src/database');
const QueueManager = require('./src/queueManager');
const moment = require('moment-timezone');
require('dotenv').config();

async function diagnoseAssignment() {
    const db = new Database();
    
    try {
        await db.init();
        console.log('🔍 Diagnosing assignment issue for viernes 22/08...\n');
        
        const targetDate = '2025-08-22';
        const date = moment(targetDate);
        
        console.log('📊 Current Status:\n');
        
        // Get all parking spots
        const allSpots = await db.query('SELECT number FROM parking_spots ORDER BY number');
        console.log(`Total parking spots: ${allSpots.length}`);
        allSpots.forEach(spot => console.log(`  • ${spot.number}`));
        
        // Get reservations
        const reservations = await db.query(`
            SELECT user_id, first_name, username, spot_number 
            FROM reservations 
            WHERE date = ?
            ORDER BY spot_number
        `, [targetDate]);
        
        console.log(`\n📋 Reservations (${reservations.length}):`);
        reservations.forEach(res => {
            const name = res.first_name || res.username || 'Unknown';
            console.log(`  • ${res.spot_number}: ${name}`);
        });
        
        // Get waitlist
        const waitlist = await db.query(`
            SELECT user_id, first_name, username, position 
            FROM waitlist 
            WHERE date = ?
            ORDER BY position
        `, [targetDate]);
        
        console.log(`\n📝 Waitlist (${waitlist.length}):`);
        waitlist.forEach(wait => {
            const name = wait.first_name || wait.username || 'Unknown';
            console.log(`  • Position ${wait.position}: ${name}`);
        });
        
        // Check what getAvailableSpot returns
        console.log(`\n🔍 Testing getAvailableSpot for ${targetDate}:`);
        const availableSpot = await db.getAvailableSpot(targetDate);
        if (availableSpot) {
            console.log(`  ✅ Available spot found: ${availableSpot.number}`);
        } else {
            console.log(`  ❌ No available spot returned`);
        }
        
        // Check fixed spots
        console.log(`\n🔐 Checking fixed spots:`);
        const fixedSpots = await db.query('SELECT spot_number FROM fixed_spots');
        console.log(`Fixed spots configured: ${fixedSpots.length}`);
        fixedSpots.forEach(spot => console.log(`  • ${spot.spot_number}`));
        
        // Check released fixed spots for this date
        const releasedFixed = await db.query(`
            SELECT spot_number, start_date, end_date 
            FROM fixed_spot_releases 
            WHERE ? BETWEEN start_date AND end_date
        `, [targetDate]);
        
        console.log(`\n🔓 Released fixed spots for ${targetDate}: ${releasedFixed.length}`);
        releasedFixed.forEach(release => {
            console.log(`  • ${release.spot_number} (${release.start_date} to ${release.end_date})`);
        });
        
        // Test the assignment logic manually
        if (waitlist.length > 0 && availableSpot) {
            const nextUser = waitlist[0];
            const name = nextUser.first_name || nextUser.username || 'Unknown';
            
            console.log(`\n🎯 Assignment Test:`);
            console.log(`  Next in line: ${name}`);
            console.log(`  Available spot: ${availableSpot.number}`);
            
            const readline = require('readline');
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });
            
            const answer = await new Promise(resolve => {
                rl.question(`\nWould you like to manually assign spot ${availableSpot.number} to ${name}? (yes/no): `, resolve);
            });
            
            if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
                console.log(`\n🔄 Assigning spot ${availableSpot.number} to ${name}...`);
                
                try {
                    await db.createReservation(nextUser.user_id, nextUser, targetDate, availableSpot.number);
                    await db.removeFromWaitlist(nextUser.user_id, targetDate);
                    
                    console.log(`✅ Successfully assigned!`);
                    
                    // Show final status
                    const finalReservations = await db.query(`
                        SELECT spot_number, first_name, username 
                        FROM reservations 
                        WHERE date = ?
                        ORDER BY spot_number
                    `, [targetDate]);
                    
                    console.log(`\n📊 Updated reservations:`);
                    finalReservations.forEach(res => {
                        const name = res.first_name || res.username || 'Unknown';
                        console.log(`  • ${res.spot_number}: ${name}`);
                    });
                    
                } catch (error) {
                    console.error(`❌ Assignment failed:`, error.message);
                }
            }
            
            rl.close();
        } else if (waitlist.length === 0) {
            console.log(`\n✅ No one in waitlist - this is correct`);
        } else {
            console.log(`\n❌ People in waitlist but no available spot - this might be the issue`);
        }
        
    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await db.close();
    }
}

// Add helper method for raw queries
Database.prototype.query = function(sql, params = []) {
    return new Promise((resolve, reject) => {
        this.db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};

// Run the diagnosis
if (require.main === module) {
    console.log('🔧 WTC Parking - Assignment Diagnosis\n');
    
    diagnoseAssignment().then(() => {
        process.exit(0);
    }).catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = { diagnoseAssignment };