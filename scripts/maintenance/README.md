# 维护脚本

本目录的脚本不应加入 cron、systemd timer 或其他日常调度。日常采集只使用上级目录的
`sync_scs_incremental.py`、`sync_rty_incremental.py` 和 `spider_change_result.py`。

所有写库脚本默认仅输出统计。执行前先确认 dry-run 输出，数据库备份完成后才传 `--apply`。

| 文件 | 用途 |
|---|---|
| `backfill_repair_orders.py` | 通过本地关联回填维修记录的生产订单和销售订单 |
| `backfill_repair_orders_from_sap_sn.py` | 通过 SAP SN 接口补全缺失维修订单字段 |
| `backfill_repair_customers.py` | 通过销售订单主数据回填维修记录客户；日常 RTY 同步已覆盖此能力 |
| `migrate_scs_doa_keys.py` | 迁移历史 SCS DOA 稳定键并清理重复记录 |
| `sync_sales_orders_range.py` | 手工按日期范围同步 SAP 销售订单，不创建 RTY 水位线 |
| `benchmark_rty.py` | 只读 RTY 查询性能与执行计划基准 |
| `backfill_station_pass_fields.py` | 回填工位直通率聚合所需规范字段；默认 dry-run，使用 `--apply` 写入 |
