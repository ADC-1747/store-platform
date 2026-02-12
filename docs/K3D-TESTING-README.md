# k3d Testing for Production-Like Deployment

This directory contains scripts and configuration for testing your Helm charts in a production-like k3s environment using k3d.

## 🚀 Quick Start

```bash
# 1. Create k3d cluster
./k3d-setup.sh

# 2. Install Traefik ingress controller
./k3d-install-traefik.sh

# 3. Deploy and test your Helm chart
./k3d-deploy-test.sh

# 4. Cleanup when done
./k3d-cleanup.sh
```

## 📁 Files

- **k3d-setup.sh** - Creates k3d cluster with k3s
- **k3d-install-traefik.sh** - Installs Traefik ingress controller
- **k3d-deploy-test.sh** - Deploys Helm chart for testing
- **k3d-cleanup.sh** - Removes k3d cluster
- **k3d-check-status.sh** - Checks deployment status and resources
- **values-k3d-test.yaml** - Production-like values for local testing

## 📖 Full Documentation

See the [k3d Testing Guide](file:///home/adc/.gemini/antigravity/brain/93aea747-dbc4-4843-a177-1f0156a08c0d/k3d-testing-guide.md) for detailed instructions, troubleshooting, and best practices.

## ✅ What This Tests

- ✅ Same Helm charts work in production k3s
- ✅ Traefik ingress controller (k3s default)
- ✅ local-path storage class (k3s default)
- ✅ Multiple replicas and autoscaling
- ✅ Multi-store deployment capability
- ✅ Persistent storage
- ✅ Readiness/liveness probes
- ✅ Clean teardown
