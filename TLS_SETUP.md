# TLS/HTTPS Setup Guide

## Is TLS Free?

**Yes!** You can get free TLS certificates using **Let's Encrypt**, a free, automated, and open certificate authority.

## Prerequisites

1. **A real domain** (not `nip.io` - Let's Encrypt doesn't issue certificates for nip.io)
2. **DNS configured** - Your domain must point to your server's IP address
3. **Port 80 and 443 open** - Let's Encrypt needs these ports for validation

## Step 1: Install cert-manager

cert-manager automatically manages TLS certificates in Kubernetes.

```bash
# Install cert-manager using Helm
helm repo add jetstack https://charts.jetstack.io
helm repo update

# Install cert-manager
kubectl create namespace cert-manager
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --set installCRDs=true \
  --version v1.13.0
```

## Step 2: Create Let's Encrypt ClusterIssuer

Create a ClusterIssuer resource that tells cert-manager how to get certificates from Let's Encrypt:

```bash
cat <<EOF | kubectl apply -f -
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: your-email@example.com  # Replace with your email
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
    - http01:
        ingress:
          class: traefik
EOF
```

**For testing/staging** (to avoid rate limits during setup):
```bash
cat <<EOF | kubectl apply -f -
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-staging
spec:
  acme:
    server: https://acme-staging-v02.api.letsencrypt.org/directory
    email: your-email@example.com
    privateKeySecretRef:
      name: letsencrypt-staging
    solvers:
    - http01:
        ingress:
          class: traefik
EOF
```

## Step 3: Update Your Helm Values

### For WooCommerce (`store-woocommerce/values-prod.yaml`):

Uncomment and update the TLS section:

```yaml
ingress:
  enabled: true
  className: "traefik"
  annotations:
    traefik.ingress.kubernetes.io/router.entrypoints: web,websecure
    cert-manager.io/cluster-issuer: "letsencrypt-prod"  # Uncomment this
    traefik.ingress.kubernetes.io/router.tls: "true"   # Uncomment this
  hosts:
    - host: "store.yourdomain.com"  # Your actual domain
      paths:
        - path: /
          pathType: Prefix
  tls:  # Uncomment this section
    - secretName: "store-tls"
      hosts:
        - "store.yourdomain.com"
```

### For Medusa (`store-medusa/values-prod.yaml`):

The TLS configuration is already there, just make sure it's enabled:

```yaml
ingress:
  enabled: true
  className: "traefik"
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"  # Already configured
    traefik.ingress.kubernetes.io/router.tls: "true"    # Already configured
  tls:
    - secretName: "{{ .Release.Name }}-tls"
      hosts:
        - "{{ .Release.Name }}.yourdomain.com"
```

## Step 4: Configure Traefik for HTTPS

Make sure Traefik is configured to handle HTTPS. In k3s, Traefik usually handles this automatically, but verify:

```bash
# Check Traefik configuration
kubectl get configmap -n kube-system traefik -o yaml
```

Traefik should have `websecure` entrypoint configured for port 443.

## Step 5: Provision a Store with Real Domain

When provisioning a store via the dashboard:
1. Set `DEFAULT_ENVIRONMENT=prod` in `backend/.env`
2. Enter your real domain (e.g., `example.com`) in the domain field
3. The backend will automatically enable TLS for non-nip.io domains

## Step 6: Verify Certificate

After provisioning, check the certificate:

```bash
# Check certificate status
kubectl get certificate -A

# Check certificate details
kubectl describe certificate <store-name>-tls -n store-<store-name>

# Check certificate secret
kubectl get secret <store-name>-tls -n store-<store-name>
```

## Troubleshooting

### Certificate Not Issuing

1. **Check cert-manager logs:**
   ```bash
   kubectl logs -n cert-manager deployment/cert-manager
   kubectl logs -n cert-manager deployment/cert-manager-webhook
   kubectl logs -n cert-manager deployment/cert-manager-cainjector
   ```

2. **Check CertificateRequest:**
   ```bash
   kubectl get certificaterequest -A
   kubectl describe certificaterequest <name> -n <namespace>
   ```

3. **Check Challenge:**
   ```bash
   kubectl get challenge -A
   kubectl describe challenge <name> -n <namespace>
   ```

### Common Issues

- **DNS not configured**: Domain must point to your server IP
- **Port 80 blocked**: Let's Encrypt needs port 80 for HTTP-01 challenge
- **Rate limits**: Let's Encrypt has rate limits (50 certs/week per domain)
- **Wrong ingress class**: Make sure `ingressClassName` matches Traefik

## Let's Encrypt Rate Limits

- **50 certificates per registered domain per week**
- **5 duplicate certificates per week**
- **300 new orders per account per 3 hours**

Use staging issuer for testing to avoid rate limits.

## Automatic Renewal

cert-manager automatically renews certificates before they expire (30 days before expiry). No manual intervention needed!

## Cost

**Let's Encrypt is 100% free** - no cost, no credit card, no limits (except rate limits mentioned above).

## For Local Development (nip.io)

For `nip.io` domains, TLS is automatically disabled because:
- Let's Encrypt doesn't issue certificates for nip.io
- nip.io is for local testing only
- Use HTTP for local development

The backend automatically detects `nip.io` domains and disables TLS.

