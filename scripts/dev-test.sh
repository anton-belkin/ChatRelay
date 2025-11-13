#!/bin/bash
set -e

echo "🧪 Running ChatRelay test suite..."

# Navigate to project root
cd "$(dirname "$0")/.."

# Check if services are running
if ! docker ps --format '{{.Names}}' | grep -q chatrelay-app-1; then
  echo "⚠️  Warning: Docker services not running"
  echo "   Run: bash scripts/dev-deploy.sh"
  echo ""
fi

echo ""
echo "1️⃣  Node.js Unit Tests..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
npm run test:unit

echo ""
echo "2️⃣  Python Unit Tests..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
cd agent-service
pip install -q -r requirements.txt
pytest
cd ..

echo ""
echo "3️⃣  End-to-End Tests..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
FAKE_OPENAI_MODE=1 npm run test:e2e

echo ""
echo "✅ All tests passed!"
echo ""
echo "📊 Coverage Reports:"
echo "   Node.js: coverage/index.html"
echo "   Python:  agent-service/htmlcov/index.html"
