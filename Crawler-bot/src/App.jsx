import React, { useState, useEffect } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Line, Doughnut, Bar } from 'react-chartjs-2';
import { Trash2 } from 'lucide-react';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const getApiBaseUrl = () => {
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, '');
  }
  if (typeof window !== 'undefined' && window.location.hostname.endsWith('.onrender.com')) {
    return 'https://ai-crawler-and-bot-tracker-backend.onrender.com';
  }
  return 'http://localhost:3001';
};

const API_BASE_URL = getApiBaseUrl();

const BOT_COLORS = ['#2dd4bf', '#5b9dd9', '#f0b429', '#b48cf0', '#f0554d', '#4ade80', '#f97316', '#94a3b8', '#e879f9', '#38bdf8'];

export default function App() {
  const [projects, setProjects] = useState([]);
  const [currentProjectId, setCurrentProjectId] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');

  // Filters state
  const [filters, setFilters] = useState({
    from: '',
    to: '',
    bot: '',
    botGroup: '',
    urlPattern: '',
    status: '',
    referrer: ''
  });

  // Bot signatures & stats data
  const [botSignatures, setBotSignatures] = useState([]);
  const [statsData, setStatsData] = useState(null);
  const [logsData, setLogsData] = useState([]);
  const [frequencyData, setFrequencyData] = useState([]);
  const [gapsData, setGapsData] = useState([]);
  const [insightsData, setInsightsData] = useState([]);
  const [syncData, setSyncData] = useState([]);

  // UI States
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDomain, setNewProjectDomain] = useState('');
  const [uploadStatus, setUploadStatus] = useState('');
  const [loading, setLoading] = useState(false);

  // Helper fetch function
  const apiFetch = async (path, options = {}) => {
    try {
      const res = await fetch(`${API_BASE_URL}${path}`, options);
      if (!res.ok) throw new Error(`API error ${res.status}`);
      return await res.json();
    } catch (err) {
      console.error(`Fetch failed for ${path}:`, err);
      return null;
    }
  };

  // Load Initial Projects & Signatures
  useEffect(() => {
    loadProjects();
    loadBotSignatures();
  }, []);

  const loadProjects = async () => {
    const data = await apiFetch('/api/projects');
    if (data && Array.isArray(data)) {
      setProjects(data);
      if (data.length > 0 && !currentProjectId) {
        const p0 = data[0];
        setCurrentProjectId(p0.id);
        if (p0.date_from || p0.date_to) {
          setFilters(prev => ({
            ...prev,
            from: p0.date_from || '',
            to: p0.date_to || ''
          }));
        }
      }
    }
  };

  const loadBotSignatures = async () => {
    const sigs = await apiFetch('/api/bot-signatures');
    if (sigs && Array.isArray(sigs)) setBotSignatures(sigs);
  };

  // When project changes, set default date range if available
  const handleSelectProject = (projectId) => {
    setCurrentProjectId(projectId);
    const p = projects.find(item => item.id === projectId);
    if (p) {
      setFilters(prev => ({
        ...prev,
        from: p.date_from || '',
        to: p.date_to || ''
      }));
    }
  };

  // Handle quick date range presets
  const handlePresetRange = (preset) => {
    const curProj = projects.find(p => p.id === currentProjectId);
    const maxDateStr = curProj?.date_to || new Date().toISOString().slice(0, 10);
    const maxDateObj = new Date(maxDateStr);

    let fromStr = '';
    let toStr = maxDateStr;

    if (preset === 'all') {
      fromStr = curProj?.date_from || '';
      toStr = curProj?.date_to || '';
    } else if (preset === 'today') {
      const today = new Date().toISOString().slice(0, 10);
      fromStr = today;
      toStr = today;
    } else if (preset === '7d') {
      const d7 = new Date(maxDateObj);
      d7.setDate(d7.getDate() - 7);
      fromStr = d7.toISOString().slice(0, 10);
    } else if (preset === '30d') {
      const d30 = new Date(maxDateObj);
      d30.setDate(d30.getDate() - 30);
      fromStr = d30.toISOString().slice(0, 10);
    }

    setFilters(prev => ({ ...prev, from: fromStr, to: toStr }));
  };

  // Load Data whenever currentProjectId, activeTab, or filters update
  useEffect(() => {
    if (!currentProjectId) return;
    loadDashboardData();
  }, [currentProjectId, activeTab, filters]);

  const buildQueryParams = () => {
    const params = new URLSearchParams();
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    if (filters.bot) params.set('bot', filters.bot);
    if (filters.botGroup) params.set('bot_group', filters.botGroup);
    if (filters.urlPattern) params.set('url_pattern', filters.urlPattern);
    if (filters.status) params.set('status_code', filters.status);
    if (filters.referrer) params.set('referrer', filters.referrer);
    return params.toString();
  };

  const loadDashboardData = async () => {
    if (!currentProjectId) return;
    setLoading(true);
    const query = buildQueryParams();

    if (activeTab === 'overview') {
      const res = await apiFetch(`/api/projects/${currentProjectId}/analytics/stats?${query}`);
      if (res) setStatsData(res);
    } else if (activeTab === 'query') {
      const res = await apiFetch(`/api/projects/${currentProjectId}/analytics/logs?${query}&limit=500`);
      if (res) setLogsData(Array.isArray(res) ? res : res.rows || []);
    } else if (activeTab === 'frequency') {
      const res = await apiFetch(`/api/projects/${currentProjectId}/analytics/frequency?${query}`);
      if (res) setFrequencyData(Array.isArray(res) ? res : []);
    } else if (activeTab === 'gaps') {
      const res = await apiFetch(`/api/projects/${currentProjectId}/analytics/gaps?${query}&days=10`);
      if (res) setGapsData(Array.isArray(res) ? res : []);
    } else if (activeTab === 'insights') {
      const res = await apiFetch(`/api/projects/${currentProjectId}/analytics/insights?${query}`);
      if (res) setInsightsData(Array.isArray(res) ? res : []);
    } else if (activeTab === 'sync') {
      const res = await apiFetch(`/api/projects/${currentProjectId}/sync/history`);
      if (res) setSyncData(Array.isArray(res) ? res : []);
    }
    setLoading(false);
  };

  const handleApplyFilters = () => {
    loadDashboardData();
  };

  const handleClearFilters = () => {
    setFilters({
      from: '',
      to: '',
      bot: '',
      botGroup: '',
      urlPattern: '',
      status: '',
      referrer: ''
    });
    setTimeout(() => loadDashboardData(), 50);
  };

  // Create Project
  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;
    const res = await apiFetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newProjectName.trim(), domain: newProjectDomain.trim() })
    });
    if (res && res.id) {
      setShowNewProjectModal(false);
      setNewProjectName('');
      setNewProjectDomain('');
      await loadProjects();
      setCurrentProjectId(res.id);
    }
  };

  // Delete Project
  const handleDeleteProject = async (id, name) => {
    if (!window.confirm(`Are you sure you want to delete "${name}" and all its logs?`)) return;
    const res = await apiFetch(`/api/projects/${id}`, { method: 'DELETE' });
    if (res) {
      const remaining = projects.filter(p => p.id !== id);
      setProjects(remaining);
      if (currentProjectId === id) {
        if (remaining.length > 0) {
          setCurrentProjectId(remaining[0].id);
        } else {
          setCurrentProjectId(null);
          setStatsData(null);
        }
      }
    }
  };

  // Upload Log File
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !currentProjectId) return;
    setUploadStatus('Uploading & parsing log...');

    const formData = new FormData();
    formData.append('logfile', file);

    try {
      const res = await fetch(`${API_BASE_URL}/api/projects/${currentProjectId}/logs/upload`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (res.ok) {
        setUploadStatus(`Ingested ${data.newRows || data.new_row_count || 0} rows!`);
        loadDashboardData();
      } else {
        setUploadStatus(`Error: ${data.error || 'Upload failed'}`);
      }
    } catch (err) {
      setUploadStatus(`Upload failed: ${err.message}`);
    }
  };

  const currentProject = projects.find(p => p.id === currentProjectId);

  // Chart 1: Crawl Volume Over Time
  const volumeChartData = {
    labels: statsData?.volumeOverTime?.map(d => d.date || d.ts) || [],
    datasets: (statsData?.byBot?.slice(0, 5) || []).map((b, i) => ({
      label: b.bot_name || `Bot ${i+1}`,
      data: statsData?.volumeOverTime?.map(d => d[b.bot_name] || 0) || [],
      borderColor: BOT_COLORS[i % BOT_COLORS.length],
      backgroundColor: BOT_COLORS[i % BOT_COLORS.length] + '20',
      tension: 0.3,
      fill: true
    }))
  };

  // Chart 2: Bot Share
  const botShareChartData = {
    labels: statsData?.byBot?.map(b => b.bot_name) || [],
    datasets: [{
      data: statsData?.byBot?.map(b => b.hits) || [],
      backgroundColor: BOT_COLORS.slice(0, 5),
      borderWidth: 0
    }]
  };

  // Chart 3: Status Code Distribution
  const statusCodeChartData = {
    labels: statsData?.byStatus?.map(s => `HTTP ${s.status_code}`) || [],
    datasets: [{
      label: 'Requests',
      data: statsData?.byStatus?.map(s => s.hits) || [],
      backgroundColor: ['#2dd4bf', '#5b9dd9', '#f0554d', '#e879f9'],
      borderRadius: 4
    }]
  };

  // Chart 4: Human vs Bot Traffic Over Time
  const humanVsBotChartData = {
    labels: statsData?.volumeOverTime?.map(d => d.date || d.ts) || [],
    datasets: [
      {
        label: 'Bot Traffic',
        data: statsData?.volumeOverTime?.map(d => d.bot_hits || 0) || [],
        borderColor: '#2dd4bf',
        backgroundColor: '#2dd4bf30',
        fill: true
      },
      {
        label: 'Human Traffic',
        data: statsData?.volumeOverTime?.map(d => d.human_hits || 0) || [],
        borderColor: '#5b9dd9',
        backgroundColor: '#5b9dd930',
        fill: true
      }
    ]
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
        labels: { color: '#94a3b8', font: { size: 11, family: 'Inter' } }
      }
    },
    scales: {
      x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b', font: { size: 10 } } },
      y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b', font: { size: 10 } } }
    }
  };

  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-dot"></div>
          <div>
            <div className="brand-title">Crawler Watch</div>
            <div className="brand-sub">bot &amp; AI-crawler analytics</div>
          </div>
        </div>

        <div className="sidebar-section">
          <div className="section-label">Projects</div>
          <div className="project-list">
            {projects.map(p => (
              <div
                key={p.id}
                className={`project-item ${p.id === currentProjectId ? 'active' : ''}`}
                onClick={() => handleSelectProject(p.id)}
              >
                <span className="project-name">{p.name}</span>
                <button
                  className="btn-delete-project"
                  title="Delete project"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteProject(p.id, p.name);
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            {projects.length === 0 && (
              <div style={{ color: '#64748b', fontSize: 12 }}>No projects yet</div>
            )}
          </div>
          <button className="btn-sidebar" onClick={() => setShowNewProjectModal(true)}>
            + New project
          </button>
        </div>

        <div className="sidebar-section">
          <div className="section-label">Data</div>
          <label className="btn-sidebar" style={{ cursor: 'pointer' }}>
            Upload log file
            <input
              type="file"
              style={{ display: 'none' }}
              accept=".log,.txt,.gz"
              onChange={handleFileUpload}
            />
          </label>
          {uploadStatus && (
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{uploadStatus}</div>
          )}
        </div>

        <div className="sidebar-foot">
          Bot signature list: <code>botSignatures.json</code> — edit &amp; reload anytime.
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        {/* Topbar */}
        <div className="topbar">
          <div>
            <h2 className="page-title">{currentProject ? currentProject.name : 'Select a project'}</h2>
            <div className="page-sub">{currentProject?.domain || 'Analytics Overview'}</div>
          </div>
          <div className="topbar-actions">
            <button
              className="btn-action"
              onClick={() => window.open(`${API_BASE_URL}/api/projects/${currentProjectId}/analytics/export.csv?${buildQueryParams()}`, '_blank')}
            >
              Export filtered CSV
            </button>
            <button
              className="btn-action"
              onClick={() => window.open(`${API_BASE_URL}/api/projects/${currentProjectId}/analytics/export.pdf?${buildQueryParams()}`, '_blank')}
            >
              Export full report (PDF)
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="tabs-nav">
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'query', label: 'Ask a question' },
            { id: 'frequency', label: 'Crawl frequency' },
            { id: 'gaps', label: 'Crawl gaps' },
            { id: 'insights', label: 'Insights' },
            { id: 'sync', label: 'Sync history' }
          ].map(tab => (
            <button
              key={tab.id}
              className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Filter Card */}
        <div className="filter-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>Quick Range:</span>
            <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => handlePresetRange('all')}>All Time</button>
            <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => handlePresetRange('7d')}>Last 7 Days</button>
            <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => handlePresetRange('30d')}>Last 30 Days</button>
            <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => handlePresetRange('today')}>Today</button>
          </div>
          <div className="filter-grid">
            <div className="filter-field">
              <label>From</label>
              <input
                type="date"
                className="filter-input"
                value={filters.from}
                onChange={e => setFilters({ ...filters, from: e.target.value })}
              />
            </div>
            <div className="filter-field">
              <label>To</label>
              <input
                type="date"
                className="filter-input"
                value={filters.to}
                onChange={e => setFilters({ ...filters, to: e.target.value })}
              />
            </div>
            <div className="filter-field">
              <label>Bot</label>
              <select
                className="filter-input"
                value={filters.bot}
                onChange={e => setFilters({ ...filters, bot: e.target.value })}
              >
                <option value="">All bots</option>
                {botSignatures.map(s => (
                  <option key={s.name} value={s.name}>{s.name} ({s.group})</option>
                ))}
              </select>
            </div>
            <div className="filter-field">
              <label>Bot group</label>
              <select
                className="filter-input"
                value={filters.botGroup}
                onChange={e => setFilters({ ...filters, botGroup: e.target.value })}
              >
                <option value="">All groups</option>
                {[...new Set(botSignatures.map(s => s.group))].map(g => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>
            <div className="filter-field" style={{ gridColumn: 'span 2' }}>
              <label>URL pattern</label>
              <input
                type="text"
                className="filter-input"
                placeholder="/pricing, /blog/*, or /^\/blog\/.*/ for regex"
                value={filters.urlPattern}
                onChange={e => setFilters({ ...filters, urlPattern: e.target.value })}
              />
            </div>
            <div className="filter-field">
              <label>Status code</label>
              <input
                type="text"
                className="filter-input"
                placeholder="e.g. 404"
                value={filters.status}
                onChange={e => setFilters({ ...filters, status: e.target.value })}
              />
            </div>
            <div className="filter-field">
              <label>Referrer contains</label>
              <input
                type="text"
                className="filter-input"
                placeholder="google.com"
                value={filters.referrer}
                onChange={e => setFilters({ ...filters, referrer: e.target.value })}
              />
            </div>
            <button className="btn-primary" onClick={handleApplyFilters}>
              Apply
            </button>
          </div>
          <div style={{ marginTop: 10 }}>
            <button className="btn-secondary" onClick={handleClearFilters}>
              Clear
            </button>
          </div>
        </div>

        {/* Tab Contents */}
        {activeTab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Stat Cards */}
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-val">{(statsData?.totals?.total_requests || 0).toLocaleString()}</div>
                <div className="stat-label">Total requests</div>
              </div>
              <div className="stat-card">
                <div className="stat-val" style={{ color: '#2dd4bf' }}>{(statsData?.totals?.bot_requests || 0).toLocaleString()}</div>
                <div className="stat-label">Bot requests</div>
              </div>
              <div className="stat-card">
                <div className="stat-val" style={{ color: '#5b9dd9' }}>{(statsData?.totals?.human_requests || 0).toLocaleString()}</div>
                <div className="stat-label">Human requests</div>
              </div>
              <div className="stat-card">
                <div className="stat-val" style={{ color: '#f0b429' }}>{(statsData?.byBot?.length || 0).toLocaleString()}</div>
                <div className="stat-label">Distinct bots seen</div>
              </div>
            </div>

            {/* Charts Grid */}
            <div className="charts-grid">
              <div className="chart-card">
                <div className="chart-title">CRAWL VOLUME OVER TIME (TOP BOTS)</div>
                <div className="chart-container">
                  <Line data={volumeChartData} options={chartOptions} />
                </div>
              </div>

              <div className="chart-card">
                <div className="chart-title">BOT SHARE</div>
                <div className="chart-container">
                  <Doughnut data={botShareChartData} options={{ ...chartOptions, scales: {} }} />
                </div>
              </div>

              <div className="chart-card">
                <div className="chart-title">STATUS CODE DISTRIBUTION</div>
                <div className="chart-container">
                  <Bar data={statusCodeChartData} options={chartOptions} />
                </div>
              </div>

              <div className="chart-card">
                <div className="chart-title">HUMAN VS BOT TRAFFIC OVER TIME</div>
                <div className="chart-container">
                  <Line data={humanVsBotChartData} options={chartOptions} />
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'query' && (
          <div className="table-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>IP</th>
                  <th>Method</th>
                  <th>URL</th>
                  <th>Status</th>
                  <th>Bot / User Agent</th>
                </tr>
              </thead>
              <tbody>
                {logsData.slice(0, 100).map((row, idx) => (
                  <tr key={idx}>
                    <td>{row.ts?.slice(0, 19)}</td>
                    <td>{row.ip}</td>
                    <td><span className="badge badge-low">{row.method}</span></td>
                    <td style={{ maxWidth: 300, wordBreak: 'break-all' }}>{row.url}</td>
                    <td><span className={`badge ${row.status_code >= 400 ? 'badge-high' : 'badge-low'}`}>{row.status_code}</span></td>
                    <td>{row.bot_name ? <strong style={{ color: '#2dd4bf' }}>{row.bot_name}</strong> : (row.user_agent?.slice(0, 40) + '...')}</td>
                  </tr>
                ))}
                {logsData.length === 0 && (
                  <tr><td colSpan="6" style={{ textAlign: 'center', color: '#64748b' }}>No crawl log entries match the current filters</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'frequency' && (
          <div className="table-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Bot Name</th>
                  <th>Group</th>
                  <th>Category</th>
                  <th>Frequency Trend</th>
                  <th>Recent Hits</th>
                </tr>
              </thead>
              <tbody>
                {frequencyData.map((b, idx) => (
                  <tr key={idx}>
                    <td><strong>{b.bot_name}</strong></td>
                    <td>{b.bot_group || '—'}</td>
                    <td>{b.bot_category || '—'}</td>
                    <td><span className={`badge ${b.trend === 'stopped' ? 'badge-high' : b.trend === 'rising' ? 'badge-low' : 'badge-medium'}`}>{b.trend || 'steady'}</span></td>
                    <td>{b.hits || 0}</td>
                  </tr>
                ))}
                {frequencyData.length === 0 && (
                  <tr><td colSpan="5" style={{ textAlign: 'center', color: '#64748b' }}>No frequency trend data available</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'gaps' && (
          <div className="table-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Bot Name</th>
                  <th>URL Section</th>
                  <th>Last Crawled</th>
                  <th>Days Quiet</th>
                </tr>
              </thead>
              <tbody>
                {gapsData.map((g, idx) => (
                  <tr key={idx}>
                    <td><strong style={{ color: '#f87171' }}>{g.bot_name}</strong></td>
                    <td>{g.url}</td>
                    <td>{g.last_seen?.slice(0, 10)}</td>
                    <td><span className="badge badge-high">{g.days_since_last_crawl} days</span></td>
                  </tr>
                ))}
                {gapsData.length === 0 && (
                  <tr><td colSpan="4" style={{ textAlign: 'center', color: '#64748b' }}>No crawl gaps detected — all bots crawling regularly</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'insights' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {insightsData.map((item, idx) => (
              <div key={idx} className="stat-card" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontWeight: 600, color: '#f8fafc', fontSize: 13 }}>{item.title || item.text}</div>
                  <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 2 }}>{item.description || item.detail}</div>
                </div>
                <span className={`badge ${item.severity === 'high' ? 'badge-high' : item.severity === 'medium' ? 'badge-medium' : 'badge-low'}`}>
                  {item.severity || 'info'}
                </span>
              </div>
            ))}
            {insightsData.length === 0 && (
              <div className="stat-card" style={{ color: '#64748b', textAlign: 'center' }}>No diagnostic flags detected</div>
            )}
          </div>
        )}

        {activeTab === 'sync' && (
          <div className="table-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Run Timestamp</th>
                  <th>Found New</th>
                  <th>File Size</th>
                  <th>New Rows</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {syncData.map((s, idx) => (
                  <tr key={idx}>
                    <td>{s.run_at?.slice(0, 19)}</td>
                    <td>{s.found_new ? 'Yes' : 'No'}</td>
                    <td>{s.file_size ? `${(s.file_size / 1024).toFixed(1)} KB` : '—'}</td>
                    <td>{s.new_rows || 0}</td>
                    <td>{s.note}</td>
                  </tr>
                ))}
                {syncData.length === 0 && (
                  <tr><td colSpan="5" style={{ textAlign: 'center', color: '#64748b' }}>No automated sync runs logged yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* New Project Modal */}
      {showNewProjectModal && (
        <div className="modal-backdrop" onClick={() => setShowNewProjectModal(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-title">New project</div>
            <div className="filter-field">
              <label>Project / client name</label>
              <input
                className="filter-input"
                placeholder="Acme Corp"
                value={newProjectName}
                onChange={e => setNewProjectName(e.target.value)}
              />
            </div>
            <div className="filter-field">
              <label>Domain</label>
              <input
                className="filter-input"
                placeholder="acme.com"
                value={newProjectDomain}
                onChange={e => setNewProjectDomain(e.target.value)}
              />
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowNewProjectModal(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleCreateProject}>
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
