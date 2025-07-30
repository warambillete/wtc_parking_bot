const https = require('https');

class BotKiller {
    constructor(token) {
        this.token = token;
    }

    /**
     * Aggressively terminates all existing bot instances
     * by making conflicting API calls that force disconnection
     */
    async killAllInstances() {
        console.log('🔥 KILLING ALL BOT INSTANCES...');
        
        try {
            // Method 1: Delete webhook (if any)
            await this.makeApiCall('deleteWebhook');
            console.log('✅ Webhook deleted');
            
            // Method 2: Make multiple getUpdates calls to force conflicts
            // This will cause 409 errors for any existing polling instances
            const promises = [];
            for (let i = 0; i < 5; i++) {
                promises.push(this.makeApiCall('getUpdates', { timeout: 1 }));
            }
            
            // Wait a bit for conflicts to occur
            await Promise.allSettled(promises);
            console.log('✅ Sent conflict-inducing requests');
            
            // Method 3: Wait for existing instances to die
            await new Promise(resolve => setTimeout(resolve, 3000));
            console.log('✅ Waited for instance cleanup');
            
            // Method 4: Final verification
            const me = await this.makeApiCall('getMe');
            console.log(`✅ Bot ready: ${me.first_name} (@${me.username})`);
            
            return true;
            
        } catch (error) {
            console.error('❌ Error during bot cleanup:', error.message);
            // Continue anyway - some errors are expected during cleanup
            return true;
        }
    }

    makeApiCall(method, params = {}) {
        return new Promise((resolve, reject) => {
            const data = JSON.stringify(params);
            const options = {
                hostname: 'api.telegram.org',
                port: 443,
                path: `/bot${this.token}/${method}`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': data.length
                }
            };

            const req = https.request(options, (res) => {
                let responseData = '';
                res.on('data', (chunk) => responseData += chunk);
                res.on('end', () => {
                    try {
                        const response = JSON.parse(responseData);
                        if (response.ok) {
                            resolve(response.result);
                        } else {
                            reject(new Error(response.description || 'API call failed'));
                        }
                    } catch (e) {
                        reject(new Error('Invalid JSON response'));
                    }
                });
            });

            req.on('error', reject);
            req.write(data);
            req.end();
        });
    }
}

module.exports = BotKiller;