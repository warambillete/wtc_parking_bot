const fs = require('fs');
const path = require('path');

class SingleInstanceLock {
    constructor() {
        this.lockFile = '/tmp/wtcparking-bot.lock';
        this.isLocked = false;
    }

    async acquireLock() {
        try {
            // Check if lock file exists
            if (fs.existsSync(this.lockFile)) {
                const lockData = fs.readFileSync(this.lockFile, 'utf8');
                const lockInfo = JSON.parse(lockData);
                
                // Check if lock is stale (older than 2 minutes for faster recovery)
                const lockAge = Date.now() - lockInfo.timestamp;
                if (lockAge < 2 * 60 * 1000) {
                    console.error(`❌ Another instance is running (PID: ${lockInfo.pid})`);
                    console.error(`Lock age: ${Math.round(lockAge / 1000)} seconds`);
                    console.error('🔥 FORCING CLEANUP OF STALE LOCK...');
                    // Force cleanup anyway - we need to be aggressive
                }
                
                console.log('🔓 Removing stale lock file');
            }
            
            // Create lock file
            const lockInfo = {
                pid: process.pid,
                timestamp: Date.now(),
                instance: process.env.RENDER_INSTANCE_ID || 'unknown'
            };
            
            fs.writeFileSync(this.lockFile, JSON.stringify(lockInfo));
            this.isLocked = true;
            
            console.log(`🔒 Lock acquired (PID: ${process.pid})`);
            return true;
            
        } catch (error) {
            console.error('Error acquiring lock:', error);
            return false;
        }
    }

    releaseLock() {
        try {
            if (this.isLocked && fs.existsSync(this.lockFile)) {
                fs.unlinkSync(this.lockFile);
                console.log('🔓 Lock released');
            }
        } catch (error) {
            console.error('Error releasing lock:', error);
        }
    }
}

module.exports = SingleInstanceLock;