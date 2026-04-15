export type User = {
  id: number
  name: string
  email: string
  role: 'admin' | 'employee'
  created_at: string
}

export type Product = {
  id: number
  name: string
  sku: string
  price: number
  stock: number
  min_stock: number
  created_at: string
  updated_at: string
}

export type RevenuePoint = {
  day: string
  revenue: number
}

export type TopProduct = {
  id: number
  name: string
  sku: string
  quantity_sold: number
  revenue: number
}

export type LowStockProduct = {
  id: number
  name: string
  sku: string
  stock: number
  min_stock: number
}

export type Dashboard = {
  total_products: number
  low_stock_count: number
  out_of_stock_count: number
  total_sales_count: number
  revenue: number
  stock_value: number
  recent_sales: Array<{
    id: number
    total_amount: number
    created_at: string
    created_by_name: string
  }>
  low_stock_products: LowStockProduct[]
  top_products: TopProduct[]
  revenue_by_day: RevenuePoint[]
  viewer: User
}

export type Movement = {
  id: number
  product_id: number
  product_name: string
  sku: string
  movement_type: 'purchase' | 'writeoff' | 'adjustment' | 'sale'
  quantity: number
  note: string | null
  created_at: string
  created_by_name: string
}

export type SaleItem = {
  sale_id: number
  product_id: number
  product_name: string
  sku: string
  quantity: number
  unit_price: number
}

export type Sale = {
  id: number
  total_amount: number
  created_at: string
  created_by_name: string
  items: SaleItem[]
}
