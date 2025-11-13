const helperExecutor = require('../../lib/agents/helperExecutor');
const mainCoordinator = require('../../lib/agents/mainCoordinator');
const agentRegistry = require('../../lib/agents/agentRegistry');

// Mock toolBridge
jest.mock('../../lib/toolBridge', () => ({
  refreshTools: jest.fn().mockResolvedValue([
    {
      name: '_fetch',
      description: 'Fetch URL content',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' }
        },
        required: ['url']
      }
    },
    {
      name: '_run_js',
      description: 'Run JavaScript code',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string' }
        },
        required: ['code']
      }
    }
  ]),
  executeToolCall: jest.fn().mockResolvedValue({
    name: '_fetch',
    content: '<html><body>Hello from Google</body></html>'
  })
}));

describe('Helper Agents', () => {
  describe('Direct Helper Execution', () => {
    it('should execute research helper and return predictable result', async () => {
      const mockStreamModelResponse = jest.fn().mockResolvedValue({
        content: 'I fetched google.com and found the content: Hello from Google',
        toolCalls: []
      });

      const result = await helperExecutor.executeHelper({
        helperId: 'research',
        task: 'Fetch google.com',
        context: 'Testing research helper',
        username: 'test_user',
        conversation: [],
        streamModelResponse: mockStreamModelResponse,
        sendToken: null,
        shouldStop: () => false
      });

      expect(result).toBeDefined();
      expect(result.content).toBeTruthy();
      expect(result.helperId).toBe('research');
      expect(result.iterations).toBeGreaterThan(0);
      expect(mockStreamModelResponse).toHaveBeenCalled();
    });

    it('should execute code helper and return predictable result', async () => {
      const toolBridge = require('../../lib/toolBridge');
      toolBridge.executeToolCall.mockResolvedValueOnce({
        name: '_run_js',
        content: 'Hello, World!'
      });

      const mockStreamModelResponse = jest.fn()
        .mockResolvedValueOnce({
          content: '',
          toolCalls: [{
            id: 'call_1',
            function: {
              name: '_run_js',
              arguments: JSON.stringify({ code: 'console.log("Hello, World!")' })
            }
          }]
        })
        .mockResolvedValueOnce({
          content: 'I created a Hello World app that outputs: Hello, World!',
          toolCalls: []
        });

      const result = await helperExecutor.executeHelper({
        helperId: 'code',
        task: 'Create a Hello World app',
        context: 'Testing code helper',
        username: 'test_user',
        conversation: [],
        streamModelResponse: mockStreamModelResponse,
        sendToken: null,
        shouldStop: () => false
      });

      expect(result).toBeDefined();
      expect(result.content).toBeTruthy();
      expect(result.content.toLowerCase()).toContain('hello');
      expect(result.helperId).toBe('code');
      expect(mockStreamModelResponse).toHaveBeenCalledTimes(2);
    });

    it('should handle helper execution errors gracefully', async () => {
      const mockStreamModelResponse = jest.fn().mockRejectedValue(
        new Error('OpenAI API error')
      );

      await expect(helperExecutor.executeHelper({
        helperId: 'research',
        task: 'This will fail',
        context: '',
        username: 'test_user',
        conversation: [],
        streamModelResponse: mockStreamModelResponse,
        sendToken: null,
        shouldStop: () => false
      })).rejects.toThrow('OpenAI API error');
    });

    it('should reject unknown helper IDs', async () => {
      const mockStreamModelResponse = jest.fn();

      await expect(helperExecutor.executeHelper({
        helperId: 'unknown_helper',
        task: 'Test',
        context: '',
        username: 'test_user',
        conversation: [],
        streamModelResponse: mockStreamModelResponse,
        sendToken: null,
        shouldStop: () => false
      })).rejects.toThrow('Unknown helper');
    });

    it('should respect maxIterations limit', async () => {
      const researchHelper = agentRegistry.getHelperAgent('research');
      const maxIter = researchHelper.maxIterations;

      let callCount = 0;
      const mockStreamModelResponse = jest.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          content: `Iteration ${callCount}`,
          toolCalls: callCount < maxIter + 5 ? [{
            id: `call_${callCount}`,
            function: { name: '_fetch', arguments: '{"url":"http://test.com"}' }
          }] : []
        });
      });

      const result = await helperExecutor.executeHelper({
        helperId: 'research',
        task: 'Keep iterating',
        context: '',
        username: 'test_user',
        conversation: [],
        streamModelResponse: mockStreamModelResponse,
        sendToken: null,
        shouldStop: () => false
      });

      expect(result.iterations).toBeLessThanOrEqual(maxIter);
      expect(callCount).toBeLessThanOrEqual(maxIter);
    });
  });

  describe('Helper Agent Tool Definitions', () => {
    it('should generate correct tool definitions for helpers', () => {
      const helperTools = agentRegistry.getHelperAgentTools();

      expect(helperTools).toHaveLength(2); // research + code

      const researchTool = helperTools.find(t => t.name === 'call_research_agent');
      expect(researchTool).toBeDefined();
      expect(researchTool.parameters.required).toContain('task');
      expect(researchTool.origin).toBe('helper-agent');
      expect(researchTool.helperId).toBe('research');

      const codeTool = helperTools.find(t => t.name === 'call_code_agent');
      expect(codeTool).toBeDefined();
      expect(codeTool.parameters.required).toContain('task');
      expect(codeTool.origin).toBe('helper-agent');
      expect(codeTool.helperId).toBe('code');
    });
  });

  describe('Main Coordinator with Helpers', () => {
    it('should delegate to research helper when called', async () => {
      const toolBridge = require('../../lib/toolBridge');

      // Mock main agent calling research helper
      const mockStreamModelResponse = jest.fn()
        // First call: main agent decides to delegate to research helper
        .mockResolvedValueOnce({
          content: '',
          toolCalls: [{
            id: 'call_research_1',
            function: {
              name: 'call_research_agent',
              arguments: JSON.stringify({
                task: 'Fetch google.com',
                context: 'User wants to test research agent'
              })
            }
          }]
        })
        // Second call: research helper executes (no tool calls, returns result)
        .mockResolvedValueOnce({
          content: 'I fetched google.com and found content',
          toolCalls: []
        })
        // Third call: main agent synthesizes final response
        .mockResolvedValueOnce({
          content: 'The research helper successfully fetched google.com',
          toolCalls: []
        });

      const result = await mainCoordinator.handleRequest({
        userMessage: 'Please use the research agent to fetch google.com',
        username: 'test_user',
        conversation: [],
        streamModelResponse: async ({ messages, tools, model, sendToken, shouldStop }) => {
          return mockStreamModelResponse();
        },
        sendToken: jest.fn(),
        shouldStop: () => false,
        enableHelpers: true,
        debug: false
      });

      expect(result).toBeDefined();
      expect(result.content).toBeTruthy();
      expect(result.agent).toBe('main');
      expect(result.messages).toBeDefined();
      expect(result.messages.length).toBeGreaterThan(0);
    });

    it('should include helper tool definitions in main agent tools', async () => {
      const toolBridge = require('../../lib/toolBridge');
      const mcpTools = await toolBridge.refreshTools();
      const helperTools = agentRegistry.getHelperAgentTools();

      const allTools = [...mcpTools, ...helperTools];

      expect(allTools.length).toBeGreaterThan(mcpTools.length);
      expect(allTools.some(t => t.name === 'call_research_agent')).toBe(true);
      expect(allTools.some(t => t.name === 'call_code_agent')).toBe(true);
      expect(allTools.some(t => t.name === '_fetch')).toBe(true);
    });

    it('should handle helper errors and continue', async () => {
      const mockStreamModelResponse = jest.fn()
        // Main agent calls research helper
        .mockResolvedValueOnce({
          content: '',
          toolCalls: [{
            id: 'call_research_1',
            function: {
              name: 'call_research_agent',
              arguments: JSON.stringify({ task: 'This will fail' })
            }
          }]
        })
        // Research helper fails (simulate by throwing)
        .mockRejectedValueOnce(new Error('Helper execution failed'))
        // Main agent handles error and provides fallback
        .mockResolvedValueOnce({
          content: 'The helper encountered an error, but I can still help you',
          toolCalls: []
        });

      const sendToken = jest.fn();

      // This should NOT throw - errors should be handled gracefully
      const result = await mainCoordinator.handleRequest({
        userMessage: 'Test helper error handling',
        username: 'test_user',
        conversation: [],
        streamModelResponse: async ({ messages, tools, model, sendToken, shouldStop }) => {
          return mockStreamModelResponse();
        },
        sendToken,
        shouldStop: () => false,
        enableHelpers: true,
        debug: true
      });

      expect(result).toBeDefined();
      // Should have captured the error in tool results
      expect(result.messages.some(m =>
        m.role === 'tool' && m.content.includes('error')
      )).toBe(true);
    });
  });

  describe('Tool Filtering for Helpers', () => {
    it('should filter tools correctly for research helper', () => {
      const allTools = [
        { name: '_fetch' },
        { name: '_search_npm_packages' },
        { name: '_run_js' },
        { name: '_create_entities' }
      ];

      const researchHelper = agentRegistry.getHelperAgent('research');
      const filtered = agentRegistry.filterToolsForAgent(researchHelper, allTools);

      expect(filtered).toContainEqual({ name: '_fetch' });
      expect(filtered).toContainEqual({ name: '_search_npm_packages' });
      expect(filtered).toContainEqual({ name: '_create_entities' });
      expect(filtered).not.toContainEqual({ name: '_run_js' });
    });

    it('should filter tools correctly for code helper', () => {
      const allTools = [
        { name: '_fetch' },
        { name: '_run_js' },
        { name: '_sandbox_exec' },
        { name: '_create_entities' }
      ];

      const codeHelper = agentRegistry.getHelperAgent('code');
      const filtered = agentRegistry.filterToolsForAgent(codeHelper, allTools);

      expect(filtered).toContainEqual({ name: '_run_js' });
      expect(filtered).toContainEqual({ name: '_sandbox_exec' });
      expect(filtered).toContainEqual({ name: '_create_entities' });
      expect(filtered).not.toContainEqual({ name: '_fetch' });
    });
  });
});
