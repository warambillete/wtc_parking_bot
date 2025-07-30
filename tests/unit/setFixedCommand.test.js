describe('SetFixed Command Parsing', () => {
    test('should parse simple format correctly', () => {
        const text = '/setfixed 8033:123456:Juan';
        const fixedStr = text.replace('/setfixed', '').trim();
        const parts = fixedStr.split(':');
        
        expect(parts[0]).toBe('8033');
        expect(parts[1]).toBe('123456');
        expect(parts[2]).toBe('Juan');
        expect(parts.length).toBe(3);
    });
    
    test('should parse multiple spots', () => {
        const text = '/setfixed 8033:123456:Juan,8034:234567:María';
        const fixedStr = text.replace('/setfixed', '').trim();
        const spotDefinitions = fixedStr.split(',');
        
        expect(spotDefinitions.length).toBe(2);
        
        const spot1Parts = spotDefinitions[0].trim().split(':');
        expect(spot1Parts[0]).toBe('8033');
        expect(spot1Parts[1]).toBe('123456');
        expect(spot1Parts[2]).toBe('Juan');
        
        const spot2Parts = spotDefinitions[1].trim().split(':');
        expect(spot2Parts[0]).toBe('8034');
        expect(spot2Parts[1]).toBe('234567');
        expect(spot2Parts[2]).toBe('María');
    });
    
    test('should handle spaces correctly', () => {
        const text = '/setfixed 8033:123456:Juan Carlos';
        const fixedStr = text.replace('/setfixed', '').trim();
        const parts = fixedStr.split(':');
        
        expect(parts[0]).toBe('8033');
        expect(parts[1]).toBe('123456');
        expect(parts[2]).toBe('Juan Carlos');
    });
});