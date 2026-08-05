# Phase 1: Foundation Platform — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the monorepo skeleton with auth, user/label/batch management, and image list display — a functional web app where admins configure the workspace and annotators can see available images.

**Architecture:** FastAPI backend with SQLAlchemy + SQLite, React + TypeScript + Vite frontend with Zustand state management. REST API with JWT auth. File-system-based image storage under a configurable work directory.

**Tech Stack:** Python 3.11+, FastAPI, SQLAlchemy 2.0, Alembic, SQLite, Pydantic v2, bcrypt, PyJWT, Pillow, NumPy, ONNX Runtime (installed but not used in Phase 1), React 18, TypeScript 5, Vite 5, react-konva (installed but not used in Phase 1), Zustand, react-router-dom v6, CSS Modules

## Global Constraints

- All backend code lives under `backend/app/`, tests under `backend/app/tests/`
- All frontend code lives under `frontend/src/`, tests colocated in `__tests__/`
- Python: type hints on all function signatures; Pydantic v2 `model_validate` style
- TypeScript: strict mode; no `any` except in API client catch clauses
- Passwords hashed with bcrypt; JWT with HS256, 8-hour expiry
- SQLite database file stored at `<work_directory>/metadata.db` (path from settings)
- All API responses wrap in `{"data": ...}` on success, `{"error": "...", "detail": "..."}` on failure
- CSS Modules for all component styles; no global CSS except CSS custom properties in `index.css`
- Test files mirror source structure: `test_auth.py` tests `api/auth.py` and `services/` it uses
- Git commits after every task with conventional commit messages

---

## File Structure (entire project — Phase 1 scope in bold)

```
ling-auto-label/
├── backend/
│   ├── pyproject.toml
│   ├── alembic.ini
│   ├── alembic/
│   │   ├── env.py
│   │   └── versions/
│   └── app/
│       ├── __init__.py
│       ├── main.py                          # FastAPI app, CORS, router registration
│       ├── core/
│       │   ├── __init__.py
│       │   ├── config.py                    # Settings from env / settings table
│       │   ├── db.py                        # SQLAlchemy engine, session, Base
│       │   └── security.py                  # bcrypt hash/verify, JWT create/decode
│       ├── models/
│       │   ├── __init__.py                  # imports all models for Alembic
│       │   ├── user.py                      # User model
│       │   ├── setting.py                   # Setting model (key-value)
│       │   ├── label.py                     # Label model
│       │   ├── batch.py                     # Batch model
│       │   ├── image.py                     # Image model
│       │   ├── model_config.py              # ONNX model config (schema only in P1)
│       │   └── inference_job.py             # Inference job (schema only in P1)
│       ├── schemas/
│       │   ├── __init__.py
│       │   ├── auth.py                      # LoginRequest, TokenResponse
│       │   ├── user.py                      # UserCreate, UserUpdate, UserResponse
│       │   ├── setting.py                   # SettingUpdate
│       │   ├── label.py                     # LabelCreate, LabelUpdate, LabelResponse
│       │   ├── batch.py                     # BatchCreate, BatchResponse
│       │   ├── image.py                     # ImageResponse
│       │   └── common.py                    # PaginatedResponse, ErrorResponse
│       ├── api/
│       │   ├── __init__.py                  # router aggregation
│       │   ├── auth.py                      # POST /login, /register
│       │   ├── users.py                     # GET/POST /users, PUT /users/:id
│       │   ├── settings.py                  # GET/PUT /settings
│       │   ├── labels.py                    # CRUD /labels, POST /labels/import-txt
│       │   ├── batches.py                   # CRUD /batches, POST /batches/scan, /batches/:id/upload
│       │   └── images.py                    # GET /batches/:id/images, GET /images/:id
│       ├── services/
│       │   ├── __init__.py
│       │   ├── scanner.py                   # scan batches/*/images/, register images
│       │   └── image_processor.py           # validate format, convert >3 channels → RGB
│       └── tests/
│           ├── __init__.py
│           ├── conftest.py                  # test client, temp db, fixtures
│           ├── test_auth.py
│           ├── test_users.py
│           ├── test_settings.py
│           ├── test_labels.py
│           ├── test_batches.py
│           ├── test_scanner.py
│           └── test_image_processor.py
├── frontend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── tsconfig.node.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── index.css                         # CSS custom properties only
│       ├── api/
│       │   ├── client.ts                     # fetch wrapper with JWT + error handling
│       │   ├── auth.ts
│       │   ├── users.ts
│       │   ├── settings.ts
│       │   ├── labels.ts
│       │   ├── batches.ts
│       │   └── images.ts
│       ├── components/
│       │   ├── common/
│       │   │   ├── ColorPicker.tsx
│       │   │   ├── ColorPicker.module.css
│       │   │   ├── ConfirmDialog.tsx
│       │   │   ├── ConfirmDialog.module.css
│       │   │   ├── ProtectedRoute.tsx
│       │   │   └── Layout.tsx
│       │   ├── panels/
│       │   │   ├── BatchSelector.tsx
│       │   │   ├── BatchSelector.module.css
│       │   │   ├── ImageList.tsx
│       │   │   └── ImageList.module.css
│       ├── pages/
│       │   ├── LoginPage.tsx
│       │   ├── LoginPage.module.css
│       │   ├── AnnotationPage.tsx            # shell only in P1
│       │   ├── StatsPage.tsx                 # shell only in P1
│       │   ├── AdminUsersPage.tsx
│       │   ├── AdminUsersPage.module.css
│       │   ├── AdminLabelsPage.tsx
│       │   ├── AdminLabelsPage.module.css
│       │   ├── AdminSettingsPage.tsx
│       │   └── AdminSettingsPage.module.css
│       ├── stores/
│       │   ├── authStore.ts
│       │   ├── batchStore.ts
│       │   └── labelStore.ts
│       ├── types/
│       │   └── api.ts
│       └── utils/
│           └── color-palette.ts
└── docs/
    ├── superpowers/
    │   ├── specs/
    │   │   └── 2026-07-31-online-annotation-tool-design.md
    │   └── plans/
    └── (this file)
```

---

## Phase 1 Tasks

### Task 1: Backend project scaffolding

**Files:**
- Create: `backend/pyproject.toml`
- Create: `backend/app/__init__.py`
- Create: `backend/app/main.py`
- Create: `backend/app/core/__init__.py`
- Create: `backend/app/core/config.py`
- Create: `backend/app/core/db.py`
- Create: `backend/app/api/__init__.py`

**Interfaces:**
- Produces: `get_db()` generator for FastAPI dependency injection
- Produces: `Settings` class with `WORK_DIR: str`, `DATABASE_URL: str`, `SECRET_KEY: str`, `ALGORITHM: str = "HS256"`, `ACCESS_TOKEN_EXPIRE_MINUTES: int = 480`
- Produces: `Base` SQLAlchemy declarative base
- Produces: `app` FastAPI instance with CORS middleware

- [ ] **Step 1: Create pyproject.toml with dependencies**

```toml
[project]
name = "ling-label-backend"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "fastapi[standard]>=0.115.0",
    "sqlalchemy>=2.0.0",
    "alembic>=1.13.0",
    "pydantic>=2.0.0",
    "bcrypt>=4.0.0",
    "pyjwt>=2.8.0",
    "pillow>=10.0.0",
    "numpy>=1.26.0",
    "onnxruntime>=1.18.0",
    "python-multipart>=0.0.9",
    "aiofiles>=24.0.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0.0",
    "pytest-asyncio>=0.24.0",
    "httpx>=0.28.0",
]

[build-system]
requires = ["setuptools>=75.0"]
build-backend = "setuptools.build_meta"
```

- [ ] **Step 2: Install dependencies**

```bash
cd backend && pip install -e ".[dev]"
```

- [ ] **Step 3: Create core/config.py**

```python
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    WORK_DIR: str = "./data"
    SECRET_KEY: str = "dev-secret-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480  # 8 hours

    @property
    def DATABASE_URL(self) -> str:
        return f"sqlite+aiosqlite:///{self.WORK_DIR}/metadata.db"

    model_config = {"env_prefix": "LING_", "extra": "ignore"}


settings = Settings()
```

- [ ] **Step 4: Create core/db.py**

```python
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker, Session


class Base(DeclarativeBase):
    pass


_engine = None
_SessionLocal = None


def init_db(database_url: str) -> None:
    global _engine, _SessionLocal
    _engine = create_engine(database_url, connect_args={"check_same_thread": False})
    _SessionLocal = sessionmaker(bind=_engine, autocommit=False, autoflush=False)


def get_db() -> Session:
    if _SessionLocal is None:
        raise RuntimeError("Database not initialized. Call init_db() first.")
    db = _SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_engine():
    if _engine is None:
        raise RuntimeError("Database not initialized.")
    return _engine
```

- [ ] **Step 5: Create core/__init__.py**

```python
from app.core.config import settings
from app.core.db import Base, init_db, get_db

__all__ = ["settings", "Base", "init_db", "get_db"]
```

- [ ] **Step 6: Create app/main.py**

```python
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core import settings, init_db, Base
from app.core.db import get_engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(settings.WORK_DIR, exist_ok=True)
    init_db(settings.DATABASE_URL)
    Base.metadata.create_all(bind=get_engine())
    yield


app = FastAPI(title="Ling Label", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 7: Create app/api/__init__.py**

```python
from fastapi import APIRouter

api_router = APIRouter(prefix="/api")

# Routers will be added in subsequent tasks:
# from app.api.auth import router as auth_router
# api_router.include_router(auth_router, tags=["auth"])
```

- [ ] **Step 8: Verify health endpoint**

```bash
cd backend && python -c "
from app.main import app
from fastapi.testclient import TestClient
c = TestClient(app)
r = c.get('/api/health')
assert r.status_code == 200
assert r.json() == {'status': 'ok'}
print('Health check passed')
"
```

- [ ] **Step 9: Add api_router to main.py**

```python
# In app/main.py, after the CORS middleware, before the function definitions:
from app.api import api_router
app.include_router(api_router)

# Remove the @app.get("/api/health") and move it to api_router:
# Add this to api/__init__.py:
@api_router.get("/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 10: Run health check again to verify router setup**

```bash
cd backend && python -c "
from app.main import app
from fastapi.testclient import TestClient
c = TestClient(app)
r = c.get('/api/health')
assert r.status_code == 200
print('Router health check passed')
"
```

- [ ] **Step 11: Create backend/.gitignore**

```
__pycache__/
*.pyc
*.pyo
.env
*.db
data/
```

- [ ] **Step 12: Commit**

```bash
git add backend/
git commit -m "feat: scaffold backend with FastAPI + SQLAlchemy + SQLite"
```

---

### Task 2: Auth backend (user model, password hashing, JWT, login/register)

**Files:**
- Create: `backend/app/core/security.py`
- Create: `backend/app/models/__init__.py`
- Create: `backend/app/models/user.py`
- Create: `backend/app/schemas/__init__.py`
- Create: `backend/app/schemas/auth.py`
- Create: `backend/app/schemas/common.py`
- Create: `backend/app/api/auth.py`
- Create: `backend/app/tests/__init__.py`
- Create: `backend/app/tests/conftest.py`
- Create: `backend/app/tests/test_auth.py`
- Modify: `backend/app/api/__init__.py` (register auth router)

**Interfaces:**
- Produces: `hash_password(plain: str) -> str`, `verify_password(plain: str, hashed: str) -> bool`
- Produces: `create_access_token(data: dict) -> str`, `decode_access_token(token: str) -> dict | None`
- Produces: `get_current_user(db: Session, token: str) -> User` (FastAPI dependency)
- Produces: `require_admin(current_user: User) -> User` (FastAPI dependency)
- Produces: `User` SQLAlchemy model with fields: id, username, password_hash, role, is_active, created_at

- [ ] **Step 1: Create core/security.py**

```python
from datetime import datetime, timedelta, timezone
import bcrypt
import jwt
from app.core.config import settings


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_access_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except jwt.PyJWTError:
        return None
```

- [ ] **Step 2: Create models/user.py**

```python
from datetime import datetime, timezone
from sqlalchemy import String, Boolean, DateTime, Integer
from sqlalchemy.orm import Mapped, mapped_column
from app.core.db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="annotator")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=lambda: datetime.now(timezone.utc)
    )
```

- [ ] **Step 3: Create models/__init__.py**

```python
from app.models.user import User

__all__ = ["User"]
```

- [ ] **Step 4: Create schemas/common.py**

```python
from pydantic import BaseModel


class ErrorResponse(BaseModel):
    error: str
    detail: str
```

- [ ] **Step 5: Create schemas/auth.py**

```python
from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1)


class RegisterRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=4, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    username: str
    role: str
```

- [ ] **Step 6: Create schemas/__init__.py**

```python
from app.schemas.auth import LoginRequest, RegisterRequest, TokenResponse
from app.schemas.common import ErrorResponse

__all__ = ["LoginRequest", "RegisterRequest", "TokenResponse", "ErrorResponse"]
```

- [ ] **Step 7: Create api/auth.py**

```python
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.core.security import hash_password, verify_password, create_access_token
from app.models.user import User
from app.schemas.auth import LoginRequest, RegisterRequest, TokenResponse

router = APIRouter()


@router.post("/auth/login", response_model=TokenResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == body.username).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    token = create_access_token({"sub": str(user.id), "role": user.role})
    return TokenResponse(access_token=token, username=user.username, role=user.role)


@router.post("/auth/register", response_model=TokenResponse)
def register(body: RegisterRequest, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.username == body.username).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already taken")
    user = User(
        username=body.username,
        password_hash=hash_password(body.password),
        role="annotator",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token({"sub": str(user.id), "role": user.role})
    return TokenResponse(access_token=token, username=user.username, role=user.role)
```

- [ ] **Step 8: Register auth router in api/__init__.py**

```python
# Update backend/app/api/__init__.py:
from fastapi import APIRouter
from app.api.auth import router as auth_router

api_router = APIRouter(prefix="/api")
api_router.include_router(auth_router, tags=["auth"])


@api_router.get("/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 9: Create tests/conftest.py**

```python
import os
import tempfile
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.core.config import Settings
from app.core.db import Base, get_db


@pytest.fixture
def tmp_work_dir():
    with tempfile.TemporaryDirectory() as d:
        yield d


@pytest.fixture
def test_settings(tmp_work_dir):
    return Settings(
        WORK_DIR=tmp_work_dir,
        SECRET_KEY="test-secret",
    )


@pytest.fixture
def app(test_settings, monkeypatch):
    monkeypatch.setattr("app.core.config.settings", test_settings)
    from app.main import app as _app
    engine = create_engine(f"sqlite:///{test_settings.WORK_DIR}/metadata.db", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(bind=engine, autocommit=False, autoflush=False)

    def override_get_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    _app.dependency_overrides[get_db] = override_get_db
    return _app


@pytest.fixture
def client(app):
    return TestClient(app)
```

- [ ] **Step 10: Create tests/test_auth.py**

```python
def test_register_returns_token(client):
    resp = client.post("/api/auth/register", json={"username": "testuser", "password": "pass1234"})
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert data["username"] == "testuser"
    assert data["role"] == "annotator"


def test_register_duplicate_username_fails(client):
    client.post("/api/auth/register", json={"username": "dup", "password": "pass1234"})
    resp = client.post("/api/auth/register", json={"username": "dup", "password": "other5678"})
    assert resp.status_code == 409


def test_login_with_correct_credentials(client):
    client.post("/api/auth/register", json={"username": "alice", "password": "secret99"})
    resp = client.post("/api/auth/login", json={"username": "alice", "password": "secret99"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["username"] == "alice"


def test_login_wrong_password_fails(client):
    client.post("/api/auth/register", json={"username": "bob", "password": "correct"})
    resp = client.post("/api/auth/login", json={"username": "bob", "password": "wrong"})
    assert resp.status_code == 401


def test_login_inactive_user_fails(client, app):
    # Manually create and deactivate a user via DB
    from app.core.db import get_db
    db = next(app.dependency_overrides[get_db]())
    from app.models.user import User
    from app.core.security import hash_password
    user = User(username="inactive", password_hash=hash_password("pass"), role="annotator", is_active=False)
    db.add(user)
    db.commit()
    resp = client.post("/api/auth/login", json={"username": "inactive", "password": "pass"})
    assert resp.status_code == 401
```

- [ ] **Step 11: Run auth tests**

```bash
cd backend && python -m pytest app/tests/test_auth.py -v
```
Expected: 5 tests PASS

- [ ] **Step 12: Commit**

```bash
git add backend/app/core/security.py backend/app/models/ backend/app/schemas/ backend/app/api/auth.py backend/app/api/__init__.py backend/app/tests/
git commit -m "feat: add auth with JWT login/register"
```

---

### Task 3: Auth dependency (get_current_user, require_admin)

**Files:**
- Create: `backend/app/api/deps.py`
- Create: `backend/app/tests/test_auth_deps.py`
- Modify: `backend/app/main.py` (add exception handler)

**Interfaces:**
- Produces: `get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User`
- Produces: `require_admin(current_user: User = Depends(get_current_user)) -> User`
- Consumes: `create_access_token()` from `core/security.py`, `User` model

- [ ] **Step 1: Create api/deps.py**

```python
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.core.security import decode_access_token
from app.models.user import User

oauth2_scheme = HTTPBearer()


def get_current_user(
    token: HTTPAuthorizationCredentials = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    payload = decode_access_token(token.credentials)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    user_id = payload.get("sub")
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")
    user = db.query(User).filter(User.id == int(user_id)).first()
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")
    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user
```

- [ ] **Step 2: Create tests/test_auth_deps.py**

```python
def test_protected_endpoint_without_token_returns_401(client):
    resp = client.get("/api/users")
    assert resp.status_code == 401


def test_protected_endpoint_with_valid_token(client):
    # Register & get token
    resp = client.post("/api/auth/register", json={"username": "u1", "password": "p1"})
    token = resp.json()["access_token"]
    # Use token on protected endpoint
    resp = client.get("/api/users", headers={"Authorization": f"Bearer {token}"})
    # Will 200 once user list endpoint exists (Task 4); for now expect 404 or 200
    assert resp.status_code in [200, 404]


def test_admin_endpoint_rejects_annotator(client):
    resp = client.post("/api/auth/register", json={"username": "ann1", "password": "p1"})
    token = resp.json()["access_token"]
    # POST /api/users requires admin — should 403
    resp = client.post("/api/users", json={"username": "newguy", "password": "p", "role": "annotator"},
                       headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403
```

- [ ] **Step 3: Run dep tests (some will fail until Task 4)**

```bash
cd backend && python -m pytest app/tests/test_auth_deps.py -v
```
Expected: test_protected_endpoint_without_token PASS, others may fail until endpoints exist

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/deps.py backend/app/tests/test_auth_deps.py
git commit -m "feat: add auth dependencies get_current_user and require_admin"
```

---

### Task 4: User management API (admin CRUD)

**Files:**
- Create: `backend/app/schemas/user.py`
- Create: `backend/app/api/users.py`
- Create: `backend/app/tests/test_users.py`
- Modify: `backend/app/api/__init__.py` (register users router)

**Interfaces:**
- Produces: `GET /api/users` → list all users (admin only)
- Produces: `POST /api/users` → create user with role (admin only)
- Produces: `PUT /api/users/{user_id}` → update user active status/password/role (admin only)
- Consumes: `require_admin` from `api/deps.py`

- [ ] **Step 1: Create schemas/user.py**

```python
from datetime import datetime
from pydantic import BaseModel, Field


class UserCreate(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=4, max_length=128)
    role: str = Field(default="annotator", pattern="^(admin|annotator)$")


class UserUpdate(BaseModel):
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=4, max_length=128)
    role: str | None = Field(default=None, pattern="^(admin|annotator)$")


class UserResponse(BaseModel):
    id: int
    username: str
    role: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}
```

- [ ] **Step 2: Create api/users.py**

```python
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.core.security import hash_password
from app.models.user import User
from app.schemas.user import UserCreate, UserUpdate, UserResponse
from app.api.deps import require_admin

router = APIRouter()


@router.get("/users", response_model=list[UserResponse])
def list_users(db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    return db.query(User).order_by(User.created_at.desc()).all()


@router.post("/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user(body: UserCreate, db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    existing = db.query(User).filter(User.username == body.username).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already taken")
    user = User(
        username=body.username,
        password_hash=hash_password(body.password),
        role=body.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.put("/users/{user_id}", response_model=UserResponse)
def update_user(user_id: int, body: UserUpdate, db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if body.is_active is not None:
        user.is_active = body.is_active
    if body.password is not None:
        user.password_hash = hash_password(body.password)
    if body.role is not None:
        user.role = body.role
    db.commit()
    db.refresh(user)
    return user
```

- [ ] **Step 3: Register users router in api/__init__.py**

```python
# Add to backend/app/api/__init__.py:
from app.api.users import router as users_router
api_router.include_router(users_router, tags=["users"])
```

- [ ] **Step 4: Create tests/test_users.py**

```python
def _register_admin(client) -> str:
    from app.core.security import hash_password
    resp = client.post("/api/auth/register", json={"username": "admin1", "password": "admin"})
    token = resp.json()["access_token"]
    # Promote to admin via DB (no admin creation API yet)
    from app.main import app
    from app.core.db import get_db
    db = next(app.dependency_overrides[get_db]())
    from app.models.user import User
    user = db.query(User).filter(User.username == "admin1").first()
    user.role = "admin"
    db.commit()
    return token


def _auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_admin_can_create_user(client):
    token = _register_admin(client)
    resp = client.post("/api/users", json={"username": "ann1", "password": "pass", "role": "annotator"},
                       headers=_auth_header(token))
    assert resp.status_code == 201
    assert resp.json()["username"] == "ann1"


def test_admin_can_list_users(client):
    token = _register_admin(client)
    client.post("/api/users", json={"username": "a1", "password": "p", "role": "annotator"},
                headers=_auth_header(token))
    resp = client.get("/api/users", headers=_auth_header(token))
    assert resp.status_code == 200
    users = resp.json()
    assert len(users) >= 2  # admin1 + a1


def test_admin_can_disable_user(client):
    token = _register_admin(client)
    resp = client.post("/api/users", json={"username": "tobedisabled", "password": "p", "role": "annotator"},
                       headers=_auth_header(token))
    user_id = resp.json()["id"]
    resp = client.put(f"/api/users/{user_id}", json={"is_active": False}, headers=_auth_header(token))
    assert resp.status_code == 200
    assert resp.json()["is_active"] is False


def test_annotator_cannot_create_user(client):
    resp = client.post("/api/auth/register", json={"username": "ann2", "password": "pass"})
    token = resp.json()["access_token"]
    resp = client.post("/api/users", json={"username": "bad", "password": "p", "role": "annotator"},
                       headers=_auth_header(token))
    assert resp.status_code == 403


def test_admin_can_change_user_password(client):
    token = _register_admin(client)
    resp = client.post("/api/users", json={"username": "pwuser", "password": "old", "role": "annotator"},
                       headers=_auth_header(token))
    user_id = resp.json()["id"]
    client.put(f"/api/users/{user_id}", json={"password": "newpass"}, headers=_auth_header(token))
    # Verify new password works
    resp = client.post("/api/auth/login", json={"username": "pwuser", "password": "newpass"})
    assert resp.status_code == 200


def test_update_nonexistent_user_returns_404(client):
    token = _register_admin(client)
    resp = client.put("/api/users/99999", json={"is_active": False}, headers=_auth_header(token))
    assert resp.status_code == 404
```

- [ ] **Step 5: Run user tests**

```bash
cd backend && python -m pytest app/tests/test_users.py -v
```
Expected: 6 tests PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas/user.py backend/app/api/users.py backend/app/api/__init__.py backend/app/tests/test_users.py
git commit -m "feat: add user management API (admin CRUD)"
```

---

### Task 5: First admin seed + settings API

**Files:**
- Create: `backend/app/models/setting.py`
- Create: `backend/app/schemas/setting.py`
- Create: `backend/app/api/settings.py`
- Create: `backend/app/tests/test_settings.py`
- Modify: `backend/app/main.py` (seed first admin on startup)
- Modify: `backend/app/models/__init__.py`
- Modify: `backend/app/api/__init__.py`

**Interfaces:**
- Produces: `GET /api/settings` → all settings as dict (admin only)
- Produces: `PUT /api/settings/{key}` → update single setting (admin only)
- Produces: `seed_first_admin()` — creates admin/admin if no users exist

- [ ] **Step 1: Create models/setting.py**

```python
from sqlalchemy import String, Integer
from sqlalchemy.orm import Mapped, mapped_column
from app.core.db import Base


class Setting(Base):
    __tablename__ = "settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    value: Mapped[str] = mapped_column(String(1024), nullable=False, default="")
```

- [ ] **Step 2: Update models/__init__.py**

```python
from app.models.user import User
from app.models.setting import Setting

__all__ = ["User", "Setting"]
```

- [ ] **Step 3: Create schemas/setting.py**

```python
from pydantic import BaseModel, Field


class SettingUpdate(BaseModel):
    value: str = Field(min_length=0, max_length=1024)
```

- [ ] **Step 4: Create api/settings.py**

```python
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.models.setting import Setting
from app.models.user import User
from app.schemas.setting import SettingUpdate
from app.api.deps import require_admin

router = APIRouter()


@router.get("/settings")
def get_settings(db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    rows = db.query(Setting).all()
    return {r.key: r.value for r in rows}


@router.put("/settings/{key}")
def update_setting(key: str, body: SettingUpdate, db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    row = db.query(Setting).filter(Setting.key == key).first()
    if not row:
        row = Setting(key=key, value=body.value)
        db.add(row)
    else:
        row.value = body.value
    db.commit()
    return {"key": key, "value": body.value}
```

- [ ] **Step 5: Register settings router in api/__init__.py**

```python
from app.api.settings import router as settings_router
api_router.include_router(settings_router, tags=["settings"])
```

- [ ] **Step 6: Add first admin seed to main.py**

```python
# Add to app/main.py, inside lifespan(), after Base.metadata.create_all():
from app.core.security import hash_password
from app.models.user import User
from app.core.db import get_engine
engine = get_engine()
from sqlalchemy.orm import Session as DBSession
with DBSession(engine) as db:
    if db.query(User).filter(User.role == "admin").count() == 0:
        admin = User(
            username="admin",
            password_hash=hash_password("admin"),
            role="admin",
            is_active=True,
        )
        db.add(admin)
        db.commit()
```

- [ ] **Step 7: Create tests/test_settings.py**

```python
def _admin_token(client) -> str:
    resp = client.post("/api/auth/login", json={"username": "admin", "password": "admin"})
    if resp.status_code != 200:
        # Admin might not exist in this test; register and promote
        from app.main import app
        from app.core.db import get_db
        resp = client.post("/api/auth/register", json={"username": "adm_set", "password": "admin"})
        token = resp.json()["access_token"]
        db = next(app.dependency_overrides[get_db]())
        from app.models.user import User
        user = db.query(User).filter(User.username == "adm_set").first()
        user.role = "admin"
        db.commit()
        return token
    return resp.json()["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_get_settings_empty_by_default(client):
    token = _admin_token(client)
    resp = client.get("/api/settings", headers=_auth(token))
    assert resp.status_code == 200
    assert resp.json() == {}


def test_set_and_get_work_dir(client):
    token = _admin_token(client)
    resp = client.put("/api/settings/WORK_DIR", json={"value": "/data/annotations"}, headers=_auth(token))
    assert resp.status_code == 200
    resp = client.get("/api/settings", headers=_auth(token))
    assert resp.json()["WORK_DIR"] == "/data/annotations"


def test_annotator_cannot_access_settings(client):
    resp = client.post("/api/auth/register", json={"username": "ann_settings", "password": "pass"})
    token = resp.json()["access_token"]
    resp = client.get("/api/settings", headers=_auth(token))
    assert resp.status_code == 403
```

- [ ] **Step 8: Run settings tests**

```bash
cd backend && python -m pytest app/tests/test_settings.py -v
```
Expected: 3 tests PASS

- [ ] **Step 9: Commit**

```bash
git add backend/app/models/setting.py backend/app/models/__init__.py backend/app/schemas/setting.py backend/app/api/settings.py backend/app/api/__init__.py backend/app/main.py backend/app/tests/test_settings.py
git commit -m "feat: add settings API and first-admin seed"
```

---

### Task 6: Label model + CRUD API + txt import

**Files:**
- Create: `backend/app/models/label.py`
- Create: `backend/app/schemas/label.py`
- Create: `backend/app/api/labels.py`
- Create: `backend/app/tests/test_labels.py`
- Modify: `backend/app/models/__init__.py`
- Modify: `backend/app/api/__init__.py`

**Interfaces:**
- Produces: `GET /api/labels` → list all labels (auth required)
- Produces: `POST /api/labels` → create label (admin)
- Produces: `PUT /api/labels/{id}` → update label name/color (admin)
- Produces: `DELETE /api/labels/{id}` → delete label (admin)
- Produces: `POST /api/labels/import-txt` → parse txt body, upsert labels (admin)
- Produces: `Label` model: id, name (unique), color, enabled, sort_order, created_at

- [ ] **Step 1: Create models/label.py**

```python
from datetime import datetime, timezone
from sqlalchemy import String, Boolean, Integer, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from app.core.db import Base


class Label(Base):
    __tablename__ = "labels"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    color: Mapped[str] = mapped_column(String(7), nullable=False, default="#3388ff")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=lambda: datetime.now(timezone.utc)
    )
```

- [ ] **Step 2: Update models/__init__.py**

```python
from app.models.user import User
from app.models.setting import Setting
from app.models.label import Label

__all__ = ["User", "Setting", "Label"]
```

- [ ] **Step 3: Create schemas/label.py**

```python
from datetime import datetime
from pydantic import BaseModel, Field


class LabelCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    color: str = Field(default="#3388ff", pattern=r"^#[0-9a-fA-F]{6}$")


class LabelUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    enabled: bool | None = None
    sort_order: int | None = None


class LabelResponse(BaseModel):
    id: int
    name: str
    color: str
    enabled: bool
    sort_order: int
    created_at: datetime

    model_config = {"from_attributes": True}


class ImportTxtRequest(BaseModel):
    content: str = Field(min_length=1, description="Raw text content of the labels file")
```

- [ ] **Step 4: Create api/labels.py**

```python
import re
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.models.label import Label
from app.models.user import User
from app.schemas.label import LabelCreate, LabelUpdate, LabelResponse, ImportTxtRequest
from app.api.deps import require_admin, get_current_user

router = APIRouter()

DEFAULT_PALETTE = [
    "#ff4444", "#44ff44", "#4488ff", "#ffaa00", "#aa44ff",
    "#00cccc", "#ff66aa", "#aacc00", "#886644", "#ff8844",
]


def _next_color(db: Session) -> str:
    used = {label.color for label in db.query(Label).all()}
    for c in DEFAULT_PALETTE:
        if c not in used:
            return c
    return "#808080"


@router.get("/labels", response_model=list[LabelResponse])
def list_labels(db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    return db.query(Label).order_by(Label.sort_order, Label.name).all()


@router.post("/labels", response_model=LabelResponse, status_code=status.HTTP_201_CREATED)
def create_label(body: LabelCreate, db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    existing = db.query(Label).filter(Label.name == body.name).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Label name already exists")
    max_order = db.query(Label).order_by(Label.sort_order.desc()).first()
    label = Label(
        name=body.name,
        color=body.color,
        sort_order=(max_order.sort_order + 1) if max_order else 0,
    )
    db.add(label)
    db.commit()
    db.refresh(label)
    return label


@router.put("/labels/{label_id}", response_model=LabelResponse)
def update_label(label_id: int, body: LabelUpdate, db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    label = db.query(Label).filter(Label.id == label_id).first()
    if not label:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Label not found")
    if body.name is not None:
        dup = db.query(Label).filter(Label.name == body.name, Label.id != label_id).first()
        if dup:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Label name already taken")
        label.name = body.name
    if body.color is not None:
        label.color = body.color
    if body.enabled is not None:
        label.enabled = body.enabled
    if body.sort_order is not None:
        label.sort_order = body.sort_order
    db.commit()
    db.refresh(label)
    return label


@router.delete("/labels/{label_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_label(label_id: int, db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    label = db.query(Label).filter(Label.id == label_id).first()
    if not label:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Label not found")
    db.delete(label)
    db.commit()


@router.post("/labels/import-txt", response_model=list[LabelResponse])
def import_labels_txt(body: ImportTxtRequest, db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    results = []
    for line in body.content.strip().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line in ("__ignore__", "_background_"):
            continue
        # Parse "name" or "name,#rrggbb"
        parts = re.split(r"\s*,\s*", line, maxsplit=1)
        name = parts[0].strip()
        color = parts[1].strip() if len(parts) == 2 and re.match(r"^#[0-9a-fA-F]{6}$", parts[1].strip()) else None
        existing = db.query(Label).filter(Label.name == name).first()
        if existing:
            if color:
                existing.color = color
            results.append(existing)
        else:
            label = Label(name=name, color=color or _next_color(db))
            db.add(label)
            db.flush()
            results.append(label)
    db.commit()
    for r in results:
        db.refresh(r)
    return results
```

- [ ] **Step 5: Register labels router in api/__init__.py**

```python
from app.api.labels import router as labels_router
api_router.include_router(labels_router, tags=["labels"])
```

- [ ] **Step 6: Create tests/test_labels.py**

```python
def _admin_token(client) -> str:
    resp = client.post("/api/auth/login", json={"username": "admin", "password": "admin"})
    if resp.status_code != 200:
        from app.main import app
        from app.core.db import get_db
        resp = client.post("/api/auth/register", json={"username": "adml", "password": "admin"})
        token = resp.json()["access_token"]
        db = next(app.dependency_overrides[get_db]())
        from app.models.user import User
        u = db.query(User).filter(User.username == "adml").first()
        u.role = "admin"
        db.commit()
        return token
    return resp.json()["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_create_label(client):
    token = _admin_token(client)
    resp = client.post("/api/labels", json={"name": "cat", "color": "#ff0000"}, headers=_auth(token))
    assert resp.status_code == 201
    assert resp.json()["name"] == "cat"
    assert resp.json()["color"] == "#ff0000"


def test_list_labels(client):
    token = _admin_token(client)
    client.post("/api/labels", json={"name": "dog", "color": "#00ff00"}, headers=_auth(token))
    resp = client.get("/api/labels", headers=_auth(token))
    assert resp.status_code == 200
    names = [l["name"] for l in resp.json()]
    assert "dog" in names


def test_annotator_can_read_labels(client):
    client.post("/api/auth/register", json={"username": "reader", "password": "p"})
    resp = client.post("/api/auth/login", json={"username": "reader", "password": "p"})
    token = resp.json()["access_token"]
    resp = client.get("/api/labels", headers=_auth(token))
    assert resp.status_code == 200


def test_annotator_cannot_create_label(client):
    client.post("/api/auth/register", json={"username": "ann_nocreate", "password": "p"})
    resp = client.post("/api/auth/login", json={"username": "ann_nocreate", "password": "p"})
    token = resp.json()["access_token"]
    resp = client.post("/api/labels", json={"name": "nope", "color": "#000000"}, headers=_auth(token))
    assert resp.status_code == 403


def test_delete_label(client):
    token = _admin_token(client)
    resp = client.post("/api/labels", json={"name": "todelete", "color": "#000000"}, headers=_auth(token))
    lid = resp.json()["id"]
    resp = client.delete(f"/api/labels/{lid}", headers=_auth(token))
    assert resp.status_code == 204


def test_import_txt_with_colors(client):
    token = _admin_token(client)
    txt = "tumor,#ff0000\nvessel,#00cc00\nnodule"
    resp = client.post("/api/labels/import-txt", json={"content": txt}, headers=_auth(token))
    assert resp.status_code == 200
    labels = {l["name"]: l for l in resp.json()}
    assert labels["tumor"]["color"] == "#ff0000"
    assert labels["vessel"]["color"] == "#00cc00"
    assert labels["nodule"]["color"] != ""  # auto-assigned


def test_import_txt_skips_reserved(client):
    token = _admin_token(client)
    txt = "__ignore__\n_background_\ntumor"
    resp = client.post("/api/labels/import-txt", json={"content": txt}, headers=_auth(token))
    assert resp.status_code == 200
    names = [l["name"] for l in resp.json()]
    assert "__ignore__" not in names
    assert "_background_" not in names
    assert "tumor" in names
```

- [ ] **Step 7: Run label tests**

```bash
cd backend && python -m pytest app/tests/test_labels.py -v
```
Expected: 7 tests PASS

- [ ] **Step 8: Commit**

```bash
git add backend/app/models/label.py backend/app/models/__init__.py backend/app/schemas/label.py backend/app/api/labels.py backend/app/api/__init__.py backend/app/tests/test_labels.py
git commit -m "feat: add label CRUD API with txt import"
```

---

### Task 7: Batch + Image models and batch API

**Files:**
- Create: `backend/app/models/batch.py`
- Create: `backend/app/models/image.py`
- Create: `backend/app/schemas/batch.py`
- Create: `backend/app/schemas/image.py`
- Create: `backend/app/api/batches.py`
- Create: `backend/app/api/images.py`
- Create: `backend/app/services/__init__.py`
- Create: `backend/app/services/scanner.py`
- Create: `backend/app/services/image_processor.py`
- Create: `backend/app/tests/test_batches.py`
- Create: `backend/app/tests/test_scanner.py`
- Modify: `backend/app/models/__init__.py`
- Modify: `backend/app/api/__init__.py`

**Interfaces:**
- Produces: `Batch` model: id, name (unique), source, created_by (FK), note, created_at
- Produces: `Image` model: id, batch_id (FK), file_name, src_rel_path, work_rel_path, width, height, channels, status, locked_by (FK nullable), locked_at (nullable), annotation_rev, created_at, updated_at
- Produces: `GET/POST /api/batches`, `POST /api/batches/scan`, `POST /api/batches/:id/upload`
- Produces: `GET /api/batches/:id/images`, `GET /api/images/:id`
- Produces: `scan_batches(work_dir, db)` → discovers new images
- Produces: `process_image(src_path, work_dir, batch_name)` → returns (width, height, channels, work_rel_path | None)

- [ ] **Step 1: Create models/batch.py**

```python
from datetime import datetime, timezone
from sqlalchemy import String, Integer, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.db import Base


class Batch(Base):
    __tablename__ = "batches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(256), unique=True, nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="upload")
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=True)
    note: Mapped[str] = mapped_column(String(1024), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    images: Mapped[list["Image"]] = relationship("Image", back_populates="batch", cascade="all, delete-orphan")

from app.models.image import Image  # noqa: E402
```

- [ ] **Step 2: Create models/image.py**

```python
from datetime import datetime, timezone
from sqlalchemy import String, Integer, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.db import Base


class Image(Base):
    __tablename__ = "images"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    batch_id: Mapped[int] = mapped_column(ForeignKey("batches.id"), nullable=False, index=True)
    file_name: Mapped[str] = mapped_column(String(512), nullable=False)
    src_rel_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    work_rel_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    width: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    height: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    channels: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    locked_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    annotation_rev: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    batch: Mapped["Batch"] = relationship("Batch", back_populates="images")
```

- [ ] **Step 3: Update models/__init__.py**

```python
from app.models.user import User
from app.models.setting import Setting
from app.models.label import Label
from app.models.batch import Batch
from app.models.image import Image

__all__ = ["User", "Setting", "Label", "Batch", "Image"]
```

- [ ] **Step 4: Create services/image_processor.py**

```python
import os
from PIL import Image as PILImage


SUPPORTED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".tif", ".tiff"}


def get_image_info(path: str) -> dict:
    """Return {width, height, channels} or raise ValueError on unsupported/corrupt."""
    ext = os.path.splitext(path)[1].lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Unsupported image format: {ext}")
    img = PILImage.open(path)
    width, height = img.size
    mode = img.mode
    channel_map = {"L": 1, "LA": 2, "RGB": 3, "RGBA": 4, "CMYK": 4, "YCbCr": 3, "P": 1}
    channels = channel_map.get(mode, len(img.getbands()))
    return {"width": width, "height": height, "channels": channels, "mode": mode}


def convert_to_rgb(src_path: str, dst_dir: str) -> str:
    """Convert image to RGB, save to dst_dir. Returns relative path of the RGB copy."""
    img = PILImage.open(src_path)
    rgb = img.convert("RGB")
    base = os.path.splitext(os.path.basename(src_path))[0] + "_rgb.png"
    dst_path = os.path.join(dst_dir, base)
    rgb.save(dst_path, "PNG")
    return os.path.relpath(dst_path, start=os.path.dirname(os.path.dirname(dst_dir)))
```

- [ ] **Step 5: Create services/scanner.py**

```python
import os
import json
from sqlalchemy.orm import Session
from app.models.batch import Batch
from app.models.image import Image
from app.models.user import User
from app.services.image_processor import get_image_info, convert_to_rgb, SUPPORTED_EXTENSIONS


def scan_batches(work_dir: str, db: Session, created_by: int | None = None) -> dict:
    """Scan batches/*/images/ for new images. Returns {added, skipped, errors}."""
    batches_dir = os.path.join(work_dir, "batches")
    if not os.path.isdir(batches_dir):
        return {"added": 0, "skipped": 0, "errors": []}

    result = {"added": 0, "skipped": 0, "errors": []}

    for batch_name in sorted(os.listdir(batches_dir)):
        batch_path = os.path.join(batches_dir, batch_name)
        images_dir = os.path.join(batch_path, "images")
        if not os.path.isdir(images_dir):
            continue

        batch = db.query(Batch).filter(Batch.name == batch_name).first()
        if not batch:
            batch = Batch(name=batch_name, source="scan", created_by=created_by)
            db.add(batch)
            db.flush()

        for fname in sorted(os.listdir(images_dir)):
            fpath = os.path.join(images_dir, fname)
            ext = os.path.splitext(fname)[1].lower()
            if ext not in SUPPORTED_EXTENSIONS:
                continue
            if not os.path.isfile(fpath):
                continue

            src_rel = os.path.relpath(fpath, start=work_dir)

            existing = db.query(Image).filter(
                Image.batch_id == batch.id, Image.file_name == fname
            ).first()
            if existing:
                result["skipped"] += 1
                continue

            try:
                info = get_image_info(fpath)
            except Exception as e:
                result["errors"].append({"file": src_rel, "error": str(e)})
                continue

            work_rel = None
            if info["channels"] > 3:
                cache_dir = os.path.join(batch_path, "cache", "rgb")
                os.makedirs(cache_dir, exist_ok=True)
                try:
                    work_rel = convert_to_rgb(fpath, cache_dir)
                except Exception as e:
                    result["errors"].append({"file": src_rel, "error": f"RGB conversion failed: {e}"})
                    continue

            image = Image(
                batch_id=batch.id,
                file_name=fname,
                src_rel_path=src_rel,
                work_rel_path=work_rel,
                width=info["width"],
                height=info["height"],
                channels=min(info["channels"], 3),
                status="pending",
            )

            # Check for existing sidecar JSON
            annot_dir = os.path.join(batch_path, "annotations")
            json_name = os.path.splitext(fname)[0] + ".json"
            json_path = os.path.join(annot_dir, json_name)
            if os.path.isfile(json_path):
                try:
                    with open(json_path, "r") as f:
                        annot = json.load(f)
                    image.annotation_rev = annot.get("version", 0)
                    # Restore label statuses
                    label_status = annot.get("labelStatus", {})
                    if label_status:
                        # Will be handled in Phase 3 (image_label_status)
                        # For now just restore rev
                        pass
                except Exception:
                    pass

            db.add(image)
            result["added"] += 1

    db.commit()
    return result
```

- [ ] **Step 6: Create schemas/batch.py**

```python
from datetime import datetime
from pydantic import BaseModel, Field


class BatchCreate(BaseModel):
    name: str = Field(min_length=1, max_length=256)


class BatchResponse(BaseModel):
    id: int
    name: str
    source: str
    note: str
    created_at: datetime
    image_count: int = 0
    done_count: int = 0

    model_config = {"from_attributes": True}
```

- [ ] **Step 7: Create schemas/image.py**

```python
from datetime import datetime
from pydantic import BaseModel


class ImageResponse(BaseModel):
    id: int
    batch_id: int
    file_name: str
    width: int
    height: int
    channels: int
    status: str
    locked_by: int | None
    locked_by_username: str | None = None
    annotation_rev: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
```

- [ ] **Step 8: Create api/batches.py**

```python
import os
import uuid
import shutil
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.core.config import settings
from app.models.batch import Batch
from app.models.image import Image
from app.models.user import User
from app.schemas.batch import BatchCreate, BatchResponse
from app.schemas.image import ImageResponse
from app.api.deps import require_admin, get_current_user
from app.services.scanner import scan_batches

router = APIRouter()


@router.get("/batches", response_model=list[BatchResponse])
def list_batches(db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    batches = db.query(Batch).order_by(Batch.created_at.desc()).all()
    result = []
    for b in batches:
        total = db.query(Image).filter(Image.batch_id == b.id).count()
        done = db.query(Image).filter(Image.batch_id == b.id, Image.status == "done").count()
        result.append(BatchResponse(
            id=b.id, name=b.name, source=b.source, note=b.note, created_at=b.created_at,
            image_count=total, done_count=done,
        ))
    return result


@router.post("/batches", response_model=BatchResponse, status_code=status.HTTP_201_CREATED)
def create_batch(body: BatchCreate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    existing = db.query(Batch).filter(Batch.name == body.name).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Batch name already exists")
    batch = Batch(name=body.name, source="upload", created_by=admin.id)
    db.add(batch)
    db.commit()
    db.refresh(batch)
    return BatchResponse(id=batch.id, name=batch.name, source=batch.source, note=batch.note,
                         created_at=batch.created_at, image_count=0, done_count=0)


@router.post("/batches/scan")
def trigger_scan(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    result = scan_batches(settings.WORK_DIR, db, created_by=admin.id)
    return result


@router.post("/batches/{batch_id}/upload", response_model=list[ImageResponse])
async def upload_images(
    batch_id: int,
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    batch = db.query(Batch).filter(Batch.id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Batch not found")

    batch_dir = os.path.join(settings.WORK_DIR, "batches", batch.name)
    images_dir = os.path.join(batch_dir, "images")
    os.makedirs(images_dir, exist_ok=True)

    results = []
    for f in files:
        ext = os.path.splitext(f.filename)[1].lower()
        if ext not in {".png", ".jpg", ".jpeg", ".tif", ".tiff"}:
            continue

        # Avoid overwrite: add uuid suffix if conflict
        dest_name = f.filename
        dest_path = os.path.join(images_dir, dest_name)
        if os.path.exists(dest_path):
            stem, ext_ = os.path.splitext(f.filename)
            dest_name = f"{stem}_{uuid.uuid4().hex[:8]}{ext_}"
            dest_path = os.path.join(images_dir, dest_name)

        with open(dest_path, "wb") as buf:
            shutil.copyfileobj(f.file, buf)

        from app.services.image_processor import get_image_info, convert_to_rgb
        info = get_image_info(dest_path)
        src_rel = os.path.relpath(dest_path, start=settings.WORK_DIR)
        work_rel = None
        if info["channels"] > 3:
            cache_dir = os.path.join(batch_dir, "cache", "rgb")
            os.makedirs(cache_dir, exist_ok=True)
            work_rel = convert_to_rgb(dest_path, cache_dir)

        image = Image(
            batch_id=batch.id,
            file_name=dest_name,
            src_rel_path=src_rel,
            work_rel_path=work_rel,
            width=info["width"],
            height=info["height"],
            channels=min(info["channels"], 3),
            status="pending",
        )
        db.add(image)
        db.flush()
        results.append(ImageResponse(
            id=image.id, batch_id=image.batch_id, file_name=image.file_name,
            width=image.width, height=image.height, channels=image.channels,
            status=image.status, locked_by=None, locked_by_username=None,
            annotation_rev=image.annotation_rev,
            created_at=image.created_at, updated_at=image.updated_at,
        ))

    db.commit()
    return results
```

- [ ] **Step 9: Create api/images.py**

```python
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.models.image import Image
from app.models.user import User
from app.schemas.image import ImageResponse
from app.api.deps import get_current_user

router = APIRouter()


@router.get("/batches/{batch_id}/images", response_model=list[ImageResponse])
def list_images(batch_id: int, db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    images = db.query(Image).filter(Image.batch_id == batch_id).order_by(Image.file_name).all()
    return [_image_to_response(img, db) for img in images]


@router.get("/images/{image_id}", response_model=ImageResponse)
def get_image(image_id: int, db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    return _image_to_response(img, db)


def _image_to_response(img: Image, db: Session) -> ImageResponse:
    locked_username = None
    if img.locked_by:
        locker = db.query(User).filter(User.id == img.locked_by).first()
        locked_username = locker.username if locker else None
    return ImageResponse(
        id=img.id, batch_id=img.batch_id, file_name=img.file_name,
        width=img.width, height=img.height, channels=img.channels,
        status=img.status, locked_by=img.locked_by, locked_by_username=locked_username,
        annotation_rev=img.annotation_rev,
        created_at=img.created_at, updated_at=img.updated_at,
    )
```

- [ ] **Step 10: Register batch + image routers in api/__init__.py**

```python
from app.api.batches import router as batches_router
from app.api.images import router as images_router
api_router.include_router(batches_router, tags=["batches"])
api_router.include_router(images_router, tags=["images"])
```

- [ ] **Step 11: Create tests/test_scanner.py**

```python
import os
from PIL import Image as PILImage
import numpy as np


def test_scan_discovers_images(client, tmp_work_dir):
    from app.main import app
    from app.core.db import get_db
    from app.core.config import settings

    # Create batch directory with an image
    batches_dir = os.path.join(tmp_work_dir, "batches", "test-batch", "images")
    os.makedirs(batches_dir)
    img = PILImage.fromarray(np.zeros((100, 100, 3), dtype=np.uint8) + 128)
    img.save(os.path.join(batches_dir, "sample.png"))

    # Login as admin
    resp = client.post("/api/auth/login", json={"username": "admin", "password": "admin"})
    if resp.status_code != 200:
        resp = client.post("/api/auth/register", json={"username": "adm_sc", "password": "admin"})
        token = resp.json()["access_token"]
        db = next(app.dependency_overrides[get_db]())
        from app.models.user import User
        u = db.query(User).filter(User.username == "adm_sc").first()
        u.role = "admin"
        db.commit()
    else:
        token = resp.json()["access_token"]

    headers = {"Authorization": f"Bearer {token}"}
    resp = client.post("/api/batches/scan", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["added"] == 1


def test_scan_skips_existing(client, tmp_work_dir):
    from app.main import app
    from app.core.db import get_db
    batches_dir = os.path.join(tmp_work_dir, "batches", "test-batch2", "images")
    os.makedirs(batches_dir)
    img = PILImage.fromarray(np.zeros((50, 50, 3), dtype=np.uint8))
    img.save(os.path.join(batches_dir, "existing.png"))

    resp = client.post("/api/auth/login", json={"username": "admin", "password": "admin"})
    if resp.status_code != 200:
        resp = client.post("/api/auth/register", json={"username": "adm_sc2", "password": "admin"})
        token = resp.json()["access_token"]
        db = next(app.dependency_overrides[get_db]())
        from app.models.user import User
        u = db.query(User).filter(User.username == "adm_sc2").first()
        u.role = "admin"
        db.commit()
    else:
        token = resp.json()["access_token"]

    headers = {"Authorization": f"Bearer {token}"}

    # First scan
    r1 = client.post("/api/batches/scan", headers=headers)
    assert r1.json()["added"] == 1

    # Second scan
    r2 = client.post("/api/batches/scan", headers=headers)
    assert r2.json()["added"] == 0
    assert r2.json()["skipped"] == 1
```

- [ ] **Step 12: Run scanner tests**

```bash
cd backend && python -m pytest app/tests/test_scanner.py -v
```
Expected: 2 tests PASS

- [ ] **Step 13: Run all backend tests**

```bash
cd backend && python -m pytest app/tests/ -v
```
Expected: all tests PASS (~23 tests)

- [ ] **Step 14: Commit**

```bash
git add backend/app/models/batch.py backend/app/models/image.py backend/app/models/__init__.py backend/app/schemas/batch.py backend/app/schemas/image.py backend/app/api/batches.py backend/app/api/images.py backend/app/api/__init__.py backend/app/services/ backend/app/tests/test_batches.py backend/app/tests/test_scanner.py
git commit -m "feat: add batch scanning, image upload, and image list API"
```

---

### Task 8: Frontend project scaffolding

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/tsconfig.node.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/index.css`
- Create: `frontend/src/types/api.ts`
- Create: `frontend/src/api/client.ts`
- Create: `frontend/.gitignore`

**Interfaces:**
- Produces: `apiClient` — fetch wrapper with JWT auth, base URL config, error handling
- Produces: TypeScript types matching backend Pydantic schemas

- [ ] **Step 1: Create frontend/package.json**

```json
{
  "name": "ling-label-frontend",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0",
    "zustand": "^4.5.0",
    "konva": "^9.3.0",
    "react-konva": "^18.2.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vitest": "^2.0.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/jest-dom": "^6.4.0",
    "jsdom": "^24.0.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
cd frontend && npm install
```

- [ ] **Step 3: Create frontend/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create frontend/vite.config.ts**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
```

- [ ] **Step 5: Create frontend/index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>灵标 - 在线标注工具</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create frontend/src/index.css**

```css
:root {
  --color-primary: #2563eb;
  --color-primary-hover: #1d4ed8;
  --color-danger: #dc2626;
  --color-success: #16a34a;
  --color-warning: #f59e0b;
  --color-bg: #f8fafc;
  --color-surface: #ffffff;
  --color-border: #e2e8f0;
  --color-text: #1e293b;
  --color-text-muted: #64748b;
  --radius-sm: 4px;
  --radius-md: 8px;
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
  --shadow-md: 0 4px 6px rgba(0,0,0,0.07);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  background: var(--color-bg);
  color: var(--color-text);
}
```

- [ ] **Step 7: Create frontend/src/types/api.ts**

```typescript
export interface User {
  id: number;
  username: string;
  role: 'admin' | 'annotator';
  is_active: boolean;
  created_at: string;
}

export interface Label {
  id: number;
  name: string;
  color: string;
  enabled: boolean;
  sort_order: number;
  created_at: string;
}

export interface Batch {
  id: number;
  name: string;
  source: 'scan' | 'upload';
  note: string;
  created_at: string;
  image_count: number;
  done_count: number;
}

export interface ImageInfo {
  id: number;
  batch_id: number;
  file_name: string;
  width: number;
  height: number;
  channels: number;
  status: 'pending' | 'in_progress' | 'done';
  locked_by: number | null;
  locked_by_username: string | null;
  annotation_rev: number;
  created_at: string;
  updated_at: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  username: string;
  role: string;
}

export interface ApiError {
  detail: string;
}
```

- [ ] **Step 8: Create frontend/src/api/client.ts**

```typescript
const BASE_URL = '/api';

class ApiClient {
  private token: string | null = null;

  setToken(token: string | null) {
    this.token = token;
  }

  getToken(): string | null {
    return this.token;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) {
      h['Authorization'] = `Bearer ${this.token}`;
    }
    return h;
  }

  async get<T>(path: string): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, { headers: this.headers() });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new ApiError(res.status, err.detail);
    }
    return res.json();
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new ApiError(res.status, err.detail);
    }
    return res.json();
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'PUT',
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new ApiError(res.status, err.detail);
    }
    return res.json();
  }

  async delete(path: string): Promise<void> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new ApiError(res.status, err.detail);
    }
  }

  async uploadFiles<T>(path: string, files: File[]): Promise<T> {
    const formData = new FormData();
    files.forEach(f => formData.append('files', f));
    const h: Record<string, string> = {};
    if (this.token) {
      h['Authorization'] = `Bearer ${this.token}`;
    }
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: h,
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new ApiError(res.status, err.detail);
    }
    return res.json();
  }
}

export class ApiError extends Error {
  constructor(public status: number, public detail: string) {
    super(detail);
    this.name = 'ApiError';
  }
}

export const apiClient = new ApiClient();
```

- [ ] **Step 9: Create frontend/src/main.tsx**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
```

- [ ] **Step 10: Create frontend/src/App.tsx**

```tsx
import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import AnnotationPage from './pages/AnnotationPage';
import StatsPage from './pages/StatsPage';
import AdminUsersPage from './pages/AdminUsersPage';
import AdminLabelsPage from './pages/AdminLabelsPage';
import AdminSettingsPage from './pages/AdminSettingsPage';
import ProtectedRoute from './components/common/ProtectedRoute';
import Layout from './components/common/Layout';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/" element={<AnnotationPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/admin/users" element={<AdminUsersPage />} />
          <Route path="/admin/labels" element={<AdminLabelsPage />} />
          <Route path="/admin/settings" element={<AdminSettingsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
```

- [ ] **Step 11: Verify frontend starts**

```bash
cd frontend && npx vite build --logLevel error
```
Expected: build succeeds (may warn about missing pages — acceptable at this stage)

- [ ] **Step 12: Commit**

```bash
git add frontend/
git commit -m "feat: scaffold frontend with React + TypeScript + Vite + Zustand"
```

---

### Task 9: Auth store + Login page

**Files:**
- Create: `frontend/src/stores/authStore.ts`
- Create: `frontend/src/api/auth.ts`
- Create: `frontend/src/components/common/ProtectedRoute.tsx`
- Create: `frontend/src/pages/LoginPage.tsx`
- Create: `frontend/src/pages/LoginPage.module.css`
- Modify: `frontend/src/main.tsx` (restore token from localStorage)

**Interfaces:**
- Produces: `authStore` — Zustand store with `user`, `token`, `isAuthenticated`, `login()`, `logout()`, `restoreSession()`
- Consumes: `apiClient.setToken()` from `api/client.ts`

- [ ] **Step 1: Create frontend/src/api/auth.ts**

```typescript
import { apiClient } from './client';
import type { TokenResponse } from '../types/api';

export async function loginApi(username: string, password: string): Promise<TokenResponse> {
  return apiClient.post<TokenResponse>('/auth/login', { username, password });
}

export async function registerApi(username: string, password: string): Promise<TokenResponse> {
  return apiClient.post<TokenResponse>('/auth/register', { username, password });
}
```

- [ ] **Step 2: Create frontend/src/stores/authStore.ts**

```typescript
import { create } from 'zustand';
import { apiClient } from '../api/client';
import { loginApi, registerApi } from '../api/auth';

interface AuthState {
  user: { username: string; role: string } | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => void;
  restoreSession: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: false,

  login: async (username, password) => {
    set({ isLoading: true });
    try {
      const data = await loginApi(username, password);
      apiClient.setToken(data.access_token);
      localStorage.setItem('ling_token', data.access_token);
      localStorage.setItem('ling_user', JSON.stringify({ username: data.username, role: data.role }));
      set({
        user: { username: data.username, role: data.role },
        token: data.access_token,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (e) {
      set({ isLoading: false });
      throw e;
    }
  },

  register: async (username, password) => {
    set({ isLoading: true });
    try {
      const data = await registerApi(username, password);
      apiClient.setToken(data.access_token);
      localStorage.setItem('ling_token', data.access_token);
      localStorage.setItem('ling_user', JSON.stringify({ username: data.username, role: data.role }));
      set({
        user: { username: data.username, role: data.role },
        token: data.access_token,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (e) {
      set({ isLoading: false });
      throw e;
    }
  },

  logout: () => {
    apiClient.setToken(null);
    localStorage.removeItem('ling_token');
    localStorage.removeItem('ling_user');
    set({ user: null, token: null, isAuthenticated: false });
  },

  restoreSession: () => {
    const token = localStorage.getItem('ling_token');
    const userStr = localStorage.getItem('ling_user');
    if (token && userStr) {
      try {
        const user = JSON.parse(userStr);
        apiClient.setToken(token);
        set({ user, token, isAuthenticated: true });
      } catch {
        localStorage.removeItem('ling_token');
        localStorage.removeItem('ling_user');
      }
    }
  },
}));
```

- [ ] **Step 3: Create ProtectedRoute**

```tsx
import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';

export default function ProtectedRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
```

- [ ] **Step 4: Create LoginPage.tsx**

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { ApiError } from '../api/client';
import styles from './LoginPage.module.css';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [error, setError] = useState('');
  const { login, register, isLoading } = useAuthStore();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (isRegister) {
        await register(username, password);
      } else {
        await login(username, password);
      }
      navigate('/');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.detail);
      } else {
        setError('网络连接失败');
      }
    }
  };

  return (
    <div className={styles.container}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <h1 className={styles.title}>灵标</h1>
        <p className={styles.subtitle}>在线标注工具</p>
        {error && <div className={styles.error}>{error}</div>}
        <input
          className={styles.input}
          type="text"
          placeholder="用户名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        <input
          className={styles.input}
          type="password"
          placeholder="密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={4}
        />
        <button className={styles.button} type="submit" disabled={isLoading}>
          {isLoading ? '...' : isRegister ? '注册' : '登录'}
        </button>
        <button
          type="button"
          className={styles.switch}
          onClick={() => { setIsRegister(!isRegister); setError(''); }}
        >
          {isRegister ? '已有账号？登录' : '没有账号？注册'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 5: Create LoginPage.module.css**

```css
.container {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
}

.form {
  background: var(--color-surface);
  padding: 40px;
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  width: 360px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.title {
  text-align: center;
  font-size: 28px;
  color: var(--color-primary);
}

.subtitle {
  text-align: center;
  color: var(--color-text-muted);
  font-size: 14px;
  margin-bottom: 8px;
}

.input {
  padding: 10px 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 14px;
  outline: none;
}

.input:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
}

.button {
  padding: 10px;
  background: var(--color-primary);
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 15px;
  cursor: pointer;
}

.button:hover {
  background: var(--color-primary-hover);
}

.button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.switch {
  background: none;
  border: none;
  color: var(--color-text-muted);
  font-size: 13px;
  cursor: pointer;
  text-align: center;
}

.switch:hover {
  color: var(--color-primary);
}

.error {
  background: #fef2f2;
  color: var(--color-danger);
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  text-align: center;
}
```

- [ ] **Step 6: Update main.tsx to restore session**

```tsx
import { useAuthStore } from './stores/authStore';

// Before ReactDOM.createRoot, add:
useAuthStore.getState().restoreSession();
```

- [ ] **Step 7: Create Layout component**

```tsx
import { Outlet, Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';

export default function Layout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '0 24px', height: 48, background: 'var(--color-surface)',
        borderBottom: '1px solid var(--color-border)',
      }}>
        <nav style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <Link to="/" style={{ fontWeight: 700, textDecoration: 'none', color: 'var(--color-primary)' }}>灵标</Link>
          <Link to="/stats" style={{ textDecoration: 'none', color: 'var(--color-text-muted)', fontSize: 14 }}>统计</Link>
          {user?.role === 'admin' && (
            <>
              <Link to="/admin/users" style={{ textDecoration: 'none', color: 'var(--color-text-muted)', fontSize: 14 }}>用户</Link>
              <Link to="/admin/labels" style={{ textDecoration: 'none', color: 'var(--color-text-muted)', fontSize: 14 }}>标签</Link>
              <Link to="/admin/settings" style={{ textDecoration: 'none', color: 'var(--color-text-muted)', fontSize: 14 }}>设置</Link>
            </>
          )}
        </nav>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 14 }}>
          <span style={{ color: 'var(--color-text-muted)' }}>{user?.username} ({user?.role})</span>
          <button onClick={handleLogout} style={{
            background: 'none', border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)', padding: '4px 12px', cursor: 'pointer', fontSize: 13,
          }}>退出</button>
        </div>
      </header>
      <main style={{ flex: 1 }}>
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 8: Create stub pages (so the app renders without errors)**

```tsx
// AnnotationPage.tsx
export default function AnnotationPage() {
  return <div style={{ padding: 24 }}>标注编辑器 — 将在 Phase 2 实现</div>;
}

// StatsPage.tsx
export default function StatsPage() {
  return <div style={{ padding: 24 }}>统计面板 — 将在 Phase 3 实现</div>;
}
```

- [ ] **Step 9: Verify the app builds**

```bash
cd frontend && npx vite build --logLevel error
```
Expected: build succeeds

- [ ] **Step 10: Commit**

```bash
git add frontend/src/stores/authStore.ts frontend/src/api/auth.ts frontend/src/components/common/ProtectedRoute.tsx frontend/src/components/common/Layout.tsx frontend/src/pages/LoginPage.tsx frontend/src/pages/LoginPage.module.css frontend/src/pages/AnnotationPage.tsx frontend/src/pages/StatsPage.tsx frontend/src/main.tsx frontend/src/App.tsx
git commit -m "feat: add auth store, login page, protected routing"
```

---

### Task 10: Admin pages (users, labels, settings)

**Files:**
- Create: `frontend/src/api/users.ts`
- Create: `frontend/src/api/settings.ts`
- Create: `frontend/src/api/labels.ts`
- Create: `frontend/src/stores/labelStore.ts`
- Create: `frontend/src/components/common/ColorPicker.tsx`
- Create: `frontend/src/components/common/ColorPicker.module.css`
- Create: `frontend/src/utils/color-palette.ts`
- Create: `frontend/src/pages/AdminUsersPage.tsx`
- Create: `frontend/src/pages/AdminUsersPage.module.css`
- Create: `frontend/src/pages/AdminLabelsPage.tsx`
- Create: `frontend/src/pages/AdminLabelsPage.module.css`
- Create: `frontend/src/pages/AdminSettingsPage.tsx`
- Create: `frontend/src/pages/AdminSettingsPage.module.css`

**Interfaces:**
- Produces: Admin user management UI (create, list, disable/enable, reset password)
- Produces: Admin label management UI (create, edit, delete, color picker, txt import)
- Produces: Admin settings UI (configure WORK_DIR)

- [ ] **Step 1: Create api/users.ts**

```typescript
import { apiClient } from './client';
import type { User } from '../types/api';

export async function fetchUsers(): Promise<User[]> {
  return apiClient.get<User[]>('/users');
}

export async function createUser(data: { username: string; password: string; role: string }): Promise<User> {
  return apiClient.post<User>('/users', data);
}

export async function updateUser(id: number, data: { is_active?: boolean; password?: string; role?: string }): Promise<User> {
  return apiClient.put<User>(`/users/${id}`, data);
}
```

- [ ] **Step 2: Create api/settings.ts**

```typescript
import { apiClient } from './client';

export async function fetchSettings(): Promise<Record<string, string>> {
  return apiClient.get<Record<string, string>>('/settings');
}

export async function updateSetting(key: string, value: string): Promise<void> {
  await apiClient.put(`/settings/${key}`, { value });
}
```

- [ ] **Step 3: Create api/labels.ts**

```typescript
import { apiClient } from './client';
import type { Label } from '../types/api';

export async function fetchLabels(): Promise<Label[]> {
  return apiClient.get<Label[]>('/labels');
}

export async function createLabel(data: { name: string; color: string }): Promise<Label> {
  return apiClient.post<Label>('/labels', data);
}

export async function updateLabel(id: number, data: Partial<Label>): Promise<Label> {
  return apiClient.put<Label>(`/labels/${id}`, data);
}

export async function deleteLabel(id: number): Promise<void> {
  await apiClient.delete(`/labels/${id}`);
}

export async function importLabelsTxt(content: string): Promise<Label[]> {
  return apiClient.post<Label[]>('/labels/import-txt', { content });
}
```

- [ ] **Step 4: Create utils/color-palette.ts**

```typescript
export const DEFAULT_PALETTE = [
  '#ff4444', '#44ff44', '#4488ff', '#ffaa00', '#aa44ff',
  '#00cccc', '#ff66aa', '#aacc00', '#886644', '#ff8844',
];

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const v = parseInt(hex.slice(1), 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 5: Create ColorPicker component**

```tsx
import { useState } from 'react';
import { DEFAULT_PALETTE } from '../../utils/color-palette';
import styles from './ColorPicker.module.css';

interface Props {
  value: string;
  onChange: (color: string) => void;
}

export default function ColorPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className={styles.wrapper}>
      <button
        className={styles.swatch}
        style={{ backgroundColor: value }}
        onClick={() => setOpen(!open)}
        type="button"
      />
      {open && (
        <div className={styles.popover}>
          <div className={styles.grid}>
            {DEFAULT_PALETTE.map(c => (
              <button
                key={c}
                className={`${styles.cell} ${c === value ? styles.selected : ''}`}
                style={{ backgroundColor: c }}
                onClick={() => { onChange(c); setOpen(false); }}
                type="button"
              />
            ))}
          </div>
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={styles.input}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Create ColorPicker.module.css**

```css
.wrapper { position: relative; display: inline-block; }
.swatch {
  width: 28px; height: 28px; border-radius: 50%;
  border: 2px solid var(--color-border); cursor: pointer;
}
.popover {
  position: absolute; top: 36px; left: 0; z-index: 100;
  background: var(--color-surface); border: 1px solid var(--color-border);
  border-radius: var(--radius-md); padding: 12px;
  box-shadow: var(--shadow-md);
}
.grid { display: grid; grid-template-columns: repeat(5, 28px); gap: 6px; margin-bottom: 8px; }
.cell {
  width: 28px; height: 28px; border-radius: 50%; border: 2px solid transparent;
  cursor: pointer;
}
.selected { border-color: var(--color-text); }
.input { width: 100%; height: 32px; border: none; cursor: pointer; }
```

- [ ] **Step 7: Create AdminUsersPage.tsx**

```tsx
import { useState, useEffect } from 'react';
import { fetchUsers, createUser, updateUser } from '../api/users';
import type { User } from '../types/api';
import { ApiError } from '../api/client';
import styles from './AdminUsersPage.module.css';

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'annotator' });
  const [error, setError] = useState('');

  const load = async () => {
    try { setUsers(await fetchUsers()); } catch { setError('加载失败'); }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await createUser(newUser);
      setNewUser({ username: '', password: '', role: 'annotator' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : '创建失败');
    }
  };

  const handleToggle = async (user: User) => {
    try {
      await updateUser(user.id, { is_active: !user.is_active });
      await load();
    } catch { setError('操作失败'); }
  };

  const handleResetPw = async (user: User) => {
    const pw = prompt(`为 ${user.username} 设置新密码（至少4位）：`);
    if (!pw) return;
    try {
      await updateUser(user.id, { password: pw });
    } catch { setError('密码重置失败'); }
  };

  return (
    <div className={styles.page}>
      <h2 className={styles.heading}>用户管理</h2>
      {error && <div className={styles.error}>{error}</div>}
      <form className={styles.form} onSubmit={handleCreate}>
        <input className={styles.input} placeholder="用户名" value={newUser.username}
          onChange={e => setNewUser({...newUser, username: e.target.value})} required />
        <input className={styles.input} type="password" placeholder="密码" value={newUser.password}
          onChange={e => setNewUser({...newUser, password: e.target.value})} required minLength={4} />
        <select className={styles.input} value={newUser.role}
          onChange={e => setNewUser({...newUser, role: e.target.value})}>
          <option value="annotator">标注员</option>
          <option value="admin">管理员</option>
        </select>
        <button className={styles.btn} type="submit">创建账号</button>
      </form>
      <table className={styles.table}>
        <thead>
          <tr><th>用户名</th><th>角色</th><th>状态</th><th>创建时间</th><th>操作</th></tr>
        </thead>
        <tbody>
          {users.map(u => (
            <tr key={u.id}>
              <td>{u.username}</td>
              <td>{u.role === 'admin' ? '管理员' : '标注员'}</td>
              <td>{u.is_active ? '启用' : '禁用'}</td>
              <td>{new Date(u.created_at).toLocaleDateString('zh-CN')}</td>
              <td className={styles.actions}>
                <button className={styles.btnSmall} onClick={() => handleToggle(u)}>
                  {u.is_active ? '禁用' : '启用'}
                </button>
                <button className={styles.btnSmall} onClick={() => handleResetPw(u)}>改密</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 8: Create AdminLabelsPage.tsx**

```tsx
import { useState, useEffect, useRef } from 'react';
import { fetchLabels, createLabel, updateLabel, deleteLabel, importLabelsTxt } from '../api/labels';
import type { Label } from '../types/api';
import { ApiError } from '../api/client';
import ColorPicker from '../components/common/ColorPicker';
import styles from './AdminLabelsPage.module.css';

export default function AdminLabelsPage() {
  const [labels, setLabels] = useState<Label[]>([]);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try { setLabels(await fetchLabels()); } catch { setError('加载失败'); }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await createLabel({ name: newName, color: '#3388ff' });
      setNewName('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : '创建失败');
    }
  };

  const handleColor = async (label: Label, color: string) => {
    await updateLabel(label.id, { color });
    await load();
  };

  const handleDelete = async (label: Label) => {
    if (!confirm(`确定删除标签「${label.name}」？`)) return;
    await deleteLabel(label.id);
    await load();
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      await importLabelsTxt(text);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : '导入失败');
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className={styles.page}>
      <h2 className={styles.heading}>标签管理</h2>
      {error && <div className={styles.error}>{error}</div>}
      <form className={styles.form} onSubmit={handleCreate}>
        <input className={styles.input} placeholder="标签名称" value={newName}
          onChange={e => setNewName(e.target.value)} required />
        <button className={styles.btn} type="submit">新建标签</button>
      </form>
      <div className={styles.importRow}>
        <button className={styles.btn} onClick={() => fileRef.current?.click()}>从 txt 文件导入</button>
        <input ref={fileRef} type="file" accept=".txt" onChange={handleFileImport} hidden />
      </div>
      <table className={styles.table}>
        <thead>
          <tr><th>颜色</th><th>名称</th><th>操作</th></tr>
        </thead>
        <tbody>
          {labels.map(l => (
            <tr key={l.id}>
              <td><ColorPicker value={l.color} onChange={(c) => handleColor(l, c)} /></td>
              <td>{l.name}</td>
              <td>
                <button className={styles.btnDanger} onClick={() => handleDelete(l)}>删除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 9: Create AdminSettingsPage.tsx**

```tsx
import { useState, useEffect } from 'react';
import { fetchSettings, updateSetting } from '../api/settings';
import { ApiError } from '../api/client';
import styles from './AdminSettingsPage.module.css';

export default function AdminSettingsPage() {
  const [workDir, setWorkDir] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchSettings().then(s => { if (s.WORK_DIR) setWorkDir(s.WORK_DIR); }).catch(() => {});
  }, []);

  const handleSave = async () => {
    setError('');
    setSaved(false);
    try {
      await updateSetting('WORK_DIR', workDir);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : '保存失败');
    }
  };

  return (
    <div className={styles.page}>
      <h2 className={styles.heading}>应用设置</h2>
      {error && <div className={styles.error}>{error}</div>}
      {saved && <div className={styles.success}>已保存</div>}
      <div className={styles.field}>
        <label className={styles.label}>工作目录（数据根目录）</label>
        <input className={styles.input} value={workDir}
          onChange={e => setWorkDir(e.target.value)}
          placeholder="/path/to/data" />
        <p className={styles.hint}>图像批次将存放在此目录下的 batches/ 子目录中</p>
      </div>
      <button className={styles.btn} onClick={handleSave}>保存设置</button>
    </div>
  );
}
```

- [ ] **Step 10: Create CSS modules for admin pages**

For `AdminUsersPage.module.css`:
```css
.page { padding: 24px; max-width: 900px; }
.heading { font-size: 20px; margin-bottom: 16px; }
.error { background: #fef2f2; color: var(--color-danger); padding: 8px 12px; border-radius: var(--radius-sm); margin-bottom: 12px; font-size: 13px; }
.form { display: flex; gap: 8px; margin-bottom: 20px; }
.input { padding: 8px 12px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); font-size: 14px; }
.btn { padding: 8px 16px; background: var(--color-primary); color: #fff; border: none; border-radius: var(--radius-sm); cursor: pointer; font-size: 14px; }
.table { width: 100%; border-collapse: collapse; font-size: 14px; }
.table th, .table td { padding: 10px 12px; border-bottom: 1px solid var(--color-border); text-align: left; }
.table th { color: var(--color-text-muted); font-weight: 600; }
.actions { display: flex; gap: 6px; }
.btnSmall { padding: 4px 10px; font-size: 12px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface); cursor: pointer; }
```

For `AdminLabelsPage.module.css`:
```css
.page { padding: 24px; max-width: 700px; }
.heading { font-size: 20px; margin-bottom: 16px; }
.error { background: #fef2f2; color: var(--color-danger); padding: 8px 12px; border-radius: var(--radius-sm); margin-bottom: 12px; font-size: 13px; }
.form { display: flex; gap: 8px; margin-bottom: 16px; }
.input { padding: 8px 12px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); font-size: 14px; flex: 1; }
.btn { padding: 8px 16px; background: var(--color-primary); color: #fff; border: none; border-radius: var(--radius-sm); cursor: pointer; font-size: 14px; }
.importRow { margin-bottom: 20px; }
.table { width: 100%; border-collapse: collapse; font-size: 14px; }
.table th, .table td { padding: 10px 12px; border-bottom: 1px solid var(--color-border); text-align: left; }
.table th { color: var(--color-text-muted); font-weight: 600; }
.btnDanger { padding: 4px 10px; font-size: 12px; border: 1px solid var(--color-danger); border-radius: var(--radius-sm); background: var(--color-surface); color: var(--color-danger); cursor: pointer; }
```

For `AdminSettingsPage.module.css`:
```css
.page { padding: 24px; max-width: 700px; }
.heading { font-size: 20px; margin-bottom: 16px; }
.error { background: #fef2f2; color: var(--color-danger); padding: 8px 12px; border-radius: var(--radius-sm); margin-bottom: 12px; font-size: 13px; }
.success { background: #f0fdf4; color: var(--color-success); padding: 8px 12px; border-radius: var(--radius-sm); margin-bottom: 12px; font-size: 13px; }
.field { margin-bottom: 20px; }
.label { display: block; font-size: 14px; font-weight: 600; margin-bottom: 6px; }
.input { width: 100%; padding: 10px 14px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); font-size: 14px; }
.hint { font-size: 12px; color: var(--color-text-muted); margin-top: 4px; }
.btn { padding: 10px 20px; background: var(--color-primary); color: #fff; border: none; border-radius: var(--radius-sm); cursor: pointer; font-size: 14px; }
```

- [ ] **Step 11: Create labelStore.ts**

```typescript
import { create } from 'zustand';
import { fetchLabels } from '../api/labels';
import type { Label } from '../types/api';

interface LabelState {
  labels: Label[];
  loaded: boolean;
  load: () => Promise<void>;
}

export const useLabelStore = create<LabelState>((set) => ({
  labels: [],
  loaded: false,
  load: async () => {
    const labels = await fetchLabels();
    set({ labels, loaded: true });
  },
}));
```

- [ ] **Step 12: Verify build**

```bash
cd frontend && npx vite build --logLevel error
```
Expected: build succeeds

- [ ] **Step 13: Commit**

```bash
git add frontend/src/api/users.ts frontend/src/api/settings.ts frontend/src/api/labels.ts frontend/src/stores/labelStore.ts frontend/src/components/common/ColorPicker.tsx frontend/src/components/common/ColorPicker.module.css frontend/src/utils/color-palette.ts frontend/src/pages/AdminUsersPage.tsx frontend/src/pages/AdminUsersPage.module.css frontend/src/pages/AdminLabelsPage.tsx frontend/src/pages/AdminLabelsPage.module.css frontend/src/pages/AdminSettingsPage.tsx frontend/src/pages/AdminSettingsPage.module.css
git commit -m "feat: add admin pages for user, label, and settings management"
```

---

### Task 11: Batch list + Image list in Annotation page

**Files:**
- Create: `frontend/src/api/batches.ts`
- Create: `frontend/src/api/images.ts`
- Create: `frontend/src/stores/batchStore.ts`
- Create: `frontend/src/components/panels/BatchSelector.tsx`
- Create: `frontend/src/components/panels/BatchSelector.module.css`
- Create: `frontend/src/components/panels/ImageList.tsx`
- Create: `frontend/src/components/panels/ImageList.module.css`
- Modify: `frontend/src/pages/AnnotationPage.tsx`

**Interfaces:**
- Produces: `batchStore` — Zustand store with batches, currentBatch, fetch/select
- Produces: `BatchSelector` — dropdown to pick batch, scan button, upload button
- Produces: `ImageList` — scrollable list of images with status icons
- Produces: `AnnotationPage` — assembled layout (LeftPanel + center placeholder + right placeholder)

- [ ] **Step 1: Create api/batches.ts**

```typescript
import { apiClient } from './client';
import type { Batch, ImageInfo } from '../types/api';

export async function fetchBatches(): Promise<Batch[]> {
  return apiClient.get<Batch[]>('/batches');
}

export async function createBatch(name: string): Promise<Batch> {
  return apiClient.post<Batch>('/batches', { name });
}

export async function scanBatches(): Promise<{ added: number; skipped: number; errors: unknown[] }> {
  return apiClient.post('/batches/scan');
}

export async function uploadImages(batchId: number, files: File[]): Promise<ImageInfo[]> {
  return apiClient.uploadFiles<ImageInfo[]>(`/batches/${batchId}/upload`, files);
}
```

- [ ] **Step 2: Create api/images.ts**

```typescript
import { apiClient } from './client';
import type { ImageInfo } from '../types/api';

export async function fetchImages(batchId: number): Promise<ImageInfo[]> {
  return apiClient.get<ImageInfo[]>(`/batches/${batchId}/images`);
}

export async function fetchImage(id: number): Promise<ImageInfo> {
  return apiClient.get<ImageInfo>(`/images/${id}`);
}
```

- [ ] **Step 3: Create stores/batchStore.ts**

```typescript
import { create } from 'zustand';
import { fetchBatches, scanBatches, createBatch, uploadImages } from '../api/batches';
import { fetchImages } from '../api/images';
import type { Batch, ImageInfo } from '../types/api';

interface BatchState {
  batches: Batch[];
  currentBatchId: number | null;
  images: ImageInfo[];
  loading: boolean;
  loadBatches: () => Promise<void>;
  selectBatch: (batchId: number) => Promise<void>;
  doScan: () => Promise<{ added: number; skipped: number }>;
  doCreateAndUpload: (name: string, files: File[]) => Promise<void>;
}

export const useBatchStore = create<BatchState>((set, get) => ({
  batches: [],
  currentBatchId: null,
  images: [],
  loading: false,

  loadBatches: async () => {
    const batches = await fetchBatches();
    set({ batches });
  },

  selectBatch: async (batchId) => {
    set({ loading: true, currentBatchId: batchId });
    try {
      const images = await fetchImages(batchId);
      set({ images, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  doScan: async () => {
    const result = await scanBatches();
    await get().loadBatches();
    return result;
  },

  doCreateAndUpload: async (name, files) => {
    const batch = await createBatch(name);
    await uploadImages(batch.id, files);
    await get().loadBatches();
    await get().selectBatch(batch.id);
  },
}));
```

- [ ] **Step 4: Create BatchSelector component**

```tsx
import { useEffect, useRef, useState } from 'react';
import { useBatchStore } from '../../stores/batchStore';
import styles from './BatchSelector.module.css';

export default function BatchSelector() {
  const { batches, currentBatchId, loadBatches, selectBatch, doScan, doCreateAndUpload, loading } = useBatchStore();
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadBatches(); }, [loadBatches]);

  const handleScan = async () => {
    const result = await doScan();
    alert(`扫描完成：新增 ${result.added}，跳过 ${result.skipped}`);
  };

  const handleUploadClick = () => {
    const name = prompt('输入批次名称：');
    if (!name) return;
    fileRef.current?.click();
    (fileRef.current as HTMLInputElement & { _batchName?: string })._batchName = name;
  };

  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const name = (e.target as HTMLInputElement & { _batchName?: string })._batchName;
    if (!name || files.length === 0) return;
    setUploading(true);
    try {
      await doCreateAndUpload(name, files);
    } catch {
      alert('上传失败');
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className={styles.wrapper}>
      <select
        className={styles.select}
        value={currentBatchId ?? ''}
        onChange={(e) => { const id = Number(e.target.value); if (id) selectBatch(id); }}
        disabled={loading}
      >
        <option value="">-- 选择批次 --</option>
        {batches.map(b => (
          <option key={b.id} value={b.id}>{b.name} ({b.done_count}/{b.image_count})</option>
        ))}
      </select>
      <div className={styles.actions}>
        <button className={styles.btn} onClick={handleScan} disabled={loading}>扫描</button>
        <button className={styles.btn} onClick={handleUploadClick} disabled={uploading}>
          {uploading ? '上传中...' : '上传'}
        </button>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/tiff" multiple
          onChange={handleFilesSelected} hidden />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create ImageList component**

```tsx
import { useBatchStore } from '../../stores/batchStore';
import styles from './ImageList.module.css';

const STATUS_LABELS: Record<string, string> = {
  pending: '未开始',
  in_progress: '进行中',
  done: '已完成',
};

const STATUS_ICONS: Record<string, string> = {
  pending: '○',
  in_progress: '◐',
  done: '●',
};

export default function ImageList() {
  const { images, loading, currentBatchId } = useBatchStore();

  if (!currentBatchId) {
    return <div className={styles.empty}>请选择批次</div>;
  }

  if (loading) {
    return <div className={styles.empty}>加载中...</div>;
  }

  if (images.length === 0) {
    return <div className={styles.empty}>暂无图像</div>;
  }

  return (
    <div className={styles.list}>
      {images.map(img => (
        <div key={img.id} className={styles.item}>
          <span className={styles.status} title={STATUS_LABELS[img.status] || img.status}
            style={{ color: img.status === 'done' ? 'var(--color-success)' : img.status === 'in_progress' ? 'var(--color-warning)' : 'var(--color-text-muted)' }}>
            {STATUS_ICONS[img.status] || '○'}
          </span>
          <span className={styles.name}>{img.file_name}</span>
          {img.locked_by_username && (
            <span className={styles.lock} title={`被 ${img.locked_by_username} 锁定`}>🔒</span>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Create CSS modules**

For `BatchSelector.module.css`:
```css
.wrapper { padding: 12px; border-bottom: 1px solid var(--color-border); }
.select { width: 100%; padding: 8px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); font-size: 14px; margin-bottom: 8px; }
.actions { display: flex; gap: 6px; }
.btn { flex: 1; padding: 6px 0; font-size: 13px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface); cursor: pointer; }
.btn:hover { background: var(--color-bg); }
```

For `ImageList.module.css`:
```css
.empty { padding: 24px; text-align: center; color: var(--color-text-muted); font-size: 14px; }
.list { overflow-y: auto; flex: 1; }
.item { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--color-border); font-size: 13px; cursor: pointer; }
.item:hover { background: var(--color-bg); }
.status { font-size: 14px; flex-shrink: 0; }
.name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lock { flex-shrink: 0; font-size: 12px; }
```

- [ ] **Step 7: Update AnnotationPage to use LeftPanel**

```tsx
import BatchSelector from '../components/panels/BatchSelector';
import ImageList from '../components/panels/ImageList';

export default function AnnotationPage() {
  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 48px)' }}>
      {/* Left panel */}
      <div style={{ width: 260, background: 'var(--color-surface)', borderRight: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column' }}>
        <BatchSelector />
        <ImageList />
      </div>
      {/* Center — canvas placeholder */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)' }}>
        选择一张图像开始标注
      </div>
      {/* Right panel placeholder */}
      <div style={{ width: 260, background: 'var(--color-surface)', borderLeft: '1px solid var(--color-border)', padding: 12 }}>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>标签与状态面板 — Phase 2</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Verify build and do a manual integration check**

```bash
cd frontend && npx vite build --logLevel error
```
Expected: build succeeds

- [ ] **Step 9: Commit**

```bash
git add frontend/src/api/batches.ts frontend/src/api/images.ts frontend/src/stores/batchStore.ts frontend/src/components/panels/BatchSelector.tsx frontend/src/components/panels/BatchSelector.module.css frontend/src/components/panels/ImageList.tsx frontend/src/components/panels/ImageList.module.css frontend/src/pages/AnnotationPage.tsx
git commit -m "feat: add batch selector and image list to annotation page"
```

---

## Phase 1 Verification

Run both backend and frontend test suites:

```bash
# Backend
cd backend && python -m pytest app/tests/ -v

# Frontend (if tests configured)
cd frontend && npx vitest run
```

Then do a manual smoke test:

```bash
# Terminal 1 — start backend
cd backend && uvicorn app.main:app --reload --port 8000

# Terminal 2 — start frontend
cd frontend && npm run dev
```

1. Open http://localhost:5173 → redirected to /login
2. Login with admin/admin → see the annotation page shell
3. Go to /admin/settings → set WORK_DIR to a temp directory
4. Go to /admin/labels → create a couple labels, import labels from txt
5. Go to /admin/users → create a test annotator account
6. Go back to / → create a batch, upload some images → see them in the image list
7. Logout, login as annotator → verify annotator cannot access admin pages
8. Verify annotator can see batches and image list

Phase 1 is complete when all of the above works end-to-end.
