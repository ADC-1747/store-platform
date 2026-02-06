const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3001;
const STORES_FILE = path.join(__dirname, 'stores.json');

app.use(cors());
app.use(bodyParser.json());

// Helper to read stores
const readStores = () => {
    if (!fs.existsSync(STORES_FILE)) {
        return [];
    }
    const data = fs.readFileSync(STORES_FILE);
    return JSON.parse(data);
};

// Helper to write stores
const writeStores = (stores) => {
    fs.writeFileSync(STORES_FILE, JSON.stringify(stores, null, 2));
};

// List stores
app.get('/api/stores', (req, res) => {
    res.json(readStores());
});

// Create store
app.post('/api/stores', async (req, res) => {
    const { name, type } = req.body;
    if (!name || !type) {
        return res.status(400).json({ error: 'Name and type are required' });
    }

    const stores = readStores();
    if (stores.find(s => s.name === name)) {
        return res.status(400).json({ error: 'Store name already exists' });
    }

    const newStore = {
        id: Date.now().toString(),
        name,
        type,
        status: 'Provisioning',
        url: `http://${name}.127.0.0.1.nip.io`,
        createdAt: new Date().toISOString()
    };

    stores.push(newStore);
    writeStores(stores);

    // Initial response
    res.status(201).json(newStore);

    // Background provisioning
    const ChartPath = type === 'woocommerce'
        ? path.join(__dirname, '../store-woocommerce')
        : path.join(__dirname, '../store-medusa');

    const namespace = `store-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

    try {
        // 1. Create namespace
        await execPromise(`kubectl create namespace ${namespace} || true`);

        // 2. Install Helm chart
        // For local development, we use the local chart path.
        const helmCommand = `helm install ${name} ${ChartPath} -n ${namespace} --set ingress.hosts[0].host=${name}.127.0.0.1.nip.io --set ingress.enabled=true`;

        console.log(`Executing: ${helmCommand}`);
        await execPromise(helmCommand);

        // Update status to Ready
        const updatedStores = readStores();
        const storeIndex = updatedStores.findIndex(s => s.id === newStore.id);
        if (storeIndex !== -1) {
            updatedStores[storeIndex].status = 'Ready';
            writeStores(updatedStores);
        }
    } catch (error) {
        console.error(`Error provisioning store ${name}:`, error);
        const updatedStores = readStores();
        const storeIndex = updatedStores.findIndex(s => s.id === newStore.id);
        if (storeIndex !== -1) {
            updatedStores[storeIndex].status = 'Failed';
            updatedStores[storeIndex].error = error.message;
            writeStores(updatedStores);
        }
    }
});

// Delete store
app.delete('/api/stores/:id', async (req, res) => {
    const { id } = req.params;
    let stores = readStores();
    const store = stores.find(s => s.id === id);

    if (!store) {
        return res.status(404).json({ error: 'Store not found' });
    }

    const name = store.name;
    const namespace = `store-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

    try {
        // 1. Uninstall Helm release
        await execPromise(`helm uninstall ${name} -n ${namespace} || true`);

        // 2. Delete namespace
        await execPromise(`kubectl delete namespace ${namespace} || true`);

        // Remove from list
        stores = stores.filter(s => s.id !== id);
        writeStores(stores);
        res.status(204).send();
    } catch (error) {
        console.error(`Error deleting store ${name}:`, error);
        res.status(500).json({ error: error.message });
    }
});

const execPromise = (command) => {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.warn(`Command failed: ${command}`, stderr);
                return reject(error);
            }
            resolve(stdout);
        });
    });
};

app.listen(port, () => {
    console.log(`Backend listening at http://localhost:${port}`);
});
