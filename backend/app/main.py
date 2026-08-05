import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core import settings, init_db, Base
from app.core.db import get_engine
from app.api import api_router


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

app.include_router(api_router)
