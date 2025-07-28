const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class Database {
    constructor() {
        // Crear directorio data si no existe
        const dataDir = path.join(__dirname, '..', 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        
        this.dbPath = path.join(dataDir, 'parking.db');
        this.db = new sqlite3.Database(this.dbPath);
        this.init();
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
            
            // Índices para mejor rendimiento
            this.db.run(`CREATE INDEX IF NOT EXISTS idx_reservations_date ON reservations(date)`);
            this.db.run(`CREATE INDEX IF NOT EXISTS idx_reservations_user ON reservations(user_id)`);
            this.db.run(`CREATE INDEX IF NOT EXISTS idx_waitlist_date ON waitlist(date)`);
            this.db.run(`CREATE INDEX IF NOT EXISTS idx_waitlist_position ON waitlist(date, position)`);
        });
        
        console.log('✅ Base de datos inicializada');
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
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT ps.number 
                 FROM parking_spots ps 
                 LEFT JOIN reservations r ON ps.number = r.spot_number AND r.date = ?
                 WHERE ps.active = 1 AND r.id IS NULL 
                 ORDER BY ps.number 
                 LIMIT 1`,
                [date],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });
    }
    
    async getDayStatus(date) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT ps.number as spot_number, 
                        CASE WHEN r.id IS NOT NULL THEN 1 ELSE 0 END as reserved,
                        r.username, r.first_name, r.last_name
                 FROM parking_spots ps 
                 LEFT JOIN reservations r ON ps.number = r.spot_number AND r.date = ?
                 WHERE ps.active = 1 
                 ORDER BY ps.number`,
                [date],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
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
    
    close() {
        this.db.close((err) => {
            if (err) {
                console.error('Error cerrando la base de datos:', err);
            } else {
                console.log('Base de datos cerrada');
            }
        });
    }
}

module.exports = Database;