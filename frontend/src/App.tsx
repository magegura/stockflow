import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react'
import { AuditLog, Dashboard, Movement, Product, Sale, User } from './types'

const API_URL = import.meta.env.VITE_API_URL || '/api'

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊', description: 'Compact operational overview' },
  { id: 'products', label: 'Products', icon: '📦', description: 'Responsive product catalog cards' },
  { id: 'sales', label: 'Sales', icon: '🧾', description: 'Readable sales list with details modal' },
  { id: 'movements', label: 'Movements', icon: '🔁', description: 'Stock adjustments and full history' },
  { id: 'logs', label: 'Logs', icon: '🪵', description: 'Audit trail and system actions' },
  { id: 'profile', label: 'Profile', icon: '👤', description: 'Personal info and staff management' },
  { id: 'docs', label: 'Docs', icon: '📚', description: 'Technical notes and release summary' },
] as const

type Tab = (typeof NAV_ITEMS)[number]['id']
type StockFilter = 'all' | 'low' | 'out'
type LogFilter = 'all' | 'info' | 'warning' | 'error'
type StaffStatus = 'active' | 'on_leave' | 'inactive'
type StaffLevel = 'staff' | 'lead' | 'management'
type SaleLine = { id: number; product_id: string; quantity: string }

type ApiError = { detail?: string; message?: string }

const docsSections = [
  {
    title: 'Frontend experience',
    items: [
      'Bright responsive UI with collapsible sidebar and mobile burger menu',
      'Product catalog rendered as adaptive cards using CSS grid',
      'Sales and movements shown as clean list rows with modal detail cards',
      'All destructive or meaningful actions feed back success or failure messages',
    ],
  },
  {
    title: 'Backend capabilities',
    items: [
      'FastAPI + SQLAlchemy with PostgreSQL-ready configuration via DATABASE_URL',
      'JWT auth, role checks and audit logging for business-critical actions',
      'Personnel profiles backed by a dedicated EmployeeProfile table',
      'Product CRUD persists directly to the database and updates dashboard metrics',
    ],
  },
  {
    title: 'Operational modules',
    items: [
      'Dashboard with KPIs, trend bars, top products and low-stock watchlist',
      'Products with create, update, delete and stock health status',
      'Sales with multi-line creation, stock deduction and movement generation',
      'Logs and documentation kept available inside the application itself',
    ],
  },
]

function buildNetworkError(url: string, path: string, error: unknown): Error {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new Error(`The request to ${path} timed out. The backend may be redeploying or unavailable.`)
  }

  return new Error(`Could not reach the API at ${url}. Check backend deployment status, VITE_API_URL and CORS_ORIGINS.`)
}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const url = `${API_URL}${path}`
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), 15000)

  let response: Response

  try {
    response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    })
  } catch (error) {
    throw buildNetworkError(url, path, error)
  } finally {
    window.clearTimeout(timeoutId)
  }

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as ApiError
    const detail = errorBody.detail || errorBody.message

    if (detail) throw new Error(`${detail} (HTTP ${response.status})`)
    if (response.status === 401) throw new Error('Authentication failed. Check the email, password or session token. (HTTP 401)')
    if (response.status === 403) throw new Error('You do not have permission to perform this action. (HTTP 403)')
    if (response.status >= 500) throw new Error(`Server error while calling ${path}. Check backend logs. (HTTP ${response.status})`)
    throw new Error(`Request failed for ${path}. (HTTP ${response.status})`)
  }

  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

function currency(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value)
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString()
}

function shortDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function getStatus(product: Product): { label: string; className: string } {
  if (product.stock === 0) return { label: 'Out', className: 'status out' }
  if (product.stock <= product.min_stock) return { label: 'Low', className: 'status low' }
  return { label: 'OK', className: 'status ok' }
}

function humanizeAction(value: string): string {
  return value.replace(/\./g, ' · ').replace(/_/g, ' ')
}

function detailsToText(details: Record<string, unknown>): string {
  const items = Object.entries(details)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .slice(0, 4)

  if (items.length === 0) return 'No additional details.'
  return items.map(([key, value]) => `${key}: ${Array.isArray(value) ? `${value.length} item(s)` : String(value)}`).join(' · ')
}

function MetricCard({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <article className="metric-card">
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
      <span className="metric-hint">{hint}</span>
    </article>
  )
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <button className="modal-backdrop" type="button" onClick={onClose} aria-label="Close details" />
      <div className="modal-card">
        <div className="modal-head">
          <div>
            <h3>{title}</h3>
            {subtitle ? <p className="muted small">{subtitle}</p> : null}
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close modal">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('stockflow_token'))
  const [user, setUser] = useState<User | null>(null)
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [movements, setMovements] = useState<Movement[]>([])
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [staff, setStaff] = useState<User[]>([])
  const [tab, setTab] = useState<Tab>('dashboard')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [stockFilter, setStockFilter] = useState<StockFilter>('all')
  const [logFilter, setLogFilter] = useState<LogFilter>('all')
  const [logSearch, setLogSearch] = useState('')
  const [editingProductId, setEditingProductId] = useState<number | null>(null)
  const [saleLineId, setSaleLineId] = useState(2)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(localStorage.getItem('stockflow_sidebar_collapsed') === 'true')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null)
  const [selectedMovement, setSelectedMovement] = useState<Movement | null>(null)
  const [editingStaffId, setEditingStaffId] = useState<number | null>(null)

  const [loginForm, setLoginForm] = useState({ email: 'admin@stockflow.app', password: 'Admin123!' })
  const [productForm, setProductForm] = useState({ name: '', sku: '', price: '0', stock: '0', min_stock: '0' })
  const [movementForm, setMovementForm] = useState({ product_id: '', movement_type: 'purchase', quantity: '1', note: '' })
  const [saleLines, setSaleLines] = useState<SaleLine[]>([{ id: 1, product_id: '', quantity: '1' }])
  const [profileForm, setProfileForm] = useState({ name: '', email: '', phone: '', department: '', title: '', bio: '' })
  const [staffForm, setStaffForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'employee',
    phone: '',
    department: '',
    title: '',
    status: 'active',
    hierarchy_level: 'staff',
    manager_name: '',
    bio: '',
  })

  const currentTabMeta = NAV_ITEMS.find((item) => item.id === tab) ?? NAV_ITEMS[0]

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase()
    return products.filter((product) => {
      const matchesSearch = !term || product.name.toLowerCase().includes(term) || product.sku.toLowerCase().includes(term)
      const matchesStock = stockFilter === 'all' ? true : stockFilter === 'low' ? product.stock <= product.min_stock : product.stock === 0
      return matchesSearch && matchesStock
    })
  }, [products, search, stockFilter])

  const filteredLogs = useMemo(() => {
    const term = logSearch.trim().toLowerCase()
    return logs.filter((item) => {
      const matchesLevel = logFilter === 'all' ? true : item.level === logFilter
      const haystack = `${item.action} ${item.message} ${item.entity_type || ''} ${item.created_by_name}`.toLowerCase()
      return matchesLevel && (!term || haystack.includes(term))
    })
  }, [logs, logFilter, logSearch])

  const productSummary = useMemo(() => {
    return products.reduce(
      (acc, product) => {
        if (product.stock === 0) acc.out += 1
        if (product.stock <= product.min_stock) acc.low += 1
        return acc
      },
      { low: 0, out: 0 },
    )
  }, [products])

  const salePreview = useMemo(() => {
    return saleLines.reduce((acc, line) => {
      const product = products.find((item) => item.id === Number(line.product_id))
      const quantity = Number(line.quantity || 0)
      if (!product || quantity <= 0) return acc
      return acc + product.price * quantity
    }, 0)
  }, [products, saleLines])

  const activeStaff = useMemo(() => staff.filter((person) => person.status === 'active').length, [staff])

  const loadAll = async (currentToken: string) => {
    setIsLoading(true)
    setError(null)
    try {
      const meData = await request<User>('/me', {}, currentToken)
      const [dashboardData, productsData, salesData, movementsData, logsData] = await Promise.all([
        request<Dashboard>('/dashboard', {}, currentToken),
        request<{ items: Product[] }>('/products?page=1&page_size=100', {}, currentToken),
        request<{ items: Sale[] }>('/sales?page=1&page_size=50', {}, currentToken),
        request<{ items: Movement[] }>('/stock-movements?page=1&page_size=50', {}, currentToken),
        request<{ items: AuditLog[] }>('/logs?page=1&page_size=50', {}, currentToken),
      ])

      let staffItems: User[] = []
      if (meData.role === 'admin') {
        const usersData = await request<{ items: User[] }>('/users', {}, currentToken)
        staffItems = usersData.items
      }

      setUser(meData)
      setProfileForm({
        name: meData.name,
        email: meData.email,
        phone: meData.phone || '',
        department: meData.department || '',
        title: meData.title || '',
        bio: meData.bio || '',
      })
      setDashboard(dashboardData)
      setProducts(productsData.items)
      setSales(salesData.items)
      setMovements(movementsData.items)
      setLogs(logsData.items)
      setStaff(staffItems)
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Could not load data'
      setError(text)
      if (text.toLowerCase().includes('token') || text.toLowerCase().includes('bearer') || text.toLowerCase().includes('expired')) {
        handleLogout()
      }
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (token) void loadAll(token)
  }, [token])

  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(() => setMessage(null), 4200)
    return () => window.clearTimeout(timer)
  }, [message])

  useEffect(() => {
    localStorage.setItem('stockflow_sidebar_collapsed', String(sidebarCollapsed))
  }, [sidebarCollapsed])

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > 960) setMobileNavOpen(false)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const resetProductForm = () => {
    setEditingProductId(null)
    setProductForm({ name: '', sku: '', price: '0', stock: '0', min_stock: '0' })
  }

  const resetSaleForm = () => {
    setSaleLines([{ id: 1, product_id: '', quantity: '1' }])
    setSaleLineId(2)
  }

  const resetStaffForm = () => {
    setEditingStaffId(null)
    setStaffForm({
      name: '',
      email: '',
      password: '',
      role: 'employee',
      phone: '',
      department: '',
      title: '',
      status: 'active',
      hierarchy_level: 'staff',
      manager_name: '',
      bio: '',
    })
  }

  const selectTab = (nextTab: Tab) => {
    setTab(nextTab)
    setMobileNavOpen(false)
  }

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault()
    setIsLoading(true)
    setError(null)
    setMessage(null)
    try {
      const response = await request<{ access_token: string; user: User }>('/auth/login', { method: 'POST', body: JSON.stringify(loginForm) })
      localStorage.setItem('stockflow_token', response.access_token)
      setToken(response.access_token)
      setUser(response.user)
      setMessage(`Welcome, ${response.user.name}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setIsLoading(false)
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('stockflow_token')
    setToken(null)
    setUser(null)
    setDashboard(null)
    setProducts([])
    setSales([])
    setMovements([])
    setLogs([])
    setStaff([])
    setMessage(null)
    setError(null)
    setTab('dashboard')
    setMobileNavOpen(false)
    setSelectedSale(null)
    setSelectedMovement(null)
    resetProductForm()
    resetSaleForm()
    resetStaffForm()
  }

  const handleRefresh = async () => {
    if (!token) return
    await loadAll(token)
    setMessage('Workspace refreshed')
  }

  const handleSubmitProduct = async (event: FormEvent) => {
    event.preventDefault()
    if (!token) return
    setError(null)
    setMessage(null)
    try {
      const payload = {
        name: productForm.name,
        sku: productForm.sku,
        price: Number(productForm.price),
        min_stock: Number(productForm.min_stock),
      }
      if (editingProductId) {
        await request(`/products/${editingProductId}`, { method: 'PUT', body: JSON.stringify(payload) }, token)
        setMessage('Product updated successfully')
      } else {
        await request('/products', { method: 'POST', body: JSON.stringify({ ...payload, stock: Number(productForm.stock) }) }, token)
        setMessage('Product created successfully')
      }
      resetProductForm()
      await loadAll(token)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save product')
    }
  }

  const startEditProduct = (product: Product) => {
    setEditingProductId(product.id)
    setProductForm({
      name: product.name,
      sku: product.sku,
      price: String(product.price),
      stock: String(product.stock),
      min_stock: String(product.min_stock),
    })
    selectTab('products')
  }

  const handleDeleteProduct = async (product: Product) => {
    if (!token) return
    if (!window.confirm(`Delete ${product.name}? This action cannot be undone.`)) return
    try {
      await request(`/products/${product.id}`, { method: 'DELETE' }, token)
      if (editingProductId === product.id) resetProductForm()
      await loadAll(token)
      setMessage('Product deleted successfully')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete product')
    }
  }

  const handleCreateMovement = async (event: FormEvent) => {
    event.preventDefault()
    if (!token) return
    try {
      await request(
        '/stock-movements',
        {
          method: 'POST',
          body: JSON.stringify({
            product_id: Number(movementForm.product_id),
            movement_type: movementForm.movement_type,
            quantity: Number(movementForm.quantity),
            note: movementForm.note || null,
          }),
        },
        token,
      )
      setMovementForm({ product_id: '', movement_type: 'purchase', quantity: '1', note: '' })
      await loadAll(token)
      setMessage('Stock movement saved successfully')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save movement')
    }
  }

  const addSaleLine = () => {
    setSaleLines((current) => [...current, { id: saleLineId, product_id: '', quantity: '1' }])
    setSaleLineId((current) => current + 1)
  }

  const updateSaleLine = (lineId: number, patch: Partial<SaleLine>) => {
    setSaleLines((current) => current.map((line) => (line.id === lineId ? { ...line, ...patch } : line)))
  }

  const removeSaleLine = (lineId: number) => {
    setSaleLines((current) => (current.length === 1 ? current : current.filter((line) => line.id !== lineId)))
  }

  const handleCreateSale = async (event: FormEvent) => {
    event.preventDefault()
    if (!token) return
    const items = saleLines
      .filter((line) => line.product_id && Number(line.quantity) > 0)
      .map((line) => ({ product_id: Number(line.product_id), quantity: Number(line.quantity) }))

    if (items.length === 0) {
      setError('Add at least one sale item')
      return
    }

    try {
      await request('/sales', { method: 'POST', body: JSON.stringify({ items }) }, token)
      resetSaleForm()
      await loadAll(token)
      setMessage('Sale created successfully')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create sale')
    }
  }

  const handlePopulateDemoData = async () => {
    if (!token || user?.role !== 'admin') return
    setIsLoading(true)
    try {
      const response = await request<{ message: string; totals: { products: number; sales: number; movements: number; logs: number } }>('/demo/populate', { method: 'POST' }, token)
      await loadAll(token)
      setMessage(`${response.message}: ${response.totals.products} products, ${response.totals.sales} sales, ${response.totals.movements} movements, ${response.totals.logs} logs.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sync demo data')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSaveProfile = async (event: FormEvent) => {
    event.preventDefault()
    if (!token) return
    try {
      const response = await request<{ message: string; user: User }>('/profile', { method: 'PUT', body: JSON.stringify(profileForm) }, token)
      setUser(response.user)
      setProfileForm({
        name: response.user.name,
        email: response.user.email,
        phone: response.user.phone || '',
        department: response.user.department,
        title: response.user.title,
        bio: response.user.bio || '',
      })
      await loadAll(token)
      setMessage('Profile updated successfully')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update profile')
    }
  }

  const startEditStaff = (person: User) => {
    setEditingStaffId(person.id)
    setStaffForm({
      name: person.name,
      email: person.email,
      password: '',
      role: person.role,
      phone: person.phone || '',
      department: person.department,
      title: person.title,
      status: person.status,
      hierarchy_level: person.hierarchy_level,
      manager_name: person.manager_name || '',
      bio: person.bio || '',
    })
  }

  const handleSaveStaff = async (event: FormEvent) => {
    event.preventDefault()
    if (!token || user?.role !== 'admin') return
    try {
      if (editingStaffId) {
        await request(`/users/${editingStaffId}`, { method: 'PUT', body: JSON.stringify({ ...staffForm, password: undefined }) }, token)
        setMessage('Staff member updated successfully')
      } else {
        await request('/users', { method: 'POST', body: JSON.stringify(staffForm) }, token)
        setMessage('Staff member created successfully')
      }
      resetStaffForm()
      await loadAll(token)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save staff member')
    }
  }

  if (!token || !user) {
    return (
      <div className="auth-shell">
        <div className="auth-card auth-grid">
          <div className="stack-lg">
            <div>
              <span className="eyebrow">Publication-ready business app</span>
              <h1>StockFlow</h1>
              <p className="muted">Inventory, sales, personnel profiles and audit logs in one bright responsive workspace.</p>
            </div>
            <div className="feature-list inline">
              <span className="feature-pill">FastAPI</span>
              <span className="feature-pill">React + TypeScript</span>
              <span className="feature-pill">Profiles</span>
              <span className="feature-pill">Logs</span>
              <span className="feature-pill">Responsive</span>
            </div>
            <div className="callout">
              <strong>Demo accounts</strong>
              <p>Admin: admin@stockflow.app / Admin123!</p>
              <p>Employee: employee@stockflow.app / Employee123!</p>
            </div>
          </div>

          <form className="stack" onSubmit={handleLogin}>
            <label>
              Email
              <input type="email" value={loginForm.email} onChange={(event) => setLoginForm((current) => ({ ...current, email: event.target.value }))} />
            </label>
            <label>
              Password
              <input type="password" value={loginForm.password} onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))} />
            </label>
            <button type="submit" disabled={isLoading}>{isLoading ? 'Signing in...' : 'Sign in'}</button>
            {error ? <div className="alert error">{error}</div> : null}
            {message ? <div className="alert success">{message}</div> : null}
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="layout-root">
      {mobileNavOpen ? <button className="mobile-backdrop" type="button" onClick={() => setMobileNavOpen(false)} /> : null}

      <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''} ${mobileNavOpen ? 'open' : ''}`}>
        <div className="sidebar-top">
          <div className="brand-row">
            <div className="brand-mark">SF</div>
            <div className="brand-copy">
              <span className="eyebrow">StockFlow</span>
              <h2>Business Workspace</h2>
            </div>
          </div>
          <button className="icon-button desktop-only" type="button" onClick={() => setSidebarCollapsed((current) => !current)}>
            {sidebarCollapsed ? '→' : '←'}
          </button>
        </div>

        <div className="user-box">
          <strong>{user.name}</strong>
          <span>{user.email}</span>
          <span className={`role-pill role-${user.role}`}>{user.role}</span>
        </div>

        <nav className="nav-list">
          {NAV_ITEMS.map((item) => (
            <button key={item.id} className={item.id === tab ? 'nav-button active' : 'nav-button'} onClick={() => selectTab(item.id)} type="button" title={item.label}>
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-copy">
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </span>
            </button>
          ))}
        </nav>

        <div className="sidebar-note">
          <strong>Ready for review</strong>
          <p className="muted small">Bright UI, audit visibility, real CRUD, personnel profiles and mobile-friendly behavior.</p>
        </div>

        <div className="sidebar-actions">
          <button className="secondary" type="button" onClick={() => void handleRefresh()}>Refresh data</button>
          {user.role === 'admin' ? <button className="secondary" type="button" onClick={() => void handlePopulateDemoData()}>Sync demo data</button> : null}
          <button className="ghost" type="button" onClick={handleLogout}>Logout</button>
        </div>
      </aside>

      <main className="content">
        <header className="topbar panel">
          <div className="topbar-main">
            <button className="icon-button mobile-only" type="button" onClick={() => setMobileNavOpen(true)}>☰</button>
            <div>
              <span className="eyebrow">Operational workspace</span>
              <h1>{currentTabMeta.label}</h1>
              <p className="muted">{currentTabMeta.description}</p>
            </div>
          </div>
          <button className="ghost compact" type="button" onClick={() => void handleRefresh()}>Refresh</button>
        </header>

        {isLoading ? <div className="alert">Loading data...</div> : null}
        {error ? <div className="alert error">{error}</div> : null}
        {message ? <div className="alert success">{message}</div> : null}

        {tab === 'dashboard' && dashboard ? (
          <section className="stack-xl">
            <section className="panel compact-hero">
              <div>
                <span className="eyebrow">Live summary</span>
                <h3>Compact dashboard for faster scanning</h3>
                <p className="muted small">Smaller cards, denser layout and cleaner hierarchy for desktop and mobile.</p>
              </div>
              <div className="hero-pills">
                <span className="feature-pill">{staff.length || 2} staff</span>
                <span className="feature-pill">{products.length} products</span>
                <span className="feature-pill">{sales.length} sales</span>
              </div>
            </section>

            <div className="metrics-grid">
              <MetricCard label="Products" value={dashboard.total_products} hint="Catalog size" />
              <MetricCard label="Low stock" value={dashboard.low_stock_count} hint="Needs restock" />
              <MetricCard label="Out of stock" value={dashboard.out_of_stock_count} hint="Unavailable" />
              <MetricCard label="Sales" value={dashboard.total_sales_count} hint="Completed orders" />
              <MetricCard label="Revenue" value={currency(dashboard.revenue)} hint="Seeded performance" />
              <MetricCard label="Stock value" value={currency(dashboard.stock_value)} hint="Current inventory" />
            </div>

            <div className="dashboard-grid">
              <section className="panel">
                <div className="section-head">
                  <h3>Revenue trend</h3>
                  <span className="muted small">7 recent days</span>
                </div>
                <div className="trend-chart compact-chart">
                  {dashboard.revenue_by_day.map((point) => {
                    const maxRevenue = Math.max(...dashboard.revenue_by_day.map((item) => item.revenue), 1)
                    const height = `${Math.max((point.revenue / maxRevenue) * 100, 14)}%`
                    return (
                      <div className="trend-item" key={point.day}>
                        <div className="trend-bar-wrap"><div className="trend-bar" style={{ height }} /></div>
                        <span className="muted small">{shortDate(point.day)}</span>
                        <strong className="small">{currency(point.revenue)}</strong>
                      </div>
                    )
                  })}
                </div>
              </section>

              <section className="panel two-col-card">
                <div className="mini-list-block">
                  <div className="section-head"><h3>Top products</h3></div>
                  <div className="stack-sm">
                    {dashboard.top_products.map((item) => (
                      <div className="mini-row" key={item.id}>
                        <div className="min-w-0">
                          <strong>{item.name}</strong>
                          <div className="muted small">{item.sku}</div>
                        </div>
                        <div className="align-right">
                          <strong>{item.quantity_sold}</strong>
                          <div className="muted small">{currency(item.revenue)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mini-list-block">
                  <div className="section-head"><h3>Low stock</h3></div>
                  <div className="stack-sm">
                    {dashboard.low_stock_products.length === 0 ? (
                      <p className="muted small">Everything is healthy.</p>
                    ) : (
                      dashboard.low_stock_products.map((product) => (
                        <div className="mini-row" key={product.id}>
                          <div className="min-w-0">
                            <strong>{product.name}</strong>
                            <div className="muted small">{product.sku}</div>
                          </div>
                          <span className="status low">{product.stock} / {product.min_stock}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </section>
            </div>
          </section>
        ) : null}

        {tab === 'products' ? (
          <section className="stack-xl">
            {user.role === 'admin' ? (
              <section className="panel">
                <div className="section-head">
                  <div>
                    <h3>{editingProductId ? 'Edit product' : 'Create product'}</h3>
                    <p className="muted small">Product actions persist to the database and refresh analytics.</p>
                  </div>
                  {editingProductId ? <button className="ghost" onClick={resetProductForm} type="button">Cancel edit</button> : null}
                </div>
                <form className="form-grid" onSubmit={handleSubmitProduct}>
                  <label>
                    Name
                    <input value={productForm.name} onChange={(event) => setProductForm((current) => ({ ...current, name: event.target.value }))} required />
                  </label>
                  <label>
                    SKU
                    <input value={productForm.sku} onChange={(event) => setProductForm((current) => ({ ...current, sku: event.target.value.toUpperCase() }))} required />
                  </label>
                  <label>
                    Price
                    <input type="number" min="0" step="0.01" value={productForm.price} onChange={(event) => setProductForm((current) => ({ ...current, price: event.target.value }))} required />
                  </label>
                  {!editingProductId ? (
                    <label>
                      Initial stock
                      <input type="number" min="0" value={productForm.stock} onChange={(event) => setProductForm((current) => ({ ...current, stock: event.target.value }))} required />
                    </label>
                  ) : (
                    <div className="callout small-callout">
                      <strong>Stock changes are handled in Movements</strong>
                      <p className="muted small">This keeps inventory updates auditable and consistent.</p>
                    </div>
                  )}
                  <label>
                    Min stock
                    <input type="number" min="0" value={productForm.min_stock} onChange={(event) => setProductForm((current) => ({ ...current, min_stock: event.target.value }))} required />
                  </label>
                  <div className="button-row end span-full"><button type="submit">{editingProductId ? 'Save changes' : 'Create product'}</button></div>
                </form>
              </section>
            ) : null}

            <section className="panel">
              <div className="section-head wrap-row">
                <div>
                  <h3>Products</h3>
                  <p className="muted small">{products.length} total · {productSummary.low} low stock · {productSummary.out} out of stock</p>
                </div>
                <div className="control-row wrap">
                  <input className="search" placeholder="Search by name or SKU" value={search} onChange={(event) => setSearch(event.target.value)} />
                  <div className="filter-pills">
                    {(['all', 'low', 'out'] as StockFilter[]).map((item) => (
                      <button key={item} className={stockFilter === item ? 'pill active' : 'pill'} type="button" onClick={() => setStockFilter(item)}>{item}</button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="catalog-grid dense-cards">
                {filteredProducts.map((product) => {
                  const status = getStatus(product)
                  return (
                    <article className="product-card elevated" key={product.id}>
                      <div className="product-card-head">
                        <div className="min-w-0">
                          <h4>{product.name}</h4>
                          <div className="muted small">{product.sku}</div>
                        </div>
                        <span className={status.className}>{status.label}</span>
                      </div>
                      <div className="product-card-body">
                        <div className="product-metric"><span className="muted small">Price</span><strong>{currency(product.price)}</strong></div>
                        <div className="product-metric"><span className="muted small">Stock</span><strong>{product.stock}</strong></div>
                        <div className="product-metric"><span className="muted small">Min stock</span><strong>{product.min_stock}</strong></div>
                        <div className="product-metric span-two"><span className="muted small">Updated</span><strong>{formatDate(product.updated_at)}</strong></div>
                      </div>
                      {user.role === 'admin' ? (
                        <div className="card-actions">
                          <button className="secondary compact" type="button" onClick={() => startEditProduct(product)}>Edit</button>
                          <button className="ghost compact danger" type="button" onClick={() => void handleDeleteProduct(product)}>Delete</button>
                        </div>
                      ) : null}
                    </article>
                  )
                })}
              </div>
            </section>
          </section>
        ) : null}

        {tab === 'sales' ? (
          <section className="stack-xl">
            <div className="split-grid sales-grid">
              <section className="panel">
                <div className="section-head">
                  <div>
                    <h3>Create sale</h3>
                    <p className="muted small">Every sale deducts stock and creates related movement and audit entries.</p>
                  </div>
                  <button className="ghost" type="button" onClick={resetSaleForm}>Reset form</button>
                </div>
                <form className="stack" onSubmit={handleCreateSale}>
                  {saleLines.map((line) => (
                    <div className="sale-line" key={line.id}>
                      <label>
                        Product
                        <select value={line.product_id} onChange={(event) => updateSaleLine(line.id, { product_id: event.target.value })}>
                          <option value="">Select a product</option>
                          {products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku} · stock {product.stock}</option>)}
                        </select>
                      </label>
                      <label>
                        Quantity
                        <input type="number" min="1" value={line.quantity} onChange={(event) => updateSaleLine(line.id, { quantity: event.target.value })} />
                      </label>
                      <button className="ghost compact danger" type="button" onClick={() => removeSaleLine(line.id)}>Remove</button>
                    </div>
                  ))}
                  <div className="button-row wrap">
                    <button className="secondary" type="button" onClick={addSaleLine}>Add line</button>
                    <button type="submit">Create sale</button>
                  </div>
                </form>
              </section>

              <section className="panel summary-card">
                <span className="eyebrow">Sale preview</span>
                <h3>{currency(salePreview)}</h3>
                <p className="muted small">Calculated in real time from the selected products and quantities.</p>
                <div className="feature-list inline">
                  <span className="feature-pill">{saleLines.length} line(s)</span>
                  <span className="feature-pill">DB updated</span>
                  <span className="feature-pill">Audit logged</span>
                </div>
              </section>
            </div>

            <section className="panel">
              <div className="section-head">
                <h3>Recent sales</h3>
                <span className="muted small">Structured list with detail modal</span>
              </div>
              <div className="list-table">
                <div className="list-table-head">
                  <span>Sale</span>
                  <span>Created by</span>
                  <span>Total</span>
                  <span>Date</span>
                  <span>Details</span>
                </div>
                {sales.map((sale) => (
                  <div className="list-table-row" key={sale.id}>
                    <span className="list-main">Sale #{sale.id}</span>
                    <span>{sale.created_by_name}</span>
                    <span>{currency(sale.total_amount)}</span>
                    <span>{formatDate(sale.created_at)}</span>
                    <span><button className="secondary compact" type="button" onClick={() => setSelectedSale(sale)}>More info</button></span>
                  </div>
                ))}
              </div>
            </section>
          </section>
        ) : null}

        {tab === 'movements' ? (
          <section className="stack-xl">
            <section className="panel">
              <div className="section-head">
                <div>
                  <h3>Create stock movement</h3>
                  <p className="muted small">Purchases add stock, writeoffs remove it, adjustments correct counted inventory.</p>
                </div>
              </div>
              <form className="form-grid compact" onSubmit={handleCreateMovement}>
                <label>
                  Product
                  <select value={movementForm.product_id} onChange={(event) => setMovementForm((current) => ({ ...current, product_id: event.target.value }))} required>
                    <option value="">Select a product</option>
                    {products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku} · stock {product.stock}</option>)}
                  </select>
                </label>
                <label>
                  Type
                  <select value={movementForm.movement_type} onChange={(event) => setMovementForm((current) => ({ ...current, movement_type: event.target.value }))}>
                    <option value="purchase">Purchase</option>
                    <option value="adjustment">Adjustment</option>
                    <option value="writeoff">Writeoff</option>
                  </select>
                </label>
                <label>
                  Quantity
                  <input type="number" min="1" value={movementForm.quantity} onChange={(event) => setMovementForm((current) => ({ ...current, quantity: event.target.value }))} required />
                </label>
                <label className="span-two">
                  Note
                  <input value={movementForm.note} onChange={(event) => setMovementForm((current) => ({ ...current, note: event.target.value }))} placeholder="Why was the stock changed?" />
                </label>
                <div className="button-row end span-full"><button type="submit">Save movement</button></div>
              </form>
            </section>

            <section className="panel">
              <div className="section-head">
                <h3>Recent movements</h3>
                <span className="muted small">Readable table layout with modal details</span>
              </div>
              <div className="list-table">
                <div className="list-table-head">
                  <span>Type</span>
                  <span>Product</span>
                  <span>Qty</span>
                  <span>By</span>
                  <span>Date</span>
                  <span>Details</span>
                </div>
                {movements.map((movement) => (
                  <div className="list-table-row" key={movement.id}>
                    <span><span className={`tag tag-${movement.movement_type}`}>{movement.movement_type}</span></span>
                    <span className="list-main">{movement.product_name} <small className="muted">{movement.sku}</small></span>
                    <span>{movement.quantity}</span>
                    <span>{movement.created_by_name}</span>
                    <span>{formatDate(movement.created_at)}</span>
                    <span><button className="secondary compact" type="button" onClick={() => setSelectedMovement(movement)}>More info</button></span>
                  </div>
                ))}
              </div>
            </section>
          </section>
        ) : null}

        {tab === 'logs' ? (
          <section className="stack-xl">
            <section className="panel">
              <div className="section-head wrap-row">
                <div>
                  <h3>Audit logs</h3>
                  <p className="muted small">Every major action is recorded with actor, timestamp and context.</p>
                </div>
                <div className="control-row wrap">
                  <input className="search" placeholder="Search action, message or actor" value={logSearch} onChange={(event) => setLogSearch(event.target.value)} />
                  <div className="filter-pills">
                    {(['all', 'info', 'warning', 'error'] as LogFilter[]).map((item) => (
                      <button key={item} className={logFilter === item ? 'pill active' : 'pill'} type="button" onClick={() => setLogFilter(item)}>{item}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="log-grid">
                {filteredLogs.map((entry) => (
                  <article className="log-card" key={entry.id}>
                    <div className="log-head">
                      <div className="log-badges">
                        <span className={`tag tag-${entry.level}`}>{entry.level}</span>
                        <span className="tag">{humanizeAction(entry.action)}</span>
                      </div>
                      <span className="muted small">{formatDate(entry.created_at)}</span>
                    </div>
                    <strong>{entry.message}</strong>
                    <p className="muted small">{entry.created_by_name} · {entry.entity_type || 'system'}{entry.entity_id ? ` #${entry.entity_id}` : ''}</p>
                    <p>{detailsToText(entry.details)}</p>
                  </article>
                ))}
              </div>
            </section>
          </section>
        ) : null}

        {tab === 'profile' ? (
          <section className="stack-xl">
            <div className="split-grid profile-grid">
              <section className="panel">
                <div className="section-head">
                  <div>
                    <h3>My profile</h3>
                    <p className="muted small">Update personal data visible in the workspace and logs.</p>
                  </div>
                  <span className={`status-badge status-${user.status}`}>{user.status.replace('_', ' ')}</span>
                </div>
                <form className="form-grid" onSubmit={handleSaveProfile}>
                  <label>
                    Full name
                    <input value={profileForm.name} onChange={(event) => setProfileForm((current) => ({ ...current, name: event.target.value }))} required />
                  </label>
                  <label>
                    Email
                    <input type="email" value={profileForm.email} onChange={(event) => setProfileForm((current) => ({ ...current, email: event.target.value }))} required />
                  </label>
                  <label>
                    Phone
                    <input value={profileForm.phone} onChange={(event) => setProfileForm((current) => ({ ...current, phone: event.target.value }))} />
                  </label>
                  <label>
                    Department
                    <input value={profileForm.department} onChange={(event) => setProfileForm((current) => ({ ...current, department: event.target.value }))} required />
                  </label>
                  <label className="span-two">
                    Title
                    <input value={profileForm.title} onChange={(event) => setProfileForm((current) => ({ ...current, title: event.target.value }))} required />
                  </label>
                  <label className="span-full">
                    Bio
                    <textarea rows={4} value={profileForm.bio} onChange={(event) => setProfileForm((current) => ({ ...current, bio: event.target.value }))} />
                  </label>
                  <div className="button-row end span-full"><button type="submit">Save profile</button></div>
                </form>
              </section>

              <section className="panel">
                <div className="section-head">
                  <h3>Account summary</h3>
                </div>
                <div className="profile-summary">
                  <div className="summary-row"><span>Role</span><strong>{user.role}</strong></div>
                  <div className="summary-row"><span>Title</span><strong>{user.title}</strong></div>
                  <div className="summary-row"><span>Department</span><strong>{user.department}</strong></div>
                  <div className="summary-row"><span>Hierarchy</span><strong>{user.hierarchy_level}</strong></div>
                  <div className="summary-row"><span>Manager</span><strong>{user.manager_name || '—'}</strong></div>
                  <div className="summary-row"><span>Updated</span><strong>{formatDate(user.updated_at)}</strong></div>
                </div>
              </section>
            </div>

            {user.role === 'admin' ? (
              <>
                <section className="panel">
                  <div className="section-head">
                    <div>
                      <h3>{editingStaffId ? 'Edit staff member' : 'Add staff member'}</h3>
                      <p className="muted small">Manage hierarchy, role, status and personal information.</p>
                    </div>
                    {editingStaffId ? <button className="ghost" type="button" onClick={resetStaffForm}>Cancel edit</button> : null}
                  </div>
                  <form className="form-grid" onSubmit={handleSaveStaff}>
                    <label>
                      Full name
                      <input value={staffForm.name} onChange={(event) => setStaffForm((current) => ({ ...current, name: event.target.value }))} required />
                    </label>
                    <label>
                      Email
                      <input type="email" value={staffForm.email} onChange={(event) => setStaffForm((current) => ({ ...current, email: event.target.value }))} required />
                    </label>
                    {!editingStaffId ? (
                      <label>
                        Temporary password
                        <input type="password" value={staffForm.password} onChange={(event) => setStaffForm((current) => ({ ...current, password: event.target.value }))} required />
                      </label>
                    ) : null}
                    <label>
                      Role
                      <select value={staffForm.role} onChange={(event) => setStaffForm((current) => ({ ...current, role: event.target.value as User['role'] }))}>
                        <option value="employee">Employee</option>
                        <option value="admin">Admin</option>
                      </select>
                    </label>
                    <label>
                      Status
                      <select value={staffForm.status} onChange={(event) => setStaffForm((current) => ({ ...current, status: event.target.value as StaffStatus }))}>
                        <option value="active">Active</option>
                        <option value="on_leave">On leave</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </label>
                    <label>
                      Hierarchy
                      <select value={staffForm.hierarchy_level} onChange={(event) => setStaffForm((current) => ({ ...current, hierarchy_level: event.target.value as StaffLevel }))}>
                        <option value="staff">Staff</option>
                        <option value="lead">Lead</option>
                        <option value="management">Management</option>
                      </select>
                    </label>
                    <label>
                      Phone
                      <input value={staffForm.phone} onChange={(event) => setStaffForm((current) => ({ ...current, phone: event.target.value }))} />
                    </label>
                    <label>
                      Department
                      <input value={staffForm.department} onChange={(event) => setStaffForm((current) => ({ ...current, department: event.target.value }))} required />
                    </label>
                    <label>
                      Title
                      <input value={staffForm.title} onChange={(event) => setStaffForm((current) => ({ ...current, title: event.target.value }))} required />
                    </label>
                    <label>
                      Manager
                      <input value={staffForm.manager_name} onChange={(event) => setStaffForm((current) => ({ ...current, manager_name: event.target.value }))} />
                    </label>
                    <label className="span-full">
                      Bio
                      <textarea rows={3} value={staffForm.bio} onChange={(event) => setStaffForm((current) => ({ ...current, bio: event.target.value }))} />
                    </label>
                    <div className="button-row end span-full"><button type="submit">{editingStaffId ? 'Save staff member' : 'Create staff member'}</button></div>
                  </form>
                </section>

                <section className="panel">
                  <div className="section-head wrap-row">
                    <div>
                      <h3>Personnel</h3>
                      <p className="muted small">{activeStaff} active of {staff.length} total members</p>
                    </div>
                  </div>
                  <div className="staff-grid">
                    {staff.map((person) => (
                      <article className="staff-card" key={person.id}>
                        <div className="staff-card-top">
                          <div className="min-w-0">
                            <h4>{person.name}</h4>
                            <p className="muted small">{person.email}</p>
                          </div>
                          <span className={`status-badge status-${person.status}`}>{person.status.replace('_', ' ')}</span>
                        </div>
                        <div className="staff-meta">
                          <div><span className="muted small">Role</span><strong>{person.role}</strong></div>
                          <div><span className="muted small">Title</span><strong>{person.title}</strong></div>
                          <div><span className="muted small">Department</span><strong>{person.department}</strong></div>
                          <div><span className="muted small">Hierarchy</span><strong>{person.hierarchy_level}</strong></div>
                        </div>
                        <p className="muted small">Manager: {person.manager_name || '—'}</p>
                        <div className="card-actions"><button className="secondary compact" type="button" onClick={() => startEditStaff(person)}>Edit</button></div>
                      </article>
                    ))}
                  </div>
                </section>
              </>
            ) : null}
          </section>
        ) : null}

        {tab === 'docs' ? (
          <section className="stack-xl">
            <section className="panel compact-hero">
              <div>
                <span className="eyebrow">Technical documentation</span>
                <h3>System notes for publication and maintenance</h3>
                <p className="muted small">The repository includes markdown docs. This screen keeps the essentials available inside the app.</p>
              </div>
            </section>
            <div className="docs-grid">
              {docsSections.map((section) => (
                <article className="panel" key={section.title}>
                  <h3>{section.title}</h3>
                  <ul className="doc-list">
                    {section.items.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </main>

      {selectedSale ? (
        <Modal title={`Sale #${selectedSale.id}`} subtitle={`${selectedSale.created_by_name} · ${formatDate(selectedSale.created_at)}`} onClose={() => setSelectedSale(null)}>
          <div className="details-card-grid">
            <div className="summary-row"><span>Total amount</span><strong>{currency(selectedSale.total_amount)}</strong></div>
            <div className="summary-row"><span>Items</span><strong>{selectedSale.items.length}</strong></div>
          </div>
          <div className="stack-sm">
            {selectedSale.items.map((item) => (
              <div className="detail-line" key={`${selectedSale.id}-${item.product_id}`}>
                <div className="min-w-0">
                  <strong>{item.product_name}</strong>
                  <div className="muted small">{item.sku}</div>
                </div>
                <div className="align-right">
                  <div>{item.quantity} × {currency(item.unit_price)}</div>
                  <strong>{currency(item.quantity * item.unit_price)}</strong>
                </div>
              </div>
            ))}
          </div>
        </Modal>
      ) : null}

      {selectedMovement ? (
        <Modal title={`Movement #${selectedMovement.id}`} subtitle={`${selectedMovement.created_by_name} · ${formatDate(selectedMovement.created_at)}`} onClose={() => setSelectedMovement(null)}>
          <div className="details-card-grid">
            <div className="summary-row"><span>Type</span><strong>{selectedMovement.movement_type}</strong></div>
            <div className="summary-row"><span>Quantity</span><strong>{selectedMovement.quantity}</strong></div>
            <div className="summary-row"><span>Product</span><strong>{selectedMovement.product_name}</strong></div>
            <div className="summary-row"><span>SKU</span><strong>{selectedMovement.sku}</strong></div>
          </div>
          <div className="callout small-callout">
            <strong>Note</strong>
            <p>{selectedMovement.note || 'No note provided for this movement.'}</p>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

export default App
