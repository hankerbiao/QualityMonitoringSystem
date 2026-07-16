BASE_MAP = {
    "1000": ("天津", "TJ"),
    "2000": ("盘锦", "PJ"),
    "3000": ("昆山", "KS"),
    "7000": ("太原", "TY"),
    "8000": ("安阳", "AY"),
    "9000": ("桐乡", "TX"),
}

ALL_BASES = list(BASE_MAP.keys())

BASE_ID_TO_NAME = {k: v[0] for k, v in BASE_MAP.items()}
BASE_ID_TO_CODE = {k: v[1] for k, v in BASE_MAP.items()}

# 工厂名（中文）→ base ID 反向映射，如 "天津" -> "1000"
BASE_NAME_TO_ID = {v[0]: k for k, v in BASE_MAP.items()}

# MES 接口 base 参数接受的「SQL in」片段（与 MesClient 各方法默认 base 保持一致）
ALL_BASES_SQL = "','".join(ALL_BASES)  # -> "1000','2000','3000','7000','8000','9000"

