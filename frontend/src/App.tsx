import { FormEvent, useEffect, useMemo, useState } from 'react'
import { AuditLog, Dashboard, Movement, Product, Sale, User } from './types'

const API_URL = import.meta.env.VITE_API_URL || '/api'

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊', description: 'KPIs, trends and watchlists' },
  { id: 'products', label: 'Products', icon: '📦', description: 'Catalog CRUD and stock status' },
  { id: 'sales', label: 'Sales', icon: '🧾', description: 'Multi-line sales workflow' },
  { id: 'movements', label: 'Movements', icon: '🔁', description: 'Warehouse adjustments and restocks' },
  { id: 'logs', label: 'Logs', icon: '🪵', description: 'Audit trail for business actions' },
  { id: 'docs', label: 'Docs', icon: '📚', description: 'Technical documentation summary' },
] as const

type Tab = (typeof NAV_ITEMS)[number]['id']
type StockFilter = 'all' | 'low' | 'out'
type LogFilter = 'all' | 'info' | 'warning' | 'error'
type SaleLine = { id: number; product_id: string; quantity: string }

type ApiError = {
  detail?: string
  message?: string
}

const docsSections = [
  {
    title: 'Architecture overview',
    items: [
      'Frontend: React + TypeScript + Vite',
      'Backend: FastAPI + SQLAlchemy',
      'Database: PostgreSQL-ready via DATABASE_URL, SQLite for local fallback',
      'Authentication: JWT bearer token with admin / employee roles',
      'Delivery: Docker, GitHub Actions, Vercel-ready frontend and backend entrypoint',
    ],
  },
  {
    title: 'Core business entities',
    items: [
      'Users: login, role-based permissions and action attribution',
      'Products: SKU-based catalog with min stock thresholds',
      'Sales + sale items: multi-product orders with stock deduction',
      'Stock movements: purchase, adjustment, writeoff and sale events',
      'Audit logs: who did what, when, and against which entity',
    ],
  },
  {
    title: 'Operational flows',
    items: [
      'Create product with initial stock and audit entry',
      'Edit product name, SKU, price and reorder threshold',
      'Delete product only when it has no sales history',
      'Create sales with multiple lines and automatic stock movement records',
      'Track warehouse actions with searchable logs and dashboard updates',
    ],
  },
  {
    title: 'Environment variables',
    items: [
      'DATABASE_URL: primary database connection string',
      'JWT_SECRET: token signing secret used by the backend',
      'CORS_ORIGINS: comma-separated list of allowed frontend domains',
      'VITE_API_URL: frontend base URL for the backend API, for example https://your-api.vercel.app/api',
    ],
  },
]

function buildNetworkError(url: string, path: string, error: unknown): Error {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new Error(`The request to ${path} timed out. The backend may be sleeping, redeploying or unavailable.`)
  }

  return new Error(
    `Could not reach the API at ${url}. Check backend deployment status, VITE_API_URL and CORS_ORIGINS.`,
  )
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

    if (detail) {
      throw new Error(`${detail} (HTTP ${response.status})`)
    }

    if (response.status === 401) {
      throw new Error('Authentication failed. Check the email, password or session token. (HTTP 401)')
    }

    if (response.status === 403) {
      throw new Error('You do not have permission to perform this action. (HTTP 403)')
    }

    if (response.status >= 500) {
      throw new Error(`Server error while calling ${path}. Check backend logs. (HTTP ${response.status})`)
    }

    throw new Error(`Request failed for ${path}. (HTTP ${response.status})`)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

function currency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value)
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

function MetricCard({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <article className="card metric-card">
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
      <p className="muted small metric-hint">{hint}</p>
    </article>
  )
}

function humanizeAction(value: string): string {
  return value.replace(/\./g, ' · ').replace(/_/g, ' ')
}

function detailsToText(details: Record<string, unknown>): string {
  const items = Object.entries(details)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .slice(0, 4)

  if (items.length === 0) return 'No additional details.'

  return items
    .map(([key, value]) => {
      if (Array.isArray(value)) return `${key}: ${value.length} item(s)`
      if (typeof value === 'object') return `${key}: updated`
      return `${key}: ${String(value)}`
    })
    .join(' · ')
}

function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('stockflow_token'))
  const [user, setUser] = useState<User | null>(null)
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [movements, setMovements] = useState<Movement[]>([])
  const [logs, setLogs] = useState<AuditLog[]>([])
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

  const [loginForm, setLoginForm] = useState({
    email: 'admin@stockflow.app',
    password: 'Admin123!',
  })

  const [productForm, setProductForm] = useState({
    name: '',
    sku: '',
    price: '0',
    stock: '0',
    min_stock: '0',
  })

  const [movementForm, setMovementForm] = useState({
    product_id: '',
    movement_type: 'purchase',
    quantity: '1',
    note: '',
  })

  const [saleLines, setSaleLines] = useState<SaleLine[]>([{ id: 1, product_id: '', quantity: '1' }])

  const currentTabMeta = NAV_ITEMS.find((item) => item.id === tab) ?? NAV_ITEMS[0]

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase()

    return products.filter((product) => {
      const matchesSearch =
        !term || product.name.toLowerCase().includes(term) || product.sku.toLowerCase().includes(term)

      const matchesStock =
        stockFilter === 'all' ? true : stockFilter === 'low' ? product.stock <= product.min_stock : product.stock === 0

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

  const loadAll = async (currentToken: string) => {
    setIsLoading(true)
    setError(null)
    try {
      const [me, dashboardData, productsData, salesData, movementsData, logsData] = await Promise.all([
        request<User>('/me', {}, currentToken),
        request<Dashboard>('/dashboard', {}, currentToken),
        request<{ items: Product[] }>('/products?page=1&page_size=100', {}, currentToken),
        request<{ items: Sale[] }>('/sales?page=1&page_size=30', {}, currentToken),
        request<{ items: Movement[] }>('/stock-movements?page=1&page_size=30', {}, currentToken),
        request<{ items: AuditLog[] }>('/logs?page=1&page_size=50', {}, currentToken),
      ])

      setUser(me)
      setDashboard(dashboardData)
      setProducts(productsData.items)
      setSales(salesData.items)
      setMovements(movementsData.items)
      setLogs(logsData.items)
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Could not load data'
      setError(text)
      if (
        text.toLowerCase().includes('token') ||
        text.toLowerCase().includes('bearer') ||
        text.toLowerCase().includes('expired')
      ) {
        handleLogout()
      }
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (token) {
      void loadAll(token)
    }
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
      if (window.innerWidth > 920) {
        setMobileNavOpen(false)
      }
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
      const response = await request<{ access_token: string; user: User }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(loginForm),
      })
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
    setMessage(null)
    setError(null)
    setTab('dashboard')
    setMobileNavOpen(false)
    resetProductForm()
    resetSaleForm()
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
        await request(
          `/products/${editingProductId}`,
          {
            method: 'PUT',
            body: JSON.stringify(payload),
          },
          token,
        )
        setMessage('Product updated successfully')
      } else {
        await request(
          '/products',
          {
            method: 'POST',
            body: JSON.stringify({ ...payload, stock: Number(productForm.stock) }),
          },
          token,
        )
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
    setMessage(null)
    setError(null)
  }

  const handleDeleteProduct = async (product: Product) => {
    if (!token) return
    const confirmed = window.confirm(`Delete ${product.name}? This action cannot be undone.`)
    if (!confirmed) return

    setError(null)
    setMessage(null)
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
    setError(null)
    setMessage(null)
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

  const handlePopulateDemoData = async () => {
    if (!token || user?.role !== 'admin') return
    setError(null)
    setMessage(null)
    setIsLoading(true)

    try {
      const response = await request<{
        message: string
        changed: boolean
        totals: { products: number; sales: number; movements: number; logs: number }
      }>('/demo/populate', { method: 'POST' }, token)

      await loadAll(token)
      setMessage(
        `${response.message}: ${response.totals.products} products, ${response.totals.sales} sales, ${response.totals.movements} movements, ${response.totals.logs} logs.`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sync demo data')
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreateSale = async (event: FormEvent) => {
    event.preventDefault()
    if (!token) return
    setError(null)
    setMessage(null)

    const items = saleLines
      .filter((line) => line.product_id && Number(line.quantity) > 0)
      .map((line) => ({
        product_id: Number(line.product_id),
        quantity: Number(line.quantity),
      }))

    if (items.length === 0) {
      setError('Add at least one sale item')
      return
    }

    try {
      await request(
        '/sales',
        {
          method: 'POST',
          body: JSON.stringify({ items }),
        },
        token,
      )
      resetSaleForm()
      await loadAll(token)
      setMessage('Sale created successfully')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create sale')
    }
  }

  if (!token || !user) {
    return (
      <div className="auth-shell">
        <div className="auth-card auth-grid">
          <div className="auth-copy stack-lg">
            <div>
              <span className="eyebrow">Portfolio-ready stock system</span>
              <h1>StockFlow</h1>
              <p className="muted">
                Inventory and sales dashboard with JWT auth, role-based access, live demo data,
                audit logs and publication-ready UI.
              </p>
            </div>

            <div className="feature-list">
              <span className="feature-pill">FastAPI</span>
              <span className="feature-pill">React + TypeScript</span>
              <span className="feature-pill">JWT + roles</span>
              <span className="feature-pill">Audit logs</span>
              <span className="feature-pill">Responsive UI</span>
              <span className="feature-pill">CRUD + analytics</span>
            </div>

            <div className="demo-box">
              <strong>Demo accounts</strong>
              <p>Admin: admin@stockflow.app / Admin123!</p>
              <p>Employee: employee@stockflow.app / Employee123!</p>
            </div>
          </div>

          <form className="stack" onSubmit={handleLogin}>
            <label>
              Email
              <input
                type="email"
                value={loginForm.email}
                onChange={(event) => setLoginForm((current) => ({ ...current, email: event.target.value }))}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={loginForm.password}
                onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
              />
            </label>
            <button type="submit" disabled={isLoading}>
              {isLoading ? 'Signing in...' : 'Sign in'}
            </button>

            {error ? <div className="alert error">{error}</div> : null}
            {message ? <div className="alert success">{message}</div> : null}
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="layout-root">
      {mobileNavOpen ? <button className="mobile-backdrop" onClick={() => setMobileNavOpen(false)} /> : null}

      <aside
        className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''} ${mobileNavOpen ? 'open' : ''}`}
        aria-label="Sidebar navigation"
      >
        <div className="sidebar-top">
          <div className="brand-row">
            <div className="brand-mark">SF</div>
            <div className="brand-copy">
              <span className="eyebrow">StockFlow</span>
              <h2>Inventory Panel</h2>
            </div>
          </div>
          <button
            className="icon-button desktop-only"
            type="button"
            onClick={() => setSidebarCollapsed((current) => !current)}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? '→' : '←'}
          </button>
        </div>

        <div className="user-box">
          <strong>{user.name}</strong>
          <span>{user.email}</span>
          <span className="role-pill">{user.role}</span>
        </div>

        <nav className="nav-list">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={item.id === tab ? 'nav-button active' : 'nav-button'}
              onClick={() => selectTab(item.id)}
              type="button"
              title={item.label}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-copy">
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </span>
            </button>
          ))}
        </nav>

        <div className="sidebar-note card">
          <strong>What this showcases</strong>
          <p className="muted small">
            Production-shaped CRUD, business analytics, audit visibility, responsive UI and clean
            deploy structure.
          </p>
        </div>

        <div className="sidebar-actions">
          <button className="secondary" type="button" onClick={() => void handleRefresh()}>
            Refresh data
          </button>
          {user.role === 'admin' ? (
            <button className="secondary" type="button" onClick={() => void handlePopulateDemoData()}>
              Sync demo data
            </button>
          ) : null}
          <button className="ghost" type="button" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </aside>

      <main className="content">
        <header className="topbar card">
          <div className="topbar-main">
            <button className="icon-button mobile-only" type="button" onClick={() => setMobileNavOpen(true)}>
              ☰
            </button>
            <div>
              <span className="eyebrow">Operational workspace</span>
              <h1>{currentTabMeta.label}</h1>
              <p className="muted">{currentTabMeta.description}</p>
            </div>
          </div>
          <div className="topbar-actions">
            <button className="ghost compact" type="button" onClick={() => void handleRefresh()}>
              Refresh
            </button>
          </div>
        </header>

        {isLoading ? <div className="alert">Loading data...</div> : null}
        {error ? <div className="alert error">{error}</div> : null}
        {message ? <div className="alert success">{message}</div> : null}

        {tab === 'dashboard' && dashboard ? (
          <section className="stack-lg">
            <section className="card hero-card">
              <div>
                <span className="eyebrow">Project snapshot</span>
                <h3>Publication-ready portfolio build</h3>
                <p className="muted">
                  This version is shaped to survive recruiter review: responsive UI, credible demo
                  data, audit trail, CRUD workflows and operational documentation.
                </p>
              </div>
              <div className="feature-list">
                <span className="feature-pill">Multi-item sales</span>
                <span className="feature-pill">Create / edit / delete products</span>
                <span className="feature-pill">Collapsible navigation</span>
                <span className="feature-pill">Technical documentation</span>
                <span className="feature-pill">Audit logs</span>
                <span className="feature-pill">Mobile-friendly layout</span>
              </div>
            </section>

            <div className="cards-grid cards-grid-5">
              <MetricCard label="Products" value={dashboard.total_products} hint="Live catalog size" />
              <MetricCard label="Low stock" value={dashboard.low_stock_count} hint="Needs replenishment" />
              <MetricCard label="Out of stock" value={dashboard.out_of_stock_count} hint="Potential lost sales" />
              <MetricCard label="Sales" value={dashboard.total_sales_count} hint="Completed orders" />
              <MetricCard label="Inventory value" value={currency(dashboard.stock_value)} hint="Current stock on hand" />
            </div>

            <div className="split-grid">
              <section className="card">
                <div className="section-head">
                  <h3>Revenue trend</h3>
                  <span className="muted small">Recent seeded days</span>
                </div>
                <div className="trend-chart">
                  {dashboard.revenue_by_day.map((point) => {
                    const maxRevenue = Math.max(...dashboard.revenue_by_day.map((item) => item.revenue), 1)
                    const height = `${Math.max((point.revenue / maxRevenue) * 100, 12)}%`
                    return (
                      <div className="trend-item" key={point.day}>
                        <div className="trend-bar-wrap">
                          <div className="trend-bar" style={{ height }} />
                        </div>
                        <span className="muted small">{shortDate(point.day)}</span>
                        <strong className="small">{currency(point.revenue)}</strong>
                      </div>
                    )
                  })}
                </div>
              </section>

              <section className="card">
                <div className="section-head">
                  <h3>Top selling products</h3>
                  <span className="muted small">By sold units</span>
                </div>
                <div className="stack">
                  {dashboard.top_products.map((item) => (
                    <div className="list-row" key={item.id}>
                      <div>
                        <strong>{item.name}</strong>
                        <div className="muted small">{item.sku}</div>
                      </div>
                      <div className="align-right">
                        <strong>{item.quantity_sold} sold</strong>
                        <div className="muted small">{currency(item.revenue)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <div className="split-grid">
              <section className="card">
                <div className="section-head">
                  <h3>Low stock watchlist</h3>
                </div>
                <div className="stack">
                  {dashboard.low_stock_products.length === 0 ? (
                    <p className="muted">Everything is healthy.</p>
                  ) : (
                    dashboard.low_stock_products.map((product) => (
                      <div className="list-row" key={product.id}>
                        <div>
                          <strong>{product.name}</strong>
                          <div className="muted small">{product.sku}</div>
                        </div>
                        <div className="align-right">
                          <strong>
                            {product.stock} / min {product.min_stock}
                          </strong>
                          <div className="status low">Needs restock</div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section className="card">
                <div className="section-head">
                  <h3>Recent sales</h3>
                  <strong>{currency(dashboard.revenue)}</strong>
                </div>
                <div className="sales-list compact-list">
                  {dashboard.recent_sales.map((sale) => (
                    <article className="sale-card" key={sale.id}>
                      <div className="sale-head">
                        <div>
                          <strong>Sale #{sale.id}</strong>
                          <div className="muted small">By {sale.created_by_name}</div>
                        </div>
                        <div className="align-right">
                          <div className="sale-total">{currency(sale.total_amount)}</div>
                          <div className="muted small">{formatDate(sale.created_at)}</div>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          </section>
        ) : null}

        {tab === 'products' ? (
          <section className="stack-lg">
            {user.role === 'admin' ? (
              <section className="card">
                <div className="section-head">
                  <div>
                    <h3>{editingProductId ? 'Edit product' : 'Create product'}</h3>
                    <p className="muted small">All product changes are persisted in the database and audited.</p>
                  </div>
                  {editingProductId ? (
                    <button className="ghost" onClick={resetProductForm} type="button">
                      Cancel edit
                    </button>
                  ) : null}
                </div>
                <form className="form-grid" onSubmit={handleSubmitProduct}>
                  <label>
                    Name
                    <input
                      value={productForm.name}
                      onChange={(event) => setProductForm((current) => ({ ...current, name: event.target.value }))}
                      required
                    />
                  </label>
                  <label>
                    SKU
                    <input
                      value={productForm.sku}
                      onChange={(event) => setProductForm((current) => ({ ...current, sku: event.target.value.toUpperCase() }))}
                      required
                    />
                  </label>
                  <label>
                    Price
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={productForm.price}
                      onChange={(event) => setProductForm((current) => ({ ...current, price: event.target.value }))}
                      required
                    />
                  </label>
                  {!editingProductId ? (
                    <label>
                      Initial stock
                      <input
                        type="number"
                        min="0"
                        value={productForm.stock}
                        onChange={(event) => setProductForm((current) => ({ ...current, stock: event.target.value }))}
                        required
                      />
                    </label>
                  ) : (
                    <div className="inset-card span-two">
                      <strong>Stock changes stay auditable</strong>
                      <p className="muted small">Use the Movements tab for purchase, adjustment and writeoff operations.</p>
                    </div>
                  )}
                  <label>
                    Min stock
                    <input
                      type="number"
                      min="0"
                      value={productForm.min_stock}
                      onChange={(event) => setProductForm((current) => ({ ...current, min_stock: event.target.value }))}
                      required
                    />
                  </label>
                  <div className="button-row end span-full">
                    <button type="submit">{editingProductId ? 'Save changes' : 'Create product'}</button>
                  </div>
                </form>
              </section>
            ) : null}

            <section className="card">
              <div className="section-head with-controls">
                <div>
                  <h3>Products</h3>
                  <p className="muted small">
                    {products.length} total · {productSummary.low} low stock · {productSummary.out} out of stock
                  </p>
                </div>
                <div className="control-row wrap">
                  <input
                    className="search"
                    placeholder="Search by name or SKU"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  <div className="filter-pills">
                    {(['all', 'low', 'out'] as StockFilter[]).map((item) => (
                      <button
                        key={item}
                        className={stockFilter === item ? 'pill active' : 'pill'}
                        type="button"
                        onClick={() => setStockFilter(item)}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="catalog-grid">
                {filteredProducts.map((product) => {
                  const status = getStatus(product)
                  return (
                    <article className="product-card" key={product.id}>
                      <div className="product-card-head">
                        <div>
                          <h4>{product.name}</h4>
                          <div className="muted small">{product.sku}</div>
                        </div>
                        <span className={status.className}>{status.label}</span>
                      </div>
                      <div className="product-card-body">
                        <div className="product-metric">
                          <span className="muted small">Price</span>
                          <strong>{currency(product.price)}</strong>
                        </div>
                        <div className="product-metric">
                          <span className="muted small">Stock</span>
                          <strong>{product.stock}</strong>
                        </div>
                        <div className="product-metric">
                          <span className="muted small">Min stock</span>
                          <strong>{product.min_stock}</strong>
                        </div>
                        <div className="product-metric span-two">
                          <span className="muted small">Last update</span>
                          <strong>{formatDate(product.updated_at)}</strong>
                        </div>
                      </div>
                      {user.role === 'admin' ? (
                        <div className="table-actions">
                          <button className="secondary compact" type="button" onClick={() => startEditProduct(product)}>
                            Edit
                          </button>
                          <button className="ghost compact danger" type="button" onClick={() => void handleDeleteProduct(product)}>
                            Delete
                          </button>
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
          <section className="stack-lg">
            <div className="split-grid sales-grid">
              <section className="card">
                <div className="section-head">
                  <div>
                    <h3>Create sale</h3>
                    <p className="muted small">Each line updates stock and writes audit + movement records.</p>
                  </div>
                  <button className="ghost" type="button" onClick={resetSaleForm}>
                    Reset form
                  </button>
                </div>
                <form className="stack" onSubmit={handleCreateSale}>
                  {saleLines.map((line) => (
                    <div className="sale-line" key={line.id}>
                      <label>
                        Product
                        <select
                          value={line.product_id}
                          onChange={(event) => updateSaleLine(line.id, { product_id: event.target.value })}
                        >
                          <option value="">Select a product</option>
                          {products.map((product) => (
                            <option key={product.id} value={product.id}>
                              {product.name} · {product.sku} · stock {product.stock}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Quantity
                        <input
                          type="number"
                          min="1"
                          value={line.quantity}
                          onChange={(event) => updateSaleLine(line.id, { quantity: event.target.value })}
                        />
                      </label>
                      <button className="ghost compact danger" type="button" onClick={() => removeSaleLine(line.id)}>
                        Remove
                      </button>
                    </div>
                  ))}
                  <div className="button-row">
                    <button className="secondary" type="button" onClick={addSaleLine}>
                      Add line
                    </button>
                    <button type="submit">Create sale</button>
                  </div>
                </form>
              </section>

              <section className="card summary-box responsive-box">
                <div>
                  <span className="eyebrow">Sale preview</span>
                  <h3>{currency(salePreview)}</h3>
                  <p className="muted small">Calculated from the current line items using live product prices.</p>
                </div>
                <div className="feature-list">
                  <span className="feature-pill">{saleLines.length} line(s)</span>
                  <span className="feature-pill">Stock auto-updated</span>
                  <span className="feature-pill">Audit logged</span>
                </div>
              </section>
            </div>

            <section className="card">
              <div className="section-head">
                <h3>Recent sales</h3>
                <span className="muted small">Most recent 30 records</span>
              </div>
              <div className="sales-list">
                {sales.map((sale) => (
                  <article className="sale-card" key={sale.id}>
                    <div className="sale-head">
                      <div>
                        <strong>Sale #{sale.id}</strong>
                        <div className="muted small">By {sale.created_by_name}</div>
                      </div>
                      <div className="align-right">
                        <div className="sale-total">{currency(sale.total_amount)}</div>
                        <div className="muted small">{formatDate(sale.created_at)}</div>
                      </div>
                    </div>
                    <ul>
                      {sale.items.map((item) => (
                        <li key={`${sale.id}-${item.product_id}`}>
                          {item.product_name} ({item.sku}) · {item.quantity} × {currency(item.unit_price)}
                        </li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            </section>
          </section>
        ) : null}

        {tab === 'movements' ? (
          <section className="stack-lg">
            <section className="card">
              <div className="section-head">
                <div>
                  <h3>Create stock movement</h3>
                  <p className="muted small">Purchases add stock, writeoffs remove it, adjustments correct counted inventory.</p>
                </div>
              </div>
              <form className="form-grid compact" onSubmit={handleCreateMovement}>
                <label>
                  Product
                  <select
                    value={movementForm.product_id}
                    onChange={(event) => setMovementForm((current) => ({ ...current, product_id: event.target.value }))}
                    required
                  >
                    <option value="">Select a product</option>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name} · {product.sku} · stock {product.stock}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Type
                  <select
                    value={movementForm.movement_type}
                    onChange={(event) => setMovementForm((current) => ({ ...current, movement_type: event.target.value }))}
                  >
                    <option value="purchase">Purchase</option>
                    <option value="adjustment">Adjustment</option>
                    <option value="writeoff">Writeoff</option>
                  </select>
                </label>
                <label>
                  Quantity
                  <input
                    type="number"
                    min="1"
                    value={movementForm.quantity}
                    onChange={(event) => setMovementForm((current) => ({ ...current, quantity: event.target.value }))}
                    required
                  />
                </label>
                <label className="span-two">
                  Note
                  <input
                    value={movementForm.note}
                    onChange={(event) => setMovementForm((current) => ({ ...current, note: event.target.value }))}
                    placeholder="Why was the stock changed?"
                  />
                </label>
                <div className="button-row end span-full">
                  <button type="submit">Save movement</button>
                </div>
              </form>
            </section>

            <section className="card">
              <div className="section-head">
                <h3>Recent movements</h3>
                <span className="muted small">Most recent 30 records</span>
              </div>
              <div className="log-list movement-list">
                {movements.map((movement) => (
                  <article className="log-card" key={movement.id}>
                    <div className="log-head">
                      <div className="log-badges">
                        <span className={`tag tag-${movement.movement_type}`}>{movement.movement_type}</span>
                        <span className="muted small">#{movement.id}</span>
                      </div>
                      <span className="muted small">{formatDate(movement.created_at)}</span>
                    </div>
                    <strong>{movement.product_name}</strong>
                    <div className="muted small">{movement.sku}</div>
                    <p className="muted small">Qty {movement.quantity} · by {movement.created_by_name}</p>
                    <p>{movement.note || 'No note provided.'}</p>
                  </article>
                ))}
              </div>
            </section>
          </section>
        ) : null}

        {tab === 'logs' ? (
          <section className="stack-lg">
            <section className="card">
              <div className="section-head with-controls">
                <div>
                  <h3>Audit logs</h3>
                  <p className="muted small">Every major action is recorded with timestamp, actor and entity context.</p>
                </div>
                <div className="control-row wrap">
                  <input
                    className="search"
                    placeholder="Search action, message or actor"
                    value={logSearch}
                    onChange={(event) => setLogSearch(event.target.value)}
                  />
                  <div className="filter-pills">
                    {(['all', 'info', 'warning', 'error'] as LogFilter[]).map((item) => (
                      <button
                        key={item}
                        className={logFilter === item ? 'pill active' : 'pill'}
                        type="button"
                        onClick={() => setLogFilter(item)}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="log-list">
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
                    <p className="muted small">
                      {entry.created_by_name} · {entry.entity_type || 'system'}
                      {entry.entity_id ? ` #${entry.entity_id}` : ''}
                    </p>
                    <p>{detailsToText(entry.details)}</p>
                  </article>
                ))}
              </div>
            </section>
          </section>
        ) : null}

        {tab === 'docs' ? (
          <section className="stack-lg">
            <section className="card hero-card">
              <div>
                <span className="eyebrow">Technical documentation</span>
                <h3>System notes for reviewers and maintainers</h3>
                <p className="muted">
                  The repository also includes dedicated markdown docs, but this view keeps the main
                  architecture and deployment notes available from inside the product.
                </p>
              </div>
            </section>
            <div className="docs-grid">
              {docsSections.map((section) => (
                <article className="card" key={section.title}>
                  <h3>{section.title}</h3>
                  <ul className="doc-list">
                    {section.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  )
}

export default App
