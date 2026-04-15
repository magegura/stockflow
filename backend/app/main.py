import os
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth import get_current_user, require_roles
from .db import Product, Sale, SaleItem, StockMovement, User, get_db, init_db, now_utc, to_iso
from .security import create_access_token, verify_password


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="StockFlow API",
    version="2.0.0",
    description="Portfolio-ready inventory and sales backend with auth, roles and business workflows.",
    lifespan=lifespan,
)


def get_cors_origins() -> list[str]:
    raw = os.getenv("CORS_ORIGINS", "*")
    origins = [value.strip() for value in raw.split(",") if value.strip()]
    return origins or ["*"]


cors_origins = get_cors_origins()
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=100)


class ProductCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    sku: str = Field(min_length=2, max_length=50)
    price: float = Field(ge=0)
    stock: int = Field(ge=0, default=0)
    min_stock: int = Field(ge=0, default=0)


class ProductUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    sku: str = Field(min_length=2, max_length=50)
    price: float = Field(ge=0)
    min_stock: int = Field(ge=0, default=0)


class MovementCreate(BaseModel):
    product_id: int
    movement_type: Literal["purchase", "writeoff", "adjustment"]
    quantity: int = Field(gt=0)
    note: str | None = Field(default=None, max_length=255)


class SaleItemInput(BaseModel):
    product_id: int
    quantity: int = Field(gt=0)
    unit_price: float | None = Field(default=None, ge=0)


class SaleCreate(BaseModel):
    items: list[SaleItemInput] = Field(min_length=1)


@app.get("/api/health")
def health(db: Session = Depends(get_db)) -> dict[str, str]:
    db.execute(text("SELECT 1"))
    return {"status": "ok"}


@app.post("/api/auth/login")
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> dict:
    row = db.scalar(select(User).where(User.email == payload.email.lower()))
    if not row or not verify_password(payload.password, row.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    user = {
        "id": row.id,
        "name": row.name,
        "email": row.email,
        "role": row.role,
        "created_at": to_iso(row.created_at),
    }
    token = create_access_token({"user_id": row.id, "role": row.role})
    return {"access_token": token, "user": user}


@app.get("/api/me")
def me(user: dict = Depends(get_current_user)) -> dict:
    return user


@app.get("/api/dashboard")
def dashboard(db: Session = Depends(get_db), user: dict = Depends(get_current_user)) -> dict:
    total_products = db.scalar(select(func.count(Product.id))) or 0
    low_stock = db.scalar(select(func.count(Product.id)).where(Product.stock <= Product.min_stock)) or 0
    out_of_stock = db.scalar(select(func.count(Product.id)).where(Product.stock == 0)) or 0
    total_sales = db.scalar(select(func.count(Sale.id))) or 0
    revenue = db.scalar(select(func.coalesce(func.sum(Sale.total_amount), 0))) or 0
    stock_value = db.scalar(select(func.coalesce(func.sum(Product.stock * Product.price), 0))) or 0

    recent_sales = db.execute(
        select(Sale, User.name.label("created_by_name"))
        .join(User, User.id == Sale.created_by)
        .order_by(Sale.id.desc())
        .limit(5)
    ).all()

    low_stock_products = db.execute(
        select(Product.id, Product.name, Product.sku, Product.stock, Product.min_stock)
        .where(Product.stock <= Product.min_stock)
        .order_by(Product.stock.asc(), Product.id.desc())
        .limit(5)
    ).all()

    top_products = db.execute(
        select(
            Product.id,
            Product.name,
            Product.sku,
            func.sum(SaleItem.quantity).label("quantity_sold"),
            func.round(func.sum(SaleItem.quantity * SaleItem.unit_price), 2).label("revenue"),
        )
        .join(SaleItem, SaleItem.product_id == Product.id)
        .group_by(Product.id, Product.name, Product.sku)
        .order_by(text("quantity_sold DESC"), text("revenue DESC"))
        .limit(5)
    ).all()

    revenue_by_day = db.execute(
        select(
            func.date(Sale.created_at).label("day"),
            func.round(func.sum(Sale.total_amount), 2).label("revenue"),
        )
        .group_by(func.date(Sale.created_at))
        .order_by(text("day ASC"))
        .limit(7)
    ).all()

    return {
        "total_products": total_products,
        "low_stock_count": low_stock,
        "out_of_stock_count": out_of_stock,
        "total_sales_count": total_sales,
        "revenue": float(revenue),
        "stock_value": float(stock_value),
        "recent_sales": [
            {
                "id": sale.id,
                "total_amount": float(sale.total_amount),
                "created_at": to_iso(sale.created_at),
                "created_by_name": created_by_name,
            }
            for sale, created_by_name in recent_sales
        ],
        "low_stock_products": [dict(row._mapping) for row in low_stock_products],
        "top_products": [
            {
                "id": row.id,
                "name": row.name,
                "sku": row.sku,
                "quantity_sold": int(row.quantity_sold or 0),
                "revenue": float(row.revenue or 0),
            }
            for row in top_products
        ],
        "revenue_by_day": [
            {"day": str(row.day), "revenue": float(row.revenue or 0)} for row in revenue_by_day
        ],
        "viewer": user,
    }


@app.get("/api/products")
def list_products(
    search: str = "",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    offset = (page - 1) * page_size
    term = f"%{search.strip().lower()}%"
    filters = or_(func.lower(Product.name).like(term), func.lower(Product.sku).like(term))

    total = db.scalar(select(func.count(Product.id)).where(filters)) or 0
    rows = db.scalars(
        select(Product)
        .where(filters)
        .order_by(Product.stock.asc(), Product.id.desc())
        .offset(offset)
        .limit(page_size)
    ).all()

    return {
        "items": [
            {
                "id": row.id,
                "name": row.name,
                "sku": row.sku,
                "price": float(row.price),
                "stock": row.stock,
                "min_stock": row.min_stock,
                "created_at": to_iso(row.created_at),
                "updated_at": to_iso(row.updated_at),
            }
            for row in rows
        ],
        "page": page,
        "page_size": page_size,
        "total": total,
    }


@app.post("/api/products")
def create_product(
    payload: ProductCreate,
    db: Session = Depends(get_db),
    user: dict = Depends(require_roles("admin")),
) -> dict:
    timestamp = now_utc()
    product = Product(
        name=payload.name.strip(),
        sku=payload.sku.strip().upper(),
        price=payload.price,
        stock=payload.stock,
        min_stock=payload.min_stock,
        created_at=timestamp,
        updated_at=timestamp,
    )
    db.add(product)
    try:
        db.flush()
        if payload.stock > 0:
            db.add(
                StockMovement(
                    product_id=product.id,
                    movement_type="purchase",
                    quantity=payload.stock,
                    note="Initial stock from product creation",
                    created_by=user["id"],
                    created_at=timestamp,
                )
            )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail="SKU must be unique") from exc

    return {"message": "Product created", "product_id": product.id}


@app.put("/api/products/{product_id}")
def update_product(
    product_id: int,
    payload: ProductUpdate,
    db: Session = Depends(get_db),
    user: dict = Depends(require_roles("admin")),
) -> dict:
    timestamp = now_utc()
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    product.name = payload.name.strip()
    product.sku = payload.sku.strip().upper()
    product.price = payload.price
    product.min_stock = payload.min_stock
    product.updated_at = timestamp

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail="SKU must be unique") from exc

    return {"message": "Product updated"}


@app.delete("/api/products/{product_id}")
def delete_product(
    product_id: int,
    db: Session = Depends(get_db),
    user: dict = Depends(require_roles("admin")),
) -> dict:
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    has_sales = db.scalar(select(func.count(SaleItem.id)).where(SaleItem.product_id == product_id)) or 0
    if has_sales:
        raise HTTPException(
            status_code=400,
            detail="Product cannot be deleted because it already has sales history",
        )

    db.delete(product)
    db.commit()
    return {"message": "Product deleted"}


@app.post("/api/stock-movements")
def create_stock_movement(
    payload: MovementCreate,
    db: Session = Depends(get_db),
    user: dict = Depends(require_roles("admin", "employee")),
) -> dict:
    timestamp = now_utc()
    product = db.get(Product, payload.product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    delta = payload.quantity if payload.movement_type in {"purchase", "adjustment"} else -payload.quantity
    new_stock = product.stock + delta
    if new_stock < 0:
        raise HTTPException(status_code=400, detail="Not enough stock")

    product.stock = new_stock
    product.updated_at = timestamp
    db.add(
        StockMovement(
            product_id=payload.product_id,
            movement_type=payload.movement_type,
            quantity=payload.quantity,
            note=payload.note,
            created_by=user["id"],
            created_at=timestamp,
        )
    )
    db.commit()

    return {"message": "Stock movement created", "new_stock": new_stock}


@app.get("/api/stock-movements")
def list_stock_movements(
    product_id: int | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    offset = (page - 1) * page_size
    base_query = (
        select(
            StockMovement.id,
            StockMovement.product_id,
            Product.name.label("product_name"),
            Product.sku,
            StockMovement.movement_type,
            StockMovement.quantity,
            StockMovement.note,
            StockMovement.created_at,
            User.name.label("created_by_name"),
        )
        .join(Product, Product.id == StockMovement.product_id)
        .join(User, User.id == StockMovement.created_by)
    )
    count_query = select(func.count(StockMovement.id))
    if product_id is not None:
        base_query = base_query.where(StockMovement.product_id == product_id)
        count_query = count_query.where(StockMovement.product_id == product_id)

    total = db.scalar(count_query) or 0
    rows = db.execute(
        base_query.order_by(StockMovement.id.desc()).offset(offset).limit(page_size)
    ).all()

    return {
        "items": [
            {
                "id": row.id,
                "product_id": row.product_id,
                "product_name": row.product_name,
                "sku": row.sku,
                "movement_type": row.movement_type,
                "quantity": row.quantity,
                "note": row.note,
                "created_at": to_iso(row.created_at),
                "created_by_name": row.created_by_name,
            }
            for row in rows
        ],
        "page": page,
        "page_size": page_size,
        "total": total,
    }


@app.post("/api/sales")
def create_sale(
    payload: SaleCreate,
    db: Session = Depends(get_db),
    user: dict = Depends(require_roles("admin", "employee")),
) -> dict:
    timestamp = now_utc()
    product_ids = [item.product_id for item in payload.items]
    if len(product_ids) != len(set(product_ids)):
        raise HTTPException(status_code=400, detail="Duplicate products in one sale are not allowed")

    prepared_items: list[dict] = []
    total_amount = 0.0

    for item in payload.items:
        product = db.get(Product, item.product_id)
        if not product:
            raise HTTPException(status_code=404, detail=f"Product {item.product_id} not found")
        if product.stock < item.quantity:
            raise HTTPException(status_code=400, detail=f"Not enough stock for {product.name}")

        unit_price = item.unit_price if item.unit_price is not None else product.price
        line_total = unit_price * item.quantity
        total_amount += line_total
        prepared_items.append(
            {
                "product": product,
                "quantity": item.quantity,
                "unit_price": unit_price,
            }
        )

    sale = Sale(total_amount=round(total_amount, 2), created_by=user["id"], created_at=timestamp)
    db.add(sale)
    db.flush()

    for item in prepared_items:
        product: Product = item["product"]
        product.stock -= item["quantity"]
        product.updated_at = timestamp
        db.add(
            SaleItem(
                sale_id=sale.id,
                product_id=product.id,
                quantity=item["quantity"],
                unit_price=item["unit_price"],
            )
        )
        db.add(
            StockMovement(
                product_id=product.id,
                movement_type="sale",
                quantity=item["quantity"],
                note=f"Sale #{sale.id}",
                created_by=user["id"],
                created_at=timestamp,
            )
        )

    db.commit()
    return {"message": "Sale created", "sale_id": sale.id, "total_amount": round(total_amount, 2)}


@app.get("/api/sales")
def list_sales(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    offset = (page - 1) * page_size
    total = db.scalar(select(func.count(Sale.id))) or 0
    sales_rows = db.execute(
        select(Sale, User.name.label("created_by_name"))
        .join(User, User.id == Sale.created_by)
        .order_by(Sale.id.desc())
        .offset(offset)
        .limit(page_size)
    ).all()

    sale_ids = [sale.id for sale, _ in sales_rows]
    items_by_sale: dict[int, list[dict]] = {}
    if sale_ids:
        item_rows = db.execute(
            select(
                SaleItem.sale_id,
                SaleItem.product_id,
                Product.name.label("product_name"),
                Product.sku,
                SaleItem.quantity,
                SaleItem.unit_price,
            )
            .join(Product, Product.id == SaleItem.product_id)
            .where(SaleItem.sale_id.in_(sale_ids))
            .order_by(SaleItem.id.asc())
        ).all()
        for row in item_rows:
            items_by_sale.setdefault(row.sale_id, []).append(
                {
                    "sale_id": row.sale_id,
                    "product_id": row.product_id,
                    "product_name": row.product_name,
                    "sku": row.sku,
                    "quantity": row.quantity,
                    "unit_price": float(row.unit_price),
                }
            )

    result = []
    for sale, created_by_name in sales_rows:
        result.append(
            {
                "id": sale.id,
                "total_amount": float(sale.total_amount),
                "created_at": to_iso(sale.created_at),
                "created_by_name": created_by_name,
                "items": items_by_sale.get(sale.id, []),
            }
        )

    return {"items": result, "page": page, "page_size": page_size, "total": total}
