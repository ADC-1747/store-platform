# k3d Testing for Production-Like Deployment

This directory contains scripts and configuration for testing your Helm charts in a production-like k3s environment using k3d.

## 🚀 Quick Start

```bash
# 1. Create k3d cluster
./scripts/k3d-setup.sh

# 2. Install Traefik ingress controller
./scripts/k3d-install-traefik.sh

# 3. Deploy a test store via dashboard or API
# Option A: Use the dashboard (recommended)
# - Start backend: cd backend && npm install && node server.js
# - Start dashboard: cd dashboard && npm install && npm run dev
# - Open http://localhost:5173 and create a store

# Option B: Deploy via Helm directly
helm install test-store ./store-woocommerce \
  -n store-test-store \
  --create-namespace \
  -f store-woocommerce/values-local.yaml

# 4. Cleanup when done
./scripts/k3d-cleanup.sh
```

## 📁 Available Scripts

- **k3d-setup.sh** - Creates k3d cluster with k3s (located in `scripts/` directory)
- **k3d-install-traefik.sh** - Installs Traefik ingress controller (located in `scripts/` directory)
- **k3d-cleanup.sh** - Removes k3d cluster (located in `scripts/` directory)
- **apply-rbac.sh** - Applies RBAC permissions for backend (located in `scripts/` directory)

## 📖 Full Documentation

For detailed setup instructions, see:
- [INSTRUCTIONS.md](../INSTRUCTIONS.md) - Complete setup guide
- [README.md](../README.md) - Main documentation
- [ENVIRONMENT_VALUES.md](./ENVIRONMENT_VALUES.md) - Values file differences

## ✅ What This Tests

- ✅ Same Helm charts work in production k3s
- ✅ Traefik ingress controller (k3s default)
- ✅ local-path storage class (k3s default)
- ✅ Multiple replicas and autoscaling
- ✅ Multi-store deployment capability
- ✅ Persistent storage
- ✅ Readiness/liveness probes
- ✅ Clean teardown
