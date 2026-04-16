import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react'
import { AuditLog, Dashboard, Movement, Product, Sale, User } from './types'
import {
  getStoredLanguage,
  I18n,
  interpolate,
  Language,
  languageOptions,
  localeByLanguage,
  STORAGE_LANGUAGE_KEY,
  translateBackendMessage,
  translations,
} from './i18n'

const API_URL = import.meta.env.VITE_API_URL || '/api'

type Tab = 'dashboard' | 'products' | 'sales' | 'movements' | 'logs' | 'profile' | 'settings' | 'docs'
type SettingsSection = 'appearance' | 'language' | 'account' | 'team' | 'logs' | 'help'
type ThemeMode = 'light' | 'dark'
type AccentScheme = 'blue' | 'emerald' | 'violet' | 'sunset'
type StockFilter = 'all' | 'low' | 'out'
type LogFilter = 'all' | 'info' | 'warning' | 'error'
type StaffStatus = 'active' | 'on_leave' | 'inactive'
type StaffLevel = 'staff' | 'lead' | 'management'
type SaleLine = { id: number; product_id: string; quantity: string }

type ApiError = { detail?: string; message?: string }

function navItems(t: I18n) {
  return [
    { id: 'dashboard' as const, label: t.nav.dashboard.label, icon: '📊', description: t.nav.dashboard.description },
    { id: 'products' as const, label: t.nav.products.label, icon: '📦', description: t.nav.products.description },
    { id: 'sales' as const, label: t.nav.sales.label, icon: '🧾', description: t.nav.sales.description },
    { id: 'movements' as const, label: t.nav.movements.label, icon: '🔁', description: t.nav.movements.description },
    { id: 'settings' as const, label: t.nav.settings.label, icon: '⚙️', description: t.nav.settings.description },
  ]
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'SF'
}

function buildNetworkError(url: string, path: string, error: unknown, t: I18n): Error {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new Error(interpolate(t.common.timeout, { path }))
  }

  return new Error(interpolate(t.common.apiUnavailable, { url }))
}

async function request<T>(path: string, t: I18n, options: RequestInit = {}, token?: string): Promise<T> {
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
    throw buildNetworkError(url, path, error, t)
  } finally {
    window.clearTimeout(timeoutId)
  }

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as ApiError
    const detail = errorBody.detail || errorBody.message

    if (detail) throw new Error(`${translateBackendMessage(detail, t)} (HTTP ${response.status})`)
    if (response.status === 401) throw new Error(t.common.authFailed)
    if (response.status === 403) throw new Error(t.common.noPermission)
    if (response.status >= 500) throw new Error(interpolate(t.common.serverError, { path, status: response.status }))
    throw new Error(interpolate(t.common.requestFailed, { path, status: response.status }))
  }

  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

function currency(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value)
}

function formatDate(value: string, locale: string): string {
  return new Date(value).toLocaleString(locale)
}

function shortDate(value: string, locale: string): string {
  return new Date(value).toLocaleDateString(locale, { month: 'short', day: 'numeric' })
}

function getStatus(product: Product, t: I18n): { label: string; className: string } {
  if (product.stock === 0) return { label: t.common.out, className: 'status out' }
  if (product.stock <= product.min_stock) return { label: t.common.low, className: 'status low' }
  return { label: t.common.ok, className: 'status ok' }
}

function translateRole(value: User['role'], t: I18n): string {
  return value === 'admin' ? t.common.admin : t.common.employee
}

function translateStatus(value: StaffStatus, t: I18n): string {
  if (value === 'active') return t.common.active
  if (value === 'on_leave') return t.common.onLeave
  return t.common.inactive
}

function translateHierarchy(value: StaffLevel, t: I18n): string {
  if (value === 'lead') return t.common.lead
  if (value === 'management') return t.common.management
  return t.common.staff
}

function translateMovementType(value: Movement['movement_type'] | 'purchase' | 'adjustment' | 'writeoff' | 'sale', t: I18n): string {
  if (value === 'purchase') return t.movements.purchase
  if (value === 'adjustment') return t.movements.adjustment
  if (value === 'writeoff') return t.movements.writeoff
  return t.movements.sale
}

function translateLogLevel(value: string, t: I18n): string {
  if (value === 'warning') return t.logs.levels.warning
  if (value === 'error') return t.logs.levels.error
  return t.logs.levels.info
}

function humanizeAction(value: string, t: I18n): string {
  const known: Record<string, string> = {
    'auth.login': t.login.signIn,
    'profile.update': t.profile.saveProfile,
    'user.create': t.profile.createStaffMember,
    'user.update': t.profile.saveStaffMember,
    'product.create': t.products.createProductButton,
    'product.update': t.products.saveChanges,
    'product.delete': t.products.delete,
    'movement.create': t.movements.saveMovement,
    'sale.create': t.sales.createSaleButton,
    'demo.populate': t.common.syncDemoData,
  }
  return known[value] || value.replace(/\./g, ' · ').replace(/_/g, ' ')
}

function detailsToText(details: Record<string, unknown>, t: I18n): string {
  const items = Object.entries(details)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .slice(0, 4)

  if (items.length === 0) return t.common.noAdditionalDetails
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

function Modal({ title, subtitle, onClose, children, closeLabel }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; closeLabel: string }) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <button className="modal-backdrop" type="button" onClick={onClose} aria-label={closeLabel} />
      <div className="modal-card">
        <div className="modal-head">
          <div>
            <h3>{title}</h3>
            {subtitle ? <p className="muted small">{subtitle}</p> : null}
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label={closeLabel}>
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

function App() {
  const [language, setLanguage] = useState<Language>(getStoredLanguage)
  const t = translations[language]
  const locale = localeByLanguage[language]

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
  const [isProductModalOpen, setIsProductModalOpen] = useState(false)
  const [productPendingDelete, setProductPendingDelete] = useState<Product | null>(null)
  const [saleLineId, setSaleLineId] = useState(2)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(localStorage.getItem('stockflow_sidebar_collapsed') === 'true')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null)
  const [selectedMovement, setSelectedMovement] = useState<Movement | null>(null)
  const [editingStaffId, setEditingStaffId] = useState<number | null>(null)
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('appearance')
  const [themeMode, setThemeMode] = useState<ThemeMode>((localStorage.getItem('stockflow_theme') as ThemeMode) || 'light')
  const [accentScheme, setAccentScheme] = useState<AccentScheme>((localStorage.getItem('stockflow_accent') as AccentScheme) || 'blue')

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

  const items = useMemo(() => navItems(t), [t])
  const currentTabMeta = items.find((item) => item.id === tab) ?? items[0]
  const docsSections = t.docs.sections
  const appearanceCopy = language === 'es'
    ? { title: 'Apariencia', description: 'Elegí el modo visual y el color principal del espacio.', light: 'Claro', dark: 'Oscuro', accentTitle: 'Color principal', accentDescription: 'Aplicado a botones, focos y elementos destacados.', updatedTheme: 'Tema actualizado', updatedAccent: 'Color actualizado' }
    : language === 'ru'
      ? { title: 'Внешний вид', description: 'Выберите тему интерфейса и основной цвет рабочего пространства.', light: 'Светлая', dark: 'Тёмная', accentTitle: 'Основной цвет', accentDescription: 'Используется для кнопок, акцентов и элементов управления.', updatedTheme: 'Тема обновлена', updatedAccent: 'Цветовая схема обновлена' }
      : { title: 'Appearance', description: 'Choose the workspace mode and primary accent color.', light: 'Light', dark: 'Dark', accentTitle: 'Accent color', accentDescription: 'Used for buttons, focus states and highlighted UI elements.', updatedTheme: 'Theme updated', updatedAccent: 'Accent color updated' }
  const accentOptions = [
    { value: 'blue' as const, label: language === 'es' ? 'Azul' : language === 'ru' ? 'Синий' : 'Blue' },
    { value: 'emerald' as const, label: language === 'es' ? 'Esmeralda' : language === 'ru' ? 'Изумрудный' : 'Emerald' },
    { value: 'violet' as const, label: language === 'es' ? 'Violeta' : language === 'ru' ? 'Фиолетовый' : 'Violet' },
    { value: 'sunset' as const, label: language === 'es' ? 'Atardecer' : language === 'ru' ? 'Закат' : 'Sunset' },
  ]
  const settingsSections = [
    { id: 'appearance' as const, label: appearanceCopy.title },
    { id: 'language' as const, label: t.common.language },
    { id: 'account' as const, label: t.nav.profile.label },
    ...(user?.role === 'admin' ? [{ id: 'team' as const, label: language === 'es' ? 'Personal' : language === 'ru' ? 'Команда' : 'Team' }] : []),
    { id: 'logs' as const, label: t.nav.logs.label },
    { id: 'help' as const, label: language === 'es' ? 'Ayuda' : language === 'ru' ? 'Справка' : 'Help' },
  ]
  const helpSections = language === 'es'
    ? [
        { title: 'Primeros pasos', items: ['Usá Dashboard para ver el estado general del negocio.', 'En Productos podés revisar precios, stock y puntos de reposición.', 'Ventas y Movimientos muestran el historial reciente con detalle adicional.'] },
        { title: 'Cuenta y equipo', items: ['Actualizá tus datos desde Perfil dentro de Configuración.', 'Si sos admin, también podés gestionar el personal desde la misma sección.', 'Los cambios se guardan y se reflejan en toda la aplicación.'] },
        { title: 'Actividad', items: ['Los logs te ayudan a revisar acciones recientes.', 'Podés cambiar idioma, tema y color principal sin salir de la app.', 'La interfaz se adapta a escritorio, tablet y móvil.'] },
      ]
    : language === 'ru'
      ? [
          { title: 'Быстрый старт', items: ['На Dashboard видна общая картина по бизнесу.', 'В разделе Products можно контролировать цены, остатки и минимальный запас.', 'Разделы Sales и Movements показывают недавнюю активность и детали операций.'] },
          { title: 'Профиль и команда', items: ['Обновляйте свои данные в разделе Profile внутри Settings.', 'Если вы администратор, там же можно управлять сотрудниками.', 'Все изменения сохраняются и сразу отражаются в приложении.'] },
          { title: 'Активность', items: ['Logs помогают быстро проверить последние действия.', 'Язык, тема и основной цвет меняются прямо в приложении.', 'Интерфейс адаптирован под компьютер, планшет и телефон.'] },
        ]
      : [
          { title: 'Getting started', items: ['Use Dashboard to review the overall business snapshot.', 'Products lets you monitor prices, stock levels and reorder points.', 'Sales and Movements show recent activity with additional details.'] },
          { title: 'Account and team', items: ['Update your information from Profile inside Settings.', 'If you are an admin, you can manage staff from the same area.', 'Changes are saved and reflected across the application.'] },
          { title: 'Activity', items: ['Logs help you review recent actions.', 'You can change language, theme and accent without leaving the app.', 'The interface adapts to desktop, tablet and phone screens.'] },
        ]

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
      const meData = await request<User>('/me', t, {}, currentToken)
      const [dashboardData, productsData, salesData, movementsData, logsData] = await Promise.all([
        request<Dashboard>('/dashboard', t, {}, currentToken),
        request<{ items: Product[] }>('/products?page=1&page_size=100', t, {}, currentToken),
        request<{ items: Sale[] }>('/sales?page=1&page_size=50', t, {}, currentToken),
        request<{ items: Movement[] }>('/stock-movements?page=1&page_size=50', t, {}, currentToken),
        request<{ items: AuditLog[] }>('/logs?page=1&page_size=50', t, {}, currentToken),
      ])

      let staffItems: User[] = []
      if (meData.role === 'admin') {
        const usersData = await request<{ items: User[] }>('/users', t, {}, currentToken)
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
      const text = err instanceof Error ? translateBackendMessage(err.message, t) : t.common.couldNotLoadData
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
    localStorage.setItem(STORAGE_LANGUAGE_KEY, language)
    document.documentElement.lang = language
  }, [language])

  useEffect(() => {
    localStorage.setItem('stockflow_theme', themeMode)
    document.documentElement.dataset.theme = themeMode
  }, [themeMode])

  useEffect(() => {
    localStorage.setItem('stockflow_accent', accentScheme)
    document.documentElement.dataset.accent = accentScheme
  }, [accentScheme])

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > 960) setMobileNavOpen(false)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const resetProductForm = () => {
    setEditingProductId(null)
    setIsProductModalOpen(false)
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

  const handleLanguageChange = (nextLanguage: Language) => {
    setLanguage(nextLanguage)
    setMessage(translations[nextLanguage].common.languageUpdated)
  }

  const handleThemeChange = (nextTheme: ThemeMode) => {
    setThemeMode(nextTheme)
    setMessage(appearanceCopy.updatedTheme)
  }

  const handleAccentChange = (nextAccent: AccentScheme) => {
    setAccentScheme(nextAccent)
    setMessage(appearanceCopy.updatedAccent)
  }

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault()
    setIsLoading(true)
    setError(null)
    setMessage(null)
    try {
      const response = await request<{ access_token: string; user: User }>('/auth/login', t, { method: 'POST', body: JSON.stringify(loginForm) })
      localStorage.setItem('stockflow_token', response.access_token)
      setToken(response.access_token)
      setUser(response.user)
      setMessage(interpolate(t.common.welcome, { name: response.user.name }))
    } catch (err) {
      setError(err instanceof Error ? translateBackendMessage(err.message, t) : t.common.loginFailed)
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
    setMessage(t.common.workspaceRefreshed)
  }

  const openNewProductModal = () => {
    setEditingProductId(null)
    setProductForm({ name: '', sku: '', price: '0', stock: '0', min_stock: '0' })
    setIsProductModalOpen(true)
    selectTab('products')
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
        await request(`/products/${editingProductId}`, t, { method: 'PUT', body: JSON.stringify(payload) }, token)
        setMessage(t.common.productUpdated)
      } else {
        await request('/products', t, { method: 'POST', body: JSON.stringify({ ...payload, stock: Number(productForm.stock) }) }, token)
        setMessage(t.common.productCreated)
      }
      resetProductForm()
      await loadAll(token)
    } catch (err) {
      setError(err instanceof Error ? translateBackendMessage(err.message, t) : t.common.saveProductFailed)
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
    setIsProductModalOpen(true)
    selectTab('products')
  }

  const handleDeleteProduct = async (product: Product) => {
    if (!token) return
    try {
      await request(`/products/${product.id}`, t, { method: 'DELETE' }, token)
      setProductPendingDelete(null)
      if (editingProductId === product.id) resetProductForm()
      await loadAll(token)
      setMessage(t.common.productDeleted)
    } catch (err) {
      setError(err instanceof Error ? translateBackendMessage(err.message, t) : t.common.deleteProductFailed)
    }
  }

  const handleCreateMovement = async (event: FormEvent) => {
    event.preventDefault()
    if (!token) return
    try {
      await request(
        '/stock-movements',
        t,
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
      setMessage(t.common.stockMovementSaved)
    } catch (err) {
      setError(err instanceof Error ? translateBackendMessage(err.message, t) : t.common.saveMovementFailed)
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
    const itemsForSale = saleLines
      .filter((line) => line.product_id && Number(line.quantity) > 0)
      .map((line) => ({ product_id: Number(line.product_id), quantity: Number(line.quantity) }))

    if (itemsForSale.length === 0) {
      setError(t.common.addAtLeastOneSaleItem)
      return
    }

    try {
      await request('/sales', t, { method: 'POST', body: JSON.stringify({ items: itemsForSale }) }, token)
      resetSaleForm()
      await loadAll(token)
      setMessage(t.common.saleCreated)
    } catch (err) {
      setError(err instanceof Error ? translateBackendMessage(err.message, t) : t.common.createSaleFailed)
    }
  }

  const handlePopulateDemoData = async () => {
    if (!token || user?.role !== 'admin') return
    setIsLoading(true)
    try {
      const response = await request<{ message: string; totals: { products: number; sales: number; movements: number; logs: number } }>('/demo/populate', t, { method: 'POST' }, token)
      await loadAll(token)
      setMessage(
        interpolate(t.common.demoSyncResult, {
          message: translateBackendMessage(response.message, t),
          products: response.totals.products,
          sales: response.totals.sales,
          movements: response.totals.movements,
          logs: response.totals.logs,
        }),
      )
    } catch (err) {
      setError(err instanceof Error ? translateBackendMessage(err.message, t) : t.common.syncDemoDataFailed)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSaveProfile = async (event: FormEvent) => {
    event.preventDefault()
    if (!token) return
    try {
      const response = await request<{ message: string; user: User }>('/profile', t, { method: 'PUT', body: JSON.stringify(profileForm) }, token)
      setUser(response.user)
      setProfileForm({
        name: response.user.name,
        email: response.user.email,
        phone: response.user.phone || '',
        department: response.user.department || '',
        title: response.user.title || '',
        bio: response.user.bio || '',
      })
      await loadAll(token)
      setMessage(t.common.profileUpdated)
    } catch (err) {
      setError(err instanceof Error ? translateBackendMessage(err.message, t) : t.common.updateProfileFailed)
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
        await request(`/users/${editingStaffId}`, t, { method: 'PUT', body: JSON.stringify({ ...staffForm, password: undefined }) }, token)
        setMessage(t.common.staffUpdated)
      } else {
        await request('/users', t, { method: 'POST', body: JSON.stringify(staffForm) }, token)
        setMessage(t.common.staffCreated)
      }
      resetStaffForm()
      await loadAll(token)
    } catch (err) {
      setError(err instanceof Error ? translateBackendMessage(err.message, t) : t.common.saveStaffFailed)
    }
  }

  if (!token || !user) {
    return (
      <div className="auth-shell">
        <div className="auth-card auth-grid">
          <div className="stack-lg">
            <div className="language-switch-row">
              {languageOptions.map((option) => (
                <button
                  key={option.value}
                  className={language === option.value ? 'pill active' : 'pill'}
                  type="button"
                  onClick={() => handleLanguageChange(option.value)}
                >
                  {option.nativeLabel}
                </button>
              ))}
            </div>
            <div>
              <span className="eyebrow">{t.appName}</span>
              <h1>{t.workspaceName}</h1>
              <p className="muted">{t.authSubtitle}</p>
            </div>
            <div className="callout">
              <strong>{t.login.demoAccounts}</strong>
              <p>{t.login.adminAccount}</p>
              <p>{t.login.employeeAccount}</p>
            </div>
          </div>

          <form className="stack" onSubmit={handleLogin}>
            <label>
              {t.common.email}
              <input type="email" value={loginForm.email} onChange={(event) => setLoginForm((current) => ({ ...current, email: event.target.value }))} />
            </label>
            <label>
              {t.login.password}
              <input type="password" value={loginForm.password} onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))} />
            </label>
            <button type="submit" disabled={isLoading}>{isLoading ? t.login.signingIn : t.login.signIn}</button>
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
              <span className="eyebrow">{t.appName}</span>
              <h2>{t.workspaceName}</h2>
            </div>
          </div>
          <button className="icon-button desktop-only" type="button" onClick={() => setSidebarCollapsed((current) => !current)}>
            {sidebarCollapsed ? '→' : '←'}
          </button>
        </div>

        <div className="user-box">
          <div className="avatar-circle">{getInitials(user.name)}</div>
          <div className="user-copy">
            <strong>{user.name}</strong>
            <span>{user.email}</span>
            <span className={`role-pill role-${user.role}`}>{translateRole(user.role, t)}</span>
          </div>
        </div>

        <nav className="nav-list">
          {items.map((item) => (
            <button key={item.id} className={item.id === tab ? 'nav-button active' : 'nav-button'} onClick={() => selectTab(item.id)} type="button" title={item.label}>
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-actions">
          <button className="secondary compact" type="button" onClick={() => void handleRefresh()}>{t.common.refresh}</button>
          {user.role === 'admin' ? <button className="secondary compact" type="button" onClick={() => void handlePopulateDemoData()}>{t.common.syncDemoData}</button> : null}
          <button className="ghost compact" type="button" onClick={handleLogout}>{t.common.logout}</button>
        </div>
      </aside>

      <main className="content">
        <header className="topbar panel topbar-modern">
          <div className="topbar-main">
            <button className="icon-button mobile-only" type="button" onClick={() => setMobileNavOpen(true)}>☰</button>
            <div className="topbar-copy">
              <span className="eyebrow">{t.appName}</span>
              <h1>{currentTabMeta.label}</h1>
              <p className="muted small topbar-subtitle">{currentTabMeta.description}</p>
            </div>
          </div>
          <div className="topbar-actions">
            <span className={`role-pill role-${user.role}`}>{translateRole(user.role, t)}</span>
            <button className="ghost compact" type="button" onClick={() => void handleRefresh()}>{t.common.refresh}</button>
          </div>
        </header>

        {isLoading ? <div className="alert">{t.common.loadingData}</div> : null}
        {error ? <div className="alert error">{error}</div> : null}
        {message ? <div className="alert success">{message}</div> : null}

        {tab === 'dashboard' && dashboard ? (
          <section className="stack-xl">
            <section className="panel compact-hero">
              <div>
                <span className="eyebrow">{t.dashboard.liveSummary}</span>
                <h3>{t.dashboard.compactTitle}</h3>
                <p className="muted small">{t.dashboard.compactDescription}</p>
              </div>
              <div className="hero-pills">
                <span className="feature-pill">{staff.length || 2} {t.dashboard.staff}</span>
                <span className="feature-pill">{products.length} {t.dashboard.products}</span>
                <span className="feature-pill">{sales.length} {t.dashboard.sales}</span>
              </div>
            </section>

            <div className="metrics-grid">
              <MetricCard label={t.dashboard.metrics.products.label} value={dashboard.total_products} hint={t.dashboard.metrics.products.hint} />
              <MetricCard label={t.dashboard.metrics.lowStock.label} value={dashboard.low_stock_count} hint={t.dashboard.metrics.lowStock.hint} />
              <MetricCard label={t.dashboard.metrics.outOfStock.label} value={dashboard.out_of_stock_count} hint={t.dashboard.metrics.outOfStock.hint} />
              <MetricCard label={t.dashboard.metrics.sales.label} value={dashboard.total_sales_count} hint={t.dashboard.metrics.sales.hint} />
              <MetricCard label={t.dashboard.metrics.revenue.label} value={currency(dashboard.revenue, locale)} hint={t.dashboard.metrics.revenue.hint} />
              <MetricCard label={t.dashboard.metrics.stockValue.label} value={currency(dashboard.stock_value, locale)} hint={t.dashboard.metrics.stockValue.hint} />
            </div>

            <div className="dashboard-grid">
              <section className="panel">
                <div className="section-head">
                  <h3>{t.dashboard.revenueTrend}</h3>
                  <span className="muted small">{t.dashboard.recentDays}</span>
                </div>
                <div className="trend-chart compact-chart">
                  {dashboard.revenue_by_day.map((point) => {
                    const maxRevenue = Math.max(...dashboard.revenue_by_day.map((item) => item.revenue), 1)
                    const height = `${Math.max((point.revenue / maxRevenue) * 100, 14)}%`
                    return (
                      <div className="trend-item" key={point.day}>
                        <div className="trend-bar-wrap"><div className="trend-bar" style={{ height }} /></div>
                        <span className="muted small">{shortDate(point.day, locale)}</span>
                        <strong className="small">{currency(point.revenue, locale)}</strong>
                      </div>
                    )
                  })}
                </div>
              </section>

              <section className="panel two-col-card">
                <div className="mini-list-block">
                  <div className="section-head"><h3>{t.dashboard.topProducts}</h3></div>
                  <div className="stack-sm">
                    {dashboard.top_products.map((item) => (
                      <div className="mini-row" key={item.id}>
                        <div className="min-w-0">
                          <strong>{item.name}</strong>
                          <div className="muted small">{item.sku}</div>
                        </div>
                        <div className="align-right">
                          <strong>{item.quantity_sold}</strong>
                          <div className="muted small">{currency(item.revenue, locale)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mini-list-block">
                  <div className="section-head"><h3>{t.dashboard.lowStock}</h3></div>
                  <div className="stack-sm">
                    {dashboard.low_stock_products.length === 0 ? (
                      <p className="muted small">{t.dashboard.everythingHealthy}</p>
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
                <div className="section-head wrap-row">
                  <div>
                    <h3>{t.products.createProduct}</h3>
                    <p className="muted small">{t.products.productActionsNote}</p>
                  </div>
                  <div className="button-row wrap">
                    <button type="button" onClick={openNewProductModal}>{t.products.createProductButton}</button>
                  </div>
                </div>
              </section>
            ) : null}

            <section className="panel">
              <div className="section-head wrap-row">
                <div>
                  <h3>{t.products.products}</h3>
                  <p className="muted small">{interpolate(t.products.summary, { total: products.length, low: productSummary.low, out: productSummary.out })}</p>
                </div>
                <div className="control-row wrap">
                  <input className="search" placeholder={t.products.searchPlaceholder} value={search} onChange={(event) => setSearch(event.target.value)} />
                  <div className="filter-pills">
                    {(['all', 'low', 'out'] as StockFilter[]).map((item) => (
                      <button key={item} className={stockFilter === item ? 'pill active' : 'pill'} type="button" onClick={() => setStockFilter(item)}>{t.common[item]}</button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="catalog-grid dense-cards">
                {filteredProducts.map((product) => {
                  const status = getStatus(product, t)
                  return (
                    <article className="product-card elevated modern-product-card" key={product.id}>
                      <div className="product-card-head">
                        <div className="product-identity">
                          <div className="product-avatar">{product.name.slice(0, 2).toUpperCase()}</div>
                          <div className="min-w-0">
                            <h4>{product.name}</h4>
                            <div className="muted small">{product.sku}</div>
                          </div>
                        </div>
                        <span className={status.className}>{status.label}</span>
                      </div>
                      <div className="product-card-body">
                        <div className="product-metric"><span className="muted small">{t.products.price}</span><strong>{currency(product.price, locale)}</strong></div>
                        <div className="product-metric"><span className="muted small">{t.products.stock}</span><strong>{product.stock}</strong></div>
                        <div className="product-metric"><span className="muted small">{t.products.minStock}</span><strong>{product.min_stock}</strong></div>
                        <div className="product-metric span-two"><span className="muted small">{t.common.updated}</span><strong>{formatDate(product.updated_at, locale)}</strong></div>
                      </div>
                      {user.role === 'admin' ? (
                        <div className="card-actions card-actions-modern">
                          <button className="secondary compact" type="button" onClick={() => startEditProduct(product)}>{t.products.edit}</button>
                          <button className="ghost compact danger" type="button" onClick={() => setProductPendingDelete(product)}>{t.products.delete}</button>
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
                    <h3>{t.sales.createSale}</h3>
                    <p className="muted small">{t.sales.createSaleDescription}</p>
                  </div>
                  <button className="ghost" type="button" onClick={resetSaleForm}>{t.common.resetForm}</button>
                </div>
                <form className="stack" onSubmit={handleCreateSale}>
                  {saleLines.map((line) => (
                    <div className="sale-line" key={line.id}>
                      <label>
                        {t.common.product}
                        <select value={line.product_id} onChange={(event) => updateSaleLine(line.id, { product_id: event.target.value })}>
                          <option value="">{t.sales.selectProduct}</option>
                          {products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku} · {t.products.stock.toLowerCase()} {product.stock}</option>)}
                        </select>
                      </label>
                      <label>
                        {t.common.quantity}
                        <input type="number" min="1" value={line.quantity} onChange={(event) => updateSaleLine(line.id, { quantity: event.target.value })} />
                      </label>
                      <button className="ghost compact danger" type="button" onClick={() => removeSaleLine(line.id)}>{t.common.remove}</button>
                    </div>
                  ))}
                  <div className="button-row wrap">
                    <button className="secondary" type="button" onClick={addSaleLine}>{t.common.addLine}</button>
                    <button type="submit">{t.sales.createSaleButton}</button>
                  </div>
                </form>
              </section>

              <section className="panel summary-card">
                <span className="eyebrow">{t.sales.salePreview}</span>
                <h3>{currency(salePreview, locale)}</h3>
                <p className="muted small">{t.sales.calculatedRealtime}</p>
                <div className="feature-list inline">
                  <span className="feature-pill">{saleLines.length} {t.common.lineSuffix}</span>
                  <span className="feature-pill">{t.sales.dbUpdated}</span>
                  <span className="feature-pill">{t.sales.auditLogged}</span>
                </div>
              </section>
            </div>

            <section className="panel">
              <div className="section-head">
                <h3>{t.sales.recentSales}</h3>
                <span className="muted small">{t.sales.structuredList}</span>
              </div>
              <div className="record-list">
                {sales.map((sale) => (
                  <article className="record-row" key={sale.id}>
                    <div className="record-primary">
                      <div className="record-title-group">
                        <strong>{interpolate(t.sales.saleDetailsTitle, { id: sale.id })}</strong>
                        <p className="muted small">{sale.created_by_name} · {sale.items.length} {t.common.items.toLowerCase()}</p>
                      </div>
                      <div className="record-meta-pills">
                        <span className="tag">{currency(sale.total_amount, locale)}</span>
                        <span className="tag">{formatDate(sale.created_at, locale)}</span>
                      </div>
                    </div>
                    <div className="record-secondary">
                      <button className="secondary compact" type="button" onClick={() => setSelectedSale(sale)}>{t.common.moreInfo}</button>
                    </div>
                  </article>
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
                  <h3>{t.movements.createMovement}</h3>
                  <p className="muted small">{t.movements.createMovementDescription}</p>
                </div>
              </div>
              <form className="form-grid compact" onSubmit={handleCreateMovement}>
                <label>
                  {t.common.product}
                  <select value={movementForm.product_id} onChange={(event) => setMovementForm((current) => ({ ...current, product_id: event.target.value }))} required>
                    <option value="">{t.sales.selectProduct}</option>
                    {products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku} · {t.products.stock.toLowerCase()} {product.stock}</option>)}
                  </select>
                </label>
                <label>
                  {t.common.type}
                  <select value={movementForm.movement_type} onChange={(event) => setMovementForm((current) => ({ ...current, movement_type: event.target.value }))}>
                    <option value="purchase">{t.movements.purchase}</option>
                    <option value="adjustment">{t.movements.adjustment}</option>
                    <option value="writeoff">{t.movements.writeoff}</option>
                  </select>
                </label>
                <label>
                  {t.common.quantity}
                  <input type="number" min="1" value={movementForm.quantity} onChange={(event) => setMovementForm((current) => ({ ...current, quantity: event.target.value }))} required />
                </label>
                <label className="span-two">
                  {t.movements.note}
                  <input value={movementForm.note} onChange={(event) => setMovementForm((current) => ({ ...current, note: event.target.value }))} placeholder={t.movements.notePlaceholder} />
                </label>
                <div className="button-row end span-full"><button type="submit">{t.movements.saveMovement}</button></div>
              </form>
            </section>

            <section className="panel">
              <div className="section-head">
                <h3>{t.movements.recentMovements}</h3>
                <span className="muted small">{t.movements.readableTable}</span>
              </div>
              <div className="record-list">
                {movements.map((movement) => (
                  <article className="record-row" key={movement.id}>
                    <div className="record-primary">
                      <div className="record-title-group">
                        <strong>{translateMovementType(movement.movement_type, t)}</strong>
                        <p className="muted small">{movement.product_name} · {movement.sku} · {movement.created_by_name}</p>
                      </div>
                      <div className="record-meta-pills">
                        <span className={`tag tag-${movement.movement_type}`}>{t.common.quantity}: {movement.quantity}</span>
                        <span className="tag">{formatDate(movement.created_at, locale)}</span>
                      </div>
                    </div>
                    <div className="record-secondary">
                      <button className="secondary compact" type="button" onClick={() => setSelectedMovement(movement)}>{t.common.moreInfo}</button>
                    </div>
                  </article>
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
                  <h3>{t.logs.title}</h3>
                  <p className="muted small">{t.logs.description}</p>
                </div>
                <div className="control-row wrap">
                  <input className="search" placeholder={t.logs.searchPlaceholder} value={logSearch} onChange={(event) => setLogSearch(event.target.value)} />
                  <div className="filter-pills">
                    {(['all', 'info', 'warning', 'error'] as LogFilter[]).map((item) => (
                      <button key={item} className={logFilter === item ? 'pill active' : 'pill'} type="button" onClick={() => setLogFilter(item)}>{item === 'all' ? t.common.all : translateLogLevel(item, t)}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="log-grid">
                {filteredLogs.map((entry) => (
                  <article className="log-card" key={entry.id}>
                    <div className="log-head">
                      <div className="log-badges">
                        <span className={`tag tag-${entry.level}`}>{translateLogLevel(entry.level, t)}</span>
                        <span className="tag">{humanizeAction(entry.action, t)}</span>
                      </div>
                      <span className="muted small">{formatDate(entry.created_at, locale)}</span>
                    </div>
                    <strong>{translateBackendMessage(entry.message, t)}</strong>
                    <p className="muted small">{entry.created_by_name} · {entry.entity_type || t.logs.system}{entry.entity_id ? ` #${entry.entity_id}` : ''}</p>
                    <p>{detailsToText(entry.details, t)}</p>
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
                    <h3>{t.profile.myProfile}</h3>
                    <p className="muted small">{t.profile.myProfileDescription}</p>
                  </div>
                  <span className={`status-badge status-${user.status}`}>{translateStatus(user.status, t)}</span>
                </div>
                <form className="form-grid" onSubmit={handleSaveProfile}>
                  <label>
                    {t.profile.fullName}
                    <input value={profileForm.name} onChange={(event) => setProfileForm((current) => ({ ...current, name: event.target.value }))} required />
                  </label>
                  <label>
                    {t.common.email}
                    <input type="email" value={profileForm.email} onChange={(event) => setProfileForm((current) => ({ ...current, email: event.target.value }))} required />
                  </label>
                  <label>
                    {t.common.phone}
                    <input value={profileForm.phone} onChange={(event) => setProfileForm((current) => ({ ...current, phone: event.target.value }))} />
                  </label>
                  <label>
                    {t.common.department}
                    <input value={profileForm.department} onChange={(event) => setProfileForm((current) => ({ ...current, department: event.target.value }))} required />
                  </label>
                  <label className="span-two">
                    {t.common.title}
                    <input value={profileForm.title} onChange={(event) => setProfileForm((current) => ({ ...current, title: event.target.value }))} required />
                  </label>
                  <label className="span-full">
                    {t.common.bio}
                    <textarea rows={4} value={profileForm.bio} onChange={(event) => setProfileForm((current) => ({ ...current, bio: event.target.value }))} />
                  </label>
                  <div className="button-row end span-full"><button type="submit">{t.profile.saveProfile}</button></div>
                </form>
              </section>

              <section className="panel">
                <div className="section-head">
                  <h3>{t.profile.accountSummary}</h3>
                </div>
                <div className="profile-summary">
                  <div className="summary-row"><span>{t.common.role}</span><strong>{translateRole(user.role, t)}</strong></div>
                  <div className="summary-row"><span>{t.common.title}</span><strong>{user.title}</strong></div>
                  <div className="summary-row"><span>{t.common.department}</span><strong>{user.department}</strong></div>
                  <div className="summary-row"><span>{t.common.hierarchy}</span><strong>{translateHierarchy(user.hierarchy_level, t)}</strong></div>
                  <div className="summary-row"><span>{t.common.manager}</span><strong>{user.manager_name || t.common.noManager}</strong></div>
                  <div className="summary-row"><span>{t.common.updated}</span><strong>{formatDate(user.updated_at, locale)}</strong></div>
                </div>
              </section>
            </div>

            {user.role === 'admin' ? (
              <>
                <section className="panel">
                  <div className="section-head">
                    <div>
                      <h3>{editingStaffId ? t.profile.editStaffMember : t.profile.addStaffMember}</h3>
                      <p className="muted small">{t.profile.staffDescription}</p>
                    </div>
                    {editingStaffId ? <button className="ghost" type="button" onClick={resetStaffForm}>{t.common.cancelEdit}</button> : null}
                  </div>
                  <form className="form-grid" onSubmit={handleSaveStaff}>
                    <label>
                      {t.profile.fullName}
                      <input value={staffForm.name} onChange={(event) => setStaffForm((current) => ({ ...current, name: event.target.value }))} required />
                    </label>
                    <label>
                      {t.common.email}
                      <input type="email" value={staffForm.email} onChange={(event) => setStaffForm((current) => ({ ...current, email: event.target.value }))} required />
                    </label>
                    {!editingStaffId ? (
                      <label>
                        {t.profile.temporaryPassword}
                        <input type="password" value={staffForm.password} onChange={(event) => setStaffForm((current) => ({ ...current, password: event.target.value }))} required />
                      </label>
                    ) : null}
                    <label>
                      {t.common.role}
                      <select value={staffForm.role} onChange={(event) => setStaffForm((current) => ({ ...current, role: event.target.value as User['role'] }))}>
                        <option value="employee">{t.common.employee}</option>
                        <option value="admin">{t.common.admin}</option>
                      </select>
                    </label>
                    <label>
                      {t.common.status}
                      <select value={staffForm.status} onChange={(event) => setStaffForm((current) => ({ ...current, status: event.target.value as StaffStatus }))}>
                        <option value="active">{t.common.active}</option>
                        <option value="on_leave">{t.common.onLeave}</option>
                        <option value="inactive">{t.common.inactive}</option>
                      </select>
                    </label>
                    <label>
                      {t.common.hierarchy}
                      <select value={staffForm.hierarchy_level} onChange={(event) => setStaffForm((current) => ({ ...current, hierarchy_level: event.target.value as StaffLevel }))}>
                        <option value="staff">{t.common.staff}</option>
                        <option value="lead">{t.common.lead}</option>
                        <option value="management">{t.common.management}</option>
                      </select>
                    </label>
                    <label>
                      {t.common.phone}
                      <input value={staffForm.phone} onChange={(event) => setStaffForm((current) => ({ ...current, phone: event.target.value }))} />
                    </label>
                    <label>
                      {t.common.department}
                      <input value={staffForm.department} onChange={(event) => setStaffForm((current) => ({ ...current, department: event.target.value }))} required />
                    </label>
                    <label>
                      {t.common.title}
                      <input value={staffForm.title} onChange={(event) => setStaffForm((current) => ({ ...current, title: event.target.value }))} required />
                    </label>
                    <label>
                      {t.common.manager}
                      <input value={staffForm.manager_name} onChange={(event) => setStaffForm((current) => ({ ...current, manager_name: event.target.value }))} />
                    </label>
                    <label className="span-full">
                      {t.common.bio}
                      <textarea rows={3} value={staffForm.bio} onChange={(event) => setStaffForm((current) => ({ ...current, bio: event.target.value }))} />
                    </label>
                    <div className="button-row end span-full"><button type="submit">{editingStaffId ? t.profile.saveStaffMember : t.profile.createStaffMember}</button></div>
                  </form>
                </section>

                <section className="panel">
                  <div className="section-head wrap-row">
                    <div>
                      <h3>{t.profile.personnel}</h3>
                      <p className="muted small">{interpolate(t.profile.personnelSummary, { active: activeStaff, total: staff.length })}</p>
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
                          <span className={`status-badge status-${person.status}`}>{translateStatus(person.status, t)}</span>
                        </div>
                        <div className="staff-meta">
                          <div><span className="muted small">{t.common.role}</span><strong>{translateRole(person.role, t)}</strong></div>
                          <div><span className="muted small">{t.common.title}</span><strong>{person.title}</strong></div>
                          <div><span className="muted small">{t.common.department}</span><strong>{person.department}</strong></div>
                          <div><span className="muted small">{t.common.hierarchy}</span><strong>{translateHierarchy(person.hierarchy_level, t)}</strong></div>
                        </div>
                        <p className="muted small">{interpolate(t.profile.managerLabel, { manager: person.manager_name || t.common.noManager })}</p>
                        <div className="card-actions"><button className="secondary compact" type="button" onClick={() => startEditStaff(person)}>{t.products.edit}</button></div>
                      </article>
                    ))}
                  </div>
                </section>
              </>
            ) : null}
          </section>
        ) : null}

        {tab === 'settings' ? (
          <section className="stack-xl">
            <section className="panel settings-shell">
              <div className="settings-hero">
                <div className="avatar-circle large">{getInitials(user.name)}</div>
                <div>
                  <span className="eyebrow">{t.nav.settings.label}</span>
                  <h3>{t.settings.title}</h3>
                  <p className="muted small">{t.settings.subtitle}</p>
                </div>
              </div>
              <div className="settings-nav">
                {settingsSections.map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    className={settingsSection === section.id ? 'pill active' : 'pill'}
                    onClick={() => setSettingsSection(section.id)}
                  >
                    {section.label}
                  </button>
                ))}
              </div>
            </section>

            {settingsSection === 'appearance' ? (
              <div className="split-grid profile-grid">
                <section className="panel">
                  <div className="section-head">
                    <div>
                      <h3>{appearanceCopy.title}</h3>
                      <p className="muted small">{appearanceCopy.description}</p>
                    </div>
                  </div>
                  <div className="stack">
                    <div>
                      <span className="muted small section-label">{appearanceCopy.title}</span>
                      <div className="choice-grid">
                        <button type="button" className={themeMode === 'light' ? 'choice-card active' : 'choice-card'} onClick={() => handleThemeChange('light')}>
                          <strong>{appearanceCopy.light}</strong>
                        </button>
                        <button type="button" className={themeMode === 'dark' ? 'choice-card active' : 'choice-card'} onClick={() => handleThemeChange('dark')}>
                          <strong>{appearanceCopy.dark}</strong>
                        </button>
                      </div>
                    </div>

                    <div>
                      <span className="muted small section-label">{appearanceCopy.accentTitle}</span>
                      <p className="muted small">{appearanceCopy.accentDescription}</p>
                      <div className="choice-grid accents">
                        {accentOptions.map((option) => (
                          <button key={option.value} type="button" className={accentScheme === option.value ? 'choice-card active accent-choice' : 'choice-card accent-choice'} onClick={() => handleAccentChange(option.value)}>
                            <span className={`accent-dot accent-${option.value}`} />
                            <strong>{option.label}</strong>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>

                <section className="panel">
                  <div className="section-head">
                    <h3>{t.profile.accountSummary}</h3>
                  </div>
                  <div className="profile-summary">
                    <div className="summary-row"><span>{t.common.language}</span><strong>{languageOptions.find((option) => option.value === language)?.nativeLabel}</strong></div>
                    <div className="summary-row"><span>{appearanceCopy.title}</span><strong>{themeMode === 'dark' ? appearanceCopy.dark : appearanceCopy.light}</strong></div>
                    <div className="summary-row"><span>{appearanceCopy.accentTitle}</span><strong>{accentOptions.find((option) => option.value === accentScheme)?.label}</strong></div>
                    <div className="summary-row"><span>{t.common.role}</span><strong>{translateRole(user.role, t)}</strong></div>
                    <div className="summary-row"><span>{t.common.department}</span><strong>{user.department}</strong></div>
                    <div className="summary-row"><span>{t.common.updated}</span><strong>{formatDate(user.updated_at, locale)}</strong></div>
                  </div>
                </section>
              </div>
            ) : null}

            {settingsSection === 'language' ? (
              <div className="split-grid profile-grid">
                <section className="panel">
                  <div className="section-head">
                    <div>
                      <h3>{t.settings.languageSectionTitle}</h3>
                      <p className="muted small">{t.settings.languageSectionDescription}</p>
                    </div>
                  </div>

                  <div className="stack">
                    <div className="language-switch-row wrap-row">
                      {languageOptions.map((option) => (
                        <button
                          key={option.value}
                          className={language === option.value ? 'pill active' : 'pill'}
                          type="button"
                          onClick={() => handleLanguageChange(option.value)}
                        >
                          {option.nativeLabel}
                        </button>
                      ))}
                    </div>

                    <div className="callout small-callout">
                      <strong>{t.settings.currentLanguage}</strong>
                      <p>{languageOptions.find((option) => option.value === language)?.nativeLabel}</p>
                      <p className="muted small">{t.settings.persistenceNote}</p>
                    </div>
                  </div>
                </section>

                <section className="panel">
                  <div className="section-head">
                    <h3>{t.settings.previewTitle}</h3>
                  </div>
                  <div className="profile-summary">
                    <div className="summary-row"><span>{t.nav.dashboard.label}</span><strong>{t.dashboard.metrics.products.label}</strong></div>
                    <div className="summary-row"><span>{t.nav.products.label}</span><strong>{t.products.createProductButton}</strong></div>
                    <div className="summary-row"><span>{t.nav.sales.label}</span><strong>{t.sales.createSaleButton}</strong></div>
                    <div className="summary-row"><span>{t.nav.movements.label}</span><strong>{t.movements.saveMovement}</strong></div>
                  </div>
                  <p className="muted small">{t.settings.previewDescription}</p>
                </section>
              </div>
            ) : null}

            {settingsSection === 'account' ? (
              <div className="split-grid profile-grid">
                <section className="panel">
                  <div className="section-head">
                    <div>
                      <h3>{t.profile.myProfile}</h3>
                      <p className="muted small">{t.profile.myProfileDescription}</p>
                    </div>
                    <span className={`status-badge status-${user.status}`}>{translateStatus(user.status, t)}</span>
                  </div>
                  <form className="form-grid" onSubmit={handleSaveProfile}>
                    <label>
                      {t.profile.fullName}
                      <input value={profileForm.name} onChange={(event) => setProfileForm((current) => ({ ...current, name: event.target.value }))} required />
                    </label>
                    <label>
                      {t.common.email}
                      <input type="email" value={profileForm.email} onChange={(event) => setProfileForm((current) => ({ ...current, email: event.target.value }))} required />
                    </label>
                    <label>
                      {t.common.phone}
                      <input value={profileForm.phone} onChange={(event) => setProfileForm((current) => ({ ...current, phone: event.target.value }))} />
                    </label>
                    <label>
                      {t.common.department}
                      <input value={profileForm.department} onChange={(event) => setProfileForm((current) => ({ ...current, department: event.target.value }))} required />
                    </label>
                    <label className="span-two">
                      {t.common.title}
                      <input value={profileForm.title} onChange={(event) => setProfileForm((current) => ({ ...current, title: event.target.value }))} required />
                    </label>
                    <label className="span-full">
                      {t.common.bio}
                      <textarea rows={4} value={profileForm.bio} onChange={(event) => setProfileForm((current) => ({ ...current, bio: event.target.value }))} />
                    </label>
                    <div className="button-row end span-full"><button type="submit">{t.profile.saveProfile}</button></div>
                  </form>
                </section>

                <section className="panel">
                  <div className="section-head">
                    <h3>{t.profile.accountSummary}</h3>
                  </div>
                  <div className="profile-summary">
                    <div className="summary-row"><span>{t.common.role}</span><strong>{translateRole(user.role, t)}</strong></div>
                    <div className="summary-row"><span>{t.common.title}</span><strong>{user.title}</strong></div>
                    <div className="summary-row"><span>{t.common.department}</span><strong>{user.department}</strong></div>
                    <div className="summary-row"><span>{t.common.hierarchy}</span><strong>{translateHierarchy(user.hierarchy_level, t)}</strong></div>
                    <div className="summary-row"><span>{t.common.manager}</span><strong>{user.manager_name || t.common.noManager}</strong></div>
                    <div className="summary-row"><span>{t.common.updated}</span><strong>{formatDate(user.updated_at, locale)}</strong></div>
                  </div>
                </section>
              </div>
            ) : null}

            {settingsSection === 'team' && user.role === 'admin' ? (
              <>
                <section className="panel">
                  <div className="section-head">
                    <div>
                      <h3>{editingStaffId ? t.profile.editStaffMember : t.profile.addStaffMember}</h3>
                      <p className="muted small">{t.profile.staffDescription}</p>
                    </div>
                    {editingStaffId ? <button className="ghost compact" type="button" onClick={resetStaffForm}>{t.common.cancelEdit}</button> : null}
                  </div>
                  <form className="form-grid" onSubmit={handleSaveStaff}>
                    <label>
                      {t.profile.fullName}
                      <input value={staffForm.name} onChange={(event) => setStaffForm((current) => ({ ...current, name: event.target.value }))} required />
                    </label>
                    <label>
                      {t.common.email}
                      <input type="email" value={staffForm.email} onChange={(event) => setStaffForm((current) => ({ ...current, email: event.target.value }))} required />
                    </label>
                    {!editingStaffId ? (
                      <label>
                        {t.profile.temporaryPassword}
                        <input type="password" value={staffForm.password} onChange={(event) => setStaffForm((current) => ({ ...current, password: event.target.value }))} required />
                      </label>
                    ) : null}
                    <label>
                      {t.common.role}
                      <select value={staffForm.role} onChange={(event) => setStaffForm((current) => ({ ...current, role: event.target.value as User['role'] }))}>
                        <option value="employee">{t.common.employee}</option>
                        <option value="admin">{t.common.admin}</option>
                      </select>
                    </label>
                    <label>
                      {t.common.status}
                      <select value={staffForm.status} onChange={(event) => setStaffForm((current) => ({ ...current, status: event.target.value as StaffStatus }))}>
                        <option value="active">{t.common.active}</option>
                        <option value="on_leave">{t.common.onLeave}</option>
                        <option value="inactive">{t.common.inactive}</option>
                      </select>
                    </label>
                    <label>
                      {t.common.hierarchy}
                      <select value={staffForm.hierarchy_level} onChange={(event) => setStaffForm((current) => ({ ...current, hierarchy_level: event.target.value as StaffLevel }))}>
                        <option value="staff">{t.common.staff}</option>
                        <option value="lead">{t.common.lead}</option>
                        <option value="management">{t.common.management}</option>
                      </select>
                    </label>
                    <label>
                      {t.common.phone}
                      <input value={staffForm.phone} onChange={(event) => setStaffForm((current) => ({ ...current, phone: event.target.value }))} />
                    </label>
                    <label>
                      {t.common.department}
                      <input value={staffForm.department} onChange={(event) => setStaffForm((current) => ({ ...current, department: event.target.value }))} required />
                    </label>
                    <label>
                      {t.common.title}
                      <input value={staffForm.title} onChange={(event) => setStaffForm((current) => ({ ...current, title: event.target.value }))} required />
                    </label>
                    <label>
                      {t.common.manager}
                      <input value={staffForm.manager_name} onChange={(event) => setStaffForm((current) => ({ ...current, manager_name: event.target.value }))} />
                    </label>
                    <label className="span-full">
                      {t.common.bio}
                      <textarea rows={3} value={staffForm.bio} onChange={(event) => setStaffForm((current) => ({ ...current, bio: event.target.value }))} />
                    </label>
                    <div className="button-row end span-full"><button type="submit">{editingStaffId ? t.profile.saveStaffMember : t.profile.createStaffMember}</button></div>
                  </form>
                </section>

                <section className="panel">
                  <div className="section-head wrap-row">
                    <div>
                      <h3>{t.profile.personnel}</h3>
                      <p className="muted small">{interpolate(t.profile.personnelSummary, { active: activeStaff, total: staff.length })}</p>
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
                          <span className={`status-badge status-${person.status}`}>{translateStatus(person.status, t)}</span>
                        </div>
                        <div className="staff-meta">
                          <div><span className="muted small">{t.common.role}</span><strong>{translateRole(person.role, t)}</strong></div>
                          <div><span className="muted small">{t.common.title}</span><strong>{person.title}</strong></div>
                          <div><span className="muted small">{t.common.department}</span><strong>{person.department}</strong></div>
                          <div><span className="muted small">{t.common.hierarchy}</span><strong>{translateHierarchy(person.hierarchy_level, t)}</strong></div>
                        </div>
                        <p className="muted small">{interpolate(t.profile.managerLabel, { manager: person.manager_name || t.common.noManager })}</p>
                        <div className="card-actions"><button className="secondary compact" type="button" onClick={() => startEditStaff(person)}>{t.products.edit}</button></div>
                      </article>
                    ))}
                  </div>
                </section>
              </>
            ) : null}

            {settingsSection === 'logs' ? (
              <section className="panel">
                <div className="section-head wrap-row">
                  <div>
                    <h3>{t.logs.title}</h3>
                    <p className="muted small">{t.logs.description}</p>
                  </div>
                  <div className="control-row wrap">
                    <input className="search" placeholder={t.logs.searchPlaceholder} value={logSearch} onChange={(event) => setLogSearch(event.target.value)} />
                    <div className="filter-pills">
                      {(['all', 'info', 'warning', 'error'] as LogFilter[]).map((item) => (
                        <button key={item} className={logFilter === item ? 'pill active' : 'pill'} type="button" onClick={() => setLogFilter(item)}>{item === 'all' ? t.common.all : translateLogLevel(item, t)}</button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="log-grid">
                  {filteredLogs.map((entry) => (
                    <article className="log-card" key={entry.id}>
                      <div className="log-head">
                        <div className="log-badges">
                          <span className={`tag tag-${entry.level}`}>{translateLogLevel(entry.level, t)}</span>
                          <span className="tag">{humanizeAction(entry.action, t)}</span>
                        </div>
                        <span className="muted small">{formatDate(entry.created_at, locale)}</span>
                      </div>
                      <strong>{translateBackendMessage(entry.message, t)}</strong>
                      <p className="muted small">{entry.created_by_name} · {entry.entity_type || t.logs.system}{entry.entity_id ? ` #${entry.entity_id}` : ''}</p>
                      <p>{detailsToText(entry.details, t)}</p>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {settingsSection === 'help' ? (
              <div className="docs-grid">
                {helpSections.map((section) => (
                  <article className="panel" key={section.title}>
                    <h3>{section.title}</h3>
                    <ul className="doc-list">
                      {section.items.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </article>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        {tab === 'docs' ? (
          <section className="stack-xl">
            <section className="panel compact-hero">
              <div>
                <span className="eyebrow">{t.docs.titleEyebrow}</span>
                <h3>{t.docs.title}</h3>
                <p className="muted small">{t.docs.description}</p>
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
        <Modal
          title={interpolate(t.sales.saleDetailsTitle, { id: selectedSale.id })}
          subtitle={`${selectedSale.created_by_name} · ${formatDate(selectedSale.created_at, locale)}`}
          onClose={() => setSelectedSale(null)}
          closeLabel={t.common.close}
        >
          <div className="details-card-grid">
            <div className="summary-row"><span>{t.sales.totalAmount}</span><strong>{currency(selectedSale.total_amount, locale)}</strong></div>
            <div className="summary-row"><span>{t.common.items}</span><strong>{selectedSale.items.length}</strong></div>
          </div>
          <div className="stack-sm">
            {selectedSale.items.map((item) => (
              <div className="detail-line" key={`${selectedSale.id}-${item.product_id}`}>
                <div className="min-w-0">
                  <strong>{item.product_name}</strong>
                  <div className="muted small">{item.sku}</div>
                </div>
                <div className="align-right">
                  <div>{item.quantity} × {currency(item.unit_price, locale)}</div>
                  <strong>{currency(item.quantity * item.unit_price, locale)}</strong>
                </div>
              </div>
            ))}
          </div>
        </Modal>
      ) : null}

      {selectedMovement ? (
        <Modal
          title={interpolate(t.movements.movementDetailsTitle, { id: selectedMovement.id })}
          subtitle={`${selectedMovement.created_by_name} · ${formatDate(selectedMovement.created_at, locale)}`}
          onClose={() => setSelectedMovement(null)}
          closeLabel={t.common.close}
        >
          <div className="details-card-grid">
            <div className="summary-row"><span>{t.common.type}</span><strong>{translateMovementType(selectedMovement.movement_type, t)}</strong></div>
            <div className="summary-row"><span>{t.common.quantity}</span><strong>{selectedMovement.quantity}</strong></div>
            <div className="summary-row"><span>{t.common.product}</span><strong>{selectedMovement.product_name}</strong></div>
            <div className="summary-row"><span>SKU</span><strong>{selectedMovement.sku}</strong></div>
          </div>
          <div className="callout small-callout">
            <strong>{t.movements.note}</strong>
            <p>{selectedMovement.note || t.common.noNoteProvided}</p>
          </div>
        </Modal>
      ) : null}

      {isProductModalOpen && user?.role === 'admin' ? (
        <Modal
          title={editingProductId ? t.products.editProduct : t.products.createProduct}
          subtitle={editingProductId ? t.products.editModalSubtitle : t.products.createModalSubtitle}
          onClose={resetProductForm}
          closeLabel={t.common.close}
        >
          <form className="form-grid modal-form-grid" onSubmit={handleSubmitProduct}>
            <label>
              {t.common.name}
              <input value={productForm.name} onChange={(event) => setProductForm((current) => ({ ...current, name: event.target.value }))} required />
            </label>
            <label>
              SKU
              <input value={productForm.sku} onChange={(event) => setProductForm((current) => ({ ...current, sku: event.target.value.toUpperCase() }))} required />
            </label>
            <label>
              {t.products.price}
              <input type="number" min="0" step="0.01" value={productForm.price} onChange={(event) => setProductForm((current) => ({ ...current, price: event.target.value }))} required />
            </label>
            {!editingProductId ? (
              <label>
                {t.products.initialStock}
                <input type="number" min="0" value={productForm.stock} onChange={(event) => setProductForm((current) => ({ ...current, stock: event.target.value }))} required />
              </label>
            ) : (
              <div className="callout small-callout">
                <strong>{t.products.stockChangesHandled}</strong>
                <p className="muted small">{t.products.stockChangesDescription}</p>
              </div>
            )}
            <label>
              {t.products.minStock}
              <input type="number" min="0" value={productForm.min_stock} onChange={(event) => setProductForm((current) => ({ ...current, min_stock: event.target.value }))} required />
            </label>
            <div className="button-row end span-full modal-actions">
              <button className="ghost" type="button" onClick={resetProductForm}>{t.common.cancel}</button>
              <button type="submit">{editingProductId ? t.products.saveChanges : t.products.createProductButton}</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {productPendingDelete ? (
        <Modal
          title={t.products.deleteTitle}
          subtitle={interpolate(t.products.deleteSubtitle, { name: productPendingDelete.name })}
          onClose={() => setProductPendingDelete(null)}
          closeLabel={t.common.close}
        >
          <div className="stack">
            <div className="details-card-grid">
              <div className="callout small-callout"><span className="muted small">{t.common.product}</span><strong>{productPendingDelete.name}</strong></div>
              <div className="callout small-callout"><span className="muted small">SKU</span><strong>{productPendingDelete.sku}</strong></div>
              <div className="callout small-callout"><span className="muted small">{t.products.stock}</span><strong>{productPendingDelete.stock}</strong></div>
              <div className="callout small-callout"><span className="muted small">{t.common.updated}</span><strong>{formatDate(productPendingDelete.updated_at, locale)}</strong></div>
            </div>
            <div className="button-row end modal-actions">
              <button className="ghost" type="button" onClick={() => setProductPendingDelete(null)}>{t.common.cancel}</button>
              <button className="ghost danger" type="button" onClick={() => void handleDeleteProduct(productPendingDelete)}>{t.products.delete}</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

export default App
