#!/bin/bash
# k3d Setup Script for Production-Like Testing
# This script creates a k3s cluster using k3d that mimics production VPS setup

set -e

CLUSTER_NAME="urumi-prod-test"
K3S_VERSION="v1.28.5-k3s1"

echo "🚀 Setting up k3d cluster for production-like testing..."

# Check if k3d is installed
if ! command -v k3d &> /dev/null; then
    echo "❌ k3d is not installed. Installing k3d..."
    curl -s https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh | bash
else
    echo "✅ k3d is already installed: $(k3d version)"
fi

# Check if Docker is running
if ! docker info &> /dev/null; then
    echo "❌ Docker is not running. Please start Docker and try again."
    exit 1
fi

# Check if ports 80 and 443 are available
check_port() {
    local port=$1
    if ss -tuln | grep -q ":${port} "; then
        return 1  # Port is in use
    fi
    return 0  # Port is available
}

# Allow ports to be overridden via environment variables
HTTP_PORT=${K3D_HTTP_PORT:-80}
HTTPS_PORT=${K3D_HTTPS_PORT:-443}

if ! check_port $HTTP_PORT; then
    echo "⚠️  Port $HTTP_PORT is already in use."
    echo "   To find what's using it, run: sudo lsof -i :$HTTP_PORT"
    echo "   Or use: sudo ss -tulpn | grep :$HTTP_PORT"
    echo ""
    
    # If ports are set via env vars, use them automatically
    if [[ -n "$K3D_HTTP_PORT" ]] || [[ -n "$K3D_HTTPS_PORT" ]]; then
        echo "⚠️  Ports specified via environment variables are in use."
        echo "   Please free up the ports or set different values:"
        echo "   export K3D_HTTP_PORT=8080"
        echo "   export K3D_HTTPS_PORT=8443"
        exit 1
    fi
    
    # Interactive mode - check if stdin is available
    if [ -t 0 ]; then
        read -p "Would you like to use alternative ports? (y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            read -p "Enter HTTP port (default: 8080): " HTTP_PORT
            HTTP_PORT=${HTTP_PORT:-8080}
            read -p "Enter HTTPS port (default: 8443): " HTTPS_PORT
            HTTPS_PORT=${HTTPS_PORT:-8443}
            
            if ! check_port $HTTP_PORT; then
                echo "❌ Port $HTTP_PORT is also in use. Exiting."
                exit 1
            fi
            if ! check_port $HTTPS_PORT; then
                echo "❌ Port $HTTPS_PORT is also in use. Exiting."
                exit 1
            fi
            echo "✅ Using ports $HTTP_PORT (HTTP) and $HTTPS_PORT (HTTPS)"
        else
            echo "❌ Cannot proceed without available ports. Exiting."
            echo "   Tip: Set K3D_HTTP_PORT and K3D_HTTPS_PORT environment variables to use alternative ports."
            exit 1
        fi
    else
        echo "❌ Cannot proceed without available ports (non-interactive mode)."
        echo "   Set environment variables to use alternative ports:"
        echo "   export K3D_HTTP_PORT=8080"
        echo "   export K3D_HTTPS_PORT=8443"
        exit 1
    fi
fi

# Delete existing cluster if it exists
if k3d cluster list | grep -q "$CLUSTER_NAME"; then
    echo "🗑️  Deleting existing cluster: $CLUSTER_NAME"
    k3d cluster delete "$CLUSTER_NAME"
fi

# Create k3d cluster with k3s configuration
echo "📦 Creating k3d cluster: $CLUSTER_NAME"
k3d cluster create "$CLUSTER_NAME" \
  --image "rancher/k3s:${K3S_VERSION}" \
  --port "${HTTP_PORT}:80@loadbalancer" \
  --port "${HTTPS_PORT}:443@loadbalancer" \
  --servers 1 \
  --agents 2 \
  --k3s-arg "--disable=traefik@server:0" \
  --wait

echo "📝 Note: Cluster is accessible via ports $HTTP_PORT (HTTP) and $HTTPS_PORT (HTTPS)"

echo "⏳ Waiting for cluster to be ready..."
kubectl wait --for=condition=Ready nodes --all --timeout=120s

echo "✅ k3d cluster created successfully!"
echo ""
echo "📊 Cluster Info:"
kubectl cluster-info
echo ""
kubectl get nodes

echo ""
echo "✅ Setup complete! Next steps:"
echo "   1. Run ./k3d-install-traefik.sh to install Traefik ingress controller"
echo "   2. Run ./k3d-deploy-test.sh to deploy your Helm chart"
