#!/bin/bash

# AWS Elastic Beanstalk Setup Script for ChatRelay
# This script helps configure AWS resources for ChatRelay deployment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   ChatRelay AWS Elastic Beanstalk Setup Tool    ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""

# Check prerequisites
echo -e "${YELLOW}Checking prerequisites...${NC}"

command -v aws >/dev/null 2>&1 || { echo -e "${RED}AWS CLI is not installed. Please install it first.${NC}" >&2; exit 1; }
command -v eb >/dev/null 2>&1 || { echo -e "${RED}EB CLI is not installed. Install it with: pip install awsebcli${NC}" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo -e "${RED}Docker is not installed. Please install it first.${NC}" >&2; exit 1; }

echo -e "${GREEN}✓ All prerequisites installed${NC}"
echo ""

# Get AWS configuration
echo -e "${YELLOW}AWS Configuration:${NC}"
read -p "Enter AWS Region [us-east-1]: " AWS_REGION
AWS_REGION=${AWS_REGION:-us-east-1}

echo "Using region: $AWS_REGION"
echo ""

# Get AWS Account ID
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "AWS Account ID: $AWS_ACCOUNT_ID"
echo ""

# ECR Setup
echo -e "${YELLOW}Setting up ECR repositories...${NC}"
read -p "Create ECR repositories? (y/n) [y]: " CREATE_ECR
CREATE_ECR=${CREATE_ECR:-y}

if [[ $CREATE_ECR == "y" ]]; then
    echo "Creating ECR repositories..."

    aws ecr create-repository \
        --repository-name chatrelay/main-app \
        --region $AWS_REGION \
        --image-scanning-configuration scanOnPush=true \
        2>/dev/null || echo "Repository chatrelay/main-app already exists"

    aws ecr create-repository \
        --repository-name chatrelay/agent-service \
        --region $AWS_REGION \
        --image-scanning-configuration scanOnPush=true \
        2>/dev/null || echo "Repository chatrelay/agent-service already exists"

    aws ecr create-repository \
        --repository-name chatrelay/mcp-gateway \
        --region $AWS_REGION \
        --image-scanning-configuration scanOnPush=true \
        2>/dev/null || echo "Repository chatrelay/mcp-gateway already exists"

    echo -e "${GREEN}✓ ECR repositories created${NC}"
fi
echo ""

# ElastiCache Setup
echo -e "${YELLOW}ElastiCache (Redis) Setup${NC}"
read -p "Create ElastiCache Redis cluster? (y/n) [y]: " CREATE_REDIS
CREATE_REDIS=${CREATE_REDIS:-y}

if [[ $CREATE_REDIS == "y" ]]; then
    read -p "Enter VPC Subnet IDs (comma-separated): " SUBNET_IDS
    read -p "Enter Security Group ID: " SECURITY_GROUP_ID

    # Create subnet group
    aws elasticache create-cache-subnet-group \
        --cache-subnet-group-name chatrelay-redis-subnet \
        --cache-subnet-group-description "ChatRelay Redis Subnet Group" \
        --subnet-ids $(echo $SUBNET_IDS | tr ',' ' ') \
        --region $AWS_REGION \
        2>/dev/null || echo "Subnet group already exists"

    # Create Redis cluster
    aws elasticache create-cache-cluster \
        --cache-cluster-id chatrelay-sessions \
        --cache-node-type cache.t3.micro \
        --engine redis \
        --engine-version 7.0 \
        --num-cache-nodes 1 \
        --cache-subnet-group-name chatrelay-redis-subnet \
        --security-group-ids $SECURITY_GROUP_ID \
        --region $AWS_REGION \
        2>/dev/null || echo "Redis cluster already exists or check parameters"

    echo -e "${GREEN}✓ ElastiCache Redis cluster creation initiated${NC}"
    echo -e "${YELLOW}Note: It may take several minutes for the cluster to be available${NC}"
fi
echo ""

# EFS Setup
echo -e "${YELLOW}EFS (Elastic File System) Setup${NC}"
read -p "Create EFS file system? (y/n) [y]: " CREATE_EFS
CREATE_EFS=${CREATE_EFS:-y}

if [[ $CREATE_EFS == "y" ]]; then
    EFS_ID=$(aws efs create-file-system \
        --performance-mode generalPurpose \
        --throughput-mode bursting \
        --encrypted \
        --tags Key=Name,Value=chatrelay-data \
        --region $AWS_REGION \
        --query 'FileSystemId' \
        --output text 2>/dev/null || echo "")

    if [ ! -z "$EFS_ID" ]; then
        echo -e "${GREEN}✓ EFS created: $EFS_ID${NC}"
        echo -e "${YELLOW}Remember to update .ebextensions/03-efs-mount.config with EFS_ID: $EFS_ID${NC}"

        # Update config file
        sed -i.bak "s/fs-XXXXXXXX/$EFS_ID/g" .ebextensions/03-efs-mount.config
        echo -e "${GREEN}✓ Updated .ebextensions/03-efs-mount.config${NC}"
    else
        echo "EFS file system may already exist or check permissions"
    fi
fi
echo ""

# Build and Push Images
echo -e "${YELLOW}Docker Image Build and Push${NC}"
read -p "Build and push Docker images to ECR? (y/n) [n]: " BUILD_IMAGES
BUILD_IMAGES=${BUILD_IMAGES:-n}

if [[ $BUILD_IMAGES == "y" ]]; then
    VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "1.4.0")
    ECR_REGISTRY="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

    echo "Version: $VERSION"
    echo "ECR Registry: $ECR_REGISTRY"

    # Login to ECR
    echo "Logging in to ECR..."
    aws ecr get-login-password --region $AWS_REGION | \
        docker login --username AWS --password-stdin $ECR_REGISTRY

    # Build and push main app
    echo "Building main-app..."
    docker build -t chatrelay/main-app:$VERSION -f Dockerfile .
    docker tag chatrelay/main-app:$VERSION $ECR_REGISTRY/chatrelay/main-app:$VERSION
    docker tag chatrelay/main-app:$VERSION $ECR_REGISTRY/chatrelay/main-app:latest
    docker push $ECR_REGISTRY/chatrelay/main-app:$VERSION
    docker push $ECR_REGISTRY/chatrelay/main-app:latest

    # Build and push agent service
    echo "Building agent-service..."
    docker build -t chatrelay/agent-service:$VERSION -f agent-service/Dockerfile ./agent-service
    docker tag chatrelay/agent-service:$VERSION $ECR_REGISTRY/chatrelay/agent-service:$VERSION
    docker tag chatrelay/agent-service:$VERSION $ECR_REGISTRY/chatrelay/agent-service:latest
    docker push $ECR_REGISTRY/chatrelay/agent-service:$VERSION
    docker push $ECR_REGISTRY/chatrelay/agent-service:latest

    # Build and push MCP gateway
    echo "Building mcp-gateway..."
    docker build -t chatrelay/mcp-gateway:$VERSION -f mcp/Dockerfile ./mcp
    docker tag chatrelay/mcp-gateway:$VERSION $ECR_REGISTRY/chatrelay/mcp-gateway:$VERSION
    docker tag chatrelay/mcp-gateway:$VERSION $ECR_REGISTRY/chatrelay/mcp-gateway:latest
    docker push $ECR_REGISTRY/chatrelay/mcp-gateway:$VERSION
    docker push $ECR_REGISTRY/chatrelay/mcp-gateway:latest

    echo -e "${GREEN}✓ All images built and pushed${NC}"

    # Update Dockerrun.aws.json
    sed -i.bak "s|<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com|$ECR_REGISTRY|g" Dockerrun.aws.json
    echo -e "${GREEN}✓ Updated Dockerrun.aws.json with ECR registry${NC}"
fi
echo ""

# Elastic Beanstalk Setup
echo -e "${YELLOW}Elastic Beanstalk Application Setup${NC}"
read -p "Initialize EB application? (y/n) [n]: " INIT_EB
INIT_EB=${INIT_EB:-n}

if [[ $INIT_EB == "y" ]]; then
    echo "Initializing Elastic Beanstalk..."
    eb init ChatRelay \
        --region $AWS_REGION \
        --platform "Multi-container Docker" \
        || echo "EB already initialized"

    echo -e "${GREEN}✓ EB application initialized${NC}"
fi
echo ""

# Summary
echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              Setup Summary                       ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo "AWS Region: $AWS_REGION"
echo "AWS Account: $AWS_ACCOUNT_ID"
echo "ECR Registry: $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo "1. Wait for ElastiCache Redis cluster to be available"
echo "2. Get Redis endpoint: aws elasticache describe-cache-clusters --cache-cluster-id chatrelay-sessions --show-cache-node-info"
echo "3. Configure security groups to allow EC2 -> Redis (port 6379) and EC2 -> EFS (port 2049)"
echo "4. Create EB environment: eb create chatrelay-prod --instance-type t3.medium"
echo "5. Set environment variables: eb setenv OPENAI_API_KEY=xxx SESSION_SECRET=xxx REDIS_HOST=xxx"
echo "6. Deploy: eb deploy"
echo ""
echo -e "${GREEN}Setup complete!${NC}"
