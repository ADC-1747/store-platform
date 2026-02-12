# Accessing Store Secrets for Admin Login

## Where Secrets Are Stored

Secrets are stored in two places:

### 1. **Backend JSON File** (`backend/stores.json`)
- Each store has a `secrets` object containing all generated passwords
- File location: `backend/stores.json`
- Format:
  ```json
  {
    "id": "...",
    "name": "my-store",
    "secrets": {
      "adminPassword": "generated-password-here",
      "mariadbPassword": "...",
      "mariadbRootPassword": "..."
    }
  }
  ```

### 2. **Kubernetes Secrets**
- Secrets are also stored as Kubernetes Secret resources in the store namespace
- Location: `store-<store-name>` namespace
- Secret names:
  - WooCommerce: `mariadb-secret`
  - Medusa: `postgres-secret`, `medusa-secret`

---

## How to Access Secrets

### Method 1: Dashboard UI (Easiest)

1. Open the dashboard: `http://localhost:5173`
2. Find your store in the list
3. Click **"View Details"** button
4. You'll see a **🔐 Admin Credentials** section showing:
   - **WooCommerce**: Username (`admin`) and Password
   - **Medusa**: Email and Password
5. Click **"Copy"** button to copy password to clipboard

### Method 2: API Endpoint

```bash
# Get all stores (includes secrets)
curl http://localhost:3001/api/stores

# Get specific store by ID
curl http://localhost:3001/api/stores/<store-id>
```

Response includes `secrets` object:
```json
{
  "id": "...",
  "name": "my-store",
  "secrets": {
    "adminPassword": "abc123...",
    "mariadbPassword": "..."
  }
}
```

### Method 3: Direct File Access

```bash
# View stores.json file
cat backend/stores.json | jq '.[] | {name: .name, adminPassword: .secrets.adminPassword}'

# Or view full file
cat backend/stores.json
```

### Method 4: Kubernetes Secrets

```bash
# For WooCommerce stores
kubectl get secret mariadb-secret -n store-<store-name> -o jsonpath='{.data.password}' | base64 -d

# For Medusa stores
kubectl get secret medusa-secret -n store-<store-name> -o jsonpath='{.data.jwtSecret}' | base64 -d
```

---

## Admin Login Credentials

### WooCommerce Stores

- **Admin URL**: `http://<store-name>.127.0.0.1.nip.io/wp-admin` (local)
- **Admin URL**: `https://<store-name>.<domain>/wp-admin` (production)
- **Username**: `admin` (always)
- **Password**: 
  - **Local**: `admin123` (default)
  - **Production**: Generated secure password (shown in dashboard)

### Medusa Stores

- **Admin URL**: `http://<store-name>.127.0.0.1.nip.io:9000/app` (local)
- **Admin URL**: `https://<store-name>-api.<domain>/app` (production)
- **Email**: Auto-generated from domain (e.g., `admin@<domain>`)
- **Password**: 
  - **Local**: `supersecret` (default)
  - **Production**: Generated secure password (shown in dashboard)

---

## Default Passwords (Local Development Only)

For local stores created with `nip.io` domains:

- **WooCommerce**: `admin123`
- **Medusa**: `supersecret`

These are only used for local testing. Production stores always use generated secure passwords.

---

## Security Notes

⚠️ **Important**: 
- Secrets are stored in plain text in `stores.json` (for demo purposes)
- In production, consider:
  - Using a secure secret store (Vault, AWS Secrets Manager)
  - Encrypting secrets in the database
  - Not exposing secrets via API (use separate authenticated endpoint)
  - Rotating secrets periodically

---

## Example: Getting Admin Password via API

```bash
# Get store and extract admin password
STORE_ID="your-store-id"
curl http://localhost:3001/api/stores | jq ".[] | select(.id == \"$STORE_ID\") | .secrets.adminPassword"

# Or for WooCommerce specifically
curl http://localhost:3001/api/stores | jq ".[] | select(.type == \"woocommerce\") | {name: .name, password: .secrets.adminPassword}"
```

---

## Troubleshooting

### Secrets Not Showing in Dashboard

1. **Check if store is Ready**: Secrets are only generated for production stores
2. **Check API response**: `curl http://localhost:3001/api/stores` - look for `secrets` object
3. **Check stores.json**: `cat backend/stores.json | jq '.[] | .secrets'`

### Forgot Password

1. **Local stores**: Use default passwords (`admin123` for WooCommerce, `supersecret` for Medusa)
2. **Production stores**: Check dashboard or API response
3. **Reset**: Delete and recreate the store (secrets will be regenerated)

