#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Database = require('./src/database');
const moment = require('moment-timezone');
require('dotenv').config();

async function backupAndMigrate() {
    // Use the same logic as Database class to find the actual database location
    
    let dbPath;
    if (fs.existsSync('/var/data')) {
        // Production: Use Render's persistent disk
        dbPath = '/var/data/parking.db';
    } else {
        // Development: Use local data directory
        const dataDir = path.join(__dirname, 'data');
        dbPath = path.join(dataDir, 'parking.db');
    }
    
    const backupDir = 'database-backups';
    
    try {
        // Create backup directory if it doesn't exist
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir);
        }
        
        // Create backup filename with timestamp
        const timestamp = moment().format('YYYY-MM-DD_HH-mm-ss');
        const backupPath = path.join(backupDir, `parking_backup_${timestamp}.db`);
        
        console.log('🔒 STEP 1: Creating backup of your database...');
        console.log(`   Source: ${dbPath}`);
        console.log(`   Backup: ${backupPath}`);
        
        // Check if database file exists
        if (fs.existsSync(dbPath)) {
            // Create backup
            fs.copyFileSync(dbPath, backupPath);
            console.log('✅ Backup created successfully!\n');
            
            // Verify backup
            const originalSize = fs.statSync(dbPath).size;
            const backupSize = fs.statSync(backupPath).size;
            
            if (originalSize === backupSize) {
                console.log(`✅ Backup verified (size: ${backupSize} bytes)\n`);
            } else {
                console.error('❌ Backup size mismatch! Aborting for safety.');
                process.exit(1);
            }
        } else {
            console.log('⚠️  No existing database found. Will create new one.\n');
        }
        
        console.log('📊 STEP 2: Checking current data...');
        
        const db = new Database();
        await db.init();
        
        // Count existing data (only from core tables that always exist)
        const counts = {};
        
        try {
            counts.reservations = await new Promise((resolve) => {
                db.db.get('SELECT COUNT(*) as count FROM reservations', (err, row) => {
                    resolve(row ? row.count : 0);
                });
            });
            
            counts.waitlist = await new Promise((resolve) => {
                db.db.get('SELECT COUNT(*) as count FROM waitlist', (err, row) => {
                    resolve(row ? row.count : 0);
                });
            });
            
            counts.parking_spots = await new Promise((resolve) => {
                db.db.get('SELECT COUNT(*) as count FROM parking_spots', (err, row) => {
                    resolve(row ? row.count : 0);
                });
            });
            
            console.log('   Current core data:');
            console.log(`   • Reservations: ${counts.reservations}`);
            console.log(`   • Waitlist entries: ${counts.waitlist}`);
            console.log(`   • Parking spots: ${counts.parking_spots}`);
            console.log('');
        } catch (error) {
            console.log('   Error reading existing data:', error.message);
            console.log('   Continuing with migration...\n');
            counts.reservations = 0;
            counts.waitlist = 0;
            counts.parking_spots = 0;
        }
        
        console.log('🔧 STEP 3: Adding missing tables (won\'t affect existing data)...\n');
        
        // Check and create fixed_spot_releases table
        const fixedReleasesExists = await new Promise((resolve) => {
            db.db.get(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='fixed_spot_releases'",
                (err, row) => resolve(!!row)
            );
        });
        
        if (!fixedReleasesExists) {
            console.log('   Creating fixed_spot_releases table...');
            await new Promise((resolve, reject) => {
                db.db.run(`
                    CREATE TABLE IF NOT EXISTS fixed_spot_releases (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        spot_number TEXT NOT NULL,
                        start_date TEXT NOT NULL,
                        end_date TEXT NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                `, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            console.log('   ✅ Table created');
        } else {
            console.log('   ✅ fixed_spot_releases table already exists');
        }
        
        // Check and create fixed_spots table
        const fixedSpotsExists = await new Promise((resolve) => {
            db.db.get(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='fixed_spots'",
                (err, row) => resolve(!!row)
            );
        });
        
        if (!fixedSpotsExists) {
            console.log('   Creating fixed_spots table...');
            await new Promise((resolve, reject) => {
                db.db.run(`
                    CREATE TABLE IF NOT EXISTS fixed_spots (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        spot_number TEXT UNIQUE NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                `, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            console.log('   ✅ Table created');
        } else {
            console.log('   ✅ fixed_spots table already exists');
        }
        
        console.log('\n📊 STEP 4: Verifying data integrity...');
        
        // Re-count to ensure data is intact
        const newCounts = {};
        
        newCounts.reservations = await new Promise((resolve) => {
            db.db.get('SELECT COUNT(*) as count FROM reservations', (err, row) => {
                resolve(row ? row.count : 0);
            });
        });
        
        newCounts.waitlist = await new Promise((resolve) => {
            db.db.get('SELECT COUNT(*) as count FROM waitlist', (err, row) => {
                resolve(row ? row.count : 0);
            });
        });
        
        newCounts.parking_spots = await new Promise((resolve) => {
            db.db.get('SELECT COUNT(*) as count FROM parking_spots', (err, row) => {
                resolve(row ? row.count : 0);
            });
        });
        
        console.log('   Data after migration:');
        console.log(`   • Reservations: ${newCounts.reservations} (was ${counts.reservations})`);
        console.log(`   • Waitlist entries: ${newCounts.waitlist} (was ${counts.waitlist})`);
        console.log(`   • Parking spots: ${newCounts.parking_spots} (was ${counts.parking_spots})`);
        
        // Verify no data was lost
        let dataIntact = true;
        if (counts.reservations && newCounts.reservations !== counts.reservations) {
            console.error('   ❌ Reservation count mismatch!');
            dataIntact = false;
        }
        if (counts.waitlist && newCounts.waitlist !== counts.waitlist) {
            console.error('   ❌ Waitlist count mismatch!');
            dataIntact = false;
        }
        if (counts.parking_spots && newCounts.parking_spots !== counts.parking_spots) {
            console.error('   ❌ Parking spots count mismatch!');
            dataIntact = false;
        }
        
        if (dataIntact) {
            console.log('\n✅ SUCCESS! Migration completed without data loss.');
            console.log(`\n💾 Your backup is saved at: ${backupPath}`);
            console.log('   Keep this backup until you\'re sure everything works correctly.');
            console.log('\n📝 You can now safely run:');
            console.log('   node clean-duplicates.js');
        } else {
            console.error('\n❌ DATA MISMATCH DETECTED!');
            console.error(`   Please restore from backup: ${backupPath}`);
            console.error(`   Command: cp ${backupPath} ${dbPath}`);
        }
        
        await db.close();
        
    } catch (error) {
        console.error('\n❌ Error during migration:', error);
        console.error('\nIf anything went wrong, restore your backup:');
        console.error(`   cp ${backupPath} ${dbPath}`);
        process.exit(1);
    }
}

// Run the migration
if (require.main === module) {
    console.log('🔐 WTC Parking - Safe Database Migration with Backup\n');
    console.log('This script will:');
    console.log('1. Create a backup of your database');
    console.log('2. Add missing tables (without touching existing data)');
    console.log('3. Verify all data remains intact\n');
    
    const readline = require('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    rl.question('Do you want to proceed? (yes/no): ', (answer) => {
        if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
            rl.close();
            backupAndMigrate().then(() => {
                process.exit(0);
            }).catch(error => {
                console.error('Fatal error:', error);
                process.exit(1);
            });
        } else {
            console.log('Operation cancelled. No changes made.');
            rl.close();
            process.exit(0);
        }
    });
}

module.exports = { backupAndMigrate };