const agentRegistry = require('../../lib/agents/agentRegistry');

describe('agentRegistry', () => {
  describe('getMainAgent', () => {
    it('should return main agent configuration', () => {
      const mainAgent = agentRegistry.getMainAgent();

      expect(mainAgent).toBeDefined();
      expect(mainAgent.id).toBe('main');
      expect(mainAgent.name).toBe('Main Coordinator');
      expect(mainAgent.persistent).toBe(true);
      expect(mainAgent.systemPrompt.toLowerCase()).toContain('coordinate');
    });

    it('should have full context window', () => {
      const mainAgent = agentRegistry.getMainAgent();
      expect(mainAgent.contextWindow).toBe(-1);
    });
  });

  describe('getHelperAgent', () => {
    it('should return research helper configuration', () => {
      const helper = agentRegistry.getHelperAgent('research');

      expect(helper).toBeDefined();
      expect(helper.id).toBe('research');
      expect(helper.name).toBe('Research Helper');
      expect(helper.persistent).toBe(false);
      expect(helper.maxIterations).toBe(4);
    });

    it('should return code helper configuration', () => {
      const helper = agentRegistry.getHelperAgent('code');

      expect(helper).toBeDefined();
      expect(helper.id).toBe('code');
      expect(helper.name).toBe('Code Helper');
      expect(helper.persistent).toBe(false);
      expect(helper.maxIterations).toBe(5);
    });

    it('should return null for unknown helper', () => {
      const helper = agentRegistry.getHelperAgent('unknown');
      expect(helper).toBeNull();
    });
  });

  describe('getAllHelpers', () => {
    it('should return all helper configurations', () => {
      const helpers = agentRegistry.getAllHelpers();

      expect(Object.keys(helpers)).toHaveLength(2);
      expect(helpers.research).toBeDefined();
      expect(helpers.code).toBeDefined();
    });
  });

  describe('listHelperIds', () => {
    it('should return array of helper IDs', () => {
      const ids = agentRegistry.listHelperIds();

      expect(Array.isArray(ids)).toBe(true);
      expect(ids).toContain('research');
      expect(ids).toContain('code');
    });
  });

  describe('hasHelper', () => {
    it('should return true for existing helpers', () => {
      expect(agentRegistry.hasHelper('research')).toBe(true);
      expect(agentRegistry.hasHelper('code')).toBe(true);
    });

    it('should return false for non-existing helpers', () => {
      expect(agentRegistry.hasHelper('nonexistent')).toBe(false);
    });
  });

  describe('filterToolsForAgent', () => {
    const mockTools = [
      { name: '_fetch', description: 'Fetch URL' },
      { name: '_search_npm_packages', description: 'Search npm' },
      { name: '_run_js', description: 'Run JS' },
      { name: '_sandbox_exec', description: 'Sandbox exec' },
      { name: '_create_entities', description: 'Create entities' }
    ];

    it('should filter tools for research helper', () => {
      const helper = agentRegistry.getHelperAgent('research');
      const filtered = agentRegistry.filterToolsForAgent(helper, mockTools);

      expect(filtered).toContainEqual(mockTools[0]); // _fetch
      expect(filtered).toContainEqual(mockTools[1]); // _search_npm_packages
      expect(filtered).toContainEqual(mockTools[4]); // _create_entities
      expect(filtered).not.toContainEqual(mockTools[2]); // _run_js (code only)
    });

    it('should filter tools for code helper', () => {
      const helper = agentRegistry.getHelperAgent('code');
      const filtered = agentRegistry.filterToolsForAgent(helper, mockTools);

      expect(filtered).toContainEqual(mockTools[2]); // _run_js
      expect(filtered).toContainEqual(mockTools[3]); // _sandbox_exec
      expect(filtered).toContainEqual(mockTools[4]); // _create_entities
      expect(filtered).not.toContainEqual(mockTools[0]); // _fetch (research only)
    });

    it('should return empty array for null agent', () => {
      const filtered = agentRegistry.filterToolsForAgent(null, mockTools);
      expect(filtered).toEqual([]);
    });
  });

  describe('getHelperAgentTools', () => {
    it('should return helper agent tool definitions', () => {
      const helperTools = agentRegistry.getHelperAgentTools();

      expect(Array.isArray(helperTools)).toBe(true);
      expect(helperTools).toHaveLength(2); // research + code

      const researchTool = helperTools.find(t => t.name === 'call_research_agent');
      expect(researchTool).toBeDefined();
      expect(researchTool.description).toContain('Research Helper');
      expect(researchTool.parameters.properties.task).toBeDefined();

      const codeTool = helperTools.find(t => t.name === 'call_code_agent');
      expect(codeTool).toBeDefined();
      expect(codeTool.description).toContain('Code Helper');
    });

    it('should have correct tool structure', () => {
      const helperTools = agentRegistry.getHelperAgentTools();
      const tool = helperTools[0];

      expect(tool.name).toMatch(/^call_\w+_agent$/);
      expect(tool.description).toBeDefined();
      expect(tool.parameters).toBeDefined();
      expect(tool.parameters.type).toBe('object');
      expect(tool.parameters.properties.task).toBeDefined();
      expect(tool.parameters.required).toContain('task');
      expect(tool.origin).toBe('helper-agent');
      expect(tool.helperId).toBeDefined();
    });
  });
});
