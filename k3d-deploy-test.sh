#!/bin/bash
# Deploy Helm Chart to k3d for Production-Like Testing
# This script deploys your Helm chart using production-like configuration

set -e

RELEASE_NAME="${1:-test-store}"
CHART_PATH="./store-woocommerce"
VALUES_FILE="values-k3d-test.yaml"

echo "🚀 Deploying Helm chart to k3d cluster..."
echo "   Release Name: $RELEASE_NAME"
echo "   Chart Path: $CHART_PATH"
echo "   Values File: $VALUES_FILE"
echo ""

# Check if cluster is running
if ! kubectl cluster-info &> /dev/null; then
    echo "❌ Kubernetes cluster is not accessible. Please run ./k3d-setup.sh first."
    exit 1
fi

# Check if Traefik is installed
if ! kubectl get pods -n kube-system -l app.kubernetes.io/name=traefik &> /dev/null; then
    echo "⚠️  Traefik not found. Installing Traefik first..."
    ./k3d-install-traefik.sh
fi

# Lint the Helm chart
echo "🔍 Linting Helm chart..."
helm lint "$CHART_PATH" -f "$VALUES_FILE"

# Deploy the Helm chart
echo "📦 Deploying Helm chart..."
helm upgrade --install "$RELEASE_NAME" "$CHART_PATH" \
  -f "$VALUES_FILE" \
  --create-namespace \
  --wait \
  --timeout 10m

echo ""
echo "✅ Deployment complete!"
echo ""
echo "📊 Deployment Status:"
kubectl get all -l "app.kubernetes.io/instance=$RELEASE_NAME"
echo ""
echo "📊 Ingress Status:"
kubectl get ingress -l "app.kubernetes.io/instance=$RELEASE_NAME"
echo ""
echo "📊 PVC Status:"
kubectl get pvc -l "app.kubernetes.io/instance=$RELEASE_NAME"

# Get the ingress URL
INGRESS_HOST=$(kubectl get ingress -l "app.kubernetes.io/instance=$RELEASE_NAME" -o jsonpath='{.items[0].spec.rules[0].host}')

echo ""
echo "🌐 Access your store at: http://$INGRESS_HOST"
echo ""
echo "📝 Useful commands:"
echo "   View pods:        kubectl get pods -l app.kubernetes.io/instance=$RELEASE_NAME"
echo "   View logs:        kubectl logs -l app.kubernetes.io/instance=$RELEASE_NAME --all-containers=true"
echo "   Delete release:   helm uninstall $RELEASE_NAME"
echo "   Port forward:     kubectl port-forward svc/${RELEASE_NAME}-wordpress 8080:80"
