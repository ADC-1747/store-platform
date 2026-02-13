# Upgrade and Rollback Guide

This guide covers how to upgrade store versions (images and chart values) and roll back safely using Helm.

---

## Table of Contents

1. [Overview](#overview)
2. [Understanding Helm Releases](#understanding-helm-releases)
3. [Upgrading Stores](#upgrading-stores)
4. [Rolling Back Stores](#rolling-back-stores)
5. [Version Management](#version-management)
6. [Best Practices](#best-practices)
7. [Troubleshooting](#troubleshooting)

---

## Overview

Helm provides built-in capabilities for upgrading and rolling back store deployments. This guide covers:

- **Upgrading store images** (WordPress, Medusa backend/storefront)
- **Upgrading chart values** (resources, replicas, configuration)
- **Rolling back to previous versions** safely
- **Managing chart versions** across multiple stores

### Key Concepts

- **Helm Release**: A deployed instance of a Helm chart
- **Revision**: A numbered snapshot of a release at a point in time
- **Release History**: Helm maintains history of all revisions (default: 10 revisions)
- **Rollback**: Reverting to a previous revision

---

## Understanding Helm Releases

### View Current Release Information

```bash
# List all releases in a namespace
helm list -n store-<store-name>

# Get detailed release information
helm get all <store-name> -n store-<store-name>

# Get current values
helm get values <store-name> -n store-<store-name>

# Get release manifest
helm get manifest <store-name> -n store-<store-name>
```

### View Release History

```bash
# View release history (shows all revisions)
helm history <store-name> -n store-<store-name>

# Example output:
# REVISION  UPDATED                  STATUS     CHART                    APP VERSION DESCRIPTION
# 1        Mon Jan 15 10:00:00 2024 deployed  store-woocommerce-0.1.0 6.8         Install complete
# 2        Mon Jan 15 11:00:00 2024 deployed  store-woocommerce-0.1.0 6.9         Upgrade complete
# 3        Mon Jan 15 12:00:00 2024 failed    store-woocommerce-0.1.0 6.9         Upgrade failed
```

---

## Upgrading Stores

### Upgrade Types

1. **Image Version Upgrade**: Update container images (WordPress, Medusa)
2. **Chart Values Upgrade**: Update configuration (resources, replicas, settings)
3. **Chart Version Upgrade**: Update to newer chart version

### 1. Upgrading Image Versions

#### WooCommerce Store

```bash
# Upgrade WordPress image version
helm upgrade <store-name> ./store-woocommerce \
  -n store-<store-name> \
  -f store-woocommerce/values-prod.yaml \
  --set image.tag=6.9-apache \
  --reuse-values

# Or specify full image
helm upgrade <store-name> ./store-woocommerce \
  -n store-<store-name> \
  -f store-woocommerce/values-prod.yaml \
  --set image.repository=wordpress \
  --set image.tag=6.9-apache \
  --reuse-values
```

#### Medusa Store

```bash
# Upgrade both backend and storefront images
helm upgrade <store-name> ./store-medusa \
  -n store-<store-name> \
  -f store-medusa/values-prod.yaml \
  --set backend.image=adc47/medusa-backend:v2.0 \
  --set storefront.image=adc47/medusa-storefront:v2.0 \
  --reuse-values

# Or upgrade individually
helm upgrade <store-name> ./store-medusa \
  -n store-<store-name> \
  -f store-medusa/values-prod.yaml \
  --set backend.image=adc47/medusa-backend:v2.0 \
  --reuse-values
```

### 2. Upgrading Chart Values

#### Update Resources

```bash
# Increase memory limits
helm upgrade <store-name> ./store-woocommerce \
  -n store-<store-name> \
  -f store-woocommerce/values-prod.yaml \
  --set resources.limits.memory=4Gi \
  --set resources.requests.memory=2Gi \
  --reuse-values
```

#### Update Replica Count

```bash
# Scale WooCommerce to 3 replicas
helm upgrade <store-name> ./store-woocommerce \
  -n store-<store-name> \
  -f store-woocommerce/values-prod.yaml \
  --set replicaCount=3 \
  --reuse-values

# Scale Medusa backend
helm upgrade <store-name> ./store-medusa \
  -n store-<store-name> \
  -f store-medusa/values-prod.yaml \
  --set backend.replicas=2 \
  --reuse-values
```

#### Update Configuration Values

```bash
# Update environment-specific values
helm upgrade <store-name> ./store-woocommerce \
  -n store-<store-name> \
  -f store-woocommerce/values-prod.yaml \
  --set wordpress.debug=false \
  --set autoscaling.enabled=true \
  --reuse-values
```

### 3. Upgrading Chart Version

```bash
# Upgrade to newer chart version (if chart version changed)
helm upgrade <store-name> ./store-woocommerce \
  -n store-<store-name> \
  -f store-woocommerce/values-prod.yaml \
  --version 0.2.0  # If chart version is specified
```

### Upgrade with Wait and Timeout

For production upgrades, use `--wait` to ensure pods are ready:

```bash
helm upgrade <store-name> ./store-woocommerce \
  -n store-<store-name> \
  -f store-woocommerce/values-prod.yaml \
  --set image.tag=6.9-apache \
  --wait \
  --timeout 10m \
  --reuse-values
```

### Monitor Upgrade Progress

```bash
# Watch pods during upgrade
kubectl get pods -n store-<store-name> -w

# Check rollout status
kubectl rollout status deployment/wordpress -n store-<store-name>

# Check events
kubectl get events -n store-<store-name> --sort-by='.lastTimestamp'
```

---

## Rolling Back Stores

### When to Rollback

- Upgrade causes errors or failures
- New version has bugs or incompatibilities
- Performance degradation after upgrade
- Application becomes unavailable

### Rollback Process

#### 1. View Release History

```bash
helm history <store-name> -n store-<store-name>
```

**Example Output:**
```
REVISION  UPDATED                  STATUS     CHART                    APP VERSION DESCRIPTION
1        Mon Jan 15 10:00:00 2024 deployed  store-woocommerce-0.1.0 6.8         Install complete
2        Mon Jan 15 11:00:00 2024 deployed  store-woocommerce-0.1.0 6.9         Upgrade complete
3        Mon Jan 15 12:00:00 2024 failed    store-woocommerce-0.1.0 6.9         Upgrade failed
```

#### 2. Rollback to Previous Revision

```bash
# Rollback to most recent previous revision (revision 2 in example above)
helm rollback <store-name> -n store-<store-name>

# Rollback to specific revision
helm rollback <store-name> 2 -n store-<store-name>

# Rollback with wait (ensure rollback completes)
helm rollback <store-name> 2 -n store-<store-name> --wait --timeout 10m
```

#### 3. Verify Rollback

```bash
# Check release status
helm list -n store-<store-name>

# Check pods
kubectl get pods -n store-<store-name>

# Check rollout status
kubectl rollout status deployment/<deployment-name> -n store-<store-name>

# View release history (should show rollback as new revision)
helm history <store-name> -n store-<store-name>
```

### Rollback Considerations

#### What Gets Rolled Back

✅ **Rolled Back:**
- Container images
- Deployment configurations
- Service configurations
- Ingress configurations
- Resource limits/requests
- Replica counts
- Environment variables

❌ **NOT Rolled Back:**
- Persistent Volumes (PVCs) - data persists
- Secrets - existing secrets remain
- Database state - database migrations don't automatically rollback
- External configurations

#### Database Migrations

**Important**: Database migrations may not automatically rollback.

**WooCommerce:**
- WordPress database schema changes persist
- Plugin data persists
- May need manual database rollback if schema changed

**Medusa:**
- PostgreSQL migrations persist
- May need to run reverse migrations manually
- Consider database backups before upgrades

#### Secrets During Rollback

- Existing secrets are preserved
- Ensure secrets are compatible with rolled-back version
- If secrets changed, may need to update manually

---

## Version Management

### Chart Versioning

Helm charts have versions defined in `Chart.yaml`:

```yaml
apiVersion: v2
name: store-woocommerce
description: WooCommerce store Helm chart
type: application
version: 0.1.0  # Chart version
appVersion: "6.8"  # Application version (WordPress)
```

### Tracking Versions Per Store

**Current Implementation:**
- All stores use the same chart version
- Chart version tracked in `Chart.yaml`
- Application versions tracked via image tags

**Future Enhancement:**
- Track chart version per store in `stores.json`
- Support gradual rollout of new chart versions
- A/B testing capabilities

### Version Control Best Practices

1. **Tag Chart Versions**: Use semantic versioning (0.1.0, 0.2.0, etc.)
2. **Commit Values Files**: Track values file changes in git
3. **Document Changes**: Maintain CHANGELOG.md for chart versions
4. **Test Before Production**: Always test upgrades in local/staging first

---

## Best Practices

### Before Upgrading

1. ✅ **Backup Databases**: Backup persistent volumes before major upgrades
   ```bash
   # Backup WooCommerce database
   kubectl exec -it mariadb-0 -n store-<name> -- mysqldump -u root -p medusa > backup.sql
   
   # Backup Medusa database
   kubectl exec -it postgres-0 -n store-<name> -- pg_dump -U medusa medusa > backup.sql
   ```

2. ✅ **Test in Local Environment**: Always test upgrades locally first
   ```bash
   # Test upgrade on local store
   helm upgrade test-store ./store-woocommerce \
     -n store-test-store \
     -f store-woocommerce/values-local.yaml \
     --set image.tag=6.9-apache
   ```

3. ✅ **Review Release History**: Check current revision before upgrading
   ```bash
   helm history <store-name> -n store-<store-name>
   ```

4. ✅ **Check Compatibility**: Ensure new version is compatible with existing data

### During Upgrade

1. ✅ **Use `--wait` Flag**: Wait for pods to be ready
   ```bash
   helm upgrade ... --wait --timeout 10m
   ```

2. ✅ **Monitor Progress**: Watch pods and events
   ```bash
   kubectl get pods -n store-<store-name> -w
   kubectl get events -n store-<store-name> --sort-by='.lastTimestamp'
   ```

3. ✅ **Verify Health**: Check application health after upgrade
   ```bash
   # Check readiness probes
   kubectl get pods -n store-<store-name>
   
   # Test application
   curl http://<store-url>/wp-admin
   ```

### After Upgrade

1. ✅ **Verify Functionality**: Test critical features
2. ✅ **Monitor Metrics**: Watch for errors or performance issues
3. ✅ **Document Changes**: Record upgrade details and any issues

### Rollback Strategy

1. ✅ **Know Your Rollback Point**: Identify good revision before upgrading
2. ✅ **Test Rollback**: Practice rollback procedure in staging
3. ✅ **Have Backup Plan**: Know how to restore from backups if needed
4. ✅ **Document Rollback Steps**: Keep rollback procedure documented

---

## Troubleshooting

### Upgrade Fails

**Symptoms:**
- Helm upgrade command fails
- Pods fail to start
- Application errors after upgrade

**Solutions:**

1. **Check Pod Logs:**
   ```bash
   kubectl logs <pod-name> -n store-<store-name>
   ```

2. **Check Events:**
   ```bash
   kubectl get events -n store-<store-name> --sort-by='.lastTimestamp'
   ```

3. **Check Resource Constraints:**
   ```bash
   kubectl describe pod <pod-name> -n store-<store-name>
   ```

4. **Rollback Immediately:**
   ```bash
   helm rollback <store-name> -n store-<store-name>
   ```

### Rollback Fails

**Symptoms:**
- Rollback command fails
- Pods don't restore to previous state

**Solutions:**

1. **Check Release History:**
   ```bash
   helm history <store-name> -n store-<store-name>
   ```

2. **Manual Rollback:**
   ```bash
   # Get previous revision values
   helm get values <store-name> -n store-<store-name> --revision 2
   
   # Re-apply with previous values
   helm upgrade <store-name> ./store-woocommerce \
     -n store-<store-name> \
     --set <previous-values>
   ```

3. **Delete and Recreate:**
   - Last resort: Delete store and recreate from backup

### Image Pull Errors

**Symptoms:**
- Pods stuck in `ImagePullBackOff` state
- Cannot pull new image version

**Solutions:**

1. **Verify Image Exists:**
   ```bash
   docker pull <image>:<tag>
   ```

2. **Check Image Pull Policy:**
   ```bash
   # Ensure imagePullPolicy is correct
   kubectl get deployment <name> -n store-<name> -o yaml | grep imagePullPolicy
   ```

3. **Use Existing Image:**
   ```bash
   # Rollback to previous image
   helm rollback <store-name> -n store-<store-name>
   ```

### Database Migration Issues

**Symptoms:**
- Application errors after upgrade
- Database schema incompatibilities

**Solutions:**

1. **Check Migration Status:**
   ```bash
   # For Medusa
   kubectl logs job/medusa-migrate -n store-<name>
   ```

2. **Run Migrations Manually:**
   ```bash
   # If needed, run migrations manually
   kubectl exec -it <pod> -n store-<name> -- <migration-command>
   ```

3. **Restore from Backup:**
   ```bash
   # Restore database from backup
   kubectl exec -it <db-pod> -n store-<name> -- <restore-command>
   ```

---

## Examples

### Complete Upgrade Workflow

```bash
# 1. Check current state
helm list -n store-my-store
helm get values my-store -n store-my-store

# 2. Backup database
kubectl exec -it mariadb-0 -n store-my-store -- mysqldump -u root -p medusa > backup.sql

# 3. Upgrade WordPress image
helm upgrade my-store ./store-woocommerce \
  -n store-my-store \
  -f store-woocommerce/values-prod.yaml \
  --set image.tag=6.9-apache \
  --wait \
  --timeout 10m \
  --reuse-values

# 4. Verify upgrade
kubectl get pods -n store-my-store
curl http://my-store.example.com

# 5. If issues, rollback
helm rollback my-store -n store-my-store --wait
```

### Rollback Workflow

```bash
# 1. Check release history
helm history my-store -n store-my-store

# 2. Identify good revision (e.g., revision 2)
helm get values my-store -n store-my-store --revision 2

# 3. Rollback
helm rollback my-store 2 -n store-my-store --wait --timeout 10m

# 4. Verify rollback
helm list -n store-my-store
kubectl get pods -n store-my-store
curl http://my-store.example.com
```

---

## Summary

- ✅ **Upgrades**: Use `helm upgrade` with `--wait` for production
- ✅ **Rollbacks**: Use `helm rollback` to revert to previous revisions
- ✅ **Version Management**: Track chart versions in `Chart.yaml`
- ✅ **Best Practices**: Always backup, test locally, and monitor upgrades
- ✅ **Troubleshooting**: Check logs, events, and rollback if needed

**Key Takeaway**: Helm's built-in upgrade/rollback capabilities make store version management safe and reliable. Always test upgrades in a non-production environment first and maintain backups.

---

📖 **Related Documentation:**
- [README.md](../README.md) - Quick reference for upgrade/rollback
- [SYSTEM_DESIGN.md](../SYSTEM_DESIGN.md) - Architecture and upgrade strategy
- [ENVIRONMENT_VALUES.md](./ENVIRONMENT_VALUES.md) - Values file differences

