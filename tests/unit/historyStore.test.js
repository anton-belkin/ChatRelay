const fs = require('fs');
const path = require('path');

// Mock fs module before requiring historyStore
jest.mock('fs');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'history.json');

describe('historyStore', () => {
  // Set up mocks before ANY module is required
  beforeAll(() => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('{}');
    fs.writeFileSync.mockImplementation(() => {});
    fs.mkdirSync.mockImplementation(() => {});
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.HISTORY_MAX_MESSAGES = '100';
  });

  afterEach(() => {
    delete process.env.HISTORY_MAX_MESSAGES;
  });

  // Load module ONCE for all tests
  const historyStore = require('../../lib/historyStore');

  describe('getHistory', () => {
    it('should return empty array for null username', () => {
      const history = historyStore.getHistory(null);
      expect(history).toEqual([]);
    });

    it('should return empty array for undefined username', () => {
      const history = historyStore.getHistory(undefined);
      expect(history).toEqual([]);
    });

    it('should return empty array for non-existent user', () => {
      const history = historyStore.getHistory('nonexistent');
      expect(history).toEqual([]);
    });
  });

  describe('saveHistory', () => {
    it('should not save for null username', () => {
      historyStore.saveHistory(null, [{ role: 'user', content: 'test' }]);
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should not save for undefined username', () => {
      historyStore.saveHistory(undefined, [{ role: 'user', content: 'test' }]);
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should save messages for valid user', () => {
      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' }
      ];

      historyStore.saveHistory('testuser', messages);

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        STORE_PATH,
        expect.stringContaining('"testuser"'),
        'utf8'
      );
    });

    it('should trim messages to MAX_MESSAGES before saving', () => {
      const messages = Array.from({ length: 150 }, (_, i) => ({
        role: 'user',
        content: `Message ${i}`
      }));

      historyStore.saveHistory('testuser2', messages);

      const savedData = fs.writeFileSync.mock.calls[fs.writeFileSync.mock.calls.length - 1][1];
      const parsed = JSON.parse(savedData);
      expect(parsed.testuser2.length).toBe(100);
      expect(parsed.testuser2[0].content).toBe('Message 50');
    });

    it('should preserve JSON formatting with indentation', () => {
      const messages = [{ role: 'user', content: 'test' }];

      historyStore.saveHistory('testuser3', messages);

      const savedData = fs.writeFileSync.mock.calls[fs.writeFileSync.mock.calls.length - 1][1];
      expect(savedData).toContain('\n  '); // Check for indentation
    });
  });

  describe('integration scenarios', () => {
    it('should save and retrieve data', () => {
      const messages = [
        { role: 'user', content: 'Test message' },
        { role: 'assistant', content: 'Response' }
      ];

      historyStore.saveHistory('integration_user', messages);

      // Retrieve data
      const retrieved = historyStore.getHistory('integration_user');
      expect(retrieved).toEqual(messages);
    });

    it('should handle multiple users independently', () => {
      const user1Messages = [{ role: 'user', content: 'User 1 message' }];
      const user2Messages = [{ role: 'user', content: 'User 2 message' }];

      historyStore.saveHistory('multi_user1', user1Messages);
      historyStore.saveHistory('multi_user2', user2Messages);

      // Verify both users have their data
      expect(historyStore.getHistory('multi_user1')).toEqual(user1Messages);
      expect(historyStore.getHistory('multi_user2')).toEqual(user2Messages);
    });

    it('should limit message history per user', () => {
      const manyMessages = Array.from({ length: 120 }, (_, i) => ({
        role: 'user',
        content: `Msg ${i}`
      }));

      historyStore.saveHistory('limit_test_user', manyMessages);

      const retrieved = historyStore.getHistory('limit_test_user');
      expect(retrieved.length).toBe(100);
      // Should have last 100 messages
      expect(retrieved[0].content).toBe('Msg 20');
      expect(retrieved[99].content).toBe('Msg 119');
    });
  });

  describe('error handling', () => {
    it('should handle write errors gracefully', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      fs.writeFileSync.mockImplementationOnce(() => {
        throw new Error('Disk full');
      });

      // Should not throw
      expect(() => {
        historyStore.saveHistory('error_user', [{ role: 'user', content: 'test' }]);
      }).not.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[historyStore] Failed to persist history:'),
        expect.any(String)
      );

      consoleErrorSpy.mockRestore();
    });
  });
});
