# Complete Setup and Usage Instructions

This document provides step-by-step instructions for setting up and running the Urumi Store Provisioning Platform from scratch.

---

## Quick Summary
1. Make sure you have Node v20+, docker, kubectl, and helmv3 installed in the system
2. then please run the `./scripts/k3d-setup.sh`
3. then please run the `./scripts/k3d-install-traefik.sh`
4. Then please `cd backend` and then `npm install` and then `node server.js`
5. then in the dashboard dir please run `npm install` and then `npm run dev`

## 📋 Table of Contents

1. [Prerequisites](#prerequisites)
2. [Kubernetes Cluster Setup](#kubernetes-cluster-setup)
3. [Backend Server Setup](#backend-server-setup)
4. [Dashboard Setup](#dashboard-setup)
5. [Using the Platform](#using-the-platform)
6. [Cleanup](#cleanup)
7. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Software

Install the following software before proceeding:

#### 1. Docker
- **Purpose**: Required for running Kubernetes clusters (k3d/Kind) and containerized workloads
- **Installation**:
  - **Linux**: `curl -fsSL https://get.docker.com -o get-docker.sh && sh get-docker.sh`
  - **macOS**: Download from [Docker Desktop](https://www.docker.com/products/docker-desktop)
  - **Windows**: Download from [Docker Desktop](https://www.docker.com/products/docker-desktop)
- **Verify**: `docker --version` and `docker ps` (should not error)

#### 2. Kubernetes CLI (kubectl)
- **Purpose**: Command-line tool for interacting with Kubernetes clusters
- **Installation**:
  ```bash
  # Linux/macOS
  curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
  chmod +x kubectl
  sudo mv kubectl /usr/local/bin/
  
  # Or use package manager
  # Ubuntu/Debian
  sudo apt-get update && sudo apt-get install -y kubectl
  
  # macOS
  brew install kubectl
  ```
- **Verify**: `kubectl version --client`

#### 3. Helm v3
- **Purpose**: Package manager for Kubernetes (used to deploy stores)
- **Installation**:
  ```bash
  # Linux/macOS
  curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
  
  # Or use package manager
  # Ubuntu/Debian
  sudo apt-get install helm
  
  # macOS
  brew install helm
  ```
- **Verify**: `helm version`

#### 4. Node.js v20+
- **Purpose**: Required for running the backend server and dashboard
- **Installation**:
  - **Linux/macOS**: Use [nvm](https://github.com/nvm-sh/nvm) (recommended)
    ```bash
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
    nvm install 20
    nvm use 20
    ```
  - **Direct Download**: [Node.js Official Site](https://nodejs.org/)
- **Verify**: `node --version` (should be v20 or higher) and `npm --version`

#### 5. k3d (Required)
- **Purpose**: Runs k3s in Docker containers, closely matches production VPS setup
- **Installation**:
  ```bash
  curl -s https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh | bash
  ```
- **Verify**: `k3d version`

**Note**: k3d is used because it closely matches production k3s environments. The backend uses whatever Kubernetes cluster kubectl is configured for, but k3d is recommended for consistency.

### System Requirements

- **RAM**: Minimum 4GB, Recommended 8GB+
- **CPU**: 2+ cores recommended
- **Disk Space**: 10GB+ free space
- **Ports**: Ports 80 and 443 should be available (or use alternative ports)

---

## Kubernetes Cluster Setup

We use k3d to create a local Kubernetes cluster that closely matches production k3s environments.

#### Step 1: Create k3d Cluster

```bash
# Navigate to project root
cd /path/to/urumi-store-platform

# Run setup script
./scripts/k3d-setup.sh
```

**What this does:**
- Checks if k3d is installed (installs if missing)
- Checks if Docker is running
- Checks port availability (80, 443)
- Creates a k3d cluster named `urumi-prod-test`
- Configures ports for HTTP (80) and HTTPS (443)

**Note**: If ports 80/443 are in use, the script will prompt for alternative ports or you can set:
```bash
export K3D_HTTP_PORT=8080
export K3D_HTTPS_PORT=8443
./scripts/k3d-setup.sh
```

#### Step 2: Install Traefik Ingress Controller

```bash
# Install Traefik (required for ingress)
./scripts/k3d-install-traefik.sh
```

**What this does:**
- Adds Traefik Helm repository
- Installs Traefik ingress controller in `kube-system` namespace
- Configures Traefik as the default ingress class
- Waits for Traefik to be ready

#### Step 3: Verify Cluster Setup

```bash
# Check cluster status
kubectl get nodes

# Check Traefik installation
kubectl get pods -n kube-system -l app.kubernetes.io/name=traefik

# Check ingress class
kubectl get ingressclass

# Verify kubectl context (should be k3d cluster)
kubectl config current-context
```

**Expected Output:**
- Nodes should show `Ready` status
- Traefik pod should be `Running`
- IngressClass `traefik` should exist
- Current context should be `k3d-urumi-prod-test`

**Important**: 
- k3d automatically configures kubectl to use the newly created cluster
- The backend server uses `kubectl` commands, so it uses whatever cluster kubectl is currently pointing to
- **If you have multiple Kubernetes clusters configured**, ensure kubectl is pointing to the k3d cluster before starting the backend
- The backend will verify the connection at startup and warn if there are issues

---

## Backend Server Setup

The backend server orchestrates Helm deployments and manages store state.

### Step 1: Navigate to Backend Directory

```bash
cd /path/to/urumi-store-platform/backend
```

### Step 2: Install Dependencies

```bash
npm install
```

**What this installs:**
- `express` - Web framework
- `cors` - Cross-origin resource sharing
- `body-parser` - Request body parsing
- `express-rate-limit` - Rate limiting middleware
- `dotenv` - Environment variable management
- `@kubernetes/client-node` - Kubernetes client library

### Step 3: Configure Environment (Optional)

Create a `.env` file to set default environment:

```bash
# Create .env file
cat > .env << EOF
# Default environment for store provisioning
# Options: 'local' or 'prod'
DEFAULT_ENVIRONMENT=local

# Production domain (used when environment=prod)
PRODUCTION_DOMAIN=yourdomain.com

# Backend port (default: 3001)
PORT=3001
EOF
```

**Note**: This is optional. The dashboard allows selecting environment per store.

### Step 4: Apply RBAC Permissions (Optional for Local, Required for Production)

**For Local Development (k3d):**
- RBAC is **optional** - your user credentials typically have full cluster-admin access
- The backend runs as a local process using your kubectl credentials
- You can skip this step if stores are working without it

**For Production:**

The backend runs as a Node.js process (not a Kubernetes pod), so it uses your user's kubectl credentials. For production, you need to bind the ClusterRole to the **User** that runs the backend process.

**Option 1: Apply RBAC for Process-Based Deployment (Recommended - No Code Changes)**

**Using the script (Easiest):**
```bash
# Run the RBAC setup script
./scripts/apply-rbac.sh

# Follow the prompts:
# 1. Select option 1 (Process-based)
# 2. Enter username (or press Enter to auto-detect)
```

**Manual method:**
```bash
# 1. Apply ClusterRole (defines permissions)
kubectl apply -f backend/rbac/clusterrole.yaml

# 2. Bind ClusterRole to the user that runs the backend
# Replace <USERNAME> with the actual username on your VPS
kubectl create clusterrolebinding store-provisioner-user-binding \
  --clusterrole=store-provisioner \
  --user=<USERNAME>

# Verify permissions
kubectl auth can-i create namespaces --as=<USERNAME>
```

**Option 2: Apply RBAC for Pod-Based Deployment (If Backend Runs as Pod)**

If you deploy the backend as a Kubernetes pod in the future:

**Using the script:**
```bash
./scripts/apply-rbac.sh
# Select option 2 (Pod-based)
```

**Manual method:**
```bash
# Apply all RBAC manifests (ServiceAccount + ClusterRoleBinding)
kubectl apply -f backend/rbac/

# Verify ServiceAccount exists
kubectl get serviceaccount store-provisioner -n default

# Verify ClusterRole exists
kubectl get clusterrole store-provisioner
```

**What RBAC Provides:**
- ClusterRole defines permissions: create/delete namespaces, manage secrets, read storage classes
- ClusterRoleBinding grants these permissions to a User (process-based) or ServiceAccount (pod-based)
- Follows least-privilege security principle

**Note**: The current backend code uses `kubectl` commands directly, so it works with User-based RBAC without any code changes. This is the simplest production setup.

### Step 5: Verify Kubernetes Context

**CRITICAL**: The backend uses `kubectl` commands, which use whatever cluster is configured in your kubeconfig. **You must ensure kubectl is pointing to the k3d cluster** before starting the backend.

```bash
# Check current cluster context
kubectl config current-context

# Should show: k3d-urumi-prod-test
```

**If you see a different cluster or no cluster**, switch to the k3d cluster:
```bash
# List available contexts
kubectl config get-contexts

# Switch to k3d context
kubectl config use-context k3d-urumi-prod-test

# Verify you're on the right cluster
kubectl get nodes
# Should show k3d cluster nodes (typically 3 nodes: 1 server + 2 agents)
```

**Why this matters:**
- If kubectl points to a different cluster (e.g., cloud cluster, different local cluster), stores will be created in that cluster instead
- The backend will warn you at startup if it detects issues, but it's best to verify beforehand
- After running `k3d-setup.sh`, kubectl should automatically be configured, but if you have multiple clusters, verify the context

### Step 6: Start the Backend Server

```bash
# Start server
node server.js
```

**Expected Output:**
```
✅ Connected to Kubernetes cluster
   Context: k3d-urumi-prod-test
   Nodes: 3
Backend listening at http://localhost:3001
Environment configuration: DEFAULT_ENVIRONMENT=local (from .env)
Production domain: yourdomain.com (from .env)
Stores will be provisioned to: Local (Kind/k3d/Minikube)
Periodic status refresh enabled (every 5 seconds)
```

**If you see warnings**, check:
- Is the k3d cluster running? (`k3d cluster list`)
- Is kubectl pointing to the right cluster? (`kubectl config current-context`)
- Switch context if needed: `kubectl config use-context k3d-urumi-prod-test`

**Keep this terminal open** - the backend server must remain running.

**Important Note**: 
- The backend uses `kubectl` commands to interact with Kubernetes
- It uses whatever cluster `kubectl` is currently configured for (the current context)
- The k3d setup script automatically configures kubectl to use the k3d cluster
- **If you have multiple clusters**, ensure kubectl is pointing to the k3d cluster before starting the backend
- The backend verifies the connection at startup and will warn if there are issues

### Step 7: Verify Backend is Running

In a new terminal:

```bash
# Test backend health
curl http://localhost:3001/api/stores

# Should return: [] (empty array if no stores exist)
```

**Verify backend can access Kubernetes:**
```bash
# The backend should be able to list nodes
# (This is tested when you create your first store)
# If you see errors, check kubectl context is correct
kubectl get nodes
```

---

## Dashboard Setup

The dashboard is a React web application that provides the UI for managing stores.

### Step 1: Navigate to Dashboard Directory

```bash
cd /path/to/urumi-store-platform/dashboard
```

### Step 2: Install Dependencies

```bash
npm install
```

**What this installs:**
- `react` - UI framework
- `react-dom` - React DOM bindings
- `vite` - Build tool and dev server

### Step 3: Start Development Server

```bash
npm run dev
```

**Expected Output:**
```
  VITE v7.x.x  ready in xxx ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
```

**Keep this terminal open** - the dashboard dev server must remain running.

### Step 4: Open Dashboard in Browser

Open your browser and navigate to:
```
http://localhost:5173
```

You should see the Urumi Store Platform dashboard.

---

## Using the Platform

### Creating a Store

1. **Open Dashboard**: Navigate to `http://localhost:5173`
2. **Click "Create New Store"** button
3. **Fill in the form**:
   - **Store Name**: e.g., `my-test-store` (must be unique, lowercase, alphanumeric)
   - **Engine**: Select `WooCommerce` or `MedusaJS`
   - **Domain** (Optional): For production stores, enter your domain
   - **Admin Email** (Optional): Admin user email (auto-generated if empty)
4. **Click "Provision Store"**

**What happens:**
- Store appears immediately with `Provisioning` status
- Backend creates namespace `store-<name>`
- Backend installs Helm chart
- Pods start up (WordPress/MariaDB for WooCommerce, Backend/Storefront/PostgreSQL for Medusa)
- Bootstrap jobs run to configure the store
- Status changes to `Ready` when complete (typically 2-5 minutes)

### Viewing Store Details

1. **Click "View Details"** on any store card
2. **See expanded view**:
   - **Admin Credentials**: Username/password with copy button
   - **Activity Log**: Color-coded events showing provisioning progress
   - **Store URL**: Clickable link to open storefront

### Accessing Store Admin

#### WooCommerce Stores

1. **Get Admin Credentials**: Click "View Details" → Copy password
2. **Open Admin URL**: Click store URL → Add `/wp-admin` to the URL
   - Example: `http://my-store.127.0.0.1.nip.io/wp-admin`
3. **Login**:
   - Username: `admin`
   - Password: (copied from dashboard)

#### Medusa Stores

1. **Get Admin Credentials**: Click "View Details" → Copy email and password
2. **Open Admin URL**: Click store URL → Add `/app` to backend URL
   - Example: `http://my-store-api.127.0.0.1.nip.io/app`
3. **Login** with email and password from dashboard

### Placing an Order (End-to-End Test)

#### WooCommerce

1. **Open Storefront**: Click store URL in dashboard
2. **Browse Products**: Default WooCommerce theme includes sample products
3. **Add to Cart**: Click "Add to cart" on any product
4. **Checkout**: Go to cart → Proceed to checkout
5. **Payment**: Select "Cash on Delivery" (test payment method)
6. **Place Order**: Complete checkout
7. **Verify**: Login to `/wp-admin` → Orders → View order

#### Medusa

1. **Open Storefront**: Click store URL in dashboard
2. **Browse Products**: Default Medusa starter includes sample products
3. **Add to Cart**: Add products to cart
4. **Checkout**: Complete checkout flow
5. **Verify**: Login to admin panel → Orders → View order

### Deleting a Store

1. **Click "Delete"** button on store card
2. **Confirm deletion** in popup
3. **Watch status change** to `Deleting`
4. **Store disappears** when cleanup completes

**What happens:**
- Helm release is uninstalled
- Namespace is deleted (removes all resources)
- Store is removed from dashboard

---

## Cleanup

### Cleanup Individual Store

Stores can be deleted via the dashboard (see above). This removes all resources.

### Cleanup All Stores

```bash
# List all store namespaces
kubectl get namespaces | grep store-

# Delete all store namespaces (removes all stores)
kubectl get namespaces -o name | grep store- | xargs kubectl delete

# Or delete via dashboard (recommended)
```

### Cleanup Kubernetes Cluster

```bash
# Using cleanup script
./scripts/k3d-cleanup.sh

# Or manually
k3d cluster delete urumi-prod-test
```

### Cleanup Backend State

```bash
# Backend stores state in stores.json
# To reset (removes all store records):
cd backend
rm stores.json
# File will be recreated on next backend start
```

### Complete Cleanup (Everything)

```bash
# 1. Stop backend and dashboard (Ctrl+C in terminals)

# 2. Delete all stores
kubectl get namespaces -o name | grep store- | xargs kubectl delete

# 3. Delete cluster
k3d cluster delete urumi-prod-test

# 4. (Optional) Remove backend state
rm backend/stores.json
```

---

## Troubleshooting

### Backend Issues

#### Backend won't start

**Error**: `Port 3001 already in use`
```bash
# Find process using port 3001
lsof -i :3001
# Or
sudo ss -tulpn | grep :3001

# Kill the process or change port in .env
PORT=3002 node server.js
```

**Error**: `Cannot connect to Kubernetes`
```bash
# Verify kubectl can connect
kubectl get nodes

# Check if cluster is running
k3d cluster list

# Verify kubectl context is set to k3d cluster
kubectl config current-context
# Should show: k3d-urumi-prod-test

# If wrong context, switch to k3d cluster
kubectl config use-context k3d-urumi-prod-test
```

**Error**: `Backend creates stores but they don't appear in cluster`
- This usually means kubectl is pointing to a different cluster
- Check context: `kubectl config current-context`
- Switch to k3d: `kubectl config use-context k3d-urumi-prod-test`
- Restart backend after switching context

**Error**: `Permission denied` when creating namespaces
```bash
# This usually happens if RBAC is required but not applied
# For local k3d clusters, you typically have admin access, so this shouldn't happen
# If it does, apply RBAC:

kubectl apply -f backend/rbac/

# Verify ServiceAccount exists
kubectl get serviceaccount store-provisioner -n default

# Or check your current permissions
kubectl auth can-i create namespaces
```

#### Stores stuck in "Provisioning"

**Check namespace exists:**
```bash
kubectl get namespace store-<store-name>
```

**Check Helm release:**
```bash
helm list -n store-<store-name>
```

**Check pods:**
```bash
kubectl get pods -n store-<store-name>
kubectl describe pod <pod-name> -n store-<store-name>
```

**Check bootstrap job:**
```bash
kubectl get jobs -n store-<store-name>
kubectl logs job/<job-name> -n store-<store-name>
```

**Common issues:**
- Image pull errors: Check if images are available
- Resource constraints: Check ResourceQuota limits
- Storage issues: Check PVC status

### Dashboard Issues

#### Dashboard won't start

**Error**: `Port 5173 already in use`
```bash
# Kill process or use different port
npm run dev -- --port 5174
```

**Error**: `Cannot connect to backend`
- Verify backend is running: `curl http://localhost:3001/api/stores`
- Check CORS settings in backend
- Check browser console for errors

#### Stores not appearing

- Check backend is running
- Check browser console for API errors
- Verify backend URL in `dashboard/src/App.jsx` (should be `http://localhost:3001/api`)

### Cluster Issues

#### Cluster creation fails

**Ports 80/443 in use:**
```bash
# Use alternative ports
export K3D_HTTP_PORT=8080
export K3D_HTTPS_PORT=8443
./scripts/k3d-setup.sh
```

**Docker not running:**
```bash
# Start Docker
sudo systemctl start docker  # Linux
# Or start Docker Desktop (macOS/Windows)
```

**Cluster already exists:**
```bash
# Delete existing cluster first
k3d cluster delete urumi-prod-test
# Then run setup script again
./scripts/k3d-setup.sh
```

#### Traefik not working

**Check Traefik pods:**
```bash
kubectl get pods -n kube-system -l app.kubernetes.io/name=traefik
kubectl logs -n kube-system -l app.kubernetes.io/name=traefik
```

**Reinstall Traefik:**
```bash
./scripts/k3d-install-traefik.sh
```

#### Ingress not routing

**Check ingress resources:**
```bash
kubectl get ingress -A
kubectl describe ingress <ingress-name> -n <namespace>
```

**Check Traefik service:**
```bash
kubectl get svc -n kube-system -l app.kubernetes.io/name=traefik
```

**Verify ingress class:**
```bash
kubectl get ingressclass
```

### Store Access Issues

#### Cannot access store URL

**Check ingress:**
```bash
kubectl get ingress -n store-<store-name>
```

**Check DNS resolution:**
```bash
# For nip.io domains
ping my-store.127.0.0.1.nip.io

# Add to /etc/hosts if needed (Linux/macOS)
echo "127.0.0.1 my-store.127.0.0.1.nip.io" | sudo tee -a /etc/hosts
```

**Check Traefik routing:**
```bash
# View Traefik logs
kubectl logs -n kube-system -l app.kubernetes.io/name=traefik --tail=50
```

#### Admin credentials don't work

**WooCommerce:**
- Username is always `admin`
- Password is shown in dashboard (copy button)
- Check if bootstrap job completed: `kubectl get jobs -n store-<store-name>`

**Medusa:**
- Email format: `admin@<domain>` (last 2 parts of store domain)
- Password is shown in dashboard
- Check migrate job: `kubectl logs job/medusa-migrate -n store-<store-name>`

**Reset password:**
- See `docs/RESET_MEDUSA_PASSWORD.md` for Medusa
- For WooCommerce, use WordPress CLI or database access

### Resource Issues

#### Out of resources

**Check ResourceQuota:**
```bash
kubectl describe resourcequota -n store-<store-name>
```

**Check node resources:**
```bash
kubectl top nodes
kubectl top pods -A
```

**Free up resources:**
- Delete unused stores
- Reduce replica counts in values files
- Increase cluster resources

---

## Quick Reference

### Essential Commands

```bash
# Cluster status
kubectl get nodes
kubectl get namespaces

# Store status
kubectl get pods -A | grep store-
helm list -A

# Backend logs
# (View terminal where backend is running)

# Dashboard logs
# (View terminal where dashboard is running)

# Traefik status
kubectl get pods -n kube-system -l app.kubernetes.io/name=traefik
```

### Important URLs

- **Dashboard**: http://localhost:5173
- **Backend API**: http://localhost:3001/api
- **Backend Metrics**: http://localhost:3001/api/metrics
- **Store URLs**: `http://<store-name>.127.0.0.1.nip.io`

### File Locations

- **Backend**: `backend/server.js`
- **Dashboard**: `dashboard/src/App.jsx`
- **Helm Charts**: `store-woocommerce/`, `store-medusa/`
- **Values Files**: `*-local.yaml`, `*-prod.yaml`
- **State File**: `backend/stores.json`
- **RBAC**: `backend/rbac/`

---

## Next Steps

After setup is complete:

1. **Create your first store** via the dashboard
2. **Test end-to-end flow** by placing an order
3. **Explore features**:
   - View activity logs
   - Check metrics
   - Test deletion
4. **Read documentation**:
   - `SYSTEM_DESIGN.md` - Architecture details
   - `ENVIRONMENT_VALUES.md` - Configuration differences
   - `TLS_SETUP.md` - Production TLS setup
   - `ACCESSING_SECRETS.md` - Secret management

---

## Support

For issues or questions:

1. Check this troubleshooting section
2. Review `docs/` directory for detailed guides
3. Check backend logs for error messages
4. Verify all prerequisites are installed correctly

---

**Happy Provisioning! 🚀**

