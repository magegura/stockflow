import os
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, create_engine, event, func, select, text
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker

from .security import hash_password


DATA_DIR = Path(__file__).resolve().parents[1] / "data"


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    sku: Mapped[str] = mapped_column(String(50), nullable=False, unique=True, index=True)
    price: Mapped[float] = mapped_column(Float, nullable=False)
    stock: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    min_stock: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class StockMovement(Base):
    __tablename__ = "stock_movements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True)
    movement_type: Mapped[str] = mapped_column(String(20), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class Sale(Base):
    __tablename__ = "sales"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    total_amount: Mapped[float] = mapped_column(Float, nullable=False)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)

    items: Mapped[list["SaleItem"]] = relationship(back_populates="sale", cascade="all, delete-orphan")


class SaleItem(Base):
    __tablename__ = "sale_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sale_id: Mapped[int] = mapped_column(ForeignKey("sales.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="RESTRICT"), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_price: Mapped[float] = mapped_column(Float, nullable=False)

    sale: Mapped[Sale] = relationship(back_populates="items")


_engine = None
_SessionLocal = None


def get_database_url() -> str:
    direct_url = os.getenv("DATABASE_URL")
    if direct_url:
        if direct_url.startswith("postgres://"):
            return direct_url.replace("postgres://", "postgresql+psycopg://", 1)
        if direct_url.startswith("postgresql://") and "+psycopg" not in direct_url:
            return direct_url.replace("postgresql://", "postgresql+psycopg://", 1)
        return direct_url

    db_path = os.getenv("DATABASE_PATH", str(DATA_DIR / "stockflow.db"))
    return f"sqlite:///{Path(db_path).resolve()}"


def get_engine():
    global _engine
    if _engine is not None:
        return _engine

    database_url = get_database_url()
    connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
    _engine = create_engine(database_url, future=True, pool_pre_ping=True, connect_args=connect_args)

    if database_url.startswith("sqlite"):
        @event.listens_for(_engine, "connect")
        def _set_sqlite_pragma(dbapi_connection, _connection_record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    return _engine


def get_session_factory():
    global _SessionLocal
    if _SessionLocal is not None:
        return _SessionLocal
    _SessionLocal = sessionmaker(bind=get_engine(), autoflush=False, autocommit=False, future=True)
    return _SessionLocal


SessionLocal = get_session_factory()


def now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def to_iso(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def get_db():
    db = get_session_factory()()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    engine = get_engine()
    if engine.url.drivername.startswith("sqlite"):
        DATA_DIR.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)
    with get_session_factory()() as db:
        seed_db(db)


def seed_db(db: Session) -> None:
    user_exists = db.scalar(select(func.count(User.id)))
    if user_exists:
        return

    created_at = datetime(2026, 4, 9, 9, 0, 0, tzinfo=timezone.utc)

    admin = User(
        name="Admin",
        email="admin@stockflow.app",
        password_hash=hash_password("Admin123!"),
        role="admin",
        created_at=created_at,
    )
    employee = User(
        name="Employee",
        email="employee@stockflow.app",
        password_hash=hash_password("Employee123!"),
        role="employee",
        created_at=created_at,
    )
    db.add_all([admin, employee])
    db.flush()

    products = [
        Product(name="Wireless Mouse", sku="WM-001", price=25.0, stock=20, min_stock=5, created_at=created_at, updated_at=created_at),
        Product(name="Mechanical Keyboard", sku="MK-002", price=79.0, stock=8, min_stock=3, created_at=created_at, updated_at=created_at),
        Product(name="USB-C Cable", sku="UC-003", price=12.5, stock=35, min_stock=10, created_at=created_at, updated_at=created_at),
        Product(name="Laptop Stand", sku="LS-004", price=39.0, stock=10, min_stock=4, created_at=created_at, updated_at=created_at),
        Product(name="Webcam HD", sku="WC-005", price=59.0, stock=8, min_stock=4, created_at=created_at, updated_at=created_at),
        Product(name="Desk Lamp", sku="DL-006", price=45.0, stock=4, min_stock=2, created_at=created_at, updated_at=created_at),
    ]
    db.add_all(products)
    db.flush()

    for product in products:
        db.add(
            StockMovement(
                product_id=product.id,
                movement_type="purchase",
                quantity=product.stock,
                note="Initial seed stock",
                created_by=admin.id,
                created_at=created_at,
            )
        )

    sales_seed = [
        (datetime(2026, 4, 10, 10, 30, 0, tzinfo=timezone.utc), employee.id, [(products[0], 2), (products[2], 3)]),
        (datetime(2026, 4, 11, 12, 0, 0, tzinfo=timezone.utc), admin.id, [(products[1], 1), (products[4], 2)]),
        (datetime(2026, 4, 12, 15, 45, 0, tzinfo=timezone.utc), employee.id, [(products[0], 1), (products[3], 2), (products[2], 4)]),
        (datetime(2026, 4, 13, 11, 10, 0, tzinfo=timezone.utc), employee.id, [(products[4], 3), (products[5], 2)]),
        (datetime(2026, 4, 14, 16, 20, 0, tzinfo=timezone.utc), admin.id, [(products[1], 3), (products[2], 4), (products[3], 2)]),
        (datetime(2026, 4, 15, 9, 15, 0, tzinfo=timezone.utc), employee.id, [(products[0], 3), (products[5], 1)]),
    ]

    for sale_created_at, created_by, items in sales_seed:
        total_amount = round(sum(product.price * quantity for product, quantity in items), 2)
        sale = Sale(total_amount=total_amount, created_by=created_by, created_at=sale_created_at)
        db.add(sale)
        db.flush()

        for product, quantity in items:
            product.stock -= quantity
            product.updated_at = sale_created_at
            db.add(
                SaleItem(
                    sale_id=sale.id,
                    product_id=product.id,
                    quantity=quantity,
                    unit_price=product.price,
                )
            )
            db.add(
                StockMovement(
                    product_id=product.id,
                    movement_type="sale",
                    quantity=quantity,
                    note=f"Sale #{sale.id}",
                    created_by=created_by,
                    created_at=sale_created_at,
                )
            )

    writeoff_at = datetime(2026, 4, 15, 9, 30, 0, tzinfo=timezone.utc)
    products[5].stock = max(products[5].stock - 1, 0)
    products[5].updated_at = writeoff_at
    db.add(
        StockMovement(
            product_id=products[5].id,
            movement_type="writeoff",
            quantity=1,
            note="Damaged item during seed import",
            created_by=admin.id,
            created_at=writeoff_at,
        )
    )

    db.commit()


__all__ = [
    "Product",
    "Sale",
    "SaleItem",
    "SessionLocal",
    "StockMovement",
    "User",
    "get_db",
    "get_engine",
    "get_session_factory",
    "init_db",
    "now_utc",
    "to_iso",
]
