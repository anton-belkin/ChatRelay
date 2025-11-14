# AWS Elastic Beanstalk Deployment Guide for ChatRelay

This guide provides step-by-step instructions for deploying ChatRelay to AWS Elastic Beanstalk using a multi-container Docker environment.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Architecture Overview](#architecture-overview)
- [AWS Services Required](#aws-services-required)
- [Pre-Deployment Setup](#pre-deployment-setup)
- [Deployment Steps](#deployment-steps)
- [Environment Configuration](#environment-configuration)
- [CI/CD Integration](#cicd-integration)
- [Monitoring and Logging](#monitoring-and-logging)
- [Scaling and Performance](#scaling-and-performance)
- [Troubleshooting](#troubleshooting)
- [Cost Optimization](#cost-optimization)

---

## Prerequisites

### Required Tools
- AWS CLI v2.x or higher
- EB CLI (Elastic Beanstalk Command Line Interface)
- Docker and Docker Compose
- Git
- Node.js 20+ (for local testing)
- Python 3.11+ (for local testing)

### AWS Account Requirements
- Active AWS account with appropriate permissions
- IAM user with the following managed policies:
  - `AWSElasticBeanstalkFullAccess`
  - `AmazonEC2ContainerRegistryFullAccess`
  - `AmazonElastiCacheFullAccess`
  - `AmazonEFSFullAccess`
  - `IAMFullAccess` (for role creation)
  - `CloudWatchFullAccess`

### Install EB CLI

```bash
# Using pip
pip install awsebcli --upgrade --user

# Verify installation
eb --version
```

---

## Architecture Overview

ChatRelay uses a **multi-container Docker architecture** on AWS Elastic Beanstalk:

```
┌─────────────────────────────────────────────────────────────┐
│                    Application Load Balancer                 │
│                         (Port 80/443)                         │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              Elastic Beanstalk Environment                    │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              EC2 Instance (Docker Host)                │  │
│  │                                                         │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │  │
│  │  │ Main App     │  │ Agent Service│  │ MCP Gateway │ │  │
│  │  │ (Node.js)    │  │ (Python)     │  │ (Docker)    │ │  │
│  │  │ Port: 8081   │  │ Port: 8090   │  │ Port: 8080  │ │  │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬──────┘ │  │
│  │         │                  │                  │         │  │
│  │         └──────────────────┴──────────────────┘         │  │
│  └───────────────────────────┬───────────────────────────┘  │
└────────────────────────────────┼────────────────────────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 │                               │
                 ▼                               ▼
         ┌───────────────┐             ┌────────────────┐
         │ ElastiCache   │             │  EFS Volume    │
         │ (Redis)       │             │ (Persistent)   │
         │ Sessions      │             │ history.json   │
         └───────────────┘             └────────────────┘
```

### Services:
1. **Main Application (Node.js)**: Express server handling HTTP requests
2. **Agent Service (Python)**: FastAPI service for AI agent coordination
3. **MCP Gateway**: Docker-based tool orchestration service
4. **ElastiCache (Redis)**: Distributed session storage
5. **EFS**: Persistent file storage for conversation history
6. **ECR**: Container image registry

---

## AWS Services Required

### 1. Amazon ECR (Elastic Container Registry)

ECR stores Docker images for all three services.

**Create ECR Repositories:**

```bash
# Set your AWS region
export AWS_REGION=us-east-1

# Create repositories
aws ecr create-repository \
    --repository-name chatrelay/main-app \
    --region $AWS_REGION

aws ecr create-repository \
    --repository-name chatrelay/agent-service \
    --region $AWS_REGION

aws ecr create-repository \
    --repository-name chatrelay/mcp-gateway \
    --region $AWS_REGION

# Get login credentials
aws ecr get-login-password --region $AWS_REGION | \
    docker login --username AWS --password-stdin \
    $(aws sts get-caller-identity --query Account --output text).dkr.ecr.$AWS_REGION.amazonaws.com
```

### 2. Amazon ElastiCache (Redis)

Used for distributed session storage across multiple EC2 instances.

**Create Redis Cluster:**

```bash
# Create a subnet group (update with your VPC subnet IDs)
aws elasticache create-cache-subnet-group \
    --cache-subnet-group-name chatrelay-redis-subnet \
    --cache-subnet-group-description "ChatRelay Redis Subnet Group" \
    --subnet-ids subnet-xxxxxx subnet-yyyyyy

# Create Redis cluster
aws elasticache create-cache-cluster \
    --cache-cluster-id chatrelay-sessions \
    --cache-node-type cache.t3.micro \
    --engine redis \
    --engine-version 7.0 \
    --num-cache-nodes 1 \
    --cache-subnet-group-name chatrelay-redis-subnet \
    --security-group-ids sg-xxxxxxxxx
```

### 3. Amazon EFS (Elastic File System)

Used for persistent storage of conversation history.

**Create EFS:**

```bash
# Create EFS file system
aws efs create-file-system \
    --performance-mode generalPurpose \
    --throughput-mode bursting \
    --encrypted \
    --tags Key=Name,Value=chatrelay-data \
    --region $AWS_REGION

# Note the FileSystemId from the output (fs-xxxxxxxx)
```

---

## Pre-Deployment Setup

### Step 1: Build and Push Docker Images to ECR

```bash
# Set variables
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export AWS_REGION=us-east-1
export ECR_REGISTRY=${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com
export VERSION=1.4.0

# Login to ECR
aws ecr get-login-password --region $AWS_REGION | \
    docker login --username AWS --password-stdin $ECR_REGISTRY

# Build and push main app
docker build -t chatrelay/main-app:${VERSION} -f Dockerfile .
docker tag chatrelay/main-app:${VERSION} ${ECR_REGISTRY}/chatrelay/main-app:${VERSION}
docker tag chatrelay/main-app:${VERSION} ${ECR_REGISTRY}/chatrelay/main-app:latest
docker push ${ECR_REGISTRY}/chatrelay/main-app:${VERSION}
docker push ${ECR_REGISTRY}/chatrelay/main-app:latest

# Build and push agent service
docker build -t chatrelay/agent-service:${VERSION} -f agent-service/Dockerfile ./agent-service
docker tag chatrelay/agent-service:${VERSION} ${ECR_REGISTRY}/chatrelay/agent-service:${VERSION}
docker tag chatrelay/agent-service:${VERSION} ${ECR_REGISTRY}/chatrelay/agent-service:latest
docker push ${ECR_REGISTRY}/chatrelay/agent-service:${VERSION}
docker push ${ECR_REGISTRY}/chatrelay/agent-service:latest

# Build and push MCP gateway (uses Docker-in-Docker)
# Note: MCP gateway requires special handling for Docker socket access
docker build -t chatrelay/mcp-gateway:${VERSION} -f mcp/Dockerfile ./mcp
docker tag chatrelay/mcp-gateway:${VERSION} ${ECR_REGISTRY}/chatrelay/mcp-gateway:${VERSION}
docker tag chatrelay/mcp-gateway:${VERSION} ${ECR_REGISTRY}/chatrelay/mcp-gateway:latest
docker push ${ECR_REGISTRY}/chatrelay/mcp-gateway:${VERSION}
docker push ${ECR_REGISTRY}/chatrelay/mcp-gateway:latest
```

### Step 2: Create Dockerrun.aws.json

This file is already created in the repository root. It defines the multi-container Docker configuration for Elastic Beanstalk.

### Step 3: Configure .ebextensions

The `.ebextensions/` directory contains configuration files for:
- Environment properties
- CloudWatch logging
- EFS mounting
- Security groups
- Instance configuration

---

## Deployment Steps

### Step 1: Initialize Elastic Beanstalk Application

```bash
# Navigate to project root
cd /path/to/ChatRelay

# Initialize EB application
eb init

# Follow prompts:
# - Select region: us-east-1 (or your preferred region)
# - Application name: ChatRelay
# - Platform: Multi-container Docker
# - Platform version: (select latest)
# - Setup SSH: Yes (for troubleshooting)
```

### Step 2: Create Elastic Beanstalk Environment

```bash
# Create environment
eb create chatrelay-prod \
    --instance-type t3.medium \
    --min-instances 1 \
    --max-instances 4 \
    --envvars \
      NODE_ENV=production,\
      OPENAI_API_KEY=your-openai-api-key,\
      SESSION_SECRET=your-secure-random-secret,\
      REDIS_HOST=your-elasticache-endpoint.cache.amazonaws.com,\
      REDIS_PORT=6379,\
      PORT=8081,\
      AGENT_SERVICE_URL=http://localhost:8090,\
      TOOL_BRIDGE_URL=http://localhost:8080
```

**Important Environment Variables:**

| Variable | Description | Example |
|----------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API key (required) | `sk-...` |
| `SESSION_SECRET` | Session encryption secret | `random-64-char-string` |
| `REDIS_HOST` | ElastiCache Redis endpoint | `chatrelay.xxx.cache.amazonaws.com` |
| `REDIS_PORT` | Redis port | `6379` |
| `NODE_ENV` | Environment mode | `production` |
| `PORT` | Main app port | `8081` |
| `AGENT_SERVICE_URL` | Agent service URL | `http://localhost:8090` |
| `TOOL_BRIDGE_URL` | MCP gateway URL | `http://localhost:8080` |
| `OPENAI_MODEL` | OpenAI model to use | `gpt-4o` |
| `HISTORY_MAX_MESSAGES` | Max conversation history | `50` |

### Step 3: Configure EFS Mount

Update `.ebextensions/03-efs-mount.config` with your EFS file system ID:

```yaml
commands:
  01_mount_efs:
    command: |
      mkdir -p /mnt/efs
      mount -t efs -o tls fs-xxxxxxxx:/ /mnt/efs
      mkdir -p /mnt/efs/data
      chmod -R 777 /mnt/efs/data
```

### Step 4: Deploy Application

```bash
# Deploy the application
eb deploy

# Monitor deployment
eb status

# View logs
eb logs

# Open application in browser
eb open
```

### Step 5: Configure Security Groups

After deployment, update security groups to allow:

1. **Application Load Balancer → EC2 Instances**:
   - Port 80 (HTTP)
   - Port 443 (HTTPS)

2. **EC2 Instances → ElastiCache**:
   - Port 6379 (Redis)

3. **EC2 Instances → EFS**:
   - Port 2049 (NFS)

```bash
# Get environment details
eb status

# Update security group in AWS Console or using CLI
aws ec2 authorize-security-group-ingress \
    --group-id sg-xxxxxxxxx \
    --protocol tcp \
    --port 6379 \
    --source-group sg-yyyyyyyyy
```

---

## Environment Configuration

### Update Environment Variables

```bash
# Set environment variable
eb setenv OPENAI_API_KEY=sk-new-key

# Set multiple variables
eb setenv \
    OPENAI_MODEL=gpt-4o \
    HISTORY_MAX_MESSAGES=100 \
    LOG_LEVEL=info
```

### Configure HTTPS/SSL

```bash
# Using AWS Certificate Manager (ACM)
# 1. Request certificate in ACM for your domain
# 2. Configure load balancer to use certificate

eb config

# In the configuration file, add:
# aws:elbv2:listener:443:
#   ListenerEnabled: true
#   Protocol: HTTPS
#   SSLCertificateArns: arn:aws:acm:region:account:certificate/cert-id
```

### Session Store Configuration

Update `lib/sessionStore.js` to use Redis (this requires code changes):

```javascript
const session = require('express-session');
const RedisStore = require('connect-redis').default;
const { createClient } = require('redis');

// Create Redis client
const redisClient = createClient({
    url: `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`
});

redisClient.connect().catch(console.error);

// Configure session with Redis
app.use(session({
    store: new RedisStore({ client: redisClient }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24 // 24 hours
    }
}));
```

---

## CI/CD Integration

### Update GitHub Actions for ECR and EB

Create `.github/workflows/aws-deploy.yml`:

```yaml
name: Deploy to AWS Elastic Beanstalk

on:
  push:
    branches:
      - main
      - production

env:
  AWS_REGION: us-east-1
  ECR_REGISTRY: ${{ secrets.AWS_ACCOUNT_ID }}.dkr.ecr.us-east-1.amazonaws.com
  EB_APPLICATION_NAME: ChatRelay
  EB_ENVIRONMENT_NAME: chatrelay-prod

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Login to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build and push Docker images
        run: |
          VERSION=$(node -p "require('./package.json').version")

          # Main app
          docker build -t $ECR_REGISTRY/chatrelay/main-app:$VERSION .
          docker tag $ECR_REGISTRY/chatrelay/main-app:$VERSION $ECR_REGISTRY/chatrelay/main-app:latest
          docker push $ECR_REGISTRY/chatrelay/main-app:$VERSION
          docker push $ECR_REGISTRY/chatrelay/main-app:latest

          # Agent service
          docker build -t $ECR_REGISTRY/chatrelay/agent-service:$VERSION -f agent-service/Dockerfile ./agent-service
          docker tag $ECR_REGISTRY/chatrelay/agent-service:$VERSION $ECR_REGISTRY/chatrelay/agent-service:latest
          docker push $ECR_REGISTRY/chatrelay/agent-service:$VERSION
          docker push $ECR_REGISTRY/chatrelay/agent-service:latest

          # MCP Gateway
          docker build -t $ECR_REGISTRY/chatrelay/mcp-gateway:$VERSION -f mcp/Dockerfile ./mcp
          docker tag $ECR_REGISTRY/chatrelay/mcp-gateway:$VERSION $ECR_REGISTRY/chatrelay/mcp-gateway:latest
          docker push $ECR_REGISTRY/chatrelay/mcp-gateway:$VERSION
          docker push $ECR_REGISTRY/chatrelay/mcp-gateway:latest

      - name: Deploy to Elastic Beanstalk
        run: |
          # Install EB CLI
          pip install awsebcli

          # Deploy
          eb deploy $EB_ENVIRONMENT_NAME --region $AWS_REGION

      - name: Verify deployment
        run: |
          # Wait for environment to be ready
          eb health --region $AWS_REGION
```

### Required GitHub Secrets

Add the following secrets to your GitHub repository:

- `AWS_ACCESS_KEY_ID`: AWS IAM access key
- `AWS_SECRET_ACCESS_KEY`: AWS IAM secret key
- `AWS_ACCOUNT_ID`: Your AWS account ID
- `OPENAI_API_KEY`: OpenAI API key (for EB environment)

---

## Monitoring and Logging

### CloudWatch Logs

Logs are automatically configured via `.ebextensions/02-cloudwatch.config`.

**View logs:**

```bash
# Via EB CLI
eb logs

# Via AWS CLI
aws logs tail /aws/elasticbeanstalk/chatrelay-prod/var/log/eb-docker/containers/eb-current-app --follow
```

### CloudWatch Metrics

Monitor key metrics:
- CPU Utilization
- Network In/Out
- Request Count
- Response Time
- 4xx/5xx Errors

**Create CloudWatch Dashboard:**

```bash
aws cloudwatch put-dashboard \
    --dashboard-name ChatRelay-Production \
    --dashboard-body file://cloudwatch-dashboard.json
```

### Health Monitoring

```bash
# Check environment health
eb health

# Detailed health information
eb health --refresh
```

---

## Scaling and Performance

### Auto Scaling Configuration

```bash
# Configure auto-scaling
eb scale 2  # Set to 2 instances

# Or use configuration file (.ebextensions/04-autoscaling.config)
```

**Auto-scaling triggers:**
- CPU > 70% → Scale up
- CPU < 20% → Scale down
- Min instances: 1
- Max instances: 4

### Performance Optimization

1. **Use CloudFront CDN** for static assets
2. **Enable Redis caching** for session data
3. **Optimize Docker images** (use multi-stage builds)
4. **Configure connection pooling** for database connections
5. **Enable gzip compression** in nginx

### Load Testing

```bash
# Using Apache Bench
ab -n 1000 -c 10 https://your-app.elasticbeanstalk.com/

# Using wrk
wrk -t12 -c400 -d30s https://your-app.elasticbeanstalk.com/
```

---

## Troubleshooting

### Common Issues

#### 1. Container Health Check Failures

**Symptom:** Containers fail health checks and restart continuously.

**Solution:**
```bash
# Check container logs
eb logs

# Verify health check endpoint
curl http://your-app.elasticbeanstalk.com/health

# Update health check path in Dockerrun.aws.json
```

#### 2. Redis Connection Errors

**Symptom:** `ECONNREFUSED` or timeout errors when connecting to Redis.

**Solution:**
```bash
# Verify security group rules
# EC2 instance security group must allow outbound to Redis security group on port 6379

# Test Redis connection from EC2 instance
eb ssh
redis-cli -h your-redis-endpoint.cache.amazonaws.com ping
```

#### 3. EFS Mount Failures

**Symptom:** Data is not persisting or mount errors in logs.

**Solution:**
```bash
# Verify EFS security group allows NFS (port 2049)
# Check mount configuration in .ebextensions/03-efs-mount.config

# Test EFS mount
eb ssh
df -h | grep efs
```

#### 4. Docker Socket Access Issues

**Symptom:** MCP Gateway cannot start Docker containers.

**Solution:**
- AWS Elastic Beanstalk does not support Docker socket mounting for security reasons
- Consider alternatives:
  - Use ECS/Fargate for MCP Gateway with Docker daemon
  - Refactor MCP Gateway to use AWS SDK instead of Docker socket
  - Deploy MCP Gateway separately on EC2 with Docker daemon access

#### 5. High Memory Usage

**Symptom:** Instance memory exhaustion, OOM errors.

**Solution:**
```bash
# Upgrade instance type
eb scale --instance-type t3.large

# Monitor memory usage
eb ssh
free -h
docker stats
```

### Debug Mode

Enable debug logging:

```bash
eb setenv LOG_LEVEL=debug DEBUG=true

# View real-time logs
eb logs --stream
```

### SSH Access

```bash
# Connect to EC2 instance
eb ssh

# View Docker containers
sudo docker ps

# Check container logs
sudo docker logs <container-id>

# Inspect container
sudo docker inspect <container-id>
```

---

## Cost Optimization

### Estimated Monthly Costs (us-east-1)

| Service | Configuration | Estimated Cost |
|---------|--------------|----------------|
| Elastic Beanstalk | Free (pay for EC2) | $0 |
| EC2 (t3.medium) | 2 instances × 730 hrs | ~$60 |
| Application Load Balancer | 1 ALB + data transfer | ~$25 |
| ElastiCache (cache.t3.micro) | 1 node | ~$12 |
| EFS | 10 GB storage | ~$3 |
| ECR | 10 GB storage | ~$1 |
| Data Transfer | 100 GB/month | ~$9 |
| **Total** | | **~$110/month** |

### Cost Reduction Strategies

1. **Use Reserved Instances** → Save 30-50% on EC2 costs
2. **Enable Auto-scaling** → Scale down during low traffic
3. **Use Spot Instances** → Save up to 90% (for non-critical environments)
4. **CloudFront Caching** → Reduce data transfer costs
5. **Lifecycle Policies** → Delete old ECR images automatically
6. **Right-size Instances** → Monitor and adjust instance types
7. **Development Environment** → Use smaller instances (t3.small)

### Enable Cost Monitoring

```bash
# Enable cost allocation tags
aws ce create-cost-category-definition \
    --name ChatRelay \
    --rules file://cost-category-rules.json

# Set up billing alerts
aws cloudwatch put-metric-alarm \
    --alarm-name chatrelay-billing-alert \
    --alarm-description "Alert when estimated charges exceed $150" \
    --metric-name EstimatedCharges \
    --namespace AWS/Billing \
    --statistic Maximum \
    --period 86400 \
    --threshold 150 \
    --comparison-operator GreaterThanThreshold
```

---

## Security Best Practices

### 1. Environment Variables

- **Never commit secrets** to version control
- Use **AWS Secrets Manager** or **Parameter Store** for sensitive data
- Rotate credentials regularly

### 2. Network Security

- Enable **VPC** for all services
- Use **private subnets** for ElastiCache and EFS
- Configure **security groups** with least privilege
- Enable **VPC Flow Logs** for auditing

### 3. SSL/TLS

- Use **AWS Certificate Manager** for free SSL certificates
- Enforce **HTTPS-only** traffic
- Enable **HSTS headers**

### 4. Access Control

- Use **IAM roles** instead of access keys
- Enable **MFA** for AWS console access
- Follow **principle of least privilege**
- Enable **AWS CloudTrail** for audit logging

### 5. Container Security

- Scan images for vulnerabilities using **ECR scanning**
- Use **minimal base images** (Alpine, Distroless)
- Run containers as **non-root users**
- Keep dependencies updated

---

## Backup and Disaster Recovery

### Automated Backups

**EFS Backups:**
```bash
# Enable automatic backups
aws backup create-backup-plan --backup-plan file://efs-backup-plan.json
```

**Database Backups (if using RDS):**
```bash
# Enable automated backups with 7-day retention
aws rds modify-db-instance \
    --db-instance-identifier chatrelay-db \
    --backup-retention-period 7 \
    --preferred-backup-window "03:00-04:00"
```

### Disaster Recovery Plan

1. **RTO (Recovery Time Objective):** < 1 hour
2. **RPO (Recovery Point Objective):** < 15 minutes

**Recovery Steps:**
```bash
# 1. Create new environment from saved configuration
eb clone chatrelay-prod --clone-name chatrelay-recovery

# 2. Restore EFS data from backup
aws backup start-restore-job \
    --recovery-point-arn arn:aws:backup:region:account:recovery-point/backup-id \
    --metadata file://restore-metadata.json

# 3. Update DNS to point to new environment
# 4. Verify application health
# 5. Decommission failed environment
```

---

## Migration from Current NAS Deployment

### Migration Checklist

- [ ] Create and configure AWS services (ECR, ElastiCache, EFS)
- [ ] Build and push Docker images to ECR
- [ ] Update session store to use Redis
- [ ] Configure EFS for persistent data
- [ ] Test application in staging environment
- [ ] Set up monitoring and alerts
- [ ] Configure CI/CD pipeline for AWS
- [ ] Perform load testing
- [ ] Plan DNS cutover
- [ ] Execute migration during low-traffic window
- [ ] Monitor application performance
- [ ] Verify data integrity
- [ ] Keep NAS deployment as backup for 2 weeks

### Data Migration

```bash
# Export conversation history from NAS
scp user@nas-ip:/path/to/data/history.json ./backup/

# Upload to EFS via EC2 instance
eb ssh
sudo cp /tmp/history.json /mnt/efs/data/history.json
sudo chown 1000:1000 /mnt/efs/data/history.json
```

---

## Additional Resources

- [AWS Elastic Beanstalk Documentation](https://docs.aws.amazon.com/elasticbeanstalk/)
- [Multi-Container Docker Configuration](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/create_deploy_docker_v2config.html)
- [AWS ElastiCache for Redis](https://docs.aws.amazon.com/AmazonElastiCache/latest/red-ug/)
- [Amazon EFS User Guide](https://docs.aws.amazon.com/efs/latest/ug/)
- [AWS Well-Architected Framework](https://aws.amazon.com/architecture/well-architected/)

---

## Support and Maintenance

### Health Checks

Configure health check endpoints in all services:

- **Main App:** `GET /health` → Returns `{ status: 'healthy' }`
- **Agent Service:** `GET /health` → Returns `{ status: 'healthy' }`
- **MCP Gateway:** `GET /health` → Returns `{ status: 'healthy' }`

### Maintenance Windows

- **Scheduled Updates:** Every Sunday 2:00 AM - 4:00 AM UTC
- **Security Patches:** Applied within 48 hours of release
- **EB Platform Updates:** Reviewed monthly, applied quarterly

### Rollback Procedure

```bash
# List previous versions
eb deploy --version

# Rollback to previous version
eb deploy --version app-version-label

# Verify rollback
eb health
eb logs
```

---

## Conclusion

This guide provides comprehensive instructions for deploying ChatRelay to AWS Elastic Beanstalk. The multi-container Docker architecture ensures all services run cohesively while leveraging AWS managed services for scalability, reliability, and security.

For production deployments, ensure all security best practices are followed, monitoring is configured, and disaster recovery procedures are tested.

**Next Steps:**
1. Review and customize configuration files
2. Set up AWS services (ECR, ElastiCache, EFS)
3. Build and test in staging environment
4. Configure CI/CD pipeline
5. Deploy to production
6. Monitor and optimize performance

For questions or issues, refer to the troubleshooting section or consult AWS support.
