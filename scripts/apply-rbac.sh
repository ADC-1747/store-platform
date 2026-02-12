#!/bin/bash
# Apply RBAC Permissions for Backend
# Supports both process-based (User) and pod-based (ServiceAccount) deployments

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RBAC_DIR="$PROJECT_ROOT/backend/rbac"

echo "🔐 Applying RBAC Permissions for Backend"
echo ""

# Check if kubectl is available
if ! command -v kubectl &> /dev/null; then
    echo "❌ kubectl is not installed or not in PATH"
    exit 1
fi

# Check if cluster is accessible
if ! kubectl cluster-info &> /dev/null; then
    echo "❌ Cannot connect to Kubernetes cluster"
    echo "   Make sure cluster is running and kubectl is configured"
    exit 1
fi

echo "✅ Connected to cluster: $(kubectl config current-context)"
echo ""

# Apply ClusterRole (required for both scenarios)
echo "📦 Applying ClusterRole..."
kubectl apply -f "$RBAC_DIR/clusterrole.yaml"
echo "✅ ClusterRole applied"
echo ""

# Ask user which deployment type
echo "Select deployment type:"
echo "1) Process-based (backend runs as Node.js process - recommended, no code changes)"
echo "2) Pod-based (backend runs as Kubernetes pod - requires code changes)"
read -p "Enter choice [1 or 2]: " choice

case $choice in
    1)
        echo ""
        echo "🔧 Process-based deployment selected"
        echo ""
        
        # Get username
        read -p "Enter username that runs the backend process (or press Enter to use current user): " username
        
        if [ -z "$username" ]; then
            # Try to detect current user from kubeconfig
            current_user=$(kubectl config view -o jsonpath='{.users[?(@.name=="'$(kubectl config current-context)'")].user.name}' 2>/dev/null || echo "")
            if [ -z "$current_user" ]; then
                echo "⚠️  Could not auto-detect username. Please provide it manually:"
                read -p "Username: " username
            else
                username="$current_user"
                echo "   Using detected user: $username"
            fi
        fi
        
        if [ -z "$username" ]; then
            echo "❌ Username is required"
            exit 1
        fi
        
        # Check if binding already exists
        if kubectl get clusterrolebinding store-provisioner-user-binding &> /dev/null; then
            echo "⚠️  ClusterRoleBinding 'store-provisioner-user-binding' already exists"
            read -p "   Delete and recreate? [y/N]: " recreate
            if [[ $recreate =~ ^[Yy]$ ]]; then
                kubectl delete clusterrolebinding store-provisioner-user-binding
            else
                echo "   Keeping existing binding. Exiting."
                exit 0
            fi
        fi
        
        # Create ClusterRoleBinding for User
        echo ""
        echo "📦 Creating ClusterRoleBinding for user: $username"
        kubectl create clusterrolebinding store-provisioner-user-binding \
            --clusterrole=store-provisioner \
            --user="$username"
        
        echo "✅ RBAC applied for process-based deployment"
        echo ""
        echo "📋 Verification:"
        kubectl auth can-i create namespaces --as="$username" || echo "⚠️  Permission check failed (this is normal if user doesn't exist in cluster yet)"
        ;;
        
    2)
        echo ""
        echo "🔧 Pod-based deployment selected"
        echo ""
        
        # Apply ServiceAccount and ClusterRoleBinding
        echo "📦 Applying ServiceAccount..."
        kubectl apply -f "$RBAC_DIR/serviceaccount.yaml"
        
        echo "📦 Applying ClusterRoleBinding..."
        kubectl apply -f "$RBAC_DIR/clusterrolebinding.yaml"
        
        echo "✅ RBAC applied for pod-based deployment"
        echo ""
        echo "📋 Verification:"
        kubectl get serviceaccount store-provisioner -n default
        kubectl get clusterrolebinding store-provisioner-binding
        ;;
        
    *)
        echo "❌ Invalid choice"
        exit 1
        ;;
esac

echo ""
echo "✅ RBAC setup complete!"
echo ""
echo "📝 Summary:"
echo "   ClusterRole: store-provisioner"
if [ "$choice" = "1" ]; then
    echo "   Bound to User: $username"
    echo "   Backend can run as process - no code changes needed"
else
    echo "   ServiceAccount: store-provisioner (namespace: default)"
    echo "   Backend must run as pod with serviceAccountName: store-provisioner"
fi
echo ""
echo "💡 Note: Backend code uses kubectl commands, so it works with User-based RBAC"
echo "   without any code changes."

