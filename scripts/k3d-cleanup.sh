#!/bin/bash
# Cleanup k3d cluster and resources

set -e

CLUSTER_NAME="urumi-prod-test"

echo "🗑️  Cleaning up k3d cluster..."

# Delete the cluster
if k3d cluster list | grep -q "$CLUSTER_NAME"; then
    echo "Deleting cluster: $CLUSTER_NAME"
    k3d cluster delete "$CLUSTER_NAME"
    echo "✅ Cluster deleted successfully!"
else
    echo "ℹ️  Cluster $CLUSTER_NAME does not exist."
fi

echo ""
echo "✅ Cleanup complete!"
