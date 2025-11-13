/**
 * Intent Classifier
 *
 * Routes user messages to appropriate agents based on intent detection.
 * Uses rule-based classification initially (can be upgraded to LLM-based).
 */

/**
 * Classification rules for different agent types
 */
const INTENT_RULES = {
  code: {
    keywords: [
      'run', 'execute', 'code', 'javascript', 'js', 'function',
      'sandbox', 'npm', 'package', 'install', 'dependency',
      'script', 'test', 'debug', 'console', 'error'
    ],
    patterns: [
      /run\s+(?:this\s+)?code/i,
      /execute\s+(?:this\s+)?(?:script|function)/i,
      /sandbox/i,
      /npm\s+install/i,
      /require\(['"]/i,
      /import\s+.*\s+from/i,
      /console\.log/i,
      /function\s+\w+\s*\(/i,
      /const\s+\w+\s*=/i,
      /^\s*```(?:javascript|js)/im
    ]
  },

  research: {
    keywords: [
      'fetch', 'search', 'find', 'lookup', 'get', 'retrieve',
      'url', 'website', 'web', 'http', 'api', 'data',
      'package', 'npm', 'library', 'documentation', 'docs'
    ],
    patterns: [
      /fetch\s+(?:the\s+)?(?:url|website|data)/i,
      /search\s+(?:for\s+)?(?:npm|packages?)/i,
      /find\s+(?:me\s+)?(?:packages?|libraries)/i,
      /https?:\/\//i,
      /what\s+(?:is|are)\s+(?:the\s+)?(?:best|top|popular)/i,
      /compare\s+packages?/i,
      /look\s+up/i
    ]
  }
};

/**
 * Classify user intent and select appropriate agent
 * @param {string} userMessage - The user's message
 * @param {Array} conversationHistory - Recent conversation context
 * @returns {string} Agent ID ('general', 'code', 'research')
 */
function classifyIntent(userMessage, conversationHistory = []) {
  if (!userMessage || typeof userMessage !== 'string') {
    return 'general';
  }

  const message = userMessage.toLowerCase();
  const scores = {
    code: 0,
    research: 0,
    general: 0
  };

  // Check code intent
  const codeRules = INTENT_RULES.code;
  codeRules.keywords.forEach(keyword => {
    if (message.includes(keyword)) {
      scores.code += 1;
    }
  });
  codeRules.patterns.forEach(pattern => {
    if (pattern.test(userMessage)) {
      scores.code += 3; // Patterns are stronger signals
    }
  });

  // Check research intent
  const researchRules = INTENT_RULES.research;
  researchRules.keywords.forEach(keyword => {
    if (message.includes(keyword)) {
      scores.research += 1;
    }
  });
  researchRules.patterns.forEach(pattern => {
    if (pattern.test(userMessage)) {
      scores.research += 3;
    }
  });

  // Context-based boosting
  // If previous message involved code execution, boost code score
  if (conversationHistory.length > 0) {
    const recentMessages = conversationHistory.slice(-3);
    const hasRecentCodeActivity = recentMessages.some(msg => {
      return msg.role === 'tool' && (
        msg.name?.includes('run_js') ||
        msg.name?.includes('sandbox')
      );
    });
    if (hasRecentCodeActivity) {
      scores.code += 2;
    }

    const hasRecentResearchActivity = recentMessages.some(msg => {
      return msg.role === 'tool' && (
        msg.name?.includes('fetch') ||
        msg.name?.includes('search')
      );
    });
    if (hasRecentResearchActivity) {
      scores.research += 2;
    }
  }

  // Determine winner
  const maxScore = Math.max(scores.code, scores.research, scores.general);

  // Require minimum confidence threshold
  const CONFIDENCE_THRESHOLD = 2;

  if (maxScore < CONFIDENCE_THRESHOLD) {
    return 'general'; // Default to general if no strong signal
  }

  if (scores.code === maxScore) {
    return 'code';
  }

  if (scores.research === maxScore) {
    return 'research';
  }

  return 'general';
}

/**
 * Explain why a particular agent was selected (for debugging)
 * @param {string} userMessage - The user's message
 * @param {Array} conversationHistory - Recent conversation context
 * @returns {Object} Classification result with explanation
 */
function explainClassification(userMessage, conversationHistory = []) {
  const agentId = classifyIntent(userMessage, conversationHistory);
  const message = userMessage.toLowerCase();

  const matchedKeywords = {
    code: [],
    research: []
  };

  const matchedPatterns = {
    code: [],
    research: []
  };

  // Collect matches for code
  INTENT_RULES.code.keywords.forEach(keyword => {
    if (message.includes(keyword)) {
      matchedKeywords.code.push(keyword);
    }
  });
  INTENT_RULES.code.patterns.forEach(pattern => {
    if (pattern.test(userMessage)) {
      matchedPatterns.code.push(pattern.toString());
    }
  });

  // Collect matches for research
  INTENT_RULES.research.keywords.forEach(keyword => {
    if (message.includes(keyword)) {
      matchedKeywords.research.push(keyword);
    }
  });
  INTENT_RULES.research.patterns.forEach(pattern => {
    if (pattern.test(userMessage)) {
      matchedPatterns.research.push(pattern.toString());
    }
  });

  return {
    selectedAgent: agentId,
    matchedKeywords,
    matchedPatterns,
    message: `Selected '${agentId}' agent based on intent analysis`
  };
}

module.exports = {
  classifyIntent,
  explainClassification
};
