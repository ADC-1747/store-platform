#!/bin/bash
# Import Medusa images into k3d cluster for local development
# Usage: ./scripts/import-medusa-images.sh [cluster-name]

set -e

CLUSTER_NAME="${1:-urumi-prod-test}"

echo "🔍 Checking for k3d cluster: $CLUSTER_NAME"
if ! k3d cluster list | grep -q "$CLUSTER_NAME"; then
    echo "❌ Cluster '$CLUSTER_NAME' not found"
    echo "Available clusters:"
    k3d cluster list
    exit 1
fi

echo "🏷️  Tagging images with docker.io/library prefix..."
docker tag medusa-backend:local docker.io/library/medusa-backend:local 2>/dev/null || echo "Image already tagged or doesn't exist"
docker tag medusa-storefront:local docker.io/library/medusa-storefront:local 2>/dev/null || echo "Image already tagged or doesn't exist"

echo "📦 Importing images into k3d cluster: $CLUSTER_NAME"
k3d image import docker.io/library/medusa-backend:local docker.io/library/medusa-storefront:local -c "$CLUSTER_NAME"

echo "✅ Images imported successfully!"
echo ""
echo "📝 Next steps:"
echo "   1. Deploy Medusa store via dashboard or Helm"
echo "   2. Images will be pulled from k3d's local registry"
echo ""
echo "💡 For production, push images to Docker Hub:"
echo "   docker tag medusa-backend:local <your-dockerhub-username>/medusa-backend:latest"
echo "   docker push <your-dockerhub-username>/medusa-backend:latest"
echo "   # Then update values-prod.yaml with your Docker Hub image path"

