# Urumi Store Provisioning Platform

A powerful, automated store provisioning platform that orchestrates e-commerce stacks (WooCommerce and MedusaJS) on a local Kubernetes cluster using Helm.

## 🚀 Overview

This platform allows users to instantly provision fully isolated e-commerce stores. It supports two main engines:
1.  **WooCommerce**: A classic PHP/WordPress-based stack.
2.  **MedusaJS (Full Stack)**: A modern, headless commerce engine with dedicated PostgreSQL and Redis.

### Key Features
- **Automated Provisioning**: One-click store creation via Helm.
- **Resource isolation**: Dedicated `ResourceQuota` and `LimitRange` per namespace.
- **Auto-Bootstrapping**: MedusaJS stores automatically install all dependencies and seed the database on initialization.
- **Consistent Ingress**: Uses Traefik for both local and production environments.

---

## 🏗 Architecture

```mermaid
graph TD
    User([User]) --> Dashboard[React Dashboard]
    Dashboard --> Backend[Node.js Backend]
    Backend --> K8s[Local K8s Cluster - Kind]
    K8s --> Ingress[Ingress Nginx]
    K8s --> StoreNS[Store Namespace]
    StoreNS --> Helm[Helm Release]
    StoreNS --> Quota[Resource Quota]
```

---

## 🛠 Prerequisites

Ensure you have the following installed:
- [Docker](https://docs.docker.com/get-docker/)
- [Kind](https://kind.sigs.k8s.io/docs/user/quick-start/)
- [Helm v3](https://helm.sh/docs/intro/install/)
- [kubectl](https://kubernetes.io/docs/tasks/tools/)
- [Node.js v20+](https://nodejs.org/)

---

## 🚦 Getting Started

### 1. Setup Local Cluster

**For k3d (Recommended - matches production k3s):**
```bash
./k3d-setup.sh
./k3d-install-traefik.sh
```

**For Kind:**
```bash
kind create cluster --config kind-config.yaml
# Install Traefik ingress controller (see k3d-install-traefik.sh for reference)
```

**For Minikube:**
```bash
minikube start
minikube addons enable ingress
```

**Note**: All local environments use Traefik ingress controller for consistency with production.

### 3. Start the Backend
```bash
cd backend
npm install
node server.js
```
The backend listens at `http://localhost:3001`.

### 4. Start the Dashboard
```bash
cd dashboard
npm install
npm run dev
```
Open `http://localhost:5173` to start provisioning stores!

---

## 🌍 Environment-Specific Deployment

This platform supports both **local** and **production** deployments using environment-specific Helm values files:

- **`values-local.yaml`**: Optimized for local Kind clusters with nip.io domains
- **`values-prod.yaml`**: Production-ready configuration for k3s on VPS with TLS/SSL

### Quick Deploy

**Local (default):**
```bash
# Via API (dashboard automatically uses local)
POST /api/stores { "name": "my-store", "type": "woocommerce" }

# Via Helm
helm install my-store ./store-woocommerce -f store-woocommerce/values-local.yaml
```

**Production:**
```bash
# Via API
POST /api/stores { "name": "my-store", "type": "woocommerce", "environment": "prod" }

# Via Helm
helm install my-store ./store-woocommerce -f store-woocommerce/values-prod.yaml
```

📖 **See [ENVIRONMENT_VALUES.md](./ENVIRONMENT_VALUES.md) for detailed documentation.**

---

## 📦 Store Stacks

### WooCommerce
- **MariaDB**: Dedicated database.
- **WordPress**: Core engine.
- **Bootstrap Job**: Automated WooCommerce plugin installation and admin setup.

### MedusaJS (Full Stack)
- **PostgreSQL 15**: Dedicated storage.
- **Redis 7**: Caching and event bus.
- **Medusa Server**: Auto-bootstrapped within the container using a custom Node.js script.

---

## 🧹 Cleanup
To delete the entire setup:
```bash
kind delete cluster --name store-platform
```
