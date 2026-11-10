"""MDM material vendor lookup used by the FA application form."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlencode

import httpx

BASE = "http://mdm.cooacloud.com"
API_LIST = "/mdm/masterData/resultFirst"
API_VIEW = "/masterdata/apply/getMdViewByMdCateId"
REFERER = BASE + "/masterdata/management/masterdata_query_result.html?mdTypeCode=S_ITEM"
VENDOR_KEY = "ZMDM_PART_VENDOR"


class MdmCookieExpired(Exception):
    """The configured MDM session is no longer authenticated."""


def _cookie_value(value: str) -> str:
    value = value.strip()
    if value.lower().startswith("cookie:"):
        value = value.split(":", 1)[1].strip()
    return value


def _is_login_redirect(response: httpx.Response) -> bool:
    location = response.headers.get("location", "").lower()
    return response.status_code in {301, 302, 303, 307, 308} or "ssoserver/login" in location


async def lookup_vendor(pn: str, cookie: str) -> str | None:
    cookie = _cookie_value(cookie)
    if not cookie:
        raise MdmCookieExpired

    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "X-Requested-With": "XMLHttpRequest",
        "Cookie": cookie,
        "Referer": REFERER,
    }
    # MDM is an internal host. The local/global HTTP proxy returns an empty
    # 502 for it, while a direct request reaches the MDM login endpoint.
    async with httpx.AsyncClient(
        follow_redirects=False, timeout=20, trust_env=False
    ) as client:
        home = await client.get(BASE + "/", headers=headers)
        if _is_login_redirect(home):
            raise MdmCookieExpired
        home.raise_for_status()
        match = re.search(r'name="_csrf"\s+content="([^"]+)"', home.text)
        if not match:
            if "login" in home.text.lower():
                raise MdmCookieExpired
            raise RuntimeError("MDM 首页未返回 CSRF 令牌")
        csrf = match.group(1)
        request_headers = {**headers, "X-CSRF-TOKEN": csrf, "Content-Type": "application/json"}
        response = await client.post(
            BASE + API_LIST,
            headers=request_headers,
            json={
                "mdTypeId": "4",
                "mdTypeName": "物料",
                "mdTypeCode": "S_ITEM",
                "queryAttributes": [],
                "topCateIds": [],
                "topCateCodes": [],
                "masterCodeFrom": pn,
                "page": 1,
                "pageSize": 10,
            },
        )
        if _is_login_redirect(response):
            raise MdmCookieExpired
        response.raise_for_status()
        listing = response.json()
        if not listing.get("success"):
            raise RuntimeError("MDM 物料查询失败")
        row = next(
            (
                item
                for item in listing.get("rows", [])
                if str(item.get("MD_CODE", "")).strip() == pn
            ),
            None,
        )
        if not row:
            return None

        params = [
            ("mdTypeCode", "S_ITEM"),
            ("mdCateCode", row.get("MD_CATE_CODE") or ""),
            ("mdId", str(row.get("ID") or "")),
            ("operationType", "SELECT"),
            ("orgTypeIds", ""),
            ("orgIdStr", ""),
            ("locale", "zh_CN"),
            ("sourceCode", "null"),
        ]
        view_url = f"{BASE}{API_VIEW}?{urlencode(params)}&baseUrl="
        detail = await client.get(view_url, headers={**headers, "X-CSRF-TOKEN": csrf})
        if _is_login_redirect(detail):
            raise MdmCookieExpired
        detail.raise_for_status()
        payload: dict[str, Any] = detail.json()
        value = ((payload.get("data") or {}).get("attrValues") or {}).get(VENDOR_KEY)
        return str(value).strip() if value else None
