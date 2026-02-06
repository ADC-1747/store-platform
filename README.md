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
- **Local-First Architecture**: Powered by Kind (Kubernetes in Docker).

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
Create the Kind cluster with Ingress support:
```bash
kind create cluster --config kind-config.yaml
```

### 2. Install Ingress Controller
Deploy the Nginx Ingress Controller:
```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml
```
*Wait for the ingress-nginx pods to be Ready.*

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
