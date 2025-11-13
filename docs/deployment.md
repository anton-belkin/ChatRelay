# Deployment Guide

This guide covers setting up CI/CD with GitHub Actions and deploying to your Ugreen NAS.

## Table of Contents
- [GitHub Actions Setup](#github-actions-setup)
- [Container Registries](#container-registries)
- [Ugreen NAS Setup](#ugreen-nas-setup)
- [Manual Deployment](#manual-deployment)
- [Troubleshooting](#troubleshooting)

## GitHub Actions Setup

### Required GitHub Secrets

Go to your repository → Settings → Secrets and variables → Actions → New repository secret

#### Required Secrets:

1. **For Docker Hub** (Optional - if you want to push to Docker Hub):
   ```
   DOCKERHUB_USERNAME=your_dockerhub_username
   DOCKERHUB_TOKEN=your_dockerhub_access_token
   ```

   Generate token at: https://hub.docker.com/settings/security

2. **For NAS Deployment** (Required for auto-deployment):
   ```
   NAS_HOST=192.168.1.100  # Your NAS IP or hostname
   NAS_USER=admin          # SSH username on NAS
   NAS_SSH_KEY=            # Private SSH key (see below)
   NAS_DEPLOY_PATH=/volume1/docker/chatrelay  # Deploy directory
   NAS_APP_URL=http://192.168.1.100:8081      # Optional: for health checks
   ```

### Generate SSH Key for NAS

On your local machine:

```bash
# Generate SSH key pair
ssh-keygen -t ed25519 -C "github-actions-chatrelay" -f ~/.ssh/nas_deploy_key

# Copy public key to NAS
ssh-copy-id -i ~/.ssh/nas_deploy_key.pub admin@YOUR_NAS_IP

# Test connection
ssh -i ~/.ssh/nas_deploy_key admin@YOUR_NAS_IP

# Copy private key content for GitHub secret
cat ~/.ssh/nas_deploy_key
# Copy the entire output and paste into NAS_SSH_KEY secret
```

## Container Registries

### GitHub Container Registry (GHCR) - Recommended

GHCR is automatically configured and uses `GITHUB_TOKEN` (no setup needed).

Images will be pushed to:
- `ghcr.io/YOUR_USERNAME/chatrelay-app:prod-latest`
- `ghcr.io/YOUR_USERNAME/chatrelay-agent-service:prod-latest`

**Make packages public** (so NAS can pull without auth):
1. Go to https://github.com/YOUR_USERNAME?tab=packages
2. Click on each package (chatrelay-app, chatrelay-agent-service)
3. Package settings → Change visibility → Public

**Or configure NAS to authenticate**:
```bash
# On your NAS, login to GHCR
docker login ghcr.io -u YOUR_GITHUB_USERNAME
# When prompted for password, use a Personal Access Token with read:packages scope
# Generate at: https://github.com/settings/tokens
```

### Docker Hub (Optional)

If you prefer Docker Hub:
1. Configure secrets as shown above
2. The workflow will automatically push to both registries
3. Update `docker-compose.prod.yml` to use Docker Hub images

## Ugreen NAS Setup

### 1. Enable SSH on Ugreen NAS

1. Login to Ugreen NAS web interface
2. Go to Control Panel → Terminal & SNMP
3. Enable SSH service
4. Set SSH port (default: 22)

### 2. Prepare NAS Directory Structure

SSH into your NAS and create directories:

```bash
ssh admin@YOUR_NAS_IP

# Create deployment directory
mkdir -p /volume1/docker/chatrelay/{data,mcp}
cd /volume1/docker/chatrelay

# Create environment file
cat > .env.production << 'EOF'
# OpenAI Configuration
OPENAI_API_KEY=sk-your-actual-key-here
OPENAI_MODEL=gpt-4o-mini

# Session Configuration
SESSION_SECRET=generate-a-long-random-string-here

# Server Configuration
PORT=8081
HISTORY_MAX_MESSAGES=100

# Tool Service Configuration
TOOL_SERVICE_URL=http://agent-service:8090
TOOL_CACHE_TTL_MS=60000
TOOL_LOOP_LIMIT=4

# MCP Configuration
MCP_GATEWAY_URL=http://mcp-gateway:8080
MCP_TRANSPORT=streamable-http

# Production Settings
NODE_ENV=production
EOF

# Set proper permissions
chmod 600 .env.production

# Copy MCP configuration from your local machine
# (do this from your local machine)
```

From your local machine:

```bash
# Copy MCP config to NAS
scp -r mcp/ admin@YOUR_NAS_IP:/volume1/docker/chatrelay/
```

### 3. Set Environment Variable for Compose

On your NAS, add to `~/.bashrc` or `~/.profile`:

```bash
echo 'export GITHUB_REPOSITORY_OWNER=YOUR_GITHUB_USERNAME' >> ~/.bashrc
source ~/.bashrc
```

Or create a `.env` file in the deploy directory:

```bash
# On NAS
cd /volume1/docker/chatrelay
echo "GITHUB_REPOSITORY_OWNER=YOUR_GITHUB_USERNAME" > .env
```

### 4. Test Manual Deployment

```bash
# On NAS
cd /volume1/docker/chatrelay

# Pull images
docker compose -f docker-compose.prod.yml pull

# Start services
docker compose -f docker-compose.prod.yml up -d

# Check status
docker compose -f docker-compose.prod.yml ps

# View logs
docker compose -f docker-compose.prod.yml logs -f

# Test access
curl http://localhost:8081/api/meta
```

### 5. Configure Firewall (if needed)

If you can't access the service:

```bash
# On NAS, allow ports
sudo ufw allow 8080/tcp
sudo ufw allow 8081/tcp
sudo ufw allow 8090/tcp
```

Or configure through Ugreen web interface:
- Control Panel → Security → Firewall

## Deployment Workflows

### Automatic Deployment

**Push to main branch**:
```bash
git push origin main
```
- Runs tests
- Builds and pushes images to GHCR
- Automatically deploys to NAS (if secrets configured)

**Manual deployment with control**:
1. Go to GitHub Actions tab
2. Click "CI/CD Pipeline"
3. Click "Run workflow"
4. Select environment (dev/prod)
5. Check "Deploy to NAS" if desired
6. Click "Run workflow"

### Branch Strategy

- `main` → Production (auto-deploys to NAS)
- `develop` → Development (builds but doesn't deploy)
- Feature branches → Only runs tests

## Manual Deployment

### Quick Deploy Script

Save on your NAS as `/usr/local/bin/chatrelay-deploy`:

```bash
#!/bin/bash
set -e

DEPLOY_DIR="/volume1/docker/chatrelay"
cd "$DEPLOY_DIR"

echo "🔄 Pulling latest images..."
docker compose -f docker-compose.prod.yml pull

echo "🚀 Restarting services..."
docker compose -f docker-compose.prod.yml up -d --remove-orphans

echo "⏳ Waiting for services..."
sleep 5

echo "✅ Checking health..."
docker compose -f docker-compose.prod.yml ps

echo "🎉 Deployment complete!"
echo "Access at: http://$(hostname -I | awk '{print $1}'):8081"
```

Make it executable:
```bash
chmod +x /usr/local/bin/chatrelay-deploy
```

Use it:
```bash
chatrelay-deploy
```

### Rollback

To rollback to a previous version:

```bash
# On NAS
cd /volume1/docker/chatrelay

# Stop current services
docker compose -f docker-compose.prod.yml down

# Edit docker-compose.prod.yml and change image tags from :prod-latest to specific SHA
# For example: ghcr.io/username/chatrelay-app:prod-abc1234

# Pull old version
docker compose -f docker-compose.prod.yml pull

# Start services
docker compose -f docker-compose.prod.yml up -d
```

## Monitoring

### View Logs

```bash
# All services
docker compose -f docker-compose.prod.yml logs -f

# Specific service
docker compose -f docker-compose.prod.yml logs -f app
docker compose -f docker-compose.prod.yml logs -f agent-service
docker compose -f docker-compose.prod.yml logs -f mcp-gateway

# Last 100 lines
docker compose -f docker-compose.prod.yml logs --tail 100
```

### Check Service Status

```bash
docker compose -f docker-compose.prod.yml ps
```

### Resource Usage

```bash
docker stats
```

## Backup

### Backup Data

```bash
# On NAS
cd /volume1/docker/chatrelay
tar -czf backup-$(date +%Y%m%d).tar.gz data/ .env.production mcp/

# Optional: Copy to another location
cp backup-*.tar.gz /volume1/backups/
```

### Automated Backup (Cron)

```bash
# On NAS, edit crontab
crontab -e

# Add daily backup at 2 AM
0 2 * * * cd /volume1/docker/chatrelay && tar -czf /volume1/backups/chatrelay-$(date +\%Y\%m\%d).tar.gz data/ .env.production mcp/ && find /volume1/backups/chatrelay-* -mtime +30 -delete
```

## Troubleshooting

### Issue: Cannot pull images from GHCR

**Solution 1**: Make packages public (recommended for personal projects)
- Go to https://github.com/YOUR_USERNAME?tab=packages
- Make each package public

**Solution 2**: Authenticate Docker on NAS
```bash
docker login ghcr.io -u YOUR_GITHUB_USERNAME
# Password: Use Personal Access Token with read:packages scope
```

### Issue: SSH connection fails from GitHub Actions

Check:
1. SSH service enabled on NAS
2. SSH key properly added to NAS `~/.ssh/authorized_keys`
3. NAS_SSH_KEY secret contains complete private key (including headers)
4. NAS firewall allows SSH (port 22)

Test locally:
```bash
ssh -i ~/.ssh/nas_deploy_key admin@YOUR_NAS_IP "echo Connection successful"
```

### Issue: Services won't start

Check logs:
```bash
docker compose -f docker-compose.prod.yml logs
```

Common issues:
- Missing `.env.production` file
- Invalid OPENAI_API_KEY
- Ports already in use
- Docker socket permission issues

### Issue: "Permission denied" on docker.sock

```bash
# On NAS
sudo chmod 666 /var/run/docker.sock
# Or add user to docker group
sudo usermod -aG docker $USER
# Logout and login again
```

### Issue: Out of disk space

```bash
# Clean old images
docker system prune -a

# Remove unused volumes
docker volume prune

# Check space
df -h
```

## Health Checks

Add to your NAS crontab to check if services are running:

```bash
# Check every 5 minutes
*/5 * * * * docker compose -f /volume1/docker/chatrelay/docker-compose.prod.yml ps | grep -q "Up" || docker compose -f /volume1/docker/chatrelay/docker-compose.prod.yml up -d
```

## Performance Tuning

### NAS Resource Limits

Edit `docker-compose.prod.yml` to add resource limits:

```yaml
services:
  app:
    # ... existing config ...
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 512M
        reservations:
          memory: 256M
```

### Log Rotation

```yaml
services:
  app:
    # ... existing config ...
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

## Security Recommendations

1. **Use strong SESSION_SECRET**: Generate with `openssl rand -hex 32`
2. **Restrict SSH access**: Use SSH keys only, disable password auth
3. **Regular updates**: Pull new images weekly
4. **Backup encryption**: Encrypt backups if storing off-site
5. **Firewall rules**: Only expose necessary ports
6. **HTTPS/Reverse Proxy**: Use nginx/Caddy for HTTPS (optional)

## Support

- GitHub Issues: https://github.com/YOUR_USERNAME/ChatRelay/issues
- Discussions: https://github.com/YOUR_USERNAME/ChatRelay/discussions
