import React, { useState, useEffect } from 'react';
import './App.css';

const API_BASE = 'http://localhost:3001/api';

function App() {
  const [stores, setStores] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newStore, setNewStore] = useState({ name: '', type: 'woocommerce' });
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    fetchStores();
    const interval = setInterval(fetchStores, 5000); // Poll every 5s
    return () => clearInterval(interval);
  }, []);

  const fetchStores = async () => {
    try {
      const resp = await fetch(`${API_BASE}/stores`);
      const data = await resp.json();
      setStores(data);
    } catch (err) {
      console.error("Failed to fetch stores", err);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/stores`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newStore)
      });
      if (resp.ok) {
        setIsModalOpen(false);
        setNewStore({ name: '', type: 'woocommerce' });
        fetchStores();
      } else {
        const errorData = await resp.json();
        alert(`Error: ${errorData.error}`);
      }
    } catch (err) {
      alert("Failed to create store");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this store?")) return;
    try {
      await fetch(`${API_BASE}/stores/${id}`, { method: 'DELETE' });
      fetchStores();
    } catch (err) {
      alert("Failed to delete store");
    }
  };

  return (
    <div className="dashboard">
      <header>
        <div>
          <h1>Urumi Store Platform</h1>
          <p style={{ color: '#94a3b8', margin: '4px 0 0' }}>Provisioning Nodes Locally</p>
        </div>
        <button className="btn-primary" onClick={() => setIsModalOpen(true)}>
          Create New Store
        </button>
      </header>

      <div className="store-grid">
        {stores.map(store => (
          <div key={store.id} className="store-card">
            <span className={`status-badge status-${store.status.toLowerCase()}`}>
              {store.status}
            </span>
            <div className="store-name">{store.name}</div>
            <div className="store-meta">{store.type} • {new Date(store.createdAt).toLocaleDateString()}</div>

            <div className="store-actions">
              {store.status === 'Ready' && (
                <a href={store.url} target="_blank" rel="noreferrer" className="btn-secondary" style={{ textDecoration: 'none' }}>
                  Open Store
                </a>
              )}
              <button className="btn-danger" onClick={() => handleDelete(store.id)}>
                Delete
              </button>
            </div>
            {store.error && (
              <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '10px' }}>
                Error: {store.error}
              </div>
            )}
          </div>
        ))}

        {stores.length === 0 && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '4rem', color: '#94a3b8' }}>
            No stores provisioned yet. Click "Create New Store" to get started.
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>New Store</h2>
            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label>Store Name</label>
                <input
                  type="text"
                  value={newStore.name}
                  onChange={e => setNewStore({ ...newStore, name: e.target.value })}
                  placeholder="e.g. my-awesome-store"
                  required
                />
              </div>
              <div className="form-group">
                <label>Engine</label>
                <select
                  value={newStore.type}
                  onChange={e => setNewStore({ ...newStore, type: e.target.value })}
                >
                  <option value="woocommerce">WooCommerce (WordPress)</option>
                  <option value="medusa">MedusaJS (Full Stack)</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                <button type="button" className="btn-secondary" onClick={() => setIsModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={isLoading}>
                  {isLoading ? 'Processing...' : 'Provision Store'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
