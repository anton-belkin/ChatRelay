#!/bin/bash
set -e

echo "🔨 Building and deploying ChatRelay to local Docker..."

# Navigate to project root
cd "$(dirname "$0")/.."

echo "📦 Stopping existing containers..."
docker compose -f docker-compose.dev.yml down 2>/dev/null || true

echo "🏗️  Building and starting services..."
docker compose -f docker-compose.dev.yml up -d --build --remove-orphans

echo "⏳ Waiting for services to be ready..."
sleep 5

echo ""
echo "🔍 Checking service health..."
docker compose -f docker-compose.dev.yml ps

echo ""
echo "📊 Checking application logs..."
echo "--- App Service ---"
docker compose -f docker-compose.dev.yml logs app --tail 10 2>&1 || echo "App service not found"

echo ""
echo "--- Agent Service ---"
docker compose -f docker-compose.dev.yml logs agent-service --tail 10 2>&1 || echo "Agent service not found"

echo ""
echo "✅ Deployment complete!"
echo "🌐 App:         http://localhost:8081"
echo "🔧 Agent:       http://localhost:8090"
echo "🛠️  MCP Gateway: http://localhost:8080"
echo ""
echo "📝 View logs:"
echo "   docker compose -f docker-compose.dev.yml logs app -f"
echo "   docker compose -f docker-compose.dev.yml logs agent-service -f"
echo ""
echo "🛑 Stop services:"
echo "   docker compose -f docker-compose.dev.yml down"
