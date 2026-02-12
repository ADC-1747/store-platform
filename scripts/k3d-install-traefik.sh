#!/bin/bash
# Install Traefik Ingress Controller (k3s default)
# This mimics the production k3s setup which uses Traefik by default

set -e

echo "🚀 Installing Traefik Ingress Controller..."

# Add Traefik Helm repository
echo "📦 Adding Traefik Helm repository..."
helm repo add traefik https://traefik.github.io/charts
helm repo update

# Install Traefik in kube-system namespace (like k3s does)
echo "📦 Installing Traefik..."
helm upgrade --install traefik traefik/traefik \
  --namespace kube-system \
  --set ports.web.exposedPort=80 \
  --set ports.websecure.exposedPort=443 \
  --set ingressClass.enabled=true \
  --set ingressClass.isDefaultClass=true \
  --wait

echo "⏳ Waiting for Traefik to be ready..."
kubectl wait --namespace kube-system \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/name=traefik \
  --timeout=120s

echo ""
echo "✅ Traefik installed successfully!"
echo ""
echo "📊 Traefik Status:"
kubectl get pods -n kube-system -l app.kubernetes.io/name=traefik
echo ""
kubectl get svc -n kube-system -l app.kubernetes.io/name=traefik

echo ""
echo "✅ Setup complete! Next step:"
echo "   Run ./k3d-deploy-test.sh to deploy your Helm chart"
