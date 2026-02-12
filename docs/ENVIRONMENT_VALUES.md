# Environment-Specific Values Files

This document explains how to use environment-specific Helm values files for deploying stores in different environments.

## Overview

Each Helm chart (`store-woocommerce` and `store-medusa`) now has three values files:

1. **`values.yaml`** - Base values with common defaults
2. **`values-local.yaml`** - Local development environment (Kind)
3. **`values-prod.yaml`** - Production environment (k3s on VPS)

## Key Differences Between Environments

### Local Environment (`values-local.yaml`)
- **Ingress**: Traefik with `nip.io` domains (e.g., `store-name.127.0.0.1.nip.io`)
- **Storage Class**: Cluster default (auto-detected: `standard` for Kind, `local-path` for k3d/k3s)
- **Resources**: Lower CPU/memory limits for development
- **Replicas**: Single replica
- **TLS**: Disabled
- **Autoscaling**: Disabled
- **Images**: Local images with `IfNotPresent` pull policy

### Production Environment (`values-prod.yaml`)
- **Ingress**: Traefik with real domains and TLS/SSL via cert-manager
- **Storage Class**: `local-path` (k3s default)
- **Resources**: Higher CPU/memory limits for production workloads
- **Replicas**: Multiple replicas for high availability
- **TLS**: Enabled with Let's Encrypt certificates
- **Autoscaling**: Enabled with HPA
- **Images**: Registry images with `Always` pull policy
- **Security**: Requires external secret management

## Usage

### Manual Deployment

#### Local Environment
```bash
# WooCommerce
helm install my-store ./store-woocommerce \
  -n store-my-store \
  -f store-woocommerce/values-local.yaml

# Medusa
helm install my-medusa ./store-medusa \
  -n store-my-medusa \
  -f store-medusa/values-local.yaml
```

#### Production Environment
```bash
# WooCommerce
helm install my-store ./store-woocommerce \
  -n store-my-store \
  -f store-woocommerce/values-prod.yaml

# Medusa (with secrets)
helm install my-medusa ./store-medusa \
  -n store-my-medusa \
  -f store-medusa/values-prod.yaml \
  --set postgres.password=<secure-password> \
  --set admin.password=<secure-password> \
  --set security.jwtSecret=<random-string> \
  --set security.cookieSecret=<random-string>
```

### Via Backend API

The backend now accepts an `environment` parameter:

```bash
# Create local store
curl -X POST http://localhost:3001/api/stores \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-store",
    "type": "woocommerce",
    "environment": "local"
  }'

# Create production store
curl -X POST http://localhost:3001/api/stores \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-store",
    "type": "medusa",
    "environment": "prod"
  }'
```

## Customizing Values

### Override Specific Values

You can override specific values using `--set`:

```bash
helm install my-store ./store-woocommerce \
  -f store-woocommerce/values-local.yaml \
  --set replicaCount=2 \
  --set resources.limits.memory=2Gi
```

### Create Custom Values File

For specific deployments, create a custom values file:

```bash
# custom-values.yaml
replicaCount: 3
resources:
  limits:
    memory: 4Gi
```

Then use it alongside environment values:

```bash
helm install my-store ./store-woocommerce \
  -f store-woocommerce/values-local.yaml \
  -f custom-values.yaml
```

## Production Considerations

### Security
- **Never commit production secrets** to version control
- Use external secret management (e.g., Sealed Secrets, External Secrets Operator)
- Provide secrets via `--set` flags or separate secret files

### Domain Configuration
- Replace `yourdomain.com` in `values-prod.yaml` with your actual domain
- Ensure DNS is properly configured
- Install cert-manager for automatic TLS certificate management

### Storage
- Verify storage class availability: `kubectl get storageclass`
- Adjust storage sizes based on expected usage
- Consider backup strategies for persistent data

### Monitoring
- Add monitoring annotations for Prometheus
- Configure alerting for critical resources
- Set up log aggregation

## Troubleshooting

### Check Applied Values
```bash
helm get values <release-name> -n <namespace>
```

### Validate Before Install
```bash
helm install --dry-run --debug my-store ./store-woocommerce \
  -f store-woocommerce/values-local.yaml
```

### Upgrade Existing Deployment
```bash
helm upgrade my-store ./store-woocommerce \
  -n store-my-store \
  -f store-woocommerce/values-prod.yaml
```
