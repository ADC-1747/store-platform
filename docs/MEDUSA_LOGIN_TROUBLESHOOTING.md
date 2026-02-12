# Medusa Admin Login Troubleshooting

## Issue: Unable to login with credentials shown in dashboard

### How Medusa Admin Credentials Work

1. **Admin User Creation**: The admin user is created in the `medusa-migrate` job using:
   - Email: Auto-generated from `store.domain` using Helm template logic
   - Password: From `admin.password` value

2. **Email Generation Logic**:
   - The Helm template extracts the **last 2 parts** of `store.domain`
   - For `store.127.0.0.1.nip.io` → extracts `nip.io` → creates `admin@nip.io`
   - For `store.example.com` → extracts `example.com` → creates `admin@example.com`

3. **Password**:
   - **Local environment**: `supersecret` (default)
   - **Production environment**: Generated secure password (stored in `store.secrets.adminPassword`)

### Common Issues

#### Issue 1: Email doesn't match
**Symptom**: Dashboard shows `admin@127.0.0.1.nip.io` but actual email is `admin@nip.io`

**Solution**: The Helm template uses last 2 parts of domain. For nip.io domains, try:
- Email: `admin@nip.io` (not `admin@127.0.0.1.nip.io`)

#### Issue 2: Password doesn't match
**Symptom**: Password shown in dashboard doesn't work

**Possible causes**:
1. Store was created before secrets were stored in backend
2. Environment mismatch (local vs prod)
3. Password wasn't set correctly during provisioning

**Solution**: 
- Check the actual password in Kubernetes Secret:
  ```bash
  kubectl get secret medusa-secret -n store-<store-name> -o jsonpath='{.data.adminPassword}' | base64 -d
  ```
- Or check the migrate job logs:
  ```bash
  kubectl logs job/medusa-migrate -n store-<store-name>
  ```

#### Issue 3: Admin user wasn't created
**Symptom**: Login fails with "Invalid credentials"

**Check**:
1. Verify migrate job completed successfully:
   ```bash
   kubectl get jobs -n store-<store-name>
   kubectl logs job/medusa-migrate -n store-<store-name>
   ```

2. Check if admin user exists in database:
   ```bash
   kubectl exec -it postgres-0 -n store-<store-name> -- psql -U medusa -d medusa -c "SELECT email FROM user WHERE email LIKE 'admin%';"
   ```

### How to Verify Credentials

1. **Check API response**:
   ```bash
   curl http://localhost:3001/api/stores | jq '.[] | select(.type=="medusa") | {name, secrets}'
   ```

2. **Check Kubernetes Secret** (if stored):
   ```bash
   kubectl get secret medusa-secret -n store-<store-name> -o yaml
   ```

3. **Check migrate job logs**:
   ```bash
   kubectl logs job/medusa-migrate -n store-<store-name>
   ```
   Look for: `👤 Creating admin user (idempotent)`

### Correct Credentials Format

For **nip.io domains** (local):
- Email: `admin@nip.io` (Helm template extracts last 2 parts)
- Password: `supersecret` (default for local)

For **real domains** (production):
- Email: `admin@<domain>` (e.g., `admin@example.com`)
- Password: Generated secure password (shown in dashboard)

### Fixing Email Display

The dashboard now correctly generates the email based on the Helm template logic:
- For nip.io: Extracts all parts except first → `admin@127.0.0.1.nip.io`
- For real domains: Extracts last 2 parts → `admin@example.com`

However, the **actual email created** follows Helm template logic (last 2 parts), so for nip.io it's `admin@nip.io`.

### Workaround

If email doesn't match:
1. Try `admin@nip.io` for nip.io domains
2. Or set explicit email via API:
   ```bash
   curl -X POST http://localhost:3001/api/stores \
     -H "Content-Type: application/json" \
     -d '{
       "name": "test-medusa",
       "type": "medusa",
       "environment": "local",
       "adminEmail": "admin@127.0.0.1.nip.io"
     }'
   ```

