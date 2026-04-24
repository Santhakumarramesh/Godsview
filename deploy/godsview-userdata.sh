#!/bin/bash
set -euo pipefail

# GodsView EC2 Provisioning Script
# Usage: Pass as User Data when launching an EC2 instance
# Prerequisites: Ubuntu 22.04 AMI, t3.medium or larger

echo "=== GodsView EC2 Setup ==="

# Install Docker
apt-get update -y
apt-get install -y docker.io docker-compose-plugin git
systemctl enable docker
systemctl start docker

# Clone repo
cd /opt
git clone https://github.com/Santhakumarramesh/Godsview.git
cd Godsview

# Create .env from environment — NEVER hardcode secrets
cat > .env << 'ENVEOF'
NODE_ENV=production
PORT=3000
CORS_ORIGIN=*
ALPACA_API_KEY=${ALPACA_API_KEY:-your_alpaca_key}
ALPACA_SECRET_KEY=${ALPACA_SECRET_KEY:-your_alpaca_secret}
ALPACA_BASE_URL=https://paper-api.alpaca.markets/v2
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-your_anthropic_key}
TIINGO_API_KEY=${TIINGO_API_KEY:-your_tiingo_key}
ALPHA_VANTAGE_API_KEY=${ALPHA_VANTAGE_API_KEY:-your_alphavantage_key}
FINNHUB_API_KEY=${FINNHUB_API_KEY:-your_finnhub_key}
FRED_API_KEY=${FRED_API_KEY:-your_fred_key}
S3_ENDPOINT=${S3_ENDPOINT:-https://files.example.com}
S3_ACCESS_KEY_ID=${S3_ACCESS_KEY_ID:-your_s3_key}
S3_SECRET_ACCESS_KEY=${S3_SECRET_ACCESS_KEY:-your_s3_secret}
S3_BUCKET=${S3_BUCKET:-flatfiles}
DATABASE_URL=postgresql://godsview:godsview@postgres:5432/godsview
REDIS_URL=redis://redis:6379
ENVEOF

# Build and start
docker compose up -d --build

echo "=== GodsView deployed ==="
echo "API: http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4):3001"
echo "Dashboard: http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)"
