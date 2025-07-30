const packageInfo = require('../../package.json');

describe('Version Command', () => {
    test('should have version 1.2.0', () => {
        expect(packageInfo.version).toBe('1.2.0');
    });
    
    test('should have correct package name', () => {
        expect(packageInfo.name).toBe('wtc-parking-bot');
    });
    
    test('version should be semantic', () => {
        const versionRegex = /^\d+\.\d+\.\d+$/;
        expect(packageInfo.version).toMatch(versionRegex);
    });
});