import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Dashboard, Movement, Product, Sale, User } from './types'

const API_URL = import.meta.env.VITE_API_URL || '/api'
const TABS = ['dashboard', 'products', 'sales', 'movements'] as const

type Tab = (typeof TABS)[number]
type StockFilter = 'all' | 'low' | 'out'
type SaleLine = { id: number; product_id: string; quantity: string }

type ApiError = {
  detail?: string
  message?: string
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  })

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as ApiError
    throw new Error(errorBody.detail || errorBody.message || 'Request failed')
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

function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('stockflow_token'))
  const [user, setUser] = useState<User | null>(null)
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [movements, setMovements] = useState<Movement[]>([])
  const [tab, setTab] = useState<Tab>('dashboard')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [stockFilter, setStockFilter] = useState<StockFilter>('all')
  const [editingProductId, setEditingProductId] = useState<number | null>(null)
  const [saleLineId, setSaleLineId] = useState(2)

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

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase()

    return products.filter((product) => {
      const matchesSearch =
        !term ||
        product.name.toLowerCase().includes(term) ||
        product.sku.toLowerCase().includes(term)

      const matchesStock =
        stockFilter === 'all'
          ? true
          : stockFilter === 'low'
            ? product.stock <= product.min_stock
            : product.stock === 0

      return matchesSearch && matchesStock
    })
  }, [products, search, stockFilter])

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
    return saleLines.reduce(
      (acc, line) => {
        const product = products.find((item) => item.id === Number(line.product_id))
        const quantity = Number(line.quantity || 0)
        if (!product || quantity <= 0) return acc
        return acc + product.price * quantity
      },
      0,
    )
  }, [products, saleLines])

  const loadAll = async (currentToken: string) => {
    setIsLoading(true)
    setError(null)
    try {
      const [me, dashboardData, productsData, salesData, movementsData] = await Promise.all([
        request<User>('/me', {}, currentToken),
        request<Dashboard>('/dashboard', {}, currentToken),
        request<{ items: Product[] }>('/products?page=1&page_size=100', {}, currentToken),
        request<{ items: Sale[] }>('/sales?page=1&page_size=20', {}, currentToken),
        request<{ items: Movement[] }>('/stock-movements?page=1&page_size=20', {}, currentToken),
      ])

      setUser(me)
      setDashboard(dashboardData)
      setProducts(productsData.items)
      setSales(salesData.items)
      setMovements(movementsData.items)
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

  const resetProductForm = () => {
    setEditingProductId(null)
    setProductForm({ name: '', sku: '', price: '0', stock: '0', min_stock: '0' })
  }

  const resetSaleForm = () => {
    setSaleLines([{ id: 1, product_id: '', quantity: '1' }])
    setSaleLineId(2)
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
    setMessage(null)
    setError(null)
    resetProductForm()
    resetSaleForm()
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
        setMessage('Product updated')
      } else {
        await request(
          '/products',
          {
            method: 'POST',
            body: JSON.stringify({ ...payload, stock: Number(productForm.stock) }),
          },
          token,
        )
        setMessage('Product created')
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
    setTab('products')
    setMessage(null)
    setError(null)
  }

  const handleDeleteProduct = async (product: Product) => {
    if (!token) return
    const confirmed = window.confirm(`Delete ${product.name}? This cannot be undone.`)
    if (!confirmed) return

    setError(null)
    setMessage(null)
    try {
      await request(`/products/${product.id}`, { method: 'DELETE' }, token)
      setMessage('Product deleted')
      if (editingProductId === product.id) resetProductForm()
      await loadAll(token)
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
      setMessage('Stock movement saved')
      await loadAll(token)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save movement')
    }
  }

  const addSaleLine = () => {
    setSaleLines((current) => [...current, { id: saleLineId, product_id: '', quantity: '1' }])
    setSaleLineId((current) => current + 1)
  }

  const updateSaleLine = (lineId: number, patch: Partial<SaleLine>) => {
    setSaleLines((current) =>
      current.map((line) => (line.id === lineId ? { ...line, ...patch } : line)),
    )
  }

  const removeSaleLine = (lineId: number) => {
    setSaleLines((current) => (current.length === 1 ? current : current.filter((line) => line.id !== lineId)))
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
      setMessage('Sale created')
      await loadAll(token)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create sale')
    }
  }

  if (!token || !user) {
    return (
      <div className="auth-shell">
        <div className="auth-card auth-grid">
          <div className="auth-copy stack">
            <div>
              <span className="eyebrow">Portfolio-ready MVP</span>
              <h1>StockFlow</h1>
              <p className="muted">
                Inventory and sales dashboard with JWT auth, role-based access, stock movements,
                analytics and multi-item sales.
              </p>
            </div>

            <div className="feature-list">
              <span className="feature-pill">FastAPI</span>
              <span className="feature-pill">React + TypeScript</span>
              <span className="feature-pill">JWT + roles</span>
              <span className="feature-pill">SQLite</span>
              <span className="feature-pill">Docker + CI</span>
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
                onChange={(event) =>
                  setLoginForm((current) => ({ ...current, email: event.target.value }))
                }
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={loginForm.password}
                onChange={(event) =>
                  setLoginForm((current) => ({ ...current, password: event.target.value }))
                }
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
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <span className="eyebrow">StockFlow Portfolio Build</span>
          <h2>Inventory Panel</h2>
          <p className="muted small">
            Business-oriented demo project with clean flows for products, sales and warehouse
            actions.
          </p>
        </div>

        <div className="user-box">
          <strong>{user.name}</strong>
          <span>{user.email}</span>
          <span className="role-pill">{user.role}</span>
        </div>

        <nav className="nav-list">
          {TABS.map((item) => (
            <button
              key={item}
              className={item === tab ? 'nav-button active' : 'nav-button'}
              onClick={() => setTab(item)}
            >
              {item}
            </button>
          ))}
        </nav>

        <div className="sidebar-note card">
          <strong>What this showcases</strong>
          <p className="muted small">
            Role-based access, business logic, analytics, editable records, Docker and CI-ready
            setup.
          </p>
        </div>

        <button className="secondary" onClick={() => token && loadAll(token)}>
          Refresh data
        </button>
        <button className="ghost" onClick={handleLogout}>
          Logout
        </button>
      </aside>

      <main className="content">
        <header className="page-header">
          <div>
            <span className="eyebrow">Operational workspace</span>
            <h1>{tab[0].toUpperCase() + tab.slice(1)}</h1>
            <p className="muted">A compact portfolio-grade MVP with visible business value.</p>
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
                <h3>Production-flavored MVP</h3>
                <p className="muted">
                  This version is meant to look credible in a recruiter review: seeded analytics,
                  multi-step business operations and clean admin workflows.
                </p>
              </div>
              <div className="feature-list">
                <span className="feature-pill">Multi-item sales</span>
                <span className="feature-pill">Edit + delete products</span>
                <span className="feature-pill">Low-stock watchlist</span>
                <span className="feature-pill">Revenue trend</span>
              </div>
            </section>

            <div className="cards-grid cards-grid-5">
              <MetricCard
                label="Products"
                value={dashboard.total_products}
                hint="Live catalog size"
              />
              <MetricCard
                label="Low stock"
                value={dashboard.low_stock_count}
                hint="Needs replenishment"
              />
              <MetricCard
                label="Out of stock"
                value={dashboard.out_of_stock_count}
                hint="Potential lost sales"
              />
              <MetricCard
                label="Sales"
                value={dashboard.total_sales_count}
                hint="Completed orders"
              />
              <MetricCard
                label="Inventory value"
                value={currency(dashboard.stock_value)}
                hint="Current stock on hand"
              />
            </div>

            <div className="split-grid">
              <section className="card">
                <div className="section-head">
                  <h3>Revenue trend</h3>
                  <span className="muted small">Last seeded days</span>
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
                          <div className="muted small">Restock soon</div>
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
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Total</th>
                        <th>Created by</th>
                        <th>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.recent_sales.map((sale) => (
                        <tr key={sale.id}>
                          <td>#{sale.id}</td>
                          <td>{currency(sale.total_amount)}</td>
                          <td>{sale.created_by_name}</td>
                          <td>{formatDate(sale.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
                  <h3>{editingProductId ? 'Edit product' : 'Create product'}</h3>
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
                      onChange={(event) =>
                        setProductForm((current) => ({ ...current, name: event.target.value }))
                      }
                      required
                    />
                  </label>
                  <label>
                    SKU
                    <input
                      value={productForm.sku}
                      onChange={(event) =>
                        setProductForm((current) => ({ ...current, sku: event.target.value }))
                      }
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
                      onChange={(event) =>
                        setProductForm((current) => ({ ...current, price: event.target.value }))
                      }
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
                        onChange={(event) =>
                          setProductForm((current) => ({ ...current, stock: event.target.value }))
                        }
                        required
                      />
                    </label>
                  ) : (
                    <div className="card inset-card">
                      <strong>Stock is edited via movements</strong>
                      <p className="muted small">This keeps stock changes auditable.</p>
                    </div>
                  )}
                  <label>
                    Min stock
                    <input
                      type="number"
                      min="0"
                      value={productForm.min_stock}
                      onChange={(event) =>
                        setProductForm((current) => ({ ...current, min_stock: event.target.value }))
                      }
                      required
                    />
                  </label>
                  <div className="button-row">
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
                    {(['all', 'low', 'out'] as StockFilter[]).map((filter) => (
                      <button
                        key={filter}
                        type="button"
                        className={stockFilter === filter ? 'pill active' : 'pill'}
                        onClick={() => setStockFilter(filter)}
                      >
                        {filter}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>SKU</th>
                      <th>Price</th>
                      <th>Stock</th>
                      <th>Min stock</th>
                      <th>Status</th>
                      <th>Updated</th>
                      {user.role === 'admin' ? <th>Actions</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProducts.length === 0 ? (
                      <tr>
                        <td colSpan={user.role === 'admin' ? 8 : 7}>No products found</td>
                      </tr>
                    ) : (
                      filteredProducts.map((product) => {
                        const status = getStatus(product)
                        return (
                          <tr key={product.id}>
                            <td>{product.name}</td>
                            <td>{product.sku}</td>
                            <td>{currency(product.price)}</td>
                            <td>{product.stock}</td>
                            <td>{product.min_stock}</td>
                            <td>
                              <span className={status.className}>{status.label}</span>
                            </td>
                            <td>{formatDate(product.updated_at)}</td>
                            {user.role === 'admin' ? (
                              <td>
                                <div className="table-actions">
                                  <button
                                    className="ghost compact"
                                    type="button"
                                    onClick={() => startEditProduct(product)}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    className="ghost compact danger"
                                    type="button"
                                    onClick={() => void handleDeleteProduct(product)}
                                  >
                                    Delete
                                  </button>
                                </div>
                              </td>
                            ) : null}
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </section>
        ) : null}

        {tab === 'sales' ? (
          <section className="stack-lg">
            <div className="split-grid sales-grid">
              <section className="card">
                <div className="section-head">
                  <h3>Create sale</h3>
                  <button className="ghost" type="button" onClick={addSaleLine}>
                    Add line
                  </button>
                </div>
                <form className="stack" onSubmit={handleCreateSale}>
                  {saleLines.map((line, index) => (
                    <div className="sale-line" key={line.id}>
                      <label>
                        Product #{index + 1}
                        <select
                          value={line.product_id}
                          onChange={(event) =>
                            updateSaleLine(line.id, { product_id: event.target.value })
                          }
                          required
                        >
                          <option value="">Choose product</option>
                          {products.map((product) => (
                            <option key={product.id} value={product.id}>
                              {product.name} ({product.stock} in stock)
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
                          onChange={(event) =>
                            updateSaleLine(line.id, { quantity: event.target.value })
                          }
                          required
                        />
                      </label>
                      <div className="button-row end">
                        <button
                          className="ghost compact"
                          type="button"
                          onClick={() => removeSaleLine(line.id)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}

                  <div className="button-row">
                    <button type="submit">Create sale</button>
                    <button className="ghost" type="button" onClick={resetSaleForm}>
                      Reset
                    </button>
                  </div>
                </form>
              </section>

              <section className="card">
                <div className="section-head">
                  <h3>Sale preview</h3>
                </div>
                <div className="stack">
                  {saleLines.map((line) => {
                    const product = products.find((item) => item.id === Number(line.product_id))
                    if (!product) return null
                    const qty = Number(line.quantity || 0)
                    return (
                      <div className="list-row" key={line.id}>
                        <div>
                          <strong>{product.name}</strong>
                          <div className="muted small">{qty} × {currency(product.price)}</div>
                        </div>
                        <strong>{currency(product.price * qty)}</strong>
                      </div>
                    )
                  })}
                  <div className="summary-box">
                    <span className="muted">Estimated total</span>
                    <strong>{currency(salePreview)}</strong>
                  </div>
                </div>
              </section>
            </div>

            <section className="card">
              <div className="section-head">
                <h3>Sales history</h3>
              </div>
              <div className="sales-list">
                {sales.length === 0 ? <p className="muted">No sales yet</p> : null}
                {sales.map((sale) => (
                  <article className="sale-card" key={sale.id}>
                    <div className="sale-head">
                      <div>
                        <strong>Sale #{sale.id}</strong>
                        <span className="muted small">{formatDate(sale.created_at)}</span>
                      </div>
                      <div className="sale-total">{currency(sale.total_amount)}</div>
                    </div>
                    <div className="muted small">Created by: {sale.created_by_name}</div>
                    <ul>
                      {sale.items.map((item) => (
                        <li key={`${sale.id}-${item.product_id}`}>
                          {item.product_name} — {item.quantity} × {currency(item.unit_price)}
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
                <h3>Create stock movement</h3>
              </div>
              <form className="form-grid compact" onSubmit={handleCreateMovement}>
                <label>
                  Product
                  <select
                    value={movementForm.product_id}
                    onChange={(event) =>
                      setMovementForm((current) => ({ ...current, product_id: event.target.value }))
                    }
                    required
                  >
                    <option value="">Choose product</option>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Type
                  <select
                    value={movementForm.movement_type}
                    onChange={(event) =>
                      setMovementForm((current) => ({ ...current, movement_type: event.target.value }))
                    }
                  >
                    <option value="purchase">purchase</option>
                    <option value="writeoff">writeoff</option>
                    <option value="adjustment">adjustment</option>
                  </select>
                </label>
                <label>
                  Quantity
                  <input
                    type="number"
                    min="1"
                    value={movementForm.quantity}
                    onChange={(event) =>
                      setMovementForm((current) => ({ ...current, quantity: event.target.value }))
                    }
                    required
                  />
                </label>
                <label>
                  Note
                  <input
                    value={movementForm.note}
                    onChange={(event) =>
                      setMovementForm((current) => ({ ...current, note: event.target.value }))
                    }
                  />
                </label>
                <div className="button-row">
                  <button type="submit">Save movement</button>
                </div>
              </form>
            </section>

            <section className="card">
              <div className="section-head">
                <h3>Latest movements</h3>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Type</th>
                      <th>Qty</th>
                      <th>Note</th>
                      <th>By</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.length === 0 ? (
                      <tr>
                        <td colSpan={6}>No movements yet</td>
                      </tr>
                    ) : (
                      movements.map((movement) => (
                        <tr key={movement.id}>
                          <td>{movement.product_name}</td>
                          <td>
                            <span className={`tag tag-${movement.movement_type}`}>
                              {movement.movement_type}
                            </span>
                          </td>
                          <td>{movement.quantity}</td>
                          <td>{movement.note || '—'}</td>
                          <td>{movement.created_by_name}</td>
                          <td>{formatDate(movement.created_at)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </section>
        ) : null}
      </main>
    </div>
  )
}

export default App
