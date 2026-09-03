"""
MongoDB Document 模型定义

定义各 Collection 的文档结构
"""

# ============== MongoDB Collections ==============


class Collections:
    """MongoDB Collection 名称常量"""

    MACHINE_INFO = "machine_info"
    FAULT_INFO = "fault_info"
    CONFIGS = "configs"
    USERS = "users"
    SALES_ORDERS_SAP = "sales_orders_sap"
    ORDER_BOM_POSTINGS_SAP = "order_bom_postings_sap"
    SERIAL_BINDINGS_SAP = "serial_bindings_sap"
    REPAIR_RECORDS_SAP = "repair_records_sap"
    STATION_RECORDS_SAP = "station_records_sap"
    LRR_LIST_CACHE = "lrr_list_cache"
    LRR_LIST_CACHE_LOCKS = "lrr_list_cache_locks"
    SCS_DOA_RESULTS = "scs_doa_results"
    # SCS 换上换下（换件登记）采集结果，与 scs_doa_results 通过 data.服务单号 关联
    SCS_CHANGE_RESULTS = "scs_change_results"
