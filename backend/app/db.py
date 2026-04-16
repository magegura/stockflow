import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, create_engine, event, func, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker

from .security import hash_password


DATA_DIR = Path(__file__).resolve().parents[1] / "data"
PORTFOLIO_MARKER_SKU = "NB-014"


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

    profile: Mapped["EmployeeProfile | None"] = relationship(back_populates="user", uselist=False)


class EmployeeProfile(Base):
    __tablename__ = "employee_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    department: Mapped[str] = mapped_column(String(80), nullable=False, default="Operations")
    title: Mapped[str] = mapped_column(String(120), nullable=False, default="Team Member")
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="active")
    hierarchy_level: Mapped[str] = mapped_column(String(40), nullable=False, default="staff")
    manager_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    user: Mapped[User] = relationship(back_populates="profile")


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


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    level: Mapped[str] = mapped_column(String(20), nullable=False, default="info")
    action: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    entity_type: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    entity_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    message: Mapped[str] = mapped_column(String(255), nullable=False)
    details_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)


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


def parse_details(value: str | None) -> dict[str, Any]:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def serialize_user_profile(user: User, profile: EmployeeProfile | None = None) -> dict[str, Any]:
    current = profile or user.profile
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "role": user.role,
        "created_at": to_iso(user.created_at),
        "phone": current.phone if current else None,
        "department": current.department if current else "Operations",
        "title": current.title if current else ("Administrator" if user.role == "admin" else "Team Member"),
        "status": current.status if current else "active",
        "hierarchy_level": current.hierarchy_level if current else ("management" if user.role == "admin" else "staff"),
        "manager_name": current.manager_name if current else None,
        "bio": current.bio if current else None,
        "updated_at": to_iso(current.updated_at) if current else to_iso(user.created_at),
    }


def create_audit_log(
    db: Session,
    *,
    action: str,
    message: str,
    level: str = "info",
    entity_type: str | None = None,
    entity_id: int | None = None,
    created_by: int | None = None,
    details: dict[str, Any] | None = None,
    created_at: datetime | None = None,
) -> AuditLog:
    row = AuditLog(
        level=level,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        message=message,
        details_json=json.dumps(details or {}, ensure_ascii=False),
        created_by=created_by,
        created_at=created_at or now_utc(),
    )
    db.add(row)
    return row


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
        ensure_portfolio_demo_data(db)
        ensure_org_demo_users(db)
        db.flush()
        ensure_user_profiles(db)
        db.commit()


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
        create_stock_movement_record(
            db,
            product=product,
            movement_type="purchase",
            quantity=product.stock,
            note="Initial seed stock",
            created_by=admin.id,
            created_at=created_at,
            apply_stock_delta=False,
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
        create_sale_record(db, created_at=sale_created_at, created_by=created_by, items=items)

    writeoff_at = datetime(2026, 4, 15, 9, 30, 0, tzinfo=timezone.utc)
    create_stock_movement_record(
        db,
        product=products[5],
        movement_type="writeoff",
        quantity=1,
        note="Damaged item during seed import",
        created_by=admin.id,
        created_at=writeoff_at,
    )

    create_audit_log(
        db,
        action="seed.initialized",
        message="Initial demo users, products and sample transactions created",
        entity_type="system",
        created_by=admin.id,
        created_at=created_at,
        details={"users": 2, "products": len(products), "sales": len(sales_seed)},
    )

    db.commit()


def ensure_org_demo_users(db: Session) -> bool:
    demo_people = [
        {
            "name": "Sofia Martinez",
            "email": "sofia.martinez@stockflow.app",
            "password": "Sofia123!",
            "role": "employee",
            "created_at": datetime(2026, 4, 12, 8, 0, 0, tzinfo=timezone.utc),
            "profile": {
                "phone": "+54 11 5555 0199",
                "department": "Warehouse",
                "title": "Warehouse Specialist",
                "status": "active",
                "hierarchy_level": "staff",
                "manager_name": "Admin",
                "bio": "Coordinates receiving, storage checks and replenishment readiness.",
            },
        },
        {
            "name": "Diego Alvarez",
            "email": "diego.alvarez@stockflow.app",
            "password": "Diego123!",
            "role": "employee",
            "created_at": datetime(2026, 4, 13, 8, 0, 0, tzinfo=timezone.utc),
            "profile": {
                "phone": "+54 11 5555 0144",
                "department": "Sales",
                "title": "Sales Associate",
                "status": "active",
                "hierarchy_level": "staff",
                "manager_name": "Admin",
                "bio": "Handles daily walk-in orders and customer-facing product recommendations.",
            },
        },
        {
            "name": "Laura Gomez",
            "email": "laura.gomez@stockflow.app",
            "password": "Laura123!",
            "role": "admin",
            "created_at": datetime(2026, 4, 14, 8, 0, 0, tzinfo=timezone.utc),
            "profile": {
                "phone": "+54 11 5555 0170",
                "department": "Operations",
                "title": "Operations Lead",
                "status": "active",
                "hierarchy_level": "management",
                "manager_name": "Board",
                "bio": "Oversees floor operations, reporting and SLA follow-through.",
            },
        },
    ]

    changed = False
    for item in demo_people:
        user = db.scalar(select(User).where(User.email == item["email"]))
        if user:
            continue
        user = User(
            name=item["name"],
            email=item["email"],
            password_hash=hash_password(item["password"]),
            role=item["role"],
            created_at=item["created_at"],
        )
        db.add(user)
        db.flush()
        profile = EmployeeProfile(
            user_id=user.id,
            phone=item["profile"]["phone"],
            department=item["profile"]["department"],
            title=item["profile"]["title"],
            status=item["profile"]["status"],
            hierarchy_level=item["profile"]["hierarchy_level"],
            manager_name=item["profile"]["manager_name"],
            bio=item["profile"]["bio"],
            updated_at=item["created_at"],
        )
        db.add(profile)
        create_audit_log(
            db,
            action="seed.user_created",
            message=f"Seeded staff member {user.name}",
            entity_type="user",
            entity_id=user.id,
            created_by=1,
            created_at=item["created_at"],
            details={"email": user.email, "role": user.role},
        )
        changed = True

    return changed


def ensure_user_profiles(db: Session) -> bool:
    changed = False
    users = db.scalars(select(User)).all()
    for user in users:
        profile = db.scalar(select(EmployeeProfile).where(EmployeeProfile.user_id == user.id))
        if profile:
            continue
        db.add(
            EmployeeProfile(
                user_id=user.id,
                phone=None,
                department="Operations" if user.role == "admin" else "Sales",
                title="Administrator" if user.role == "admin" else "Staff Member",
                status="active",
                hierarchy_level="management" if user.role == "admin" else "staff",
                manager_name="Board" if user.role == "admin" else "Admin",
                bio="Autogenerated profile to support portfolio-ready people management.",
                updated_at=user.created_at,
            )
        )
        changed = True
    return changed


def ensure_portfolio_demo_data(db: Session) -> bool:
    admin = db.scalar(select(User).where(User.email == "admin@stockflow.app"))
    employee = db.scalar(select(User).where(User.email == "employee@stockflow.app"))
    if not admin or not employee:
        return False

    already_enriched = db.scalar(select(Product.id).where(Product.sku == PORTFOLIO_MARKER_SKU))
    if already_enriched:
        return False

    created_at = datetime(2026, 4, 16, 9, 0, 0, tzinfo=timezone.utc)
    catalog = {product.sku: product for product in db.scalars(select(Product)).all()}

    extra_products = [
        {"name": "Noise Cancelling Headphones", "sku": "HD-007", "price": 129.0, "stock": 18, "min_stock": 4},
        {"name": '4K Monitor 27"', "sku": "MN-008", "price": 299.0, "stock": 7, "min_stock": 2},
        {"name": "Portable SSD 1TB", "sku": "PS-009", "price": 109.0, "stock": 14, "min_stock": 4},
        {"name": "Wireless Charger", "sku": "WC-010", "price": 34.0, "stock": 22, "min_stock": 6},
        {"name": "Ergonomic Chair", "sku": "EC-011", "price": 249.0, "stock": 5, "min_stock": 2},
        {"name": "USB Hub 7-in-1", "sku": "UH-012", "price": 49.0, "stock": 15, "min_stock": 5},
        {"name": "Conference Speaker", "sku": "CS-013", "price": 89.0, "stock": 6, "min_stock": 2},
        {"name": "Notebook Set", "sku": PORTFOLIO_MARKER_SKU, "price": 16.0, "stock": 40, "min_stock": 12},
    ]

    for item in extra_products:
        product = Product(
            name=item["name"],
            sku=item["sku"],
            price=item["price"],
            stock=item["stock"],
            min_stock=item["min_stock"],
            created_at=created_at,
            updated_at=created_at,
        )
        db.add(product)
        db.flush()
        catalog[product.sku] = product
        create_stock_movement_record(
            db,
            product=product,
            movement_type="purchase",
            quantity=item["stock"],
            note="Portfolio demo opening stock",
            created_by=admin.id,
            created_at=created_at,
            apply_stock_delta=False,
        )

    movement_plan = [
        ("DL-006", "purchase", 12, "Weekly supplier restock", admin.id, datetime(2026, 4, 16, 10, 0, 0, tzinfo=timezone.utc)),
        ("WM-001", "purchase", 8, "Top seller replenishment", admin.id, datetime(2026, 4, 16, 11, 0, 0, tzinfo=timezone.utc)),
        ("WC-005", "adjustment", 2, "Cycle count correction after shelf audit", employee.id, datetime(2026, 4, 17, 9, 20, 0, tzinfo=timezone.utc)),
        ("MK-002", "writeoff", 1, "Returned damaged unit", admin.id, datetime(2026, 4, 17, 16, 45, 0, tzinfo=timezone.utc)),
        ("MN-008", "purchase", 3, "Display order received from supplier", admin.id, datetime(2026, 4, 18, 9, 5, 0, tzinfo=timezone.utc)),
        ("CS-013", "adjustment", 1, "Manual recount before showroom refresh", employee.id, datetime(2026, 4, 18, 14, 10, 0, tzinfo=timezone.utc)),
    ]

    for sku, movement_type, quantity, note, created_by, movement_at in movement_plan:
        create_stock_movement_record(
            db,
            product=catalog[sku],
            movement_type=movement_type,
            quantity=quantity,
            note=note,
            created_by=created_by,
            created_at=movement_at,
        )

    sales_plan = [
        (datetime(2026, 4, 16, 13, 15, 0, tzinfo=timezone.utc), employee.id, [(catalog["WM-001"], 2), (catalog["UH-012"], 2), (catalog[PORTFOLIO_MARKER_SKU], 5)]),
        (datetime(2026, 4, 17, 12, 5, 0, tzinfo=timezone.utc), admin.id, [(catalog["HD-007"], 1), (catalog["PS-009"], 2), (catalog["WC-010"], 3)]),
        (datetime(2026, 4, 18, 17, 30, 0, tzinfo=timezone.utc), employee.id, [(catalog["MN-008"], 1), (catalog["EC-011"], 1), (catalog["UH-012"], 1)]),
        (datetime(2026, 4, 19, 11, 40, 0, tzinfo=timezone.utc), admin.id, [(catalog["WC-005"], 1), (catalog["DL-006"], 2), (catalog[PORTFOLIO_MARKER_SKU], 6)]),
        (datetime(2026, 4, 20, 15, 10, 0, tzinfo=timezone.utc), employee.id, [(catalog["MK-002"], 1), (catalog["UC-003"], 4), (catalog["WC-010"], 2)]),
        (datetime(2026, 4, 21, 9, 50, 0, tzinfo=timezone.utc), employee.id, [(catalog["HD-007"], 2), (catalog["PS-009"], 1), (catalog[PORTFOLIO_MARKER_SKU], 4), (catalog["UH-012"], 3)]),
        (datetime(2026, 4, 22, 13, 35, 0, tzinfo=timezone.utc), admin.id, [(catalog["MN-008"], 2), (catalog["CS-013"], 1), (catalog["WM-001"], 3)]),
        (datetime(2026, 4, 23, 16, 25, 0, tzinfo=timezone.utc), employee.id, [(catalog["DL-006"], 3), (catalog["UC-003"], 5), (catalog["WC-010"], 4), (catalog[PORTFOLIO_MARKER_SKU], 8)]),
        (datetime(2026, 4, 24, 14, 45, 0, tzinfo=timezone.utc), admin.id, [(catalog["PS-009"], 2), (catalog["HD-007"], 1), (catalog["EC-011"], 1)]),
        (datetime(2026, 4, 25, 10, 10, 0, tzinfo=timezone.utc), employee.id, [(catalog["WM-001"], 2), (catalog["CS-013"], 2), (catalog["UH-012"], 2)]),
    ]

    for sale_created_at, created_by, items in sales_plan:
        create_sale_record(db, created_at=sale_created_at, created_by=created_by, items=items)

    create_audit_log(
        db,
        action="demo.enriched",
        message="Portfolio-grade demo dataset synchronized",
        entity_type="system",
        created_by=admin.id,
        created_at=created_at,
        details={"new_products": len(extra_products), "new_sales": len(sales_plan), "new_movements": len(movement_plan)},
    )

    db.commit()
    return True


def create_stock_movement_record(
    db: Session,
    *,
    product: Product,
    movement_type: str,
    quantity: int,
    note: str | None,
    created_by: int,
    created_at: datetime,
    apply_stock_delta: bool = True,
) -> None:
    if apply_stock_delta:
        delta = quantity if movement_type in {"purchase", "adjustment"} else -quantity
        product.stock = max(product.stock + delta, 0)
        product.updated_at = created_at

    db.add(
        StockMovement(
            product_id=product.id,
            movement_type=movement_type,
            quantity=quantity,
            note=note,
            created_by=created_by,
            created_at=created_at,
        )
    )


def create_sale_record(
    db: Session,
    *,
    created_at: datetime,
    created_by: int,
    items: list[tuple[Product, int]],
) -> Sale:
    total_amount = round(sum(product.price * quantity for product, quantity in items), 2)
    sale = Sale(total_amount=total_amount, created_by=created_by, created_at=created_at)
    db.add(sale)
    db.flush()

    for product, quantity in items:
        product.stock -= quantity
        product.updated_at = created_at
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
                created_at=created_at,
            )
        )

    return sale


__all__ = [
    "AuditLog",
    "EmployeeProfile",
    "Product",
    "Sale",
    "SaleItem",
    "SessionLocal",
    "StockMovement",
    "User",
    "create_audit_log",
    "ensure_org_demo_users",
    "ensure_portfolio_demo_data",
    "ensure_user_profiles",
    "get_db",
    "get_engine",
    "get_session_factory",
    "init_db",
    "now_utc",
    "parse_details",
    "serialize_user_profile",
    "to_iso",
]
