import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core import settings, init_db, Base
from app.core.db import get_engine
from app.core.migrations import run_migrations
from app.api import api_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(settings.WORK_DIR, exist_ok=True)
    init_db(settings.DATABASE_URL)
    Base.metadata.create_all(bind=get_engine())
    run_migrations(get_engine())

    from sqlalchemy.orm import Session as DBSession
    from app.core.security import hash_password
    from app.models.user import User

    with DBSession(get_engine()) as db:
        if db.query(User).filter(User.role == "admin").count() == 0:
            admin = User(
                username="admin",
                password_hash=hash_password("admin"),
                role="admin",
                is_active=True,
            )
            db.add(admin)
            db.commit()

    yield


app = FastAPI(title="Ling Label", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)
