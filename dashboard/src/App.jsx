import React, { useState, useEffect } from 'react';
import './App.css';

const API_BASE = 'http://localhost:3001/api';

function App() {
  const [stores, setStores] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newStore, setNewStore] = useState({ 
    name: '', 
    type: 'woocommerce', 
    domain: '', 
    adminEmail: '',
    showAdvanced: false 
  });
  const [isLoading, setIsLoading] = useState(false);
  const [expandedStore, setExpandedStore] = useState(null);
  const [metrics, setMetrics] = useState(null);

  useEffect(() => {
    fetchStores();
    fetchMetrics();
    const interval = setInterval(() => {
      fetchStores();
      fetchMetrics();
    }, 5000); // Poll every 5s
    return () => clearInterval(interval);
  }, []);

  const fetchMetrics = async () => {
    try {
      const resp = await fetch(`${API_BASE}/metrics`);
      const data = await resp.json();
      setMetrics(data);
    } catch (err) {
      console.error("Failed to fetch metrics", err);
    }
  };

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
      // Only send optional fields if they have values
      const payload = { 
        name: newStore.name,
        type: newStore.type
      };
      if (newStore.domain && newStore.domain.trim() !== '') {
        payload.domain = newStore.domain.trim();
      }
      if (newStore.adminEmail && newStore.adminEmail.trim() !== '') {
        payload.adminEmail = newStore.adminEmail.trim();
      }
      console.log('Sending store creation request:', payload);
      const resp = await fetch(`${API_BASE}/stores`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (resp.ok) {
        setIsModalOpen(false);
        setNewStore({ name: '', type: 'woocommerce', domain: '', adminEmail: '', showAdvanced: false });
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
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          {metrics && (
            <div style={{ 
              display: 'flex', 
              gap: '1.5rem', 
              fontSize: '0.875rem', 
              color: '#64748b',
              background: '#f8fafc',
              padding: '0.5rem 1rem',
              borderRadius: '8px',
              border: '1px solid #e2e8f0'
            }}>
              <span><strong>{metrics.totalStores}</strong> stores</span>
              <span><strong>{metrics.storesByStatus.Ready}</strong> ready</span>
              <span><strong>{metrics.storesByStatus.Provisioning}</strong> provisioning</span>
              {metrics.provisioning.averageDurationSeconds && (
                <span>Avg: <strong>{metrics.provisioning.averageDurationSeconds}s</strong></span>
              )}
            </div>
          )}
          <button className="btn-primary" onClick={() => setIsModalOpen(true)}>
            Create New Store
          </button>
        </div>
      </header>

      <div className="store-grid">
        {stores.map(store => (
          <div key={store.id} className="store-card">
            <span className={`status-badge status-${store.status.toLowerCase()}`}>
              {store.status}
            </span>
            <div className="store-name">{store.name}</div>
            <div className="store-meta">
              {store.type} • {store.environment || 'local'} • {new Date(store.createdAt).toLocaleDateString()}
              {store.provisioningDuration !== undefined && store.provisioningDuration !== null && (
                <span style={{ marginLeft: '0.5rem', color: '#64748b' }}>
                  • {store.provisioningDuration}s
                </span>
              )}
            </div>

            <div className="store-actions">
              {store.status === 'Ready' && (
                <a href={store.url} target="_blank" rel="noreferrer" className="btn-secondary" style={{ textDecoration: 'none' }}>
                  Open Store
                </a>
              )}
              <button 
                className="btn-secondary" 
                onClick={() => setExpandedStore(expandedStore === store.id ? null : store.id)}
                style={{ fontSize: '0.875rem', padding: '0.5rem 1rem' }}
              >
                {expandedStore === store.id ? 'Hide' : 'View'} Details
              </button>
              <button className="btn-danger" onClick={() => handleDelete(store.id)}>
                Delete
              </button>
            </div>
            {store.error && (
              <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '10px' }}>
                Error: {store.error}
              </div>
            )}
            
            {expandedStore === store.id && (
              <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {/* Admin Credentials Section */}
                {(store.secrets?.adminPassword || store.status === 'Ready') && (
                  <div style={{ 
                    padding: '1rem', 
                    background: '#f0fdf4', 
                    borderRadius: '8px',
                    border: '1px solid #86efac'
                  }}>
                    <div style={{ fontSize: '0.875rem', fontWeight: '600', marginBottom: '0.75rem', color: '#166534' }}>
                      🔐 Admin Credentials
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.875rem' }}>
                      {store.type === 'woocommerce' && (
                        <>
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            <span style={{ color: '#475569', fontWeight: '500', minWidth: '80px' }}>Username:</span>
                            <code style={{ background: 'white', padding: '0.25rem 0.5rem', borderRadius: '4px', color: '#166534' }}>admin</code>
                          </div>
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ color: '#475569', fontWeight: '500', minWidth: '80px' }}>Password:</span>
                            <code style={{ background: 'white', padding: '0.25rem 0.5rem', borderRadius: '4px', color: '#166534', fontFamily: 'monospace' }}>
                              {store.secrets?.adminPassword || 'admin123'}
                            </code>
                            <button 
                              onClick={() => {
                                const password = store.secrets?.adminPassword || 'admin123';
                                navigator.clipboard.writeText(password);
                                alert('Password copied to clipboard!');
                              }}
                              style={{ 
                                padding: '0.25rem 0.5rem', 
                                fontSize: '0.75rem', 
                                background: '#166534', 
                                color: 'white', 
                                border: 'none', 
                                borderRadius: '4px', 
                                cursor: 'pointer' 
                              }}
                            >
                              Copy
                            </button>
                            {!store.secrets?.adminPassword && (
                              <span style={{ fontSize: '0.75rem', color: '#64748b', fontStyle: 'italic' }}>
                                (default for local)
                              </span>
                            )}
                          </div>
                          <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#64748b' }}>
                            Access: <a href={`${store.url}/wp-admin`} target="_blank" rel="noreferrer" style={{ color: '#166534' }}>{store.url}/wp-admin</a>
                          </div>
                        </>
                      )}
                      {store.type === 'medusa' && (
                        <>
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            <span style={{ color: '#475569', fontWeight: '500', minWidth: '80px' }}>Email:</span>
                            <code style={{ background: 'white', padding: '0.25rem 0.5rem', borderRadius: '4px', color: '#166534' }}>
                              {store.secrets?.adminEmail || (() => {
                                // Generate email from URL if not stored
                                // IMPORTANT: Must match Helm template logic which extracts LAST 2 parts
                                // For "store.127.0.0.1.nip.io" -> extracts "nip.io" -> "admin@nip.io"
                                // For "store.example.com" -> extracts "example.com" -> "admin@example.com"
                                if (store.url) {
                                  const host = store.url.replace(/^https?:\/\//, '').split('/')[0];
                                  const parts = host.split('.');
                                  if (parts.length >= 2) {
                                    // Extract last 2 parts (matches Helm template logic)
                                    return `admin@${parts.slice(-2).join('.')}`;
                                  }
                                }
                                return 'admin@example.com';
                              })()}
                            </code>
                          </div>
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ color: '#475569', fontWeight: '500', minWidth: '80px' }}>Password:</span>
                            <code style={{ background: 'white', padding: '0.25rem 0.5rem', borderRadius: '4px', color: '#166534', fontFamily: 'monospace' }}>
                              {store.secrets?.adminPassword || 'supersecret'}
                            </code>
                            <button 
                              onClick={() => {
                                const password = store.secrets?.adminPassword || 'supersecret';
                                navigator.clipboard.writeText(password);
                                alert('Password copied to clipboard!');
                              }}
                              style={{ 
                                padding: '0.25rem 0.5rem', 
                                fontSize: '0.75rem', 
                                background: '#166534', 
                                color: 'white', 
                                border: 'none', 
                                borderRadius: '4px', 
                                cursor: 'pointer' 
                              }}
                            >
                              Copy
                            </button>
                            {!store.secrets?.adminPassword && (
                              <span style={{ fontSize: '0.75rem', color: '#64748b', fontStyle: 'italic' }}>
                                (default for local)
                              </span>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}
                
                {/* Activity Log Section */}
                {store.events && store.events.length > 0 && (
                  <div style={{ 
                    padding: '1rem', 
                    background: '#f8fafc', 
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                    maxHeight: '300px',
                    overflowY: 'auto'
                  }}>
                    <div style={{ fontSize: '0.875rem', fontWeight: '600', marginBottom: '0.75rem', color: '#334155' }}>
                      Activity Log ({store.events.length} events)
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {[...store.events].reverse().map((event, idx) => (
                        <div key={idx} style={{ 
                          fontSize: '0.75rem', 
                          padding: '0.5rem',
                          background: 'white',
                          borderRadius: '4px',
                          borderLeft: `3px solid ${
                            event.type === 'success' ? '#10b981' :
                            event.type === 'error' ? '#ef4444' :
                            event.type === 'warning' ? '#f59e0b' : '#64748b'
                          }`
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                            <span style={{ color: '#475569', flex: 1 }}>{event.message}</span>
                            <span style={{ color: '#94a3b8', fontSize: '0.7rem', marginLeft: '0.5rem' }}>
                              {new Date(event.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
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
              <div className="form-group">
                <label>Domain (Optional - for production)</label>
                <input
                  type="text"
                  value={newStore.domain}
                  onChange={e => setNewStore({ ...newStore, domain: e.target.value })}
                  placeholder="e.g. example.com (leave empty to use default)"
                />
                <small style={{ color: '#94a3b8', fontSize: '0.75rem', display: 'block', marginTop: '0.25rem' }}>
                  Only used in production environment. Leave empty to use default from backend config.
                </small>
              </div>

              <div style={{ marginTop: '1rem', marginBottom: '1rem' }}>
                <button
                  type="button"
                  onClick={() => setNewStore({ ...newStore, showAdvanced: !newStore.showAdvanced })}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#64748b',
                    cursor: 'pointer',
                    fontSize: '0.875rem',
                    textDecoration: 'underline',
                    padding: 0
                  }}
                >
                  {newStore.showAdvanced ? '▼' : '▶'} Advanced Options
                </button>
              </div>

              {newStore.showAdvanced && (
                <div style={{ 
                  padding: '1rem', 
                  background: '#f8fafc', 
                  borderRadius: '8px', 
                  marginBottom: '1rem',
                  border: '1px solid #e2e8f0'
                }}>
                  <div className="form-group">
                    <label>Admin Email (Optional)</label>
                    <input
                      type="email"
                      value={newStore.adminEmail}
                      onChange={e => setNewStore({ ...newStore, adminEmail: e.target.value })}
                      placeholder="e.g. admin@example.com (auto-generated from domain if empty)"
                    />
                    <small style={{ color: '#94a3b8', fontSize: '0.75rem', display: 'block', marginTop: '0.25rem' }}>
                      Admin user email. If empty, will be auto-generated as admin@&lt;domain&gt;
                    </small>
                  </div>
                </div>
              )}

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
