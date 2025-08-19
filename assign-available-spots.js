#!/usr/bin/env node

const Database = require('./src/database');
const QueueManager = require('./src/queueManager');
const moment = require('moment-timezone');
require('dotenv').config();

// Mock bot for notifications
const mockBot = {
    sendMessage: async (userId, message) => {
        console.log(`📨 Notification sent to user ${userId}: ${message}`);
        return true;
    }
};

async function assignAvailableSpots() {
    const db = new Database();
    const queueManager = new QueueManager(db, mockBot);
    
    try {
        await db.init();
        console.log('🔄 Checking for available spots to assign to waitlist...\n');
        
        const now = moment().tz('America/Montevideo');
        const futureDate = now.clone().add(7, 'days'); // Check next week
        
        let totalAssignments = 0;
        const assignmentResults = [];
        
        for (let currentDate = now.clone(); currentDate.isBefore(futureDate, 'day'); currentDate.add(1, 'day')) {
            // Skip weekends
            if (currentDate.day() === 0 || currentDate.day() === 6) continue;
            
            const dateStr = currentDate.format('YYYY-MM-DD');
            const dayName = currentDate.format('dddd DD/MM');
            
            // Check if there are people waiting
            const waitlistUsers = await db.getWaitlistForDate(dateStr);
            if (waitlistUsers.length === 0) continue;
            
            console.log(`📅 ${dayName} - ${waitlistUsers.length} people waiting`);
            
            // Check for available spots
            const availableSpot = await db.getAvailableSpot(dateStr);
            if (!availableSpot) {
                console.log(`   ❌ No available spots`);
                continue;
            }
            
            console.log(`   ✅ Available spot: ${availableSpot.number}`);
            
            // Assign to first person in waitlist
            const nextUser = waitlistUsers[0];
            const name = nextUser.first_name || nextUser.username || 'Unknown';
            
            try {
                await db.createReservation(nextUser.user_id, nextUser, dateStr, availableSpot.number);
                await db.removeFromWaitlist(nextUser.user_id, dateStr);
                
                console.log(`   🎉 Assigned spot ${availableSpot.number} to ${name}`);
                
                assignmentResults.push({
                    date: dayName,
                    spot: availableSpot.number,
                    user: name
                });
                
                totalAssignments++;
                
                // Send notification
                try {
                    await mockBot.sendMessage(nextUser.user_id, 
                        `🎉 ¡Buenas noticias! Se te ha asignado el estacionamiento ${availableSpot.number} para ${dayName}`);
                } catch (error) {
                    console.log(`   ⚠️ Could not send notification: ${error.message}`);
                }
                
            } catch (error) {
                console.log(`   ❌ Assignment failed: ${error.message}`);
            }
        }
        
        console.log(`\n📊 Assignment Summary:`);
        console.log(`Total assignments made: ${totalAssignments}`);
        
        if (assignmentResults.length > 0) {
            console.log(`\nAssignments made:`);
            assignmentResults.forEach(result => {
                console.log(`  • ${result.date}: Spot ${result.spot} → ${result.user}`);
            });
        }
        
        console.log('\n✅ Process completed!');
        
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

// Run the assignment
if (require.main === module) {
    console.log('🔧 WTC Parking - Assign Available Spots to Waitlist\n');
    console.log('This will check for available spots and assign them to people waiting.\n');
    
    const readline = require('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    rl.question('Do you want to proceed? (yes/no): ', (answer) => {
        if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
            rl.close();
            assignAvailableSpots().then(() => {
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

module.exports = { assignAvailableSpots };