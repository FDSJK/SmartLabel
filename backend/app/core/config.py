from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    WORK_DIR: str = "./data"
    SECRET_KEY: str = "dev-secret-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480  # 8 hours

    @property
    def DATABASE_URL(self) -> str:
        return f"sqlite:///{self.WORK_DIR}/metadata.db"

    model_config = {"env_prefix": "LING_", "extra": "ignore"}


settings = Settings()
