class TelegramBotMock {
    constructor(token, options = {}) {
        this.token = token;
        this.options = options;
        this.sentMessages = [];
        this.editedMessages = [];
        this.answeredCallbacks = [];
        this.sentDocuments = [];
        this.handlers = {
            message: [],
            callback_query: [],
            polling_error: []
        };
    }

    // Event handling
    on(event, handler) {
        if (this.handlers[event]) {
            this.handlers[event].push(handler);
        }
    }

    // Emit events for testing
    emit(event, data) {
        if (this.handlers[event]) {
            this.handlers[event].forEach(handler => handler(data));
        }
    }

    // Mock sending message
    sendMessage(chatId, text, options = {}) {
        const message = { chatId, text, options, timestamp: Date.now() };
        this.sentMessages.push(message);
        // console.log(`[MOCK] Message sent to ${chatId}: ${text}`); // Disabled for cleaner test output
        return Promise.resolve({ message_id: this.sentMessages.length });
    }

    // Mock editing message
    editMessageText(text, options = {}) {
        const edit = { text, options, timestamp: Date.now() };
        this.editedMessages.push(edit);
        // console.log(`[MOCK] Message edited: ${text}`); // Disabled for cleaner test output
        return Promise.resolve(true);
    }

    // Mock answering callback query
    answerCallbackQuery(queryId, text) {
        const answer = { queryId, text, timestamp: Date.now() };
        this.answeredCallbacks.push(answer);
        // console.log(`[MOCK] Callback answered: ${text}`); // Disabled for cleaner test output
        return Promise.resolve(true);
    }

    // Mock sending document
    sendDocument(chatId, buffer, options = {}) {
        const document = { chatId, buffer, options, timestamp: Date.now() };
        this.sentDocuments.push(document);
        // console.log(`[MOCK] Document sent to ${chatId}: ${options.filename}`); // Disabled for cleaner test output
        return Promise.resolve({ document: { file_id: 'mock_file_id' } });
    }

    // Mock polling methods
    stopPolling() {
        // console.log('[MOCK] Polling stopped'); // Disabled for cleaner test output
        return Promise.resolve();
    }

    setWebHook(url) {
        // console.log(`[MOCK] Webhook set to: ${url}`); // Disabled for cleaner test output
        return Promise.resolve();
    }

    // Test helpers
    getLastMessage() {
        return this.sentMessages[this.sentMessages.length - 1];
    }

    getLastEditedMessage() {
        return this.editedMessages[this.editedMessages.length - 1];
    }

    getLastActivity() {
        // Get the most recent activity (sent message or edited message)
        const lastSent = this.sentMessages[this.sentMessages.length - 1];
        const lastEdited = this.editedMessages[this.editedMessages.length - 1];
        
        if (!lastSent && !lastEdited) return null;
        if (!lastSent) return lastEdited;
        if (!lastEdited) return lastSent;
        
        // Return the most recent based on timestamp
        return lastEdited.timestamp > lastSent.timestamp ? lastEdited : lastSent;
    }

    getAllMessages() {
        return this.sentMessages;
    }

    clearMessages() {
        this.sentMessages = [];
        this.editedMessages = [];
        this.answeredCallbacks = [];
        this.sentDocuments = [];
    }

    // Simulate user sending a message
    simulateMessage(userId, text, firstName = 'Test User') {
        const message = {
            message_id: Math.floor(Math.random() * 10000),
            from: {
                id: userId,
                is_bot: false,
                first_name: firstName,
                username: `user${userId}`
            },
            chat: {
                id: userId,
                first_name: firstName,
                type: 'private'
            },
            date: Math.floor(Date.now() / 1000),
            text: text
        };
        this.emit('message', message);
        return message;
    }

    // Simulate callback query (button press)
    simulateCallbackQuery(userId, data, messageId = 1) {
        const query = {
            id: Math.floor(Math.random() * 10000).toString(),
            from: {
                id: userId,
                is_bot: false,
                first_name: `User${userId}`,
                username: `user${userId}`
            },
            message: {
                message_id: messageId,
                chat: { id: userId }
            },
            data: data
        };
        this.emit('callback_query', query);
        return query;
    }
}

module.exports = TelegramBotMock;