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

