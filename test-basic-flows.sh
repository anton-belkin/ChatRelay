#!/bin/bash
#
# Comprehensive basic flow tests for multi-agent system
#

set -e

BASE_URL="http://localhost:8081"
COOKIES_FILE="cookies_test.txt"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🧪 ChatRelay Basic Flow Tests"
echo "=============================="
echo ""

# Cleanup
rm -f $COOKIES_FILE

test_count=0
pass_count=0
fail_count=0

run_test() {
  test_count=$((test_count + 1))
  local test_name="$1"
  local test_func="$2"

  echo -n "Test $test_count: $test_name... "

  if $test_func > /dev/null 2>&1; then
    echo -e "${GREEN}✓ PASS${NC}"
    pass_count=$((pass_count + 1))
    return 0
  else
    echo -e "${RED}✗ FAIL${NC}"
    fail_count=$((fail_count + 1))
    return 1
  fi
}

# Test 1: Server Health
test_server_health() {
  curl -s -f "$BASE_URL/api/meta" > /dev/null
}

# Test 2: Login
test_login() {
  local response=$(curl -s -X POST "$BASE_URL/api/login" \
    -H "Content-Type: application/json" \
    -d '{"username": "test_user"}' \
    -c $COOKIES_FILE)

  echo "$response" | grep -q "test_user"
}

# Test 3: Session retrieval
test_session() {
  local response=$(curl -s -X GET "$BASE_URL/api/session" -b $COOKIES_FILE)
  echo "$response" | grep -q "test_user"
}

# Test 4: Tools endpoint
test_tools() {
  local response=$(curl -s -X GET "$BASE_URL/api/tools" -b $COOKIES_FILE)
  echo "$response" | grep -q "tools"
}

# Test 5: Simple chat (non-streaming check)
test_simple_chat() {
  local response=$(curl -s -X POST "$BASE_URL/api/chat" \
    -H "Content-Type: application/json" \
    -b $COOKIES_FILE \
    -d '{"message": "Hello"}' \
    --max-time 30)

  # Check if we got done event
  echo "$response" | grep -q "event: done"
}

# Test 6: Chat with potential delegation (research keywords)
test_research_keywords() {
  local response=$(curl -s -X POST "$BASE_URL/api/chat" \
    -H "Content-Type: application/json" \
    -b $COOKIES_FILE \
    -d '{"message": "What is npm?"}' \
    --max-time 30)

  echo "$response" | grep -q "event: done"
}

# Test 7: Logout
test_logout() {
  local response=$(curl -s -X POST "$BASE_URL/api/logout" -b $COOKIES_FILE)
  echo "$response" | grep -q "success"
}

# Run all tests
echo "Running tests..."
echo ""

run_test "Server health check" test_server_health
run_test "User login" test_login
run_test "Session retrieval" test_session
run_test "Tools endpoint" test_tools
run_test "Simple chat message" test_simple_chat
run_test "Chat with research keywords" test_research_keywords
run_test "User logout" test_logout

echo ""
echo "=============================="
echo "Test Results:"
echo "  Total: $test_count"
echo -e "  ${GREEN}Passed: $pass_count${NC}"
if [ $fail_count -gt 0 ]; then
  echo -e "  ${RED}Failed: $fail_count${NC}"
fi
echo ""

# Cleanup
rm -f $COOKIES_FILE

if [ $fail_count -gt 0 ]; then
  echo -e "${RED}❌ Some tests failed${NC}"
  exit 1
else
  echo -e "${GREEN}✅ All tests passed!${NC}"
  exit 0
fi
