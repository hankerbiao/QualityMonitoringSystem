"""Pure alert-mail mapping and sanitization helpers."""

import html
import re
from dataclasses import dataclass
from typing import Any

EMAIL_DEFAULT = "manager@company.com; quality-team@company.com"


@dataclass(frozen=True)
class MailTarget:
    enabled: bool
    recipients: tuple[str, ...]


def parse_emails(raw: str) -> list[str]:
    """Parse the UI's semicolon/comma/whitespace recipient format."""
    if not raw:
        return []
    parts = re.split(r"[;；,，\s]+", raw.strip())
    return [part for part in parts if part and "@" in part]


def target_from_config(document: dict[str, Any] | None) -> MailTarget:
    if document is None:
        return MailTarget(True, tuple(parse_emails(EMAIL_DEFAULT)))
    return MailTarget(
        bool(document.get("enabled", True)),
        tuple(parse_emails(str(document.get("emails", "")))),
    )


def severity_color(severity: str) -> tuple[str, str]:
    colors = {
        "严重": ("#dc2626", "#fef2f2"),
        "警告": ("#d97706", "#fffbeb"),
        "提示": ("#2563eb", "#eff6ff"),
    }
    return colors.get((severity or "").strip(), ("#475569", "#f1f5f9"))


def escape_html(value: Any) -> str:
    return html.escape("" if value is None else str(value))


def cell_html(value: str) -> str:
    return (
        f'<td style="padding:8px 10px;border-bottom:1px solid #eef2f7;'
        f'font-size:13px;color:#334155;">{escape_html(value)}</td>'
    )
