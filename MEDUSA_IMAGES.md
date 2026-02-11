# Medusa Custom Images Setup

## Overview

This project uses custom-built Medusa images for backend and storefront. This document explains how to handle them for local development and production.

## Local Development (k3d/Kind)

### Option 1: Import into k3d (Recommended)

```bash
# 1. Build your images locally (if not already built)
docker build -t medusa-backend:local ./path/to/medusa-backend
docker build -t medusa-storefront:local ./path/to/medusa-storefront

# 2. Tag with docker.io/library prefix (required by values-local.yaml)
docker tag medusa-backend:local docker.io/library/medusa-backend:local
docker tag medusa-storefront:local docker.io/library/medusa-storefront:local

# 3. Import into k3d cluster
./scripts/import-medusa-images.sh urumi-prod-test

# Or manually:
k3d image import docker.io/library/medusa-backend:local docker.io/library/medusa-storefront:local -c urumi-prod-test
```

### Option 2: Use Local Registry

```bash
# Start local registry
docker run -d -p 5000:5000 --name registry registry:2

# Tag and push to local registry
docker tag medusa-backend:local localhost:5000/medusa-backend:local
docker push localhost:5000/medusa-backend:local

# Update values-local.yaml to use localhost:5000/medusa-backend:local
```

## Production Deployment (k3s VPS)

### Push to Docker Hub

```bash
# 1. Login to Docker Hub
docker login

# 2. Tag images with your Docker Hub username
docker tag medusa-backend:local <your-username>/medusa-backend:latest
docker tag medusa-storefront:local <your-username>/medusa-storefront:latest

# 3. Push to Docker Hub
docker push <your-username>/medusa-backend:latest
docker push <your-username>/medusa-storefront:latest

# 4. Update values-prod.yaml
# backend:
#   image: docker.io/<your-username>/medusa-backend:latest
# storefront:
#   image: docker.io/<your-username>/medusa-storefront:latest
```

### Alternative: Private Registry

For production, consider using:
- **GitHub Container Registry (ghcr.io)**
- **Google Container Registry (gcr.io)**
- **AWS ECR**
- **Private Docker Registry**

## Current Configuration

- **Local**: `docker.io/library/medusa-backend:local` (imported into k3d)
- **Production**: `docker.io/yourregistry/medusa-backend:latest` (needs to be updated)

## Troubleshooting

### ImagePullBackOff Error

```bash
# Check if images are imported
k3d image list -c urumi-prod-test | grep medusa

# Re-import if needed
./scripts/import-medusa-images.sh urumi-prod-test

# Check pod events
kubectl describe pod <pod-name> -n <namespace>
```

### For Assessment

**Local Development**: Use k3d image import (no Docker Hub needed)
**Production Demo**: Push to Docker Hub and update values-prod.yaml

