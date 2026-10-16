"""Request-local production-base access shared by dashboards and exports."""

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar

from fastapi import HTTPException

BASE_OPTIONS = (
    ("1000", "天津", "TJ"),
    ("2000", "盘锦", "PJ"),
    ("3000", "昆山", "KS"),
    ("7000", "太原", "TY"),
    ("8000", "安阳", "AY"),
    ("9000", "桐乡", "TX"),
    ("D000", "大同", "DT"),
    ("QD", "青岛", "QD"),
    ("ML", "马来", "ML"),
)
_ALIASES = {alias: code for code, name, short in BASE_OPTIONS for alias in (code, name, short)}
_BASE_SCOPE: ContextVar[tuple[str, ...] | None] = ContextVar("base_permissions", default=None)


def canonical_base(value: object) -> str:
    text = str(value or "").strip()
    return _ALIASES.get(text, text)


def normalize_base_permissions(values: list[str] | None) -> list[str] | None:
    if values is None:
        return None
    return sorted({canonical_base(value) for value in values})


def current_base_permissions() -> tuple[str, ...] | None:
    return _BASE_SCOPE.get()


@contextmanager
def base_access_scope(values: list[str] | tuple[str, ...] | None) -> Iterator[None]:
    token = _BASE_SCOPE.set(
        None if values is None else tuple(sorted({canonical_base(value) for value in values}))
    )
    try:
        yield
    finally:
        _BASE_SCOPE.reset(token)


def base_allowed(value: object) -> bool:
    scope = current_base_permissions()
    return scope is None or canonical_base(value) in scope


def require_base_access(value: str | None) -> None:
    if value and value.strip() not in ("all", "全部"):
        for part in value.replace("，", ",").split(","):
            if part.strip() and not base_allowed(part):
                raise HTTPException(status_code=403, detail="无权查看或搜索该基地")


def require_scope_subset(actor: dict, values: list[str] | None) -> None:
    allowed = actor.get("basePermissions")
    if allowed is not None and (values is None or set(values) - set(allowed)):
        raise HTTPException(status_code=403, detail="不能管理或授予超出本人权限的基地")
