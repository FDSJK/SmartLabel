def test_model_configs_and_jobs_tables_exist(app):
    from sqlalchemy import inspect
    from app.core.db import get_db

    db = next(app.dependency_overrides[get_db]())
    engine = db.get_bind()
    tables = inspect(engine).get_table_names()
    assert "model_configs" in tables
    assert "inference_jobs" in tables
