#!/usr/bin/env node

const Database = require('./src/database');
require('dotenv').config();

async function migrateDatabase() {
    const db = new Database();
    
    try {
        // Initialize the database (this creates basic tables)
        await db.init();
        
        console.log('🔧 Checking database schema...\n');
        
        // Check if fixed_spot_releases table exists
        const tableExists = await new Promise((resolve, reject) => {
            db.db.get(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='fixed_spot_releases'",
                (err, row) => {
                    if (err) reject(err);
                    else resolve(!!row);
                }
            );
        });
        
        if (!tableExists) {
            console.log('📦 Creating fixed_spot_releases table...');
            
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
            
            console.log('✅ Table fixed_spot_releases created successfully');
        } else {
            console.log('✅ Table fixed_spot_releases already exists');
        }
        
        // Check if fixed_spots table exists
        const fixedSpotsExists = await new Promise((resolve, reject) => {
            db.db.get(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='fixed_spots'",
                (err, row) => {
                    if (err) reject(err);
                    else resolve(!!row);
                }
            );
        });
        
        if (!fixedSpotsExists) {
            console.log('📦 Creating fixed_spots table...');
            
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
            
            console.log('✅ Table fixed_spots created successfully');
        } else {
            console.log('✅ Table fixed_spots already exists');
        }
        
        console.log('\n✅ Database migration completed successfully!');
        console.log('\nYou can now run:');
        console.log('  node clean-duplicates.js');
        
    } catch (error) {
        console.error('❌ Migration error:', error);
        process.exit(1);
    } finally {
        await db.close();
    }
}

// Run the migration
if (require.main === module) {
    console.log('🔄 WTC Parking - Database Migration\n');
    console.log('This will add any missing tables to your database.\n');
    
    migrateDatabase().then(() => {
        process.exit(0);
    }).catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = { migrateDatabase };