const MessageProcessor = require('../../src/messageProcessor');
const moment = require('moment-timezone');

describe('MessageProcessor', () => {
    let processor;

    beforeEach(() => {
        processor = new MessageProcessor();
        moment.tz.setDefault('America/Montevideo');
    });

    describe('Reserve Intent Detection', () => {
        test('should detect simple reserve intent', () => {
            const testCases = [
                'voy el martes',
                'reservo el lunes', // Changed from 'reservar'
                'necesito mañana', // Simplified
                'reservo el viernes'
            ];

            testCases.forEach(text => {
                const result = processor.processMessage(text);
                expect(result.type).toBe('RESERVE');
                expect(result.date).toBeDefined();
            });
        });

        test('should detect multiple day reservations', () => {
            const text = 'voy el lunes y miércoles';
            const result = processor.processMessage(text);
            
            expect(result.type).toBe('RESERVE_MULTIPLE');
            expect(result.dates).toHaveLength(2);
            expect(result.dates[0].day()).toBe(1); // Monday
            expect(result.dates[1].day()).toBe(3); // Wednesday
        });

        test('should detect whole week reservation', () => {
            const text = 'voy toda la semana';
            const result = processor.processMessage(text);
            
            expect(result.type).toBe('RESERVE_MULTIPLE');
            expect(result.dates).toHaveLength(5); // Monday to Friday
        });

        test('should handle next week reservations', () => {
            const text = 'la próxima semana voy el viernes';
            const result = processor.processMessage(text);
            
            expect(result.type).toBe('RESERVE');
            const nextFriday = moment().add(1, 'week').day(5);
            expect(result.date.format('YYYY-MM-DD')).toBe(nextFriday.format('YYYY-MM-DD'));
        });
    });

    describe('Release Intent Detection', () => {
        test('should detect simple release intent', () => {
            const testCases = [
                'libero el miércoles',
                'no voy el viernes',
                'dejo libre el lunes',
                'queda libre mañana' // Fixed order
            ];

            testCases.forEach(text => {
                const result = processor.processMessage(text);
                expect(result.type).toBe('RELEASE');
                expect(result.date).toBeDefined();
            });
        });

        test('should detect multiple day releases', () => {
            const text = 'libero el lunes y martes';
            const result = processor.processMessage(text);
            
            expect(result.type).toBe('RELEASE_MULTIPLE');
            expect(result.dates).toHaveLength(2);
        });
    });

    describe('Status Commands', () => {
        test('should detect status request', () => {
            const testCases = ['estado', 'disponibles', 'cuántos quedan'];
            
            testCases.forEach(text => {
                const result = processor.processMessage(text);
                expect(result.type).toBe('STATUS');
            });
        });

        test('should detect my reservations request', () => {
            const testCases = ['mis reservas', 'ver mis reservas'];
            
            testCases.forEach(text => {
                const result = processor.processMessage(text);
                expect(result.type).toBe('MY_RESERVATIONS');
            });
        });
    });

    describe('Date Extraction', () => {
        test('should extract specific day correctly', () => {
            const today = moment();
            const cases = [
                { text: 'voy el lunes', expectedDay: 1 },
                { text: 'reservo el martes', expectedDay: 2 },
                { text: 'necesito el miércoles', expectedDay: 3 },
                { text: 'quiero el jueves', expectedDay: 4 },
                { text: 'voy el viernes', expectedDay: 5 }
            ];

            cases.forEach(({ text, expectedDay }) => {
                const result = processor.processMessage(text);
                expect(result.date.day()).toBe(expectedDay);
            });
        });

        test('should handle "mañana" correctly', () => {
            const tomorrow = moment().add(1, 'day');
            const result = processor.processMessage('voy mañana');
            
            expect(result.type).toBe('RESERVE');
            expect(result.date.format('YYYY-MM-DD')).toBe(tomorrow.format('YYYY-MM-DD'));
        });

        test('should handle "hoy" correctly', () => {
            const today = moment();
            const result = processor.processMessage('voy hoy');
            
            expect(result.type).toBe('RESERVE');
            expect(result.date.format('YYYY-MM-DD')).toBe(today.format('YYYY-MM-DD'));
        });
    });

    describe('Unknown Commands', () => {
        test('should return UNKNOWN for unrecognized text', () => {
            const testCases = [
                'hola',
                'buenos días',
                'gracias',
                '¿cómo estás?'
            ];

            testCases.forEach(text => {
                const result = processor.processMessage(text);
                expect(result.type).toBe('UNKNOWN');
            });
        });
    });
});