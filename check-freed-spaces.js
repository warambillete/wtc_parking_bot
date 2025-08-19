#!/usr/bin/env node

const Database = require('./src/database');
const moment = require('moment-timezone');
require('dotenv').config();

async function checkFreedSpaces() {
    const db = new Database();
    
    try {
        await db.init();
        console.log('🔍 Analyzing freed fixed spaces status...\n');
        
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
        
        let totalUnassigned = 0;
        let totalWaitingAffected = 0;
        const issues = [];
        
        for (const release of releasedSpots) {
            const startDate = moment(release.start_date);
            const endDate = moment(release.end_date);
            const currentDate = startDate.clone();
            
            console.log(`\n📍 Checking space ${release.spot_number} (${startDate.format('DD/MM')} to ${endDate.format('DD/MM')})`);
            
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
                    console.log(`  ✅ ${currentDate.format('dddd DD/MM')}: Assigned to ${reservation[0].first_name || reservation[0].username}`);
                } else {
                    // Space is free, check waitlist
                    const waitlistUsers = await db.getWaitlistForDate(dateStr);
                    
                    if (waitlistUsers.length > 0) {
                        console.log(`  ❌ ${currentDate.format('dddd DD/MM')}: LIBRE with ${waitlistUsers.length} waiting!`);
                        waitlistUsers.forEach((user, index) => {
                            const name = user.first_name || user.username || 'Unknown';
                            console.log(`     ${index + 1}. ${name}`);
                        });
                        
                        totalUnassigned++;
                        totalWaitingAffected += waitlistUsers.length;
                        issues.push({
                            date: currentDate.format('dddd DD/MM'),
                            spot: release.spot_number,
                            waiting: waitlistUsers.length,
                            firstInLine: waitlistUsers[0].first_name || waitlistUsers[0].username
                        });
                    } else {
                        console.log(`  ⚪ ${currentDate.format('dddd DD/MM')}: Free (no waitlist)`);
                    }
                }
                
                currentDate.add(1, 'day');
            }
        }
        
        // Summary
        console.log('\n' + '='.repeat(60));
        console.log('📊 SUMMARY\n');
        
        if (totalUnassigned === 0) {
            console.log('✅ All freed spaces are properly assigned or have no waitlist.');
        } else {
            console.log(`⚠️  Found ${totalUnassigned} unassigned freed spaces`);
            console.log(`👥 Affecting ${totalWaitingAffected} people in waitlists\n`);
            
            console.log('Issues that need fixing:');
            issues.forEach(issue => {
                console.log(`  • ${issue.date}: Space ${issue.spot} is free`);
                console.log(`    → ${issue.waiting} waiting (first: ${issue.firstInLine})`);
            });
            
            console.log('\n💡 Run "node fix-freed-spaces.js" to fix these issues automatically.');
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

// Run the check
if (require.main === module) {
    console.log('🔧 WTC Parking - Check Freed Spaces Status\n');
    checkFreedSpaces().then(() => {
        process.exit(0);
    }).catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = { checkFreedSpaces };