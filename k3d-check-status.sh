#!/bin/bash
# Robust diagnostic script for k3d deployment
# Writes output to k3d-status.log for reliable checking

LOG_FILE="k3d-status.log"

echo "=== Diagnostic Run at $(date) ===" > "$LOG_FILE"

echo "" >> "$LOG_FILE"
echo "=== Helm Release Status ===" >> "$LOG_FILE"
helm list -A >> "$LOG_FILE" 2>&1

echo "" >> "$LOG_FILE"
echo "=== All Kubernetes Resources (default namespace) ===" >> "$LOG_FILE"
kubectl get all,pvc,ingress,hpa -n default >> "$LOG_FILE" 2>&1

echo "" >> "$LOG_FILE"
echo "=== Pod Details ===" >> "$LOG_FILE"
kubectl get pods -n default -o wide >> "$LOG_FILE" 2>&1

echo "" >> "$LOG_FILE"
echo "=== Events (Last 20) ===" >> "$LOG_FILE"
kubectl get events -n default --sort-by='.lastTimestamp' | tail -20 >> "$LOG_FILE" 2>&1

echo "Diagnostic run complete. Check $LOG_FILE for details."
cat "$LOG_FILE"
