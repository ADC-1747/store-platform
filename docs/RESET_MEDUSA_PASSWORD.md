# Reset Medusa Admin Password

## Issue
Your Medusa store was created in prod environment but the password wasn't stored in the backend. The admin user exists but the password is unknown.

## Quick Fix

### Option 1: Reset Password via kubectl (Recommended)

```bash
# Set password to supersecret (or any password you want)
kubectl exec deployment/medusa-backend -n store-test-2-mjs -- \
  npx medusa user --email admin@nip.io --password supersecret
```

**Note**: The `medusa user` command will update the password if the user exists, or create it if it doesn't.

### Option 2: Check What Password Was Actually Set

The migrate job might have used a password. Check the logs:

```bash
# Check if migrate job exists
kubectl get jobs -n store-test-2-mjs | grep migrate

# Check migrate job logs
kubectl logs job/medusa-migrate -n store-test-2-mjs 2>/dev/null | grep -A 5 "Creating admin"
```

### Option 3: Try Common Passwords

Since the store was created in prod but secrets weren't stored, try:
1. `supersecret` (default for local)
2. Empty password (if migrate job ran with empty value)
3. Check helm values to see what was set:
   ```bash
   helm get values test-2-mjs -n store-test-2-mjs | grep -A 2 "admin:"
   ```

## For Future Stores

The code has been updated to:
1. Generate secure passwords for prod environment
2. Store passwords in `store.secrets` 
3. Display passwords in dashboard

New stores created with `environment: 'prod'` will have passwords stored and displayed correctly.

## Update Backend to Store Password Retroactively

If you want to update the backend to store the password for this existing store, you can manually update `backend/stores.json`:

```bash
# Get the store ID
STORE_ID=$(curl -s http://localhost:3001/api/stores | jq '.[] | select(.name=="test-2-mjs") | .id')

# Update stores.json (backup first!)
cp backend/stores.json backend/stores.json.backup

# Add secrets manually (replace with actual password)
# This requires editing the JSON file directly
```

However, it's easier to just reset the password using Option 1 above.

