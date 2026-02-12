// Load environment variables from .env file
// Load from backend directory (where server.js is located)
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');
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

// Helper function to generate secure random secrets
function generateSecureSecret(length = 32) {
    return crypto.randomBytes(length).toString('hex');
}

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
        // Verify write succeeded
        const verify = JSON.parse(fs.readFileSync(STORES_FILE));
        if (JSON.stringify(verify) !== JSON.stringify(updated)) {
            console.error('⚠️ File write verification failed - data mismatch!');
        }
        return updated;
    } catch (error) {
        // Re-throw errors from updateFn so they can be caught by the caller
        throw error;
    } finally {
        fileMutex.release();
    }
};

// Helper function to add an event to a store
const addStoreEvent = async (storeId, message, eventType = 'info') => {
    await atomicUpdateStores((stores) => {
        const storeIndex = stores.findIndex(s => s.id === storeId);
        if (storeIndex !== -1) {
            if (!stores[storeIndex].events) {
                stores[storeIndex].events = [];
            }
            stores[storeIndex].events.push({
                timestamp: new Date().toISOString(),
                message,
                type: eventType // 'info', 'success', 'error', 'warning'
            });
            // Keep only last 50 events to prevent unbounded growth
            if (stores[storeIndex].events.length > 50) {
                stores[storeIndex].events = stores[storeIndex].events.slice(-50);
            }
        }
        return stores;
    });
};

// Refresh store status based on actual Kubernetes state
async function refreshStoreStatus(store) {
    // Don't refresh deleted stores - they're in final state
    if (store.status === 'Deleting') {
        return store;
    }

    const namespace = `store-${store.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
    
    try {
        // Check if namespace exists
        const nsCheck = await execPromise(`kubectl get namespace ${namespace} 2>/dev/null || echo "notfound"`);
        const namespaceExists = !nsCheck.trim().includes('notfound');
        
        if (!namespaceExists) {
            // Namespace doesn't exist - check if we should mark as failed
            if (store.status === 'Provisioning') {
                // Only mark as Failed if store has been provisioning for more than 30 seconds
                // This prevents false failures during the initial provisioning window
                const createdAt = new Date(store.createdAt || store.provisioningStartedAt);
                const secondsSinceCreation = (Date.now() - createdAt.getTime()) / 1000;
                
                if (secondsSinceCreation > 30) {
                    // Store has been provisioning for >30s but namespace doesn't exist - likely failed
                    console.log(`Store ${store.name} has been provisioning for ${secondsSinceCreation.toFixed(1)}s but namespace doesn't exist - marking as Failed`);
                    const failedStore = { ...store, status: 'Failed', error: 'Namespace not found after 30 seconds' };
                    addStoreEvent(store.id, `Provisioning failed: Namespace not found after ${Math.round(secondsSinceCreation)}s`, 'error').catch(err => 
                        console.error(`Error adding event:`, err)
                    );
                    return failedStore;
                } else {
                    // Still within grace period - namespace might be created soon
                    console.log(`Store ${store.name} namespace not found yet (${secondsSinceCreation.toFixed(1)}s since creation) - still provisioning`);
                    return store;
                }
            } else if (store.status === 'Failed') {
                // Store is marked as Failed but namespace doesn't exist - keep Failed status
                return store;
            }
            // For other statuses, return as-is
            return store;
        }

        // Namespace exists - check if store is actually ready
        const isReady = await checkStoreReady(store.name, namespace, store.type);
        
        if (isReady) {
            // Store is ready
            if (store.status !== 'Ready') {
                // Store became ready - update status
                console.log(`Refreshing store ${store.name}: Setting status to Ready`);
                // IMPORTANT: Preserve secrets when updating status
                const existingSecrets = store.secrets;
                const updatedStore = { ...store, status: 'Ready', error: null };
                // Restore secrets if they existed
                if (existingSecrets) {
                    updatedStore.secrets = existingSecrets;
                }
                
                // Add event if status changed from Provisioning or Failed
                if (store.status === 'Provisioning' || store.status === 'Failed') {
                    const provisioningDuration = store.provisioningStartedAt 
                        ? Math.round((Date.now() - new Date(store.provisioningStartedAt).getTime()) / 1000)
                        : null;
                    updatedStore.provisioningCompletedAt = new Date().toISOString();
                    if (provisioningDuration !== null) {
                        updatedStore.provisioningDuration = provisioningDuration;
                    }
                    
                    const eventMessage = store.status === 'Failed' 
                        ? `Store recovered and became ready (was previously marked as Failed)`
                        : `Store became ready (detected via status refresh)`;
                    
                    // Fire and forget - don't await to avoid blocking refresh
                    addStoreEvent(store.id, eventMessage, 'success').catch(err => 
                        console.error(`Error adding event for store ${store.name}:`, err)
                    );
                }
                return updatedStore;
            }
            // Already Ready - return as-is (preserve secrets)
            return store;
        } else {
            // Store is not ready
            if (store.status === 'Ready') {
                // Store was marked Ready but is not actually ready - revert to Provisioning
                console.log(`Refreshing store ${store.name}: Reverting status from Ready to Provisioning (not actually ready)`);
                // IMPORTANT: Preserve secrets when reverting status
                const existingSecrets = store.secrets;
                const revertedStore = { ...store, status: 'Provisioning', error: null };
                // Restore secrets if they existed
                if (existingSecrets) {
                    revertedStore.secrets = existingSecrets;
                }
                // Fire and forget - don't await to avoid blocking refresh
                addStoreEvent(store.id, `Store readiness check failed - reverting to Provisioning`, 'warning').catch(err => 
                    console.error(`Error adding event for store ${store.name}:`, err)
                );
                return revertedStore;
            } else if (store.status === 'Failed') {
                // Store is Failed but namespace exists and pods are not ready
                // This could be a recovery attempt - check if it's been a while since failure
                // For now, keep Failed status if namespace exists but pods aren't ready
                return store;
            }
            // Still provisioning - keep status as is (preserve secrets)
            return store;
        }
    } catch (error) {
        console.error(`Error refreshing status for store ${store.name}:`, error);
    }
    
    return store;
}

// List stores (with status refresh for provisioning stores)
app.get('/api/stores', async (req, res) => {
    try {
        let stores = await readStores();
        
        // Refresh status for stores that are provisioning or ready
        const refreshPromises = stores
            .filter(s => s.status === 'Provisioning' || s.status === 'Ready')
            .map(store => refreshStoreStatus(store));
        
        const refreshedStores = await Promise.all(refreshPromises);
        
        // Update stores with refreshed statuses
        if (refreshedStores.length > 0) {
            await atomicUpdateStores((currentStores) => {
                return currentStores.map(store => {
                    const refreshed = refreshedStores.find(s => s.id === store.id);
                    if (refreshed) {
                        // IMPORTANT: Preserve secrets from current store if refreshed store doesn't have them
                        // This prevents secrets from being lost during status refresh (race condition fix)
                        if (store.secrets && !refreshed.secrets) {
                            refreshed.secrets = store.secrets;
                            console.log(`✅ Preserved secrets during status refresh for ${store.name}`);
                        }
                        return refreshed;
                    }
                    return store;
                });
            });
            stores = await readStores();
        }
        
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
                createdAt: new Date().toISOString(),
                provisioningStartedAt: new Date().toISOString(),
                events: [{
                    timestamp: new Date().toISOString(),
                    message: `Store creation initiated`,
                    type: 'info'
                }]
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
        // Add event: Namespace creation started
        await addStoreEvent(newStore.id, `Creating namespace: ${namespace}`, 'info');
        
        // 1. Create namespace
        await execPromise(`kubectl create namespace ${namespace} || true`);
        
        // Add event: Namespace created
        await addStoreEvent(newStore.id, `Namespace created successfully`, 'success');

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
                    // Set default postgres password for local testing
                    helmCommand += ` --set postgres.password=medusa123`;
                    // Set default admin email and password for local testing
                    // Use provided email if available, otherwise use admin@nip.io
                    if (adminEmail && adminEmail.trim()) {
                        helmCommand += ` --set admin.email=${adminEmail.trim()}`;
                    } else {
                        helmCommand += ` --set admin.email=admin@nip.io`;
                    }
                    helmCommand += ` --set admin.password=supersecret`;
                }
                // Set default admin password for WooCommerce local testing (values-prod.yaml has empty password)
                if (type === 'woocommerce') {
                    helmCommand += ` --set admin.password=admin123`;
                }
                helmCommand += ` --set ingress.tls=null`; // Disable TLS for local testing
                // Admin email for WooCommerce: use provided email or auto-generate from domain
                if (type === 'woocommerce' && adminEmail && adminEmail.trim()) {
                    helmCommand += ` --set admin.email=${adminEmail.trim()}`;
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
                
                // Check if domain is nip.io (for TLS purposes - nip.io can't have valid certificates)
                const isNipIo = effectiveDomain && effectiveDomain.includes('nip.io');
                
                // Generate secure secrets for production environment (regardless of domain)
                // If environment is 'prod', use secure secrets even for nip.io domains
                if (effectiveEnvironment === 'prod') {
                    // Generate secure secrets for production
                    const mariadbPassword = generateSecureSecret(24);
                    const mariadbRootPassword = generateSecureSecret(24);
                    const wpAdminPassword = generateSecureSecret(24);
                    const postgresPassword = generateSecureSecret(24);
                    const medusaAdminPassword = generateSecureSecret(24);
                    const jwtSecret = generateSecureSecret(32);
                    const cookieSecret = generateSecureSecret(32);
                    
                    // Store generated secrets in store object for later retrieval
                    // Note: In production, consider storing these in a secure secret store
                    try {
                        // Capture store info for logging
                        const storeIdToFind = newStore.id;
                        const storeNameToFind = name;
                        console.log(`Attempting to store secrets for store: ${storeNameToFind} (ID: ${storeIdToFind})`);
                        
                        await atomicUpdateStores((stores) => {
                            // Try to find store by ID first, then by name as fallback
                            let storeIndex = stores.findIndex(s => s.id === storeIdToFind);
                            if (storeIndex === -1) {
                                // Fallback: find by name
                                storeIndex = stores.findIndex(s => s.name === storeNameToFind);
                                if (storeIndex === -1) {
                                    console.error(`❌ Store ${storeIdToFind} (${storeNameToFind}) not found when storing secrets. Available stores:`, stores.map(s => `${s.id}:${s.name}`));
                                    return stores; // Return unchanged if store not found
                                }
                                console.log(`⚠️ Found store by name instead of ID: ${storeNameToFind}`);
                            } else {
                                console.log(`✅ Found store by ID: ${storeNameToFind} (${storeIdToFind})`);
                            }
                            if (type === 'woocommerce') {
                                stores[storeIndex].secrets = {
                                    mariadbPassword,
                                    mariadbRootPassword,
                                    adminPassword: wpAdminPassword
                                };
                                console.log(`✅ Stored secrets for WooCommerce store ${storeNameToFind} (ID: ${storeIdToFind})`);
                            } else if (type === 'medusa') {
                                // Generate admin email from domain (must match Helm template logic)
                                // The Helm template extracts LAST 2 parts of store.domain
                                // For "store.example.com" -> extracts "example.com" -> "admin@example.com"
                                // For "store.127.0.0.1.nip.io" -> extracts "nip.io" -> "admin@nip.io"
                                let adminEmailValue = adminEmail && adminEmail.trim() ? adminEmail.trim() : null;
                                if (!adminEmailValue) {
                                    // Extract domain from prodHost - use LAST 2 parts (matches Helm template)
                                    const domainParts = prodHost.split('.');
                                    if (domainParts.length >= 2) {
                                        // Extract last 2 parts (same as Helm template logic)
                                        adminEmailValue = `admin@${domainParts.slice(-2).join('.')}`;
                                    } else {
                                        adminEmailValue = `admin@${prodHost}`;
                                    }
                                }
                                stores[storeIndex].secrets = {
                                    postgresPassword,
                                    adminPassword: medusaAdminPassword,
                                    adminEmail: adminEmailValue,
                                    jwtSecret,
                                    cookieSecret
                                };
                                console.log(`✅ Stored secrets for Medusa store ${storeNameToFind} (ID: ${storeIdToFind}), email: ${adminEmailValue}`);
                                console.log(`🔍 Verifying secrets in stores array:`, stores[storeIndex].secrets ? 'Present' : 'Missing');
                            }
                            // Verify the secrets were actually set before returning
                            if (stores[storeIndex] && stores[storeIndex].secrets) {
                                console.log(`✅ Secrets verified in stores array before write`);
                            } else {
                                console.error(`❌ Secrets NOT found in stores array after assignment!`);
                            }
                            return stores;
                        });
                        // Verify secrets were persisted after atomic update
                        const verifyStores = await readStores();
                        const verifyStore = verifyStores.find(s => s.id === storeIdToFind || s.name === storeNameToFind);
                        if (verifyStore && verifyStore.secrets) {
                            console.log(`✅ Secrets verified in file after write`);
                        } else {
                            console.error(`❌ Secrets NOT found in file after write! Store:`, verifyStore ? `${verifyStore.name} (${verifyStore.id})` : 'not found');
                        }
                    } catch (error) {
                        console.error(`❌ Failed to store secrets for store ${newStore.name}:`, error);
                        console.error(`Error details:`, error.stack);
                        // Don't fail provisioning if secret storage fails
                    }
                    
                    // Handle TLS based on domain type (nip.io can't have valid certificates)
                    if (isNipIo) {
                        // nip.io domain - disable TLS (no valid certificates possible)
                        helmCommand += ` --set ingress.tls=null`;
                        // Clear annotations that are set in values-prod.yaml for nip.io domains
                        if (type === 'medusa') {
                            helmCommand += ` --set ingress.annotations=null`;
                        } else if (type === 'woocommerce') {
                            helmCommand += ` --set ingress.annotations=null`;
                        }
                        console.log(`Using production environment with nip.io domain (secure secrets, TLS disabled): ${prodHost}`);
                    } else {
                        // Real production domain - enable TLS with cert-manager
                        if (type === 'woocommerce') {
                            // WooCommerce: Set annotations explicitly
                            helmCommand += ` --set ingress.annotations.cert-manager\.io/cluster-issuer=letsencrypt-prod`;
                            helmCommand += ` --set ingress.annotations.traefik\.ingress\.kubernetes\.io/router\.tls=true`;
                            helmCommand += ` --set ingress.tls[0].secretName=${name}-tls`;
                            helmCommand += ` --set ingress.tls[0].hosts[0]=${prodHost}`;
                        } else if (type === 'medusa') {
                            // Medusa: annotations already in values-prod.yaml, just set TLS hosts
                            helmCommand += ` --set ingress.tls[0].hosts[0]=${prodHost}`;
                        }
                        console.log(`Using production domain with TLS (cert-manager): ${prodHost}`);
                    }
                    
                    // Set production secrets (properly quoted for shell safety)
                    if (type === 'woocommerce') {
                        helmCommand += ` --set mariadb.auth.password="${mariadbPassword}"`;
                        helmCommand += ` --set mariadb.auth.rootPassword="${mariadbRootPassword}"`;
                        helmCommand += ` --set admin.password="${wpAdminPassword}"`;
                    } else if (type === 'medusa') {
                        helmCommand += ` --set postgres.password="${postgresPassword}"`;
                        helmCommand += ` --set admin.password="${medusaAdminPassword}"`;
                        helmCommand += ` --set security.jwtSecret="${jwtSecret}"`;
                        helmCommand += ` --set security.cookieSecret="${cookieSecret}"`;
                        // Override store domain (used for auto-generating hosts, CORS, admin email)
                        helmCommand += ` --set store.domain=${prodHost}`;
                    }
                    
                    // Admin email: use provided email or auto-generate from domain
                    if (adminEmail && adminEmail.trim()) {
                        if (type === 'woocommerce') {
                            helmCommand += ` --set admin.email=${adminEmail.trim()}`;
                        } else if (type === 'medusa') {
                            helmCommand += ` --set admin.email=${adminEmail.trim()}`;
                        }
                    }
                    
                    console.log(`Generated secure secrets for ${type} store`);
                } else {
                    // Local environment - use default passwords and disable TLS for nip.io
                    if (isNipIo) {
                        // Disable TLS and annotations for nip.io domains (no valid certificates)
                        helmCommand += ` --set ingress.tls=null`;
                        // Clear annotations that are set in values-prod.yaml for nip.io domains
                        if (type === 'medusa') {
                            helmCommand += ` --set ingress.annotations=null`;
                            // Set default postgres password for local testing
                            helmCommand += ` --set postgres.password=medusa123`;
                            // Set default admin email and password for local testing
                            // Use provided email if available, otherwise use admin@nip.io
                            if (adminEmail && adminEmail.trim()) {
                                helmCommand += ` --set admin.email=${adminEmail.trim()}`;
                            } else {
                                helmCommand += ` --set admin.email=admin@nip.io`;
                            }
                            helmCommand += ` --set admin.password=supersecret`;
                        } else if (type === 'woocommerce') {
                            helmCommand += ` --set ingress.annotations=null`;
                            // Set default admin password for local testing (values-prod.yaml has empty password)
                            helmCommand += ` --set admin.password=admin123`;
                            // Admin email for WooCommerce: use provided email if available
                            if (adminEmail && adminEmail.trim()) {
                                helmCommand += ` --set admin.email=${adminEmail.trim()}`;
                            }
                        }
                        console.log(`Using local environment with nip.io domain (default passwords, TLS disabled): ${prodHost}`);
                    }
                }
            }
        }

        console.log(`Executing: ${helmCommand}`);
        console.log(`Using values file: ${valuesFile}`);
        
        // Add event: Helm installation started
        await addStoreEvent(newStore.id, `Installing Helm chart (${type})`, 'info');
        
        await execPromise(helmCommand);
        
        // Add event: Helm installation completed
        await addStoreEvent(newStore.id, `Helm chart installed successfully`, 'success');

        // Wait for store to be truly ready (check every 10 seconds, max 10 minutes)
        console.log(`Waiting for store ${name} to be ready...`);
        
        // Add event: Waiting for readiness
        await addStoreEvent(newStore.id, `Waiting for store to become ready...`, 'info');
        
        // namespace is already declared above at line 266
        let isReady = false;
        const maxWaitTime = 10 * 60 * 1000; // 10 minutes
        const checkInterval = 10 * 1000; // 10 seconds
        const startTime = Date.now();

        while (!isReady && (Date.now() - startTime) < maxWaitTime) {
            isReady = await checkStoreReady(name, namespace, type);
            if (!isReady) {
                console.log(`Store ${name} not ready yet, waiting ${checkInterval/1000}s...`);
                await new Promise(resolve => setTimeout(resolve, checkInterval));
            }
        }

        if (isReady) {
            const provisioningEndTime = new Date().toISOString();
            const provisioningDuration = Math.round((Date.now() - new Date(newStore.provisioningStartedAt).getTime()) / 1000); // seconds
            
            // Update status to Ready (atomic operation)
            // IMPORTANT: Preserve secrets if they exist
            await atomicUpdateStores((stores) => {
                const storeIndex = stores.findIndex(s => s.id === newStore.id);
                if (storeIndex !== -1) {
                    // Preserve existing secrets if they were set
                    const existingSecrets = stores[storeIndex].secrets;
                    stores[storeIndex].status = 'Ready';
                    stores[storeIndex].provisioningCompletedAt = provisioningEndTime;
                    stores[storeIndex].provisioningDuration = provisioningDuration;
                    // Restore secrets if they existed (they might have been set earlier)
                    if (existingSecrets) {
                        stores[storeIndex].secrets = existingSecrets;
                        console.log(`✅ Preserved secrets when updating status to Ready for ${name}`);
                    }
                }
                return stores;
            });
            
            // Add success event with duration
            await addStoreEvent(newStore.id, `Store is ready! Provisioning completed in ${provisioningDuration}s`, 'success');
            console.log(`Store ${name} is now ready! (took ${provisioningDuration}s)`);
        } else {
            console.warn(`Store ${name} did not become ready within ${maxWaitTime/1000/60} minutes, but Helm install completed`);
            const provisioningEndTime = new Date().toISOString();
            const provisioningDuration = Math.round((Date.now() - new Date(newStore.provisioningStartedAt).getTime()) / 1000);
            
            // Still mark as Ready since Helm succeeded, but log warning
            await atomicUpdateStores((stores) => {
                const storeIndex = stores.findIndex(s => s.id === newStore.id);
                if (storeIndex !== -1) {
                    // Preserve existing secrets if they exist
                    const existingSecrets = stores[storeIndex].secrets;
                    stores[storeIndex].status = 'Ready';
                    stores[storeIndex].provisioningCompletedAt = provisioningEndTime;
                    stores[storeIndex].provisioningDuration = provisioningDuration;
                    // Restore secrets if they existed
                    if (existingSecrets) {
                        stores[storeIndex].secrets = existingSecrets;
                    }
                }
                return stores;
            });
            
            // Add warning event
            await addStoreEvent(newStore.id, `Store marked as ready (readiness check timeout, but Helm succeeded)`, 'warning');
        }
    } catch (error) {
        console.error(`Error provisioning store ${name}:`, error);
        const provisioningEndTime = new Date().toISOString();
        const provisioningDuration = newStore.provisioningStartedAt 
            ? Math.round((Date.now() - new Date(newStore.provisioningStartedAt).getTime()) / 1000)
            : null;
        
        // Add error event
        await addStoreEvent(newStore.id, `Provisioning failed: ${error.message}`, 'error');
        
        // Update status to Failed (atomic operation)
        try {
            await atomicUpdateStores((stores) => {
                const storeIndex = stores.findIndex(s => s.id === newStore.id);
                if (storeIndex !== -1) {
                    // Preserve existing secrets if they exist
                    const existingSecrets = stores[storeIndex].secrets;
                    stores[storeIndex].status = 'Failed';
                    stores[storeIndex].error = error.message;
                    if (provisioningDuration !== null) {
                        stores[storeIndex].provisioningCompletedAt = provisioningEndTime;
                        stores[storeIndex].provisioningDuration = provisioningDuration;
                    }
                    // Restore secrets if they existed
                    if (existingSecrets) {
                        stores[storeIndex].secrets = existingSecrets;
                    }
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
                // Check if Helm release actually exists and if bootstrap job failed
                const namespace = `store-${store.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
                try {
                    // Check if namespace exists
                    const nsCheck = await execPromise(`kubectl get namespace ${namespace} 2>/dev/null || echo "notfound"`);
                    const namespaceExists = !nsCheck.trim().includes('notfound');
                    
                    // Check if Helm release exists
                    const helmCheck = await execPromise(`helm list -n ${namespace} -q 2>/dev/null | grep -q "^${store.name}$" && echo "exists" || echo "notfound"`);
                    const helmExists = helmCheck.trim() === 'exists';
                    
                    // Check if bootstrap job failed (for WooCommerce)
                    let bootstrapFailed = false;
                    if (store.type === 'woocommerce') {
                        try {
                            const bootstrapCheck = await execPromise(`kubectl get jobs -n ${namespace} -l app.kubernetes.io/component=bootstrap 2>/dev/null | grep -E "Failed|Error" || echo "ok"`);
                            if (bootstrapCheck.trim() !== 'ok') {
                                bootstrapFailed = true;
                            }
                            // Also check job status directly
                            const jobStatus = await execPromise(`kubectl get jobs -n ${namespace} -o jsonpath='{.items[*].status.conditions[?(@.type=="Failed")].status}' 2>/dev/null || echo ""`);
                            if (jobStatus.trim() === 'True') {
                                bootstrapFailed = true;
                            }
                        } catch (e) {
                            // Ignore errors checking job status
                        }
                    }
                    
                    if (!namespaceExists || (!helmExists && minutesSinceCreation > 5)) {
                        // Namespace doesn't exist or Helm release doesn't exist after 5 minutes - provisioning likely failed - allow deletion
                        console.log(`Store ${store.name} is in Provisioning status but resources don't exist - allowing deletion`);
                    } else if (bootstrapFailed) {
                        // Bootstrap job failed - allow deletion
                        console.log(`Store ${store.name} bootstrap job failed - allowing deletion`);
                    } else if (helmExists && minutesSinceCreation < 10) {
                        // Still provisioning and Helm release exists and it's been less than 10 minutes - prevent deletion
                        return res.status(409).json({ 
                            error: 'Cannot delete store while provisioning is in progress. Please wait for provisioning to complete or fail.' 
                        });
                    } else if (minutesSinceCreation >= 10) {
                        // Been provisioning for >10 minutes - likely stuck, allow deletion
                        console.log(`Store ${store.name} has been provisioning for ${minutesSinceCreation.toFixed(1)} minutes - allowing deletion (likely stuck)`);
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
        // Add deletion event
        await addStoreEvent(id, `Store deletion initiated`, 'info');
        
        // Mark as deleting to prevent concurrent operations
        await atomicUpdateStores((stores) => {
            const storeIndex = stores.findIndex(s => s.id === id);
            if (storeIndex !== -1) {
                stores[storeIndex].status = 'Deleting';
            }
            return stores;
        });

        // Add event: Cleanup started
        await addStoreEvent(id, `Uninstalling Helm release and deleting namespace`, 'info');
        
        // 1. Uninstall Helm release (idempotent - || true ensures no error if already deleted)
        await execPromise(`helm uninstall ${name} -n ${namespace} || true`);
        
        // Add event: Helm uninstalled
        await addStoreEvent(id, `Helm release uninstalled`, 'success');

        // 2. Delete namespace (idempotent - || true ensures no error if already deleted)
        await execPromise(`kubectl delete namespace ${namespace} || true`);
        
        // Add event: Namespace deleted
        await addStoreEvent(id, `Namespace deleted - cleanup completed`, 'success');

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

// Check if store is truly ready by verifying Kubernetes resources
async function checkStoreReady(storeName, namespace, type) {
    try {
        // 1. Check all pods are running and ready (excluding job pods that are Completed)
        // Use JSON to properly check pod status including init containers
        const podsOutput = await execPromise(
            `kubectl get pods -n ${namespace} -o json 2>/dev/null || echo "{}"`
        );
        
        try {
            const podsData = JSON.parse(podsOutput);
            if (podsData.items && podsData.items.length > 0) {
                for (const pod of podsData.items) {
                    const podName = pod.metadata.name;
                    const phase = pod.status.phase;
                    
                    // Skip completed job pods
                    if (phase === 'Succeeded') {
                        continue;
                    }
                    
                    // Check if pod is still initializing (init containers running)
                    if (pod.status.initContainerStatuses && pod.status.initContainerStatuses.length > 0) {
                        for (const initContainer of pod.status.initContainerStatuses) {
                            if (!initContainer.ready) {
                                console.log(`Store ${storeName}: Pod ${podName} init container ${initContainer.name} not ready`);
                                return false;
                            }
                        }
                    }
                    
                    // Check if pod phase is not Running
                    if (phase !== 'Running') {
                        console.log(`Store ${storeName}: Pod ${podName} is not running (phase: ${phase})`);
                        return false;
                    }
                    
                    // Check if all containers in pod are ready
                    if (pod.status.containerStatuses && pod.status.containerStatuses.length > 0) {
                        for (const container of pod.status.containerStatuses) {
                            if (!container.ready) {
                                console.log(`Store ${storeName}: Pod ${podName} container ${container.name} not ready`);
                                return false;
                            }
                        }
                    } else {
                        // No container statuses yet - pod might still be initializing
                        console.log(`Store ${storeName}: Pod ${podName} has no container statuses yet`);
                        return false;
                    }
                }
            }
        } catch (parseError) {
            console.error(`Error parsing pods JSON for ${storeName}:`, parseError);
            // Fallback to simple check
            const podsSimple = await execPromise(
                `kubectl get pods -n ${namespace} --field-selector=status.phase!=Succeeded --no-headers 2>/dev/null || echo ""`
            );
            if (podsSimple.trim()) {
                // Check for pods not in Running phase or not ready
                const notReady = podsSimple.trim().split('\n').filter(line => {
                    const parts = line.trim().split(/\s+/);
                    if (parts.length < 3) return true;
                    const phase = parts[2];
                    const ready = parts[1];
                    return phase !== 'Running' || !ready.match(/^\d+\/\d+$/);
                });
                if (notReady.length > 0) {
                    console.log(`Store ${storeName}: Found ${notReady.length} pods not ready`);
                    return false;
                }
            }
        }

        // 3. Check all jobs have completed successfully
        // Use JSON output to check job completion status reliably
        const jobsOutput = await execPromise(
            `kubectl get jobs -n ${namespace} -o json 2>/dev/null || echo "{}"`
        );
        
        try {
            const jobsData = JSON.parse(jobsOutput);
            if (jobsData.items && jobsData.items.length > 0) {
                for (const job of jobsData.items) {
                    const jobName = job.metadata.name;
                    const succeeded = job.status.succeeded || 0;
                    const completions = job.spec.completions || 1;
                    const active = job.status.active || 0;
                    const failed = job.status.failed || 0;
                    
                    // Check if job has failed
                    if (failed > 0) {
                        console.log(`Store ${storeName}: Job ${jobName} has failed`);
                        return false;
                    }
                    
                    // Check if job is still active (has running pods)
                    if (active > 0) {
                        console.log(`Store ${storeName}: Job ${jobName} is still active (${active} active pods)`);
                        return false;
                    }
                    
                    // Check if job has completed successfully
                    // succeeded should equal completions for job to be complete
                    if (succeeded < completions) {
                        console.log(`Store ${storeName}: Job ${jobName} not complete (${succeeded}/${completions} succeeded)`);
                        return false;
                    }
                }
            }
        } catch (parseError) {
            console.error(`Error parsing jobs JSON for ${storeName}:`, parseError);
            // Fallback to simple check
            const jobsSimple = await execPromise(
                `kubectl get jobs -n ${namespace} --no-headers 2>/dev/null || echo ""`
            );
            if (jobsSimple.trim()) {
                // If we can't parse, be conservative and check if any job shows incomplete
                const incompleteJobs = jobsSimple.trim().split('\n').filter(line => {
                    const parts = line.trim().split(/\s+/);
                    if (parts.length < 2) return false;
                    const completions = parts[1];
                    const match = completions.match(/^(\d+)\/(\d+)$/);
                    if (match) {
                        return parseInt(match[1]) < parseInt(match[2]);
                    }
                    return true; // Unknown format, assume incomplete
                });
                if (incompleteJobs.length > 0) {
                    console.log(`Store ${storeName}: Found ${incompleteJobs.length} incomplete jobs`);
                    return false;
                }
            }
        }

        // 5. Type-specific checks
        if (type === 'woocommerce') {
            // Check WordPress pod is ready (try multiple label selectors)
            let wpPod = await execPromise(
                `kubectl get pods -n ${namespace} -l app=wordpress --no-headers 2>/dev/null | grep Running | grep "1/1" || echo ""`
            );
            // If not found, try app.kubernetes.io/name=wordpress
            if (!wpPod.trim()) {
                wpPod = await execPromise(
                    `kubectl get pods -n ${namespace} -l app.kubernetes.io/name=wordpress --no-headers 2>/dev/null | grep Running | grep "1/1" || echo ""`
                );
            }
            // If still not found, check for any pod with "wordpress" in the name
            if (!wpPod.trim()) {
                wpPod = await execPromise(
                    `kubectl get pods -n ${namespace} --no-headers 2>/dev/null | grep wordpress | grep Running | grep "1/1" || echo ""`
                );
            }
            if (!wpPod.trim()) {
                console.log(`Store ${storeName}: WordPress pod not ready`);
                return false;
            }
        } else if (type === 'medusa') {
            // Check backend and storefront pods are ready
            const backendPod = await execPromise(
                `kubectl get pods -n ${namespace} -l app=medusa-backend --no-headers 2>/dev/null | grep Running | grep "1/1" || echo ""`
            );
            const storefrontPod = await execPromise(
                `kubectl get pods -n ${namespace} -l app=medusa-storefront --no-headers 2>/dev/null | grep Running | grep "1/1" || echo ""`
            );
            if (!backendPod.trim() || !storefrontPod.trim()) {
                console.log(`Store ${storeName}: Medusa pods not ready (backend: ${!!backendPod.trim()}, storefront: ${!!storefrontPod.trim()})`);
                return false;
            }
        }

        console.log(`Store ${storeName}: All checks passed - store is ready`);
        return true;
    } catch (error) {
        console.error(`Error checking store readiness for ${storeName}:`, error);
        return false;
    }
}

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

// Periodic status refresh for provisioning stores (every 5 seconds)
setInterval(async () => {
    try {
        const stores = await readStores();
        // Only refresh stores that are Provisioning or Ready (skip Failed/Deleting)
        const provisioningStores = stores.filter(s => s.status === 'Provisioning' || s.status === 'Ready');
        
        if (provisioningStores.length > 0) {
            const refreshPromises = provisioningStores.map(store => refreshStoreStatus(store));
            const refreshedStores = await Promise.all(refreshPromises);
            
            // Only update if status actually changed
            let hasChanges = false;
            const updatedStores = stores.map(store => {
                const refreshed = refreshedStores.find(s => s.id === store.id);
                if (refreshed) {
                    // IMPORTANT: Preserve secrets from current store if refreshed store doesn't have them
                    if (store.secrets && !refreshed.secrets) {
                        refreshed.secrets = store.secrets;
                        console.log(`✅ Preserved secrets during periodic status refresh for ${store.name}`);
                    }
                    if (refreshed.status !== store.status) {
                        hasChanges = true;
                    }
                    return refreshed;
                }
                return store;
            });
            
            if (hasChanges) {
                await atomicUpdateStores(() => updatedStores);
            }
        }
    } catch (error) {
        console.error('Error in periodic status refresh:', error);
    }
}, 5000); // Check every 5 seconds

// Metrics endpoint for observability
app.get('/api/metrics', async (req, res) => {
    try {
        const stores = await readStores();
        
        // Calculate metrics
        const totalStores = stores.length;
        const storesByStatus = {
            Ready: stores.filter(s => s.status === 'Ready').length,
            Provisioning: stores.filter(s => s.status === 'Provisioning').length,
            Failed: stores.filter(s => s.status === 'Failed').length,
            Deleting: stores.filter(s => s.status === 'Deleting').length
        };
        
        const storesByType = {
            woocommerce: stores.filter(s => s.type === 'woocommerce').length,
            medusa: stores.filter(s => s.type === 'medusa').length
        };
        
        // Provisioning duration statistics
        const completedStores = stores.filter(s => s.provisioningDuration !== undefined && s.provisioningDuration !== null);
        const provisioningDurations = completedStores.map(s => s.provisioningDuration);
        
        const metrics = {
            totalStores,
            storesByStatus,
            storesByType,
            provisioning: {
                totalCompleted: completedStores.length,
                totalFailed: stores.filter(s => s.status === 'Failed').length,
                averageDurationSeconds: provisioningDurations.length > 0
                    ? Math.round(provisioningDurations.reduce((a, b) => a + b, 0) / provisioningDurations.length)
                    : null,
                minDurationSeconds: provisioningDurations.length > 0 ? Math.min(...provisioningDurations) : null,
                maxDurationSeconds: provisioningDurations.length > 0 ? Math.max(...provisioningDurations) : null
            },
            timestamp: new Date().toISOString()
        };
        
        res.json(metrics);
    } catch (error) {
        console.error('Error calculating metrics:', error);
        res.status(500).json({ error: 'Failed to calculate metrics' });
    }
});

// Verify Kubernetes cluster connection at startup
async function verifyKubernetesConnection() {
    try {
        // Check if kubectl can connect to cluster
        const contextOutput = await execPromise('kubectl config current-context 2>/dev/null || echo "none"');
        const context = contextOutput.trim();
        
        if (context === 'none' || !context) {
            console.warn('⚠️  WARNING: No Kubernetes context found. kubectl may not be configured.');
            console.warn('   Make sure you have run: ./scripts/k3d-setup.sh');
            return;
        }
        
        // Try to get cluster info
        const nodesOutput = await execPromise('kubectl get nodes --no-headers 2>/dev/null || echo ""');
        if (!nodesOutput.trim()) {
            console.warn('⚠️  WARNING: Cannot connect to Kubernetes cluster.');
            console.warn(`   Current context: ${context}`);
            console.warn('   Make sure the cluster is running and kubectl is configured correctly.');
            return;
        }
        
        const nodeCount = nodesOutput.trim().split('\n').length;
        console.log(`✅ Connected to Kubernetes cluster`);
        console.log(`   Context: ${context}`);
        console.log(`   Nodes: ${nodeCount}`);
        
        // Warn if context doesn't match expected k3d cluster name
        if (DEFAULT_ENVIRONMENT === 'local' && !context.includes('k3d') && !context.includes('kind') && !context.includes('minikube')) {
            console.warn('⚠️  WARNING: Current kubectl context does not appear to be a local cluster.');
            console.warn(`   Context: ${context}`);
            console.warn('   Expected: k3d-urumi-prod-test (or similar local cluster)');
            console.warn('   If you have multiple clusters, ensure kubectl is pointing to the correct one.');
        }
    } catch (error) {
        console.warn('⚠️  WARNING: Could not verify Kubernetes connection:', error.message);
        console.warn('   Backend will start but may fail when creating stores.');
    }
}

// Verify connection before starting server
verifyKubernetesConnection().then(() => {
    app.listen(port, () => {
        console.log(`Backend listening at http://localhost:${port}`);
        console.log(`Environment configuration: DEFAULT_ENVIRONMENT=${DEFAULT_ENVIRONMENT} (from .env)`);
        console.log(`Production domain: ${PRODUCTION_DOMAIN} (from .env)`);
        console.log(`Stores will be provisioned to: ${DEFAULT_ENVIRONMENT === 'local' ? 'Local (Kind/k3d/Minikube)' : `Production (k3s VPS) - default domain: ${PRODUCTION_DOMAIN}`}`);
        console.log('Periodic status refresh enabled (every 5 seconds)');
    });
}).catch((error) => {
    console.error('Failed to verify Kubernetes connection:', error);
    console.log('Starting backend anyway, but store creation may fail...');
    app.listen(port, () => {
        console.log(`Backend listening at http://localhost:${port}`);
        console.log(`Environment configuration: DEFAULT_ENVIRONMENT=${DEFAULT_ENVIRONMENT} (from .env)`);
        console.log(`Production domain: ${PRODUCTION_DOMAIN} (from .env)`);
        console.log(`Stores will be provisioned to: ${DEFAULT_ENVIRONMENT === 'local' ? 'Local (Kind/k3d/Minikube)' : `Production (k3s VPS) - default domain: ${PRODUCTION_DOMAIN}`}`);
        console.log('Periodic status refresh enabled (every 5 seconds)');
    });
});
