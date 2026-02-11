// Load environment variables from .env file
// Load from backend directory (where server.js is located)
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const rateLimit = require('express-rate-limit');

const app = express();
const port = process.env.PORT || 3001;
const STORES_FILE = path.join(__dirname, 'stores.json');

// Environment configuration from .env (standard approach)
const DEFAULT_ENVIRONMENT = process.env.DEFAULT_ENVIRONMENT || 'local';
const PRODUCTION_DOMAIN = process.env.PRODUCTION_DOMAIN || 'yourdomain.com';

app.use(cors());
app.use(bodyParser.json());

// Rate limiting middleware for abuse prevention
const createStoreLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 store creation requests per windowMs
    message: 'Too many store creation requests from this IP, please try again later.',
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

const generalLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100, // Limit each IP to 100 requests per minute
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});

// Apply general rate limiting to all routes
app.use('/api/', generalLimiter);

// Concurrency control: Mutex for file operations
class FileMutex {
    constructor() {
        this.queue = [];
        this.locked = false;
    }

    async acquire() {
        return new Promise((resolve) => {
            if (!this.locked) {
                this.locked = true;
                resolve();
            } else {
                this.queue.push(resolve);
            }
        });
    }

    release() {
        if (this.queue.length > 0) {
            const next = this.queue.shift();
            next();
        } else {
            this.locked = false;
        }
    }
}

const fileMutex = new FileMutex();

// Helper to read stores (with locking)
const readStores = async () => {
    await fileMutex.acquire();
    try {
        if (!fs.existsSync(STORES_FILE)) {
            return [];
        }
        const data = fs.readFileSync(STORES_FILE);
        return JSON.parse(data);
    } finally {
        fileMutex.release();
    }
};

// Helper to write stores (with locking)
const writeStores = async (stores) => {
    await fileMutex.acquire();
    try {
        fs.writeFileSync(STORES_FILE, JSON.stringify(stores, null, 2));
    } finally {
        fileMutex.release();
    }
};

// Atomic read-modify-write operation
const atomicUpdateStores = async (updateFn) => {
    await fileMutex.acquire();
    try {
        const stores = fs.existsSync(STORES_FILE) 
            ? JSON.parse(fs.readFileSync(STORES_FILE))
            : [];
        const updated = updateFn(stores);
        fs.writeFileSync(STORES_FILE, JSON.stringify(updated, null, 2));
        return updated;
    } catch (error) {
        // Re-throw errors from updateFn so they can be caught by the caller
        throw error;
    } finally {
        fileMutex.release();
    }
};

// List stores
app.get('/api/stores', async (req, res) => {
    try {
        const stores = await readStores();
        res.json(stores);
    } catch (error) {
        console.error('Error reading stores:', error);
        res.status(500).json({ error: 'Failed to read stores' });
    }
});

// Create store (with stricter rate limiting)
app.post('/api/stores', createStoreLimiter, async (req, res) => {
    const { name, type, environment, domain, adminEmail, valuesFile: requestedValuesFile } = req.body;
    
    // Debug logging
    console.log('Store creation request:', { name, type, environment, domain, adminEmail, requestedValuesFile });
    
    if (!name || !type) {
        return res.status(400).json({ error: 'Name and type are required' });
    }

    // Validate environment if provided (optional - defaults to .env setting)
    if (environment && !['local', 'prod'].includes(environment)) {
        return res.status(400).json({ error: 'Environment must be either "local" or "prod"' });
    }

    // Validate valuesFile if provided
    if (requestedValuesFile && !['values-local.yaml', 'values-prod.yaml'].includes(requestedValuesFile)) {
        return res.status(400).json({ error: 'valuesFile must be either "values-local.yaml" or "values-prod.yaml"' });
    }

    // Determine effective environment: .env DEFAULT_ENVIRONMENT is primary source
    // Request parameter can override if explicitly provided (for flexibility)
    // Calculate BEFORE atomic operation so it's available in background provisioning
    const effectiveEnvironment = environment || DEFAULT_ENVIRONMENT;
    
    // Determine domain: request domain > PRODUCTION_DOMAIN env > fallback
    // Handle empty strings and undefined explicitly
    let effectiveDomain;
    if (domain && typeof domain === 'string' && domain.trim()) {
        effectiveDomain = domain.trim();
    } else {
        effectiveDomain = effectiveEnvironment === 'prod' ? PRODUCTION_DOMAIN : null;
    }
    
    console.log(`Domain resolution: provided="${domain}" (type: ${typeof domain}), effective="${effectiveDomain}", environment="${effectiveEnvironment}"`);
    
    // Determine URL based on effective environment
    const storeUrl = effectiveEnvironment === 'local'
        ? `http://${name}.127.0.0.1.nip.io`
        : `https://${name}.${effectiveDomain}`;

    // Atomic check-and-create operation to prevent race conditions
    let newStore;
    try {
        const stores = await atomicUpdateStores((currentStores) => {
            // Check if store name already exists
            if (currentStores.find(s => s.name === name)) {
                throw new Error('Store name already exists');
            }

            newStore = {
                id: Date.now().toString(),
                name,
                type,
                environment: effectiveEnvironment, // Store the effective environment
                status: 'Provisioning',
                url: storeUrl,
                createdAt: new Date().toISOString()
            };

            return [...currentStores, newStore];
        });
    } catch (error) {
        if (error.message === 'Store name already exists') {
            return res.status(400).json({ error: error.message });
        }
        throw error;
    }

    // Initial response
    res.status(201).json(newStore);

    // Background provisioning (don't await - run asynchronously)
    (async () => {
        const ChartPath = type === 'woocommerce'
            ? path.join(__dirname, '../store-woocommerce')
            : path.join(__dirname, '../store-medusa');

        const namespace = `store-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

    // Determine values file based on environment parameter
    // Assessment requirement: "Local vs production differences must be handled via Helm values"
    // effectiveEnvironment already calculated above (request > backend default > 'local')
    // - environment='local' -> values-local.yaml (works with Kind/k3d/Minikube)
    // - environment='prod' -> values-prod.yaml (works with k3s VPS)
    
    let valuesFile = effectiveEnvironment === 'local' ? 'values-local.yaml' : 'values-prod.yaml';
    
    // Allow explicit override if needed (for testing/debugging)
    if (requestedValuesFile) {
        valuesFile = requestedValuesFile;
        console.log(`Using explicitly requested values file: ${valuesFile}`);
    } else {
        console.log(`Using ${valuesFile} for ${effectiveEnvironment} environment (from .env: ${DEFAULT_ENVIRONMENT}${environment ? `, overridden by request: ${environment}` : ''})`);
    }
    
    // Detect storage class for local deployments
    // values-local.yaml uses empty storageClass (cluster default)
    // Adapt to local-path for k3d/k3s if needed
    let needsLocalPathStorage = false;
    if (valuesFile === 'values-local.yaml') {
        try {
            const storageClassOutput = await execPromise('kubectl get storageclass -o jsonpath="{.items[*].metadata.name}" 2>/dev/null || echo ""');
            if (storageClassOutput.includes('local-path')) {
                needsLocalPathStorage = true;
                console.log('Detected local-path storage class - will adapt storage classes');
            }
        } catch (error) {
            console.warn('Could not detect storage class, using defaults:', error.message);
        }
    }
    
    const valuesPath = path.join(ChartPath, valuesFile);

    try {
        // 1. Create namespace
        await execPromise(`kubectl create namespace ${namespace} || true`);

        // 2. Install Helm chart with environment-specific values
        // Assessment requirement: Differences handled via Helm values files
        let helmCommand = `helm install ${name} ${ChartPath} -n ${namespace} -f ${valuesPath}`;
        const nipHost = `${name}.127.0.0.1.nip.io`;
        
        if (valuesFile === 'values-local.yaml') {
            // values-local.yaml uses Traefik ingress (consistent for all local clusters)
            if (type === 'woocommerce') {
                // Override host to use store name
                helmCommand += ` --set ingress.hosts[0].host=${nipHost}`;
                // Set default path if not already set
                helmCommand += ` --set ingress.hosts[0].paths[0].path=/`;
                helmCommand += ` --set ingress.hosts[0].paths[0].pathType=Prefix`;
            } else if (type === 'medusa') {
                // For Medusa, set store.domain and let template generate hosts automatically
                helmCommand += ` --set store.domain=${nipHost}`;
            }
            
            // Adapt storage classes if cluster uses local-path (k3d/k3s)
            if (needsLocalPathStorage) {
                if (type === 'woocommerce') {
                    helmCommand += ` --set wordpress.storageClass=local-path`;
                    helmCommand += ` --set mariadb.storageClass=local-path`;
                } else if (type === 'medusa') {
                    helmCommand += ` --set postgres.storageClass=local-path`;
                }
                console.log(`Adapting storage classes to local-path for ${type}`);
            }
            // Admin email: use provided email or auto-generate from domain
            if (adminEmail && adminEmail.trim()) {
                if (type === 'woocommerce') {
                    helmCommand += ` --set admin.email=${adminEmail.trim()}`;
                } else if (type === 'medusa') {
                    helmCommand += ` --set admin.email=${adminEmail.trim()}`;
                }
            }
            // For Kind (standard storage), values-local.yaml defaults work
        } else if (valuesFile === 'values-prod.yaml') {
            // values-prod.yaml is configured for k3s VPS (Traefik, local-path)
            if (effectiveEnvironment === 'local') {
                // Override host for local testing
                if (type === 'woocommerce') {
                    helmCommand += ` --set ingress.hosts[0].host=${nipHost}`;
                    // Set default path if not already set (required for ingress validation)
                    helmCommand += ` --set ingress.hosts[0].paths[0].path=/`;
                    helmCommand += ` --set ingress.hosts[0].paths[0].pathType=Prefix`;
                } else if (type === 'medusa') {
                    // For Medusa, set store.domain and let template generate hosts automatically
                    helmCommand += ` --set store.domain=${nipHost}`;
                    // Override images to use local images instead of production registry placeholders
                    helmCommand += ` --set backend.image=docker.io/library/medusa-backend:local`;
                    helmCommand += ` --set backend.imagePullPolicy=IfNotPresent`;
                    helmCommand += ` --set storefront.image=docker.io/library/medusa-storefront:local`;
                    helmCommand += ` --set storefront.imagePullPolicy=IfNotPresent`;
                }
                helmCommand += ` --set ingress.tls=null`; // Disable TLS for local testing
                // Admin email: use provided email or auto-generate from domain
                if (adminEmail && adminEmail.trim()) {
                    if (type === 'woocommerce') {
                        helmCommand += ` --set admin.email=${adminEmail.trim()}`;
                    } else if (type === 'medusa') {
                        helmCommand += ` --set admin.email=${adminEmail.trim()}`;
                    }
                }
                console.log('Using values-prod.yaml for local testing (nip.io, no TLS)');
            } else {
                // For production, use the provided domain or PRODUCTION_DOMAIN
                const prodHost = `${name}.${effectiveDomain}`;
                if (type === 'woocommerce') {
                    helmCommand += ` --set ingress.hosts[0].host=${prodHost}`;
                    // Set default path if not already set (required for ingress validation)
                    helmCommand += ` --set ingress.hosts[0].paths[0].path=/`;
                    helmCommand += ` --set ingress.hosts[0].paths[0].pathType=Prefix`;
                } else if (type === 'medusa') {
                    // For Medusa, set store.domain and let template generate hosts automatically
                    helmCommand += ` --set store.domain=${prodHost}`;
                }
                
                // Check if domain is nip.io (local testing) - disable TLS for nip.io
                const isNipIo = effectiveDomain && effectiveDomain.includes('nip.io');
                
                if (isNipIo) {
                    // Disable TLS for nip.io domains (no valid certificates)
                    helmCommand += ` --set ingress.tls=null`;
                    // Admin email: use provided email or auto-generate from domain
                    if (adminEmail && adminEmail.trim()) {
                        if (type === 'woocommerce') {
                            helmCommand += ` --set admin.email=${adminEmail.trim()}`;
                        } else if (type === 'medusa') {
                            helmCommand += ` --set admin.email=${adminEmail.trim()}`;
                        }
                    }
                    console.log(`Using production config with nip.io domain (TLS disabled): ${prodHost}`);
                } else {
                    // Real production domain - enable TLS with cert-manager
                    // Enable cert-manager annotations for automatic certificate provisioning
                    if (type === 'woocommerce') {
                        helmCommand += ` --set ingress.annotations."cert-manager\.io/cluster-issuer"=letsencrypt-prod`;
                        helmCommand += ` --set ingress.annotations."traefik\.ingress\.kubernetes\.io/router\.tls"=true`;
                        helmCommand += ` --set ingress.tls[0].secretName=${name}-tls`;
                        helmCommand += ` --set ingress.tls[0].hosts[0]=${prodHost}`;
                        // Admin email: use provided email or auto-generate from domain
                        if (adminEmail && adminEmail.trim()) {
                            helmCommand += ` --set admin.email=${adminEmail.trim()}`;
                        }
                    } else if (type === 'medusa') {
                        // Medusa uses template variables, need to override TLS hosts
                        helmCommand += ` --set ingress.annotations."cert-manager\.io/cluster-issuer"=letsencrypt-prod`;
                        helmCommand += ` --set ingress.annotations."traefik\.ingress\.kubernetes\.io/router\.tls"=true`;
                        helmCommand += ` --set ingress.tls[0].hosts[0]=${prodHost}`;
                        // Override store domain (used for auto-generating hosts, CORS, admin email)
                        helmCommand += ` --set store.domain=${prodHost}`;
                        // CORS will be auto-generated from store.domain in templates
                        // Admin email: use provided email or auto-generate from domain
                        if (adminEmail && adminEmail.trim()) {
                            helmCommand += ` --set admin.email=${adminEmail.trim()}`;
                        }
                    }
                    console.log(`Using production domain with TLS (cert-manager): ${prodHost}`);
                }
            }
        }

        console.log(`Executing: ${helmCommand}`);
        console.log(`Using values file: ${valuesFile}`);
        await execPromise(helmCommand);

        // Update status to Ready (atomic operation)
        await atomicUpdateStores((stores) => {
            const storeIndex = stores.findIndex(s => s.id === newStore.id);
            if (storeIndex !== -1) {
                stores[storeIndex].status = 'Ready';
            }
            return stores;
        });
    } catch (error) {
        console.error(`Error provisioning store ${name}:`, error);
        // Update status to Failed (atomic operation)
        try {
            await atomicUpdateStores((stores) => {
                const storeIndex = stores.findIndex(s => s.id === newStore.id);
                if (storeIndex !== -1) {
                    stores[storeIndex].status = 'Failed';
                    stores[storeIndex].error = error.message;
                }
                return stores;
            });
        } catch (updateError) {
            console.error(`Error updating store status to Failed:`, updateError);
        }
    }
    })(); // End of async IIFE for background provisioning
});

// Delete store
app.delete('/api/stores/:id', async (req, res) => {
    const { id } = req.params;
    
    // Atomic read to get store info
    let store;
    try {
        const stores = await readStores();
        store = stores.find(s => s.id === id);

        if (!store) {
            return res.status(404).json({ error: 'Store not found' });
        }

        // Check if store is stuck in provisioning (older than 30 minutes)
        // If provisioning started more than 30 minutes ago, allow deletion (likely stuck/failed)
        if (store.status === 'Provisioning') {
            const createdAt = new Date(store.createdAt);
            const now = new Date();
            const minutesSinceCreation = (now - createdAt) / (1000 * 60);
            
            if (minutesSinceCreation < 30) {
                // Check if Helm release actually exists
                const namespace = `store-${store.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
                try {
                    const helmCheck = await execPromise(`helm list -n ${namespace} -q | grep -q "^${store.name}$" && echo "exists" || echo "notfound"`);
                    if (helmCheck.trim() === 'notfound') {
                        // Helm release doesn't exist, provisioning likely failed - allow deletion
                        console.log(`Store ${store.name} is in Provisioning status but Helm release doesn't exist - allowing deletion`);
                    } else {
                        // Still provisioning and Helm release exists - prevent deletion
                        return res.status(409).json({ 
                            error: 'Cannot delete store while provisioning is in progress. Please wait for provisioning to complete or fail.' 
                        });
                    }
                } catch (checkError) {
                    // If we can't check, allow deletion if it's been more than 10 minutes
                    if (minutesSinceCreation < 10) {
                        return res.status(409).json({ 
                            error: 'Cannot delete store while provisioning is in progress. Please wait for provisioning to complete or fail.' 
                        });
                    }
                    // Been provisioning for >10 minutes and we can't verify - allow deletion
                    console.log(`Store ${store.name} has been provisioning for ${minutesSinceCreation.toFixed(1)} minutes - allowing deletion`);
                }
            } else {
                // Been provisioning for >30 minutes - definitely stuck, allow deletion
                console.log(`Store ${store.name} has been provisioning for ${minutesSinceCreation.toFixed(1)} minutes - allowing deletion (likely stuck)`);
            }
        }
    } catch (error) {
        console.error('Error reading stores for deletion:', error);
        return res.status(500).json({ error: 'Failed to read stores' });
    }

    const name = store.name;
    const namespace = `store-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

    try {
        // Mark as deleting to prevent concurrent operations
        await atomicUpdateStores((stores) => {
            const storeIndex = stores.findIndex(s => s.id === id);
            if (storeIndex !== -1) {
                stores[storeIndex].status = 'Deleting';
            }
            return stores;
        });

        // 1. Uninstall Helm release (idempotent - || true ensures no error if already deleted)
        await execPromise(`helm uninstall ${name} -n ${namespace} || true`);

        // 2. Delete namespace (idempotent - || true ensures no error if already deleted)
        await execPromise(`kubectl delete namespace ${namespace} || true`);

        // Remove from list (atomic operation)
        await atomicUpdateStores((stores) => {
            return stores.filter(s => s.id !== id);
        });

        res.status(204).send();
    } catch (error) {
        console.error(`Error deleting store ${name}:`, error);
        
        // Revert status on error
        try {
            await atomicUpdateStores((stores) => {
                const storeIndex = stores.findIndex(s => s.id === id);
                if (storeIndex !== -1) {
                    stores[storeIndex].status = store.status; // Revert to previous status
                }
                return stores;
            });
        } catch (revertError) {
            console.error('Error reverting store status:', revertError);
        }
        
        res.status(500).json({ error: error.message });
    }
});

// Provisioning timeout: 15 minutes (900 seconds)
const PROVISIONING_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

const execPromise = (command, timeoutMs = 300000) => { // Default 5 minutes timeout
    return new Promise((resolve, reject) => {
        const childProcess = exec(command, (error, stdout, stderr) => {
            clearTimeout(timeout);
            if (error) {
                // For commands with || true, exit code 1 is expected
                if (command.includes('|| true')) {
                    resolve(stdout || stderr || '');
                } else {
                    console.warn(`Command failed: ${command}`, stderr);
                    reject(error);
                }
            } else {
                resolve(stdout || stderr || '');
            }
        });
        
        const timeout = setTimeout(() => {
            childProcess.kill('SIGTERM');
            reject(new Error(`Command timed out after ${timeoutMs}ms: ${command.substring(0, 100)}...`));
        }, timeoutMs);
    });
};

app.listen(port, () => {
    console.log(`Backend listening at http://localhost:${port}`);
    console.log(`Environment configuration: DEFAULT_ENVIRONMENT=${DEFAULT_ENVIRONMENT} (from .env)`);
    console.log(`Production domain: ${PRODUCTION_DOMAIN} (from .env)`);
    console.log(`Stores will be provisioned to: ${DEFAULT_ENVIRONMENT === 'local' ? 'Local (Kind/k3d/Minikube)' : `Production (k3s VPS) - default domain: ${PRODUCTION_DOMAIN}`}`);
});
