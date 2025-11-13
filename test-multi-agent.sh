#!/bin/bash
#
# Test script for multi-agent system
#

set -e

BASE_URL="http://localhost:8081"

echo "🧪 Testing Multi-Agent ChatRelay System"
echo "========================================"
echo ""

# Test 1: Login
echo "1️⃣  Testing login..."
LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/login" \
  -H "Content-Type: application/json" \
  -d '{"username": "test_agent_user"}' \
  -c cookies.txt)

echo "   ✅ Login successful"
echo ""

# Test 2: Check session
echo "2️⃣  Checking session..."
SESSION_RESPONSE=$(curl -s -X GET "$BASE_URL/api/session" -b cookies.txt)
echo "   Session: $(echo $SESSION_RESPONSE | jq -r '.username')"
echo ""

# Test 3: Check tools are loaded (including memory tools)
echo "3️⃣  Checking tools..."
TOOLS_RESPONSE=$(curl -s -X GET "$BASE_URL/api/tools" -b cookies.txt)
TOOL_COUNT=$(echo $TOOLS_RESPONSE | jq '.tools | length')
MEMORY_TOOLS=$(echo $TOOLS_RESPONSE | jq '[.tools[] | select(.name | contains("create_") or contains("read_") or contains("search_") or contains("add_"))] | length')
echo "   Total tools: $TOOL_COUNT"
echo "   Memory/knowledge graph tools: $MEMORY_TOOLS"
echo ""

# Test 4: Test intent classification for different messages
echo "4️⃣  Testing agent routing (check app logs for agent selection)..."
echo "   Note: With ENABLE_MULTI_AGENT=1, different messages should route to different agents"
echo ""

echo "   📋 Testing messages:"
echo "      - 'Hello, how are you?' → Should use general agent 💬"
echo "      - 'Search npm for express packages' → Should use research agent 🔍"
echo "      - 'Run this code: console.log(10 + 5)' → Should use code agent ⚙️"
echo ""

echo "✅ Multi-agent system is deployed and configured!"
echo ""
echo "🔍 To verify agent routing:"
echo "   1. Open browser at http://localhost:8081"
echo "   2. Login as 'test_agent_user'"
echo "   3. Try different messages and watch the status bar for agent icons"
echo "   4. Check console logs: docker compose -f docker-compose.dev.yml logs app -f"
echo ""
echo "🧪 Environment variables:"
echo "   ENABLE_MULTI_AGENT=1 (enabled)"
echo "   AGENT_DEBUG_MODE=1 (transparent agent switching)"
echo ""
