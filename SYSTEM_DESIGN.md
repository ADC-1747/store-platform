# System Design & Tradeoffs

This document outlines the architecture choices, design decisions, and tradeoffs made in building the Urumi Store Platform.

> **📊 Diagram Viewing**: This document contains **Mermaid diagrams** that render as visual diagrams.
> 
> **To view diagrams properly:**
> - ✅ **GitHub/GitLab**: Diagrams render automatically when viewing on GitHub
> - ✅ **VS Code**: Install "Markdown Preview Mermaid Support" extension, then use "Open Preview"
> - ✅ **Online**: Copy diagram code to [Mermaid Live Editor](https://mermaid.live) to view instantly
> - ⚠️ **Plain text editors**: Will show code blocks (diagrams need a Mermaid-compatible viewer)
> 
> **Quick test**: If you see code blocks starting with ````mermaid` instead of visual diagrams, your viewer doesn't support Mermaid. View the file on GitHub or use the Mermaid Live Editor.

---

## Architecture Overview

The platform is a **multi-tenant store provisioning system** that orchestrates Kubernetes resources to deploy ecommerce stores (WooCommerce or MedusaJS) on demand. The architecture follows a **stateless backend + Helm-based provisioning** pattern.

### Core Components

1. **Dashboard** (React + Vite)
   - Frontend UI for managing stores
   - Real-time status updates via polling (every 5 seconds)
   - Displays metrics in header (total stores, by status, provisioning duration)
   - Shows admin credentials in expanded store view
   - Displays color-coded activity logs per store

2. **Backend API** (Node.js + Express)
   - RESTful API for store CRUD operations
   - Orchestrates Helm chart deployments
   - Manages store state and metadata

3. **Helm Charts**
   - `store-woocommerce`: WordPress + MariaDB + Bootstrap job
   - `store-medusa`: Backend + Storefront + PostgreSQL + Bootstrap

4. **Kubernetes Cluster**
   - Local: Kind/k3d/Minikube
   - Production: k3s on VPS

### System Architecture Diagram

```mermaid
graph TB
    subgraph "Client Layer"
        User[👤 User]
        Browser[🌐 Web Browser]
    end
    
    subgraph "Application Layer"
        Dashboard[📊 React Dashboard<br/>Port 5173]
        Backend[⚙️ Node.js Backend<br/>Port 3001]
    end
    
    subgraph "State Management"
        StoresJSON[(📄 stores.json<br/>File-based State)]
    end
    
    subgraph "Kubernetes Cluster"
        K8sAPI[☸️ Kubernetes API]
        
        subgraph "Store Namespace"
            HelmRelease[📦 Helm Release]
            Ingress[🌐 Ingress<br/>Traefik]
            
            subgraph "WooCommerce Stack"
                WP[📝 WordPress Pod]
                MariaDB[(🗄️ MariaDB<br/>PVC)]
                BootstrapJob[🔧 Bootstrap Job]
            end
            
            subgraph "Medusa Stack"
                MedusaBackend[⚡ Medusa Backend]
                MedusaStorefront[🛍️ Medusa Storefront]
                PostgreSQL[(🗄️ PostgreSQL<br/>PVC)]
                Redis[(⚡ Redis)]
            end
            
            ResourceQuota[📊 ResourceQuota]
            LimitRange[📏 LimitRange]
            NetworkPolicy[🔒 NetworkPolicy]
        end
    end
    
    User --> Browser
    Browser --> Dashboard
    Dashboard -->|HTTP Polling<br/>Every 5s| Backend
    Backend -->|Read/Write| StoresJSON
    Backend -->|kubectl commands| K8sAPI
    K8sAPI --> HelmRelease
    HelmRelease --> WP
    HelmRelease --> MariaDB
    HelmRelease --> BootstrapJob
    HelmRelease --> MedusaBackend
    HelmRelease --> MedusaStorefront
    HelmRelease --> PostgreSQL
    HelmRelease --> Redis
    HelmRelease --> ResourceQuota
    HelmRelease --> LimitRange
    HelmRelease --> NetworkPolicy
    Ingress --> WP
    Ingress --> MedusaStorefront
    Ingress --> MedusaBackend
    
    style Dashboard fill:#e1f5ff
    style Backend fill:#fff4e1
    style StoresJSON fill:#ffe1f5
    style HelmRelease fill:#e1ffe1
    style K8sAPI fill:#f0e1ff
```

---

## Architecture Choices

### 1. File-Based State Management

**Choice**: Store metadata in JSON file (`stores.json`) instead of a database.

**Rationale**:
- Simplicity: No database setup required
- Portability: Easy to backup and migrate
- Sufficient for MVP: Handles concurrent operations via file locking

**Tradeoffs**:
- ✅ Simple deployment (no database dependency)
- ✅ Easy to inspect and debug
- ✅ Atomic operations via file mutex
- ❌ Not suitable for high-scale production (1000+ stores)
- ❌ No query capabilities beyond in-memory filtering

**Future Migration Path**: Can migrate to PostgreSQL/MySQL when needed without changing API contracts.

### 2. File Mutex for Concurrency Control

**Choice**: Custom `FileMutex` class for serializing file operations.

**Rationale**:
- Prevents race conditions in concurrent store creation/deletion
- Ensures atomic read-modify-write operations
- Simple implementation without external dependencies

**Implementation**:
```javascript
class FileMutex {
    // Queue-based locking mechanism
    // Ensures only one operation modifies stores.json at a time
}
```

**Tradeoffs**:
- ✅ Prevents data corruption
- ✅ Simple and reliable
- ❌ Sequential operations (not a bottleneck for current scale)
- ❌ In-memory only (doesn't survive backend restarts)

### 3. Background Provisioning

**Choice**: Store creation returns immediately, provisioning happens asynchronously.

**Rationale**:
- Better UX: Users don't wait for long provisioning operations
- Prevents HTTP timeouts
- Allows concurrent provisioning of multiple stores

**Implementation**:
- API returns 201 immediately with `status: "Provisioning"`
- Background async function handles Helm deployment
- Status updates via periodic refresh mechanism

**Store Provisioning Flow**:

```mermaid
sequenceDiagram
    participant User
    participant Dashboard
    participant Backend
    participant FileMutex
    participant K8sAPI
    participant Helm
    participant Pods
    
    User->>Dashboard: Click "Create Store"
    Dashboard->>Backend: POST /api/stores
    Backend->>FileMutex: Acquire lock
    Backend->>Backend: Check duplicate name
    Backend->>Backend: Create store object<br/>(status: "Provisioning")
    Backend->>FileMutex: Release lock
    Backend-->>Dashboard: 201 Created<br/>(status: "Provisioning")
    Dashboard-->>User: Store appears immediately
    
    Note over Backend: Background async provisioning starts
    
    Backend->>K8sAPI: kubectl create namespace
    K8sAPI-->>Backend: Namespace created
    Backend->>Backend: addStoreEvent("Namespace created")
    
    Backend->>Helm: helm install chart
    Helm->>K8sAPI: Create resources
    K8sAPI->>Pods: Start pods
    Helm-->>Backend: Helm install complete
    Backend->>Backend: addStoreEvent("Helm installed")
    
    loop Every 10s for max 10min
        Backend->>Pods: Check readiness
        Pods-->>Backend: Status
        alt Pods Ready
            Backend->>Backend: Update status: "Ready"
            Backend->>Backend: addStoreEvent("Store ready")
        end
    end
    
    Note over Dashboard: Polls every 5s
    Dashboard->>Backend: GET /api/stores
    Backend-->>Dashboard: Updated store status
    Dashboard-->>User: Status updates automatically
```

**Tradeoffs**:
- ✅ Fast API response
- ✅ Better user experience
- ✅ Handles concurrent provisioning
- ❌ Requires status polling mechanism
- ❌ More complex error handling

### 4. Namespace-Per-Store Isolation

**Choice**: Each store gets its own Kubernetes namespace (`store-<name>`).

**Rationale**:
- Complete resource isolation
- Easy cleanup (delete namespace = delete all resources)
- Natural multi-tenancy boundary
- Kubernetes-native approach

**Multi-Tenant Isolation Architecture**:

```mermaid
graph TB
    subgraph "Kubernetes Cluster"
        subgraph "Namespace: store-store1"
            Store1[🏪 Store 1<br/>WooCommerce]
            DB1[(🗄️ MariaDB)]
            PVC1[(💾 PVC)]
            Secret1[🔐 Secrets]
            Quota1[📊 ResourceQuota]
            Limit1[📏 LimitRange]
            NetPol1[🔒 NetworkPolicy]
        end
        
        subgraph "Namespace: store-store2"
            Store2[🏪 Store 2<br/>Medusa]
            DB2[(🗄️ PostgreSQL)]
            Redis2[(⚡ Redis)]
            PVC2[(💾 PVC)]
            Secret2[🔐 Secrets]
            Quota2[📊 ResourceQuota]
            Limit2[📏 LimitRange]
            NetPol2[🔒 NetworkPolicy]
        end
        
        subgraph "Namespace: store-store3"
            Store3[🏪 Store 3<br/>WooCommerce]
            DB3[(🗄️ MariaDB)]
            PVC3[(💾 PVC)]
            Secret3[🔐 Secrets]
            Quota3[📊 ResourceQuota]
            Limit3[📏 LimitRange]
            NetPol3[🔒 NetworkPolicy]
        end
        
        Ingress[🌐 Traefik Ingress]
    end
    
    Ingress --> Store1
    Ingress --> Store2
    Ingress --> Store3
    
    Store1 -.->|Isolated| DB1
    Store1 -.->|Isolated| PVC1
    Store1 -.->|Isolated| Secret1
    Store1 -.->|Isolated| Quota1
    Store1 -.->|Isolated| Limit1
    Store1 -.->|Isolated| NetPol1
    
    Store2 -.->|Isolated| DB2
    Store2 -.->|Isolated| Redis2
    Store2 -.->|Isolated| PVC2
    Store2 -.->|Isolated| Secret2
    Store2 -.->|Isolated| Quota2
    Store2 -.->|Isolated| Limit2
    Store2 -.->|Isolated| NetPol2
    
    Store3 -.->|Isolated| DB3
    Store3 -.->|Isolated| PVC3
    Store3 -.->|Isolated| Secret3
    Store3 -.->|Isolated| Quota3
    Store3 -.->|Isolated| Limit3
    Store3 -.->|Isolated| NetPol3
    
    style Store1 fill:#e1f5ff
    style Store2 fill:#ffe1f5
    style Store3 fill:#e1ffe1
    style Ingress fill:#fff4e1
```

**Tradeoffs**:
- ✅ Strong isolation
- ✅ Simple cleanup
- ✅ Resource quotas per namespace
- ✅ Network policies per namespace
- ❌ Namespace overhead (minimal)
- ❌ Namespace limits (not an issue for current scale)

### 5. Helm Charts for Store Deployment

**Choice**: Use Helm charts instead of raw Kubernetes manifests or operators.

**Rationale**:
- Standard Kubernetes package manager
- Template-based configuration
- Easy upgrades and rollbacks
- Values files for environment differences

**Tradeoffs**:
- ✅ Industry standard
- ✅ Template reusability
- ✅ Version management
- ✅ Rollback support
- ❌ Learning curve for Helm templating
- ❌ Chart maintenance overhead

### 6. Environment-Specific Values Files

**Choice**: Separate `values-local.yaml` and `values-prod.yaml` files.

**Rationale**:
- Same charts work in local and production
- Clear separation of concerns
- Easy to understand differences
- Backend selects appropriate values file

**Tradeoffs**:
- ✅ Single source of truth for charts
- ✅ Environment-specific configuration
- ✅ Easy to compare differences
- ❌ Must maintain two values files
- ❌ Risk of drift between environments

---

## Idempotency & Failure Handling

### Idempotent Operations

**Store Creation**:
- Atomic check-and-create prevents duplicates
- File mutex ensures thread-safe operations
- Duplicate name detection before provisioning starts
- Status tracking prevents duplicate provisioning

**Store Deletion**:
- Idempotent Helm uninstall (`|| true` ensures no error if already deleted)
- Idempotent namespace deletion (`|| true`)
- Safe to retry deletion operations

**Status Updates**:
- Atomic read-modify-write operations
- File mutex prevents concurrent modifications
- Status transitions are validated

### Failure Handling

**Provisioning Failures**:
1. **Timeout Detection**: 
   - 20-minute timeout for Helm install (accommodates cold starts and image pulling)
   - 10-minute timeout for readiness checks (after Helm install)
   - Overall provisioning can take up to 30 minutes in worst-case scenarios
2. **Error Capture**: Errors stored in store object with `error` field
3. **Status Tracking**: Failed stores marked with `status: "Failed"`
4. **Event Logging**: All failures logged with timestamps
5. **Recovery**: Periodic status refresh can detect recovery

**Recovery Mechanisms**:
- **Status Refresh**: Periodic checks (every 5 seconds) verify actual Kubernetes state
  - Checks namespace existence and pod readiness
  - Updates status based on actual Kubernetes state
  - Preserves secrets during status updates (prevents data loss)
  - Can detect recovery from Failed to Ready state
- **Grace Period**: 30-second grace period before marking as Failed
- **Stuck Detection**: 
  - Stores provisioning >=10 minutes can be deleted (likely stuck)
  - Stores provisioning >=30 minutes are definitely stuck and can be deleted
- **Readiness Verification**: Comprehensive checks (pods, jobs, ingress)

**Failure Scenarios Handled**:
- Namespace creation failure
- Helm installation failure
- Pod startup failures
- Database connection failures
- Timeout scenarios
- Backend restart during provisioning

### Cleanup Guarantees

**Deletion Process**:
1. Mark store as `Deleting` (prevents concurrent operations)
2. Uninstall Helm release (idempotent)
3. Delete namespace (idempotent, removes all resources)
4. Remove from stores.json

**Store Deletion Flow**:

```mermaid
sequenceDiagram
    participant User
    participant Dashboard
    participant Backend
    participant FileMutex
    participant Helm
    participant K8sAPI
    
    User->>Dashboard: Click "Delete Store"
    Dashboard->>Backend: DELETE /api/stores/:id
    
    Backend->>Backend: Check deletion protection<br/>(<10 min provisioning?)
    
    alt Provisioning < 10 minutes
        Backend-->>Dashboard: 409 Conflict<br/>"Cannot delete while provisioning"
        Dashboard-->>User: Error message
    else Can delete
        Backend->>FileMutex: Acquire lock
        Backend->>Backend: Update status: "Deleting"
        Backend->>Backend: addStoreEvent("Deletion initiated")
        Backend->>FileMutex: Release lock
        Backend-->>Dashboard: 204 No Content
        
        Note over Backend: Background cleanup starts
        
        Backend->>Backend: addStoreEvent("Uninstalling Helm")
        Backend->>Helm: helm uninstall name || true
        Helm->>K8sAPI: Remove Helm resources
        Helm-->>Backend: Uninstall complete
        Backend->>Backend: addStoreEvent("Helm uninstalled")
        
        Backend->>Backend: addStoreEvent("Deleting namespace")
        Backend->>K8sAPI: kubectl delete namespace || true
        K8sAPI->>K8sAPI: Remove all resources<br/>(Pods, PVCs, Secrets, etc.)
        K8sAPI-->>Backend: Namespace deleted
        Backend->>Backend: addStoreEvent("Cleanup completed")
        
        Backend->>FileMutex: Acquire lock
        Backend->>Backend: Remove from stores.json
        Backend->>FileMutex: Release lock
        
        Dashboard->>Backend: GET /api/stores
        Backend-->>Dashboard: Store removed
        Dashboard-->>User: Store disappears
    end
```

**Protection Mechanisms**:
- Cannot delete stores actively provisioning (<10 minutes, Helm release exists)
- Can delete stuck stores (>=10 minutes provisioning - likely stuck)
- Can delete stores definitely stuck (>=30 minutes provisioning)
- Can delete stores with failed Helm releases
- Status reversion on deletion errors

**Resource Cleanup**:
- Helm uninstall removes all Helm-managed resources
- Namespace deletion removes remaining resources (PVCs, Secrets, etc.)
- Idempotent operations ensure safe retries

---

## Production Differences

### Local vs Production Architecture

```mermaid
graph LR
    subgraph "Local Environment"
        LocalUser[👤 Developer]
        LocalDash[📊 Dashboard<br/>localhost:5173]
        LocalBackend[⚙️ Backend<br/>localhost:3001]
        LocalK8s[☸️ k3d Cluster]
        LocalIngress[🌐 Traefik<br/>HTTP only]
        LocalStore[🏪 Store<br/>*.127.0.0.1.nip.io]
        LocalDB[(🗄️ Database<br/>local-path)]
    end
    
    subgraph "Production Environment"
        ProdUser[👤 End User]
        ProdDash[📊 Dashboard<br/>dashboard.domain.com]
        ProdBackend[⚙️ Backend<br/>api.domain.com]
        ProdK8s[☸️ k3s Cluster<br/>VPS]
        ProdIngress[🌐 Traefik<br/>HTTP + HTTPS]
        CertManager[🔒 cert-manager<br/>Let's Encrypt]
        ProdStore[🏪 Store<br/>*.domain.com<br/>HTTPS]
        ProdDB[(🗄️ Database<br/>local-path)]
    end
    
    LocalUser --> LocalDash
    LocalDash --> LocalBackend
    LocalBackend --> LocalK8s
    LocalK8s --> LocalIngress
    LocalIngress --> LocalStore
    LocalStore --> LocalDB
    
    ProdUser --> ProdDash
    ProdDash --> ProdBackend
    ProdBackend --> ProdK8s
    ProdK8s --> ProdIngress
    ProdIngress --> CertManager
    CertManager --> ProdStore
    ProdStore --> ProdDB
    
    style LocalStore fill:#e1f5ff
    style ProdStore fill:#ffe1f5
    style CertManager fill:#fff4e1
```

### DNS & Ingress

**Local**:
- Domain: `<store-name>.127.0.0.1.nip.io`
- Protocol: HTTP
- Ingress: Traefik with `web` entrypoint only
- No TLS certificates

**Production**:
- Domain: `<store-name>.<your-domain>`
- Protocol: HTTPS
- Ingress: Traefik with `web,websecure` entrypoints
- TLS: cert-manager + Let's Encrypt
- WordPress HTTPS detection via `X-Forwarded-Proto` header

**Configuration**:
- Backend detects domain type (nip.io vs real domain)
- Automatically enables TLS for production domains
- Sets appropriate ingress annotations

### Storage Classes

**Local**:
- Kind: `standard` storage class
- k3d/k3s: `local-path` storage class
- Auto-detected by backend

**Production**:
- k3s: `local-path` storage class (default)
- Explicitly configured in `values-prod.yaml`

**Adaptation**:
- Backend detects storage class availability
- Adapts values files if needed
- Ensures compatibility across environments

### Secrets Management

**Local**:
- Default passwords in `values-local.yaml` (acceptable for dev)
- Secrets created via Helm templates
- No external secret management

**Production**:
- **Automatic Secret Generation**: Backend automatically generates secure random secrets for production stores
  - Uses `crypto.randomBytes()` for cryptographically secure random generation
  - No hardcoded passwords - all production secrets are generated on-the-fly
  - Secrets generated include: database passwords, admin passwords, JWT secrets, cookie secrets
  - Generated secrets passed to Helm via `--set` flags during provisioning
- No default passwords in `values-prod.yaml` (empty values require explicit secrets)
- Secrets stored in `stores.json` for retrieval and dashboard display
- Should use external secret management (Sealed Secrets, External Secrets Operator) for production
- Medusa requires explicit JWT_SECRET, COOKIE_SECRET (both auto-generated for production stores)

**Secrets Storage & Display**:
- Production secrets stored in `backend/stores.json` per store
- Dashboard displays admin credentials in expanded store view
- Copy-to-clipboard functionality for easy access
- Secrets preserved during status refresh operations
- WooCommerce: Username (`admin`) and password displayed
- Medusa: Email (auto-generated from domain) and password displayed

**Security Considerations**:
- **No Hardcoded Secrets**: Production secrets are never hardcoded - always generated securely
- Never commit production secrets to version control
- Use environment variables or secret files for manual provisioning
- Consider Vault or similar for production secret management
- Secrets in `stores.json` are plain text (acceptable for MVP, should encrypt for production)
- Secret generation uses Node.js `crypto.randomBytes()` for cryptographically secure randomness

### Resource Allocation

**Local**:
- Lower CPU/memory limits (development)
- Single replica
- No autoscaling
- Minimal storage (1-2Gi)

**Production**:
- Higher CPU/memory limits (production workloads)
- Multiple replicas (high availability)
- HPA autoscaling enabled
- Larger storage (10-20Gi)

### Replicas & Autoscaling

**Local**:
- `replicaCount: 1`
- `autoscaling.enabled: false`

**Production**:
- `replicaCount: 2` (WooCommerce), `1` (Medusa - resource constrained)
- `autoscaling.enabled: true`
- HPA configured with CPU/memory targets
- **WooCommerce**: Single HPA for WordPress deployment
- **Medusa**: Separate HPAs for backend and storefront deployments (allows independent scaling)

### Network Policies

**Local**:
- `networkPolicy.enabled: false` (optional, can enable for testing)

**Production**:
- `networkPolicy.enabled: true`
- Deny-by-default with required allows
- Ingress from Traefik only
- Egress for DNS and internet

### WordPress HTTPS Configuration

**Local**:
- `FORCE_SSL_ADMIN: false`
- No HTTPS detection needed

**Production**:
- `FORCE_SSL_ADMIN: true` (when TLS enabled)
- Detects HTTPS from `X-Forwarded-Proto` header
- Properly handles Traefik proxy termination

**Implementation**:
```php
// WordPress wp-config.php detects HTTPS behind proxy
if (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https') {
    $_SERVER['HTTPS'] = 'on';
}
```

---

## Observability & Monitoring

### Observability Architecture

```mermaid
graph TB
    subgraph "Data Collection"
        Backend[⚙️ Backend API]
        K8sAPI[☸️ Kubernetes API]
        StoresJSON[(📄 stores.json)]
    end
    
    subgraph "Metrics & Events"
        MetricsEP[/api/metrics<br/>Endpoint]
        Events[📝 Event Logs<br/>per Store]
        StatusRefresh[🔄 Status Refresh<br/>Every 5s]
    end
    
    subgraph "Dashboard Display"
        MetricsHeader[📊 Metrics Header<br/>Total, Status, Duration]
        StoreCards[🏪 Store Cards<br/>Status, URL, Timestamp]
        StoreDetails[📋 Store Details<br/>Credentials, Events]
        ActivityLog[📜 Activity Log<br/>Color-coded Events]
    end
    
    Backend --> MetricsEP
    Backend --> Events
    Backend --> StatusRefresh
    K8sAPI --> StatusRefresh
    StoresJSON --> MetricsEP
    StoresJSON --> Events
    
    MetricsEP --> MetricsHeader
    Events --> ActivityLog
    StoresJSON --> StoreCards
    StoresJSON --> StoreDetails
    
    style MetricsEP fill:#e1f5ff
    style Events fill:#ffe1f5
    style StatusRefresh fill:#fff4e1
```

### Metrics Endpoint

**Implementation**: `/api/metrics` endpoint provides:
- Total stores count
- Stores by status (Ready, Provisioning, Failed, Deleting)
- Stores by type (woocommerce, medusa)
- Provisioning statistics (completed, failed, average/min/max duration)

**Usage**: Dashboard displays metrics in header, auto-refreshes every 5 seconds.

### Event Logging

**Implementation**: `addStoreEvent()` function tracks:
- All major operations (creation, provisioning, deletion)
- Status changes
- Errors and warnings
- Timestamps and event types (info, success, error, warning)

**Storage**: Last 50 events per store (prevents unbounded growth).

**Display**: Dashboard shows activity log when store is expanded:
- Color-coded events (green=success, red=error, yellow=warning, gray=info)
- Chronological display (newest first)
- Timestamp for each event
- Expandable view per store

### Admin Credentials Display

**Implementation**: Dashboard displays admin credentials in expanded store view:
- **WooCommerce**: Username (`admin`) and password with copy button
- **Medusa**: Email (auto-generated from domain) and password with copy button
- Credentials shown only for Ready stores or stores with secrets
- Copy-to-clipboard functionality for easy access
- Default passwords indicated for local development stores

### Logging

**Backend**: Comprehensive `console.log` statements for:
- Store operations
- Helm commands
- Status checks
- Error conditions

**Future Enhancement**: Structured logging (JSON format) for production.

---

## Scaling Considerations

### Scaling Architecture

```mermaid
graph TB
    subgraph "Current Architecture"
        SingleBackend[⚙️ Single Backend<br/>File-based State]
        FileMutex[🔒 File Mutex<br/>In-memory]
        StoresJSON[(📄 stores.json<br/>Single File)]
    end
    
    subgraph "Future Scalable Architecture"
        LB[⚖️ Load Balancer]
        
        subgraph "Backend Instances"
            Backend1[⚙️ Backend 1]
            Backend2[⚙️ Backend 2]
            Backend3[⚙️ Backend 3]
        end
        
        DB[(🗄️ PostgreSQL<br/>Shared State)]
        Redis[(⚡ Redis<br/>Distributed Locking)]
        Queue[📬 Provisioning Queue<br/>RabbitMQ/Redis]
    end
    
    subgraph "Store Scaling"
        HPA[📈 HPA<br/>Auto-scaling]
        Pod1[📦 Pod 1]
        Pod2[📦 Pod 2]
        Pod3[📦 Pod 3]
    end
    
    SingleBackend --> FileMutex
    FileMutex --> StoresJSON
    
    LB --> Backend1
    LB --> Backend2
    LB --> Backend3
    Backend1 --> DB
    Backend2 --> DB
    Backend3 --> DB
    Backend1 --> Redis
    Backend2 --> Redis
    Backend3 --> Redis
    Backend1 --> Queue
    Backend2 --> Queue
    Backend3 --> Queue
    
    HPA --> Pod1
    HPA --> Pod2
    HPA --> Pod3
    
    style SingleBackend fill:#ffe1f5
    style DB fill:#e1ffe1
    style Redis fill:#fff4e1
    style Queue fill:#e1f5ff
```

### Backend Scaling

**Current**: Stateless backend can be horizontally scaled.

**Limitations**:
- File-based state (`stores.json`) not shared across instances
- File mutex is in-memory only

**Migration Path**:
- Move to database (PostgreSQL/MySQL)
- Use distributed locking (Redis, etcd)
- Stateless design already supports scaling

### Store Provisioning Scaling

**Current**: Concurrent provisioning supported via:
- File mutex for state management
- Background async operations
- Namespace isolation

**Limitations**:
- Sequential file operations (not a bottleneck for current scale)
- Kubernetes API rate limits

**Future**: Can add provisioning queue (Redis, RabbitMQ) for high-scale scenarios.

### Kubernetes Resource Scaling

**Per-Store**:
- ResourceQuota limits per namespace
- LimitRange sets default requests/limits
- HPA autoscaling for production stores
  - WooCommerce: Single HPA scales WordPress deployment
  - Medusa: Separate HPAs for backend and storefront (independent scaling)

**Cluster-Level**:
- Node capacity planning
- Storage capacity planning
- Network bandwidth considerations

---

## Security Considerations

### Security Architecture

```mermaid
graph TB
    subgraph "Access Control"
        User[👤 User/Process]
        RBAC[🔐 RBAC<br/>ClusterRole<br/>ClusterRoleBinding]
        K8sAPI[☸️ Kubernetes API]
    end
    
    subgraph "Network Security"
        Ingress[🌐 Traefik Ingress]
        NetPol[🔒 NetworkPolicy<br/>Deny-by-default]
        
        subgraph "Store Namespace"
            Pod[📦 Pod]
            DB[(🗄️ Database)]
        end
    end
    
    subgraph "Secret Management"
        Secrets[🔐 Kubernetes Secrets]
        GeneratedSecrets[🎲 Generated Secrets<br/>crypto.randomBytes]
        StoresJSON[(📄 stores.json<br/>Plain text)]
    end
    
    subgraph "Rate Limiting"
        RateLimit[⏱️ Rate Limiting<br/>express-rate-limit]
        CreateLimit[10 req/15min<br/>Store Creation]
        GeneralLimit[100 req/min<br/>General API]
    end
    
    User --> RBAC
    RBAC --> K8sAPI
    
    Ingress --> NetPol
    NetPol --> Pod
    Pod --> DB
    
    GeneratedSecrets --> Secrets
    Secrets --> StoresJSON
    StoresJSON --> RateLimit
    
    RateLimit --> CreateLimit
    RateLimit --> GeneralLimit
    
    style RBAC fill:#e1f5ff
    style NetPol fill:#ffe1f5
    style GeneratedSecrets fill:#fff4e1
    style RateLimit fill:#e1ffe1
```

### RBAC

**Implementation**: `backend/rbac/` directory contains:
- ClusterRole for namespace management
- ClusterRoleBinding for backend service account
- Role for secrets management
- RoleBinding for namespace-scoped operations

**Principle**: Least privilege - backend only has permissions it needs.

### Network Policies

**Implementation**: Deny-by-default with required allows:
- Ingress from Traefik ingress controller only
- Egress for DNS (kube-dns)
- Egress for internet (HTTPS)

**Enforcement**: Per-namespace NetworkPolicy resources.

### Secrets

**Local**: Default passwords acceptable for development.

**Production**: 
- No default passwords
- Secrets provided via `--set` or external management
- Consider Sealed Secrets or External Secrets Operator

### Rate Limiting

**Implementation**: `express-rate-limit` middleware:
- Store creation: 10 requests per 15 minutes
- General API: 100 requests per minute

**Purpose**: Prevent abuse and resource exhaustion.

---

## Upgrade & Rollback Strategy

### Upgrade & Rollback Flow

```mermaid
stateDiagram-v2
    [*] --> CurrentVersion: Store Running
    
    CurrentVersion --> UpgradeInProgress: helm upgrade
    UpgradeInProgress --> UpgradeSuccess: Pods Ready
    UpgradeInProgress --> UpgradeFailed: Pods Failed
    
    UpgradeSuccess --> NewVersion: Upgrade Complete
    UpgradeFailed --> Rollback: helm rollback
    
    Rollback --> CurrentVersion: Rollback Complete
    
    NewVersion --> UpgradeInProgress: Another Upgrade
    NewVersion --> Rollback: Issue Detected
    
    UpgradeInProgress: Monitor pods<br/>Check readiness<br/>Verify functionality
    Rollback: Helm maintains history<br/>Can rollback to any revision<br/>Database state preserved
```

### Helm Upgrades

**Standard Process**:
```bash
helm upgrade <store-name> ./store-woocommerce \
  -n store-<store-name> \
  -f store-woocommerce/values-prod.yaml
```

**Considerations**:
- Test upgrades in local environment first
- Backup databases before upgrades
- Use Helm hooks for pre/post upgrade tasks
- Monitor pod readiness after upgrade

### Rollback

**Standard Process**:
```bash
helm rollback <store-name> -n store-<store-name>
```

**Considerations**:
- Helm maintains release history
- Can rollback to any previous revision
- Database migrations may need manual handling
- Test rollback procedures

### Store Version Management

**Current**: All stores use same chart version.

**Documentation**: Comprehensive upgrade and rollback guide available in `docs/UPGRADE_ROLLBACK.md`.

**Future Enhancement**:
- Track chart version per store
- Gradual rollout of new versions
- A/B testing capabilities

---

## Tradeoffs Summary

| Aspect | Choice | Pros | Cons |
|--------|--------|------|------|
| **State Storage** | JSON file | Simple, portable | Not scalable |
| **Concurrency** | File mutex | Reliable, simple | Sequential operations |
| **Provisioning** | Async background | Fast API, better UX | Requires polling |
| **Isolation** | Namespace-per-store | Strong isolation | Namespace overhead |
| **Deployment** | Helm charts | Standard, reusable | Learning curve |
| **Configuration** | Values files | Clear separation | Must maintain multiple files |
| **Observability** | Metrics + Events | Comprehensive | No external metrics system |
| **Secrets** | Helm values | Simple | Not ideal for production |

---

## Future Enhancements

1. **Database Migration**: Move from JSON file to PostgreSQL/MySQL
2. **Distributed Locking**: Redis/etcd for multi-instance backend
3. **Provisioning Queue**: Queue-based provisioning for high scale
4. **Structured Logging**: JSON logging with log aggregation
5. **External Metrics**: Prometheus integration
6. **Advanced Observability**: Distributed tracing, APM
7. **Secret Management**: External Secrets Operator integration
8. **Multi-Region**: Support for multiple Kubernetes clusters
9. **Store Versioning**: Per-store chart version tracking
10. **Backup/Recovery**: Automated backup strategies

---

## Conclusion

The architecture prioritizes **simplicity and reliability** over complex distributed systems. This approach is appropriate for an MVP and provides clear migration paths for future scaling. The system is designed to be **production-ready** with proper security, observability, and failure handling, while remaining **simple to understand and maintain**.

**Key Strengths**:
- Kubernetes-native design
- Strong isolation and security
- Comprehensive observability
- Idempotent operations
- Production-ready configuration

**Areas for Future Improvement**:
- Database-backed state management
- Distributed systems patterns
- Advanced monitoring and alerting
- Multi-cluster support

