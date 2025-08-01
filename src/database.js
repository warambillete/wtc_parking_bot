const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class Database {
    constructor(dbPath = null) {
        if (dbPath) {
            // Use provided path (for tests)
            this.dbPath = dbPath;
            if (process.env.NODE_ENV !== 'test') {
                console.log('📁 Using provided database path:', dbPath);
            }
        } else {
            // Use Render's persistent disk at /var/data if available, otherwise local data directory
            const isPersistentDiskAvailable = fs.existsSync('/var/data');
            
            if (isPersistentDiskAvailable) {
                // Production: Use Render's persistent disk
                this.dbPath = '/var/data/parking.db';
                if (process.env.NODE_ENV !== 'test') {
                    console.log('📁 Using Render persistent disk at /var/data/parking.db');
                }
            } else {
                // Development: Use local data directory
                const dataDir = path.join(__dirname, '..', 'data');
                if (!fs.existsSync(dataDir)) {
                    fs.mkdirSync(dataDir, { recursive: true });
                }
                this.dbPath = path.join(dataDir, 'parking.db');
                if (process.env.NODE_ENV !== 'test') {
                    console.log('📁 Using local database at', this.dbPath);
                }
            }
        }
        
        this.db = new sqlite3.Database(this.dbPath);
    }
    
    init() {
        this.db.serialize(() => {
            // Tabla de espacios de estacionamiento
            this.db.run(`
                CREATE TABLE IF NOT EXISTS parking_spots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    number TEXT UNIQUE NOT NULL,
                    active BOOLEAN DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);
            
            // Tabla de reservas
            this.db.run(`
                CREATE TABLE IF NOT EXISTS reservations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    username TEXT,
                    first_name TEXT,
                    last_name TEXT,
                    date TEXT NOT NULL,
                    spot_number TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(user_id, date),
                    UNIQUE(date, spot_number)
                )
            `);
            
            // Tabla de lista de espera
            this.db.run(`
                CREATE TABLE IF NOT EXISTS waitlist (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    username TEXT,
                    first_name TEXT,
                    last_name TEXT,
                    date TEXT NOT NULL,
                    position INTEGER,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(user_id, date)
                )
            `);
            
            // Migrate fixed_spots table if needed
            this.migrateFixedSpotsTable();
            
            // Migrate fixed_spot_releases table if needed
            this.migrateFixedSpotReleasesTable();
            
            // Índices para mejor rendimiento
            this.db.run(`CREATE INDEX IF NOT EXISTS idx_reservations_date ON reservations(date)`);
            this.db.run(`CREATE INDEX IF NOT EXISTS idx_reservations_user ON reservations(user_id)`);
            this.db.run(`CREATE INDEX IF NOT EXISTS idx_waitlist_date ON waitlist(date)`);
            this.db.run(`CREATE INDEX IF NOT EXISTS idx_waitlist_position ON waitlist(date, position)`);
            this.db.run(`CREATE INDEX IF NOT EXISTS idx_fixed_releases_spot ON fixed_spot_releases(spot_number)`);
            this.db.run(`CREATE INDEX IF NOT EXISTS idx_fixed_releases_dates ON fixed_spot_releases(start_date, end_date)`);
        });
        
        if (process.env.NODE_ENV !== 'test') {
            console.log('✅ Base de datos inicializada');
        }
    }
    
    migrateFixedSpotsTable() {
        // Skip migration in test environment - just create new table
        if (process.env.NODE_ENV === 'test') {
            this.db.run(`
                CREATE TABLE IF NOT EXISTS fixed_spots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    spot_number TEXT UNIQUE NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);
            return;
        }
        
        // Check if old fixed_spots table exists and has old structure
        this.db.get("PRAGMA table_info(fixed_spots)", (err, result) => {
            if (err) {
                console.log('🔄 Creating new fixed_spots table...');
                // Table doesn't exist, create new one
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS fixed_spots (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        spot_number TEXT UNIQUE NOT NULL,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `);
                return;
            }
            
            // Check if table has old structure (owner_user_id column)
            this.db.all("PRAGMA table_info(fixed_spots)", (err, columns) => {
                if (err) return;
                
                const hasOwnerColumn = columns.some(col => col.name === 'owner_user_id');
                
                if (hasOwnerColumn) {
                    console.log('🔄 Migrating fixed_spots table to new structure...');
                    
                    // Backup existing data
                    this.db.all("SELECT spot_number FROM fixed_spots", (err, existingData) => {
                        if (err) {
                            console.error('Error reading existing fixed spots:', err);
                            return;
                        }
                        
                        // Drop old table and create new one
                        this.db.serialize(() => {
                            this.db.run("DROP TABLE IF EXISTS fixed_spots");
                            this.db.run(`
                                CREATE TABLE fixed_spots (
                                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                                    spot_number TEXT UNIQUE NOT NULL,
                                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                                )
                            `);
                            
                            // Restore data (only spot numbers)
                            if (existingData && existingData.length > 0) {
                                const stmt = this.db.prepare('INSERT INTO fixed_spots (spot_number) VALUES (?)');
                                existingData.forEach(row => {
                                    stmt.run(row.spot_number);
                                });
                                stmt.finalize();
                                console.log(`✅ Migrated ${existingData.length} fixed spots to new structure`);
                            }
                        });
                    });
                } else {
                    // Table already has correct structure
                    console.log('✅ Fixed spots table already has correct structure');
                }
            });
        });
    }
    
    migrateFixedSpotReleasesTable() {
        // Skip migration in test environment - just create new table
        if (process.env.NODE_ENV === 'test') {
            this.db.run(`
                CREATE TABLE IF NOT EXISTS fixed_spot_releases (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    spot_number TEXT NOT NULL,
                    start_date TEXT NOT NULL,
                    end_date TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (spot_number) REFERENCES fixed_spots(spot_number)
                )
            `);
            return;
        }
        
        // Check if fixed_spot_releases table exists and has old structure
        this.db.get("PRAGMA table_info(fixed_spot_releases)", (err, result) => {
            if (err) {
                console.log('🔄 Creating new fixed_spot_releases table...');
                // Table doesn't exist, create new one
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS fixed_spot_releases (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        spot_number TEXT NOT NULL,
                        start_date TEXT NOT NULL,
                        end_date TEXT NOT NULL,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (spot_number) REFERENCES fixed_spots(spot_number)
                    )
                `);
                return;
            }
            
            // Check if table has old structure (owner_user_id column)
            this.db.all("PRAGMA table_info(fixed_spot_releases)", (err, columns) => {
                if (err) return;
                
                const hasOwnerColumn = columns.some(col => col.name === 'owner_user_id');
                
                if (hasOwnerColumn) {
                    console.log('🔄 Migrating fixed_spot_releases table to new structure...');
                    
                    // Backup existing data (excluding owner_user_id)
                    this.db.all("SELECT spot_number, start_date, end_date FROM fixed_spot_releases", (err, existingData) => {
                        if (err) {
                            console.error('Error reading existing fixed spot releases:', err);
                            return;
                        }
                        
                        // Drop old table and create new one
                        this.db.serialize(() => {
                            this.db.run("DROP TABLE IF EXISTS fixed_spot_releases");
                            this.db.run(`
                                CREATE TABLE fixed_spot_releases (
                                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                                    spot_number TEXT NOT NULL,
                                    start_date TEXT NOT NULL,
                                    end_date TEXT NOT NULL,
                                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                                    FOREIGN KEY (spot_number) REFERENCES fixed_spots(spot_number)
                                )
                            `);
                            
                            // Restore data (without owner_user_id)
                            if (existingData && existingData.length > 0) {
                                const stmt = this.db.prepare('INSERT INTO fixed_spot_releases (spot_number, start_date, end_date) VALUES (?, ?, ?)');
                                existingData.forEach(row => {
                                    stmt.run(row.spot_number, row.start_date, row.end_date);
                                });
                                stmt.finalize();
                                console.log(`✅ Migrated ${existingData.length} fixed spot releases to new structure`);
                            }
                        });
                    });
                } else {
                    // Table already has correct structure
                    console.log('✅ Fixed spot releases table already has correct structure');
                }
            });
        });
    }
    
    // Métodos para espacios de estacionamiento
    async setParkingSpots(spotNumbers) {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.db.run('DELETE FROM parking_spots');
                
                const stmt = this.db.prepare('INSERT INTO parking_spots (number) VALUES (?)');
                spotNumbers.forEach(number => {
                    stmt.run(number);
                });
                stmt.finalize(resolve);
            });
        });
    }
    
    async getParkingSpots() {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT * FROM parking_spots WHERE active = 1 ORDER BY number',
                [],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });
    }
    
    // Métodos para reservas
    async createReservation(userId, user, date, spotNumber) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO reservations (user_id, username, first_name, last_name, date, spot_number) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [userId, user.username, user.first_name, user.last_name, date, spotNumber],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
    }
    
    async getReservation(userId, date) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM reservations WHERE user_id = ? AND date = ?',
                [userId, date],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });
    }
    
    async deleteReservation(userId, date) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'DELETE FROM reservations WHERE user_id = ? AND date = ?',
                [userId, date],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });
    }
    
    async getUserReservations(userId) {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT * FROM reservations WHERE user_id = ? ORDER BY date',
                [userId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });
    }
    
    async getDayReservations(date) {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT * FROM reservations WHERE date = ? ORDER BY spot_number',
                [date],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });
    }
    
    async getAvailableSpot(date) {
        return new Promise(async (resolve, reject) => {
            try {
                // First check regular flex spots
                const flexSpot = await new Promise((res, rej) => {
                    this.db.get(
                        `SELECT ps.number 
                         FROM parking_spots ps 
                         LEFT JOIN reservations r ON ps.number = r.spot_number AND r.date = ?
                         WHERE ps.active = 1 AND r.id IS NULL 
                         ORDER BY ps.number 
                         LIMIT 1`,
                        [date],
                        (err, row) => err ? rej(err) : res(row)
                    );
                });
                
                if (flexSpot) {
                    resolve(flexSpot);
                    return;
                }
                
                // If no flex spots available, check released fixed spots
                const releasedSpots = await this.getReleasedFixedSpots(date);
                
                for (const released of releasedSpots) {
                    const isReserved = await new Promise((res, rej) => {
                        this.db.get(
                            'SELECT id FROM reservations WHERE spot_number = ? AND date = ?',
                            [released.spot_number, date],
                            (err, row) => err ? rej(err) : res(row)
                        );
                    });
                    
                    if (!isReserved) {
                        resolve({ number: released.spot_number });
                        return;
                    }
                }
                
                // No spots available
                resolve(null);
            } catch (error) {
                reject(error);
            }
        });
    }
    
    async getDayStatus(date) {
        return new Promise(async (resolve, reject) => {
            try {
                // Get regular flex spots
                const flexSpots = await new Promise((res, rej) => {
                    this.db.all(
                        `SELECT ps.number as spot_number, 
                                CASE WHEN r.id IS NOT NULL THEN 1 ELSE 0 END as reserved,
                                r.username, r.first_name, r.last_name
                         FROM parking_spots ps 
                         LEFT JOIN reservations r ON ps.number = r.spot_number AND r.date = ?
                         WHERE ps.active = 1 
                         ORDER BY ps.number`,
                        [date],
                        (err, rows) => err ? rej(err) : res(rows)
                    );
                });
                
                // Get temporarily released fixed spots
                const releasedSpots = await this.getReleasedFixedSpots(date);
                
                // Add released fixed spots to the list
                for (const released of releasedSpots) {
                    const spotReservation = await new Promise((res, rej) => {
                        this.db.get(
                            `SELECT r.username, r.first_name, r.last_name
                             FROM reservations r
                             WHERE r.spot_number = ? AND r.date = ?`,
                            [released.spot_number, date],
                            (err, row) => err ? rej(err) : res(row)
                        );
                    });
                    
                    flexSpots.push({
                        spot_number: released.spot_number,
                        reserved: spotReservation ? 1 : 0,
                        username: spotReservation?.username || null,
                        first_name: spotReservation?.first_name || null,
                        last_name: spotReservation?.last_name || null
                    });
                }
                
                resolve(flexSpots);
            } catch (error) {
                reject(error);
            }
        });
    }
    
    // Métodos para lista de espera
    async addToWaitlist(userId, user, date) {
        return new Promise((resolve, reject) => {
            // Primero obtener la siguiente posición
            this.db.get(
                'SELECT COALESCE(MAX(position), 0) + 1 as next_position FROM waitlist WHERE date = ?',
                [date],
                (err, result) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    
                    const position = result.next_position;
                    this.db.run(
                        `INSERT INTO waitlist (user_id, username, first_name, last_name, date, position) 
                         VALUES (?, ?, ?, ?, ?, ?)`,
                        [userId, user.username, user.first_name, user.last_name, date, position],
                        function(err) {
                            if (err) reject(err);
                            else resolve(this.lastID);
                        }
                    );
                }
            );
        });
    }
    
    async getNextInWaitlist(date) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM waitlist WHERE date = ? ORDER BY position LIMIT 1',
                [date],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });
    }
    
    async getWaitlistUser(userId, date) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM waitlist WHERE user_id = ? AND date = ?',
                [userId, date],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });
    }
    
    async removeFromWaitlist(userId, date) {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                // Obtener la posición del usuario que se va a eliminar
                this.db.get(
                    'SELECT position FROM waitlist WHERE user_id = ? AND date = ?',
                    [userId, date],
                    (err, result) => {
                        if (err) {
                            reject(err);
                            return;
                        }
                        
                        if (!result) {
                            resolve(0);
                            return;
                        }
                        
                        const removedPosition = result.position;
                        
                        // Eliminar al usuario
                        this.db.run(
                            'DELETE FROM waitlist WHERE user_id = ? AND date = ?',
                            [userId, date],
                            (err) => {
                                if (err) {
                                    reject(err);
                                    return;
                                }
                                
                                // Actualizar posiciones de los usuarios posteriores
                                this.db.run(
                                    'UPDATE waitlist SET position = position - 1 WHERE date = ? AND position > ?',
                                    [date, removedPosition],
                                    function(err) {
                                        if (err) reject(err);
                                        else resolve(this.changes);
                                    }
                                );
                            }
                        );
                    }
                );
            });
        });
    }
    
    async getWaitlistCount(date) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT COUNT(*) as count FROM waitlist WHERE date = ?',
                [date],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row ? row.count : 0);
                }
            );
        });
    }
    
    async clearAllReservations() {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.db.run('DELETE FROM reservations', (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    
                    this.db.run('DELETE FROM waitlist', (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
            });
        });
    }
    
    async cleanupExpiredReservations() {
        const moment = require('moment-timezone');
        const yesterday = moment().tz('America/Montevideo').subtract(1, 'day').format('YYYY-MM-DD');
        
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                // Clear expired reservations
                this.db.run('DELETE FROM reservations WHERE date < ?', [yesterday], (err) => {
                    if (err) {
                        console.error('Error clearing expired reservations:', err);
                        reject(err);
                        return;
                    }
                    
                    // Clear expired waitlist entries
                    this.db.run('DELETE FROM waitlist WHERE date < ?', [yesterday], (err) => {
                        if (err) {
                            console.error('Error clearing expired waitlist:', err);
                            reject(err);
                        } else {
                            console.log(`🧹 Cleanup completed: removed reservations and waitlist entries before ${yesterday}`);
                            resolve();
                        }
                    });
                });
            });
        });
    }

    async resetCurrentWeekReservations() {
        const moment = require('moment-timezone');
        const now = moment().tz('America/Montevideo');
        
        // Calculate current work week (Monday to Friday based on the Friday reset cycle)
        const weekStart = now.clone().day(1); // Monday of current week
        const weekEnd = now.clone().day(5);   // Friday of current week
        
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                // Clear all reservations for current work week (Monday-Friday)
                this.db.run(
                    'DELETE FROM reservations WHERE date >= ? AND date <= ?', 
                    [weekStart.format('YYYY-MM-DD'), weekEnd.format('YYYY-MM-DD')], 
                    function(err) {
                        if (err) {
                            console.error('Error clearing current week reservations:', err);
                            reject(err);
                            return;
                        }
                        
                        const reservationsCleared = this.changes;
                        
                        // Clear all waitlist entries for current work week
                        this.db.run(
                            'DELETE FROM waitlist WHERE date >= ? AND date <= ?', 
                            [weekStart.format('YYYY-MM-DD'), weekEnd.format('YYYY-MM-DD')], 
                            function(err) {
                                if (err) {
                                    console.error('Error clearing current week waitlist:', err);
                                    reject(err);
                                } else {
                                    const waitlistCleared = this.changes;
                                    console.log(`🔄 Friday 5PM Reset: Cleared ${reservationsCleared} reservations and ${waitlistCleared} waitlist entries for week ${weekStart.format('DD/MM')} - ${weekEnd.format('DD/MM')}`);
                                    resolve({ reservationsCleared, waitlistCleared });
                                }
                            }
                        );
                    }
                );
            });
        });
    }
    
    async getSystemStats() {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                const stats = {};
                
                this.db.get('SELECT COUNT(*) as count FROM parking_spots WHERE active = 1', [], (err, result) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    stats.totalSpots = result.count;
                    
                    this.db.get('SELECT COUNT(*) as count FROM reservations', [], (err, result) => {
                        if (err) {
                            reject(err);
                            return;
                        }
                        stats.totalReservations = result.count;
                        
                        this.db.get('SELECT COUNT(*) as count FROM waitlist', [], (err, result) => {
                            if (err) reject(err);
                            else {
                                stats.totalWaitlist = result.count;
                                resolve(stats);
                            }
                        });
                    });
                });
            });
        });
    }
    
    // Backup methods
    getAllParkingSpots() {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT * FROM parking_spots WHERE active = 1', [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }
    
    getAllReservations() {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT * FROM reservations ORDER BY date, spot_number', [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }
    
    getAllWaitlist() {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT * FROM waitlist ORDER BY date, position', [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }

    // Fixed spots methods
    async setFixedSpotNumbers(spotNumbers) {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                // Clear existing fixed spots
                this.db.run('DELETE FROM fixed_spots', (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    
                    const stmt = this.db.prepare('INSERT INTO fixed_spots (spot_number) VALUES (?)');
                    
                    spotNumbers.forEach(number => {
                        stmt.run(number);
                    });
                    
                    stmt.finalize(() => {
                        resolve();
                    });
                });
            });
        });
    }
    
    async isFixedSpot(spotNumber) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT spot_number FROM fixed_spots WHERE spot_number = ?',
                [spotNumber],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(!!row);
                }
            );
        });
    }
    
    async getFixedSpots() {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT spot_number FROM fixed_spots ORDER BY spot_number',
                [],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }
    
    async getFixedSpot(spotNumber) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM fixed_spots WHERE spot_number = ?',
                [spotNumber],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });
    }
    
    async releaseFixedSpot(spotNumber, startDate, endDate) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO fixed_spot_releases (spot_number, start_date, end_date) 
                 VALUES (?, ?, ?)`,
                [spotNumber, startDate, endDate],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
    }
    
    async removeFixedSpotRelease(spotNumber) {
        const moment = require('moment-timezone');
        return new Promise((resolve, reject) => {
            const now = moment().tz('America/Montevideo').format('YYYY-MM-DD');
            this.db.run(
                'DELETE FROM fixed_spot_releases WHERE spot_number = ? AND end_date >= ?',
                [spotNumber, now],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });
    }
    
    async getReleasedFixedSpots(date) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT DISTINCT spot_number FROM fixed_spot_releases 
                 WHERE ? BETWEEN start_date AND end_date`,
                [date],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }
    
    close() {
        this.db.close((err) => {
            if (err) {
                if (process.env.NODE_ENV !== 'test') {
                    console.error('Error cerrando la base de datos:', err);
                }
            } else {
                if (process.env.NODE_ENV !== 'test') {
                    console.log('Base de datos cerrada');
                }
            }
        });
    }
}

module.exports = Database;