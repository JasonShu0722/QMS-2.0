from app.core.config import Settings, prefer_ipv4_loopback_for_localhost


def test_database_url_uses_ipv4_loopback_for_localhost():
    settings = Settings(
        _env_file=None,
        DATABASE_URL="postgresql+asyncpg://qms_user:qms_dev_password@localhost:5432/qms_db",
    )

    assert (
        settings.DATABASE_URL
        == "postgresql+asyncpg://qms_user:qms_dev_password@127.0.0.1:5432/qms_db"
    )


def test_redis_url_uses_ipv4_loopback_for_localhost():
    settings = Settings(
        _env_file=None,
        REDIS_URL="redis://:redis_password@localhost:6379/0",
    )

    assert settings.REDIS_URL == "redis://:redis_password@127.0.0.1:6379/0"


def test_non_localhost_urls_are_preserved():
    url = "postgresql+asyncpg://qms_user:qms_dev_password@postgres:5432/qms_db"

    assert prefer_ipv4_loopback_for_localhost(url) == url


def test_localhost_url_without_port_is_supported():
    assert (
        prefer_ipv4_loopback_for_localhost("redis://localhost/0")
        == "redis://127.0.0.1/0"
    )


def test_malformed_localhost_port_is_preserved():
    url = "postgresql+asyncpg://qms_user:qms_dev_password@localhost:not-a-port/qms_db"

    assert prefer_ipv4_loopback_for_localhost(url) == url
