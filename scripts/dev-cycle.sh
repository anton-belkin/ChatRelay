#!/bin/bash
set -e

echo "🔄 Running full development cycle..."
echo ""

# Deploy
bash "$(dirname "$0")/dev-deploy.sh"

echo ""
echo "⏳ Waiting for services to fully initialize..."
sleep 3

# Test
bash "$(dirname "$0")/dev-test.sh"

echo ""
echo "✅ Development cycle complete!"
