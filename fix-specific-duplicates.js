#!/usr/bin/env node

const Database = require('./src/database');
const moment = require('moment-timezone');
require('dotenv').config();

async function fixSpecificDuplicates() {
    const db = new Database();
    
    try {
        await db.init();
        console.log('🔍 Checking for specific duplicate issues...\n');
        
        // Get a specific date to check (like the Friday shown in the image)
        const targetDate = '2025-08-22'; // Friday from your screenshot
        
        console.log(`Checking ${targetDate} (viernes 22/08):\n`);
        
        // Get all reservations for this date
        const reservations = await db.query(`
            SELECT user_id, first_name, username, spot_number 
            FROM reservations 
            WHERE date = ?
            ORDER BY spot_number
        `, [targetDate]);
        
        console.log('📋 Reservations:');
        reservations.forEach(res => {
            const name = res.first_name || res.username || 'Unknown';
            console.log(`  • ${res.spot_number}: ${name}`);
        });
        
        // Get all waitlist entries for this date
        const waitlist = await db.query(`
            SELECT user_id, first_name, username, position 
            FROM waitlist 
            WHERE date = ?
            ORDER BY position
        `, [targetDate]);
        
        console.log('\n📝 Waitlist:');
        waitlist.forEach(wait => {
            const name = wait.first_name || wait.username || 'Unknown';
            console.log(`  • ?: ${name}`);
        });
        
        // Find duplicates
        const duplicates = [];
        for (const wait of waitlist) {
            const hasReservation = reservations.find(res => res.user_id === wait.user_id);
            if (hasReservation) {
                duplicates.push({
                    user_id: wait.user_id,
                    name: wait.first_name || wait.username || 'Unknown',
                    spot: hasReservation.spot_number
                });
            }
        }
        
        if (duplicates.length === 0) {
            console.log('\n✅ No duplicates found for this date.');
            return;
        }
        
        console.log(`\n⚠️ Found ${duplicates.length} duplicates:`);
        duplicates.forEach(dup => {
            console.log(`  • ${dup.name} has spot ${dup.spot} but is also in waitlist`);
        });
        
        const readline = require('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        const answer = await new Promise(resolve => {
            rl.question('\nRemove these users from waitlist? (yes/no): ', resolve);
        });
        
        rl.close();
        
        if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
            console.log('\n🧹 Removing duplicates...');
            
            for (const dup of duplicates) {
                await db.removeFromWaitlist(dup.user_id, targetDate);
                console.log(`  ✅ Removed ${dup.name} from waitlist (has spot ${dup.spot})`);
            }
            
            console.log('\n✅ Cleanup completed!');
            
            // Show final status
            const finalWaitlist = await db.query(`
                SELECT first_name, username 
                FROM waitlist 
                WHERE date = ?
                ORDER BY position
            `, [targetDate]);
            
            console.log(`\n📊 Final waitlist for ${targetDate}:`);
            if (finalWaitlist.length === 0) {
                console.log('  (empty)');
            } else {
                finalWaitlist.forEach(wait => {
                    const name = wait.first_name || wait.username || 'Unknown';
                    console.log(`  • ?: ${name}`);
                });
            }
        } else {
            console.log('Operation cancelled.');
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

// Run the fix
if (require.main === module) {
    console.log('🔧 WTC Parking - Fix Specific Duplicates\n');
    
    fixSpecificDuplicates().then(() => {
        process.exit(0);
    }).catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = { fixSpecificDuplicates };