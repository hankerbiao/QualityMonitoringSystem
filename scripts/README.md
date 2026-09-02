# 脚本目录

## 数据同步脚本已归档

所有会访问 SAP、HANA 或 SCS，并向本项目 MongoDB 写入业务原始数据的脚本，均已移至
[`archive/data_sync/`](archive/data_sync/)。这些脚本不属于当前系统运行时，不得加入
cron、systemd timer 或其他自动调度。

归档脚本仅用于已审批的历史数据恢复、离线迁移或审计。执行前必须确认：

- 数据网关无法提供所需历史数据；
- 已完成目标集合备份；
- 已明确执行范围和回滚方案。

归档内容及历史目标集合见 [`archive/data_sync/README.md`](archive/data_sync/README.md)。

## 当前保留脚本

| 文件 | 用途 | 写入数据库 |
|---|---|---|
| `export_doa_is_5000.py` | 导出已有 DOA 数据到 Excel | 否 |
| `export_station_records.py` | 导出已有工位记录到 Excel | 否 |
| `maintenance/benchmark_rty.py` | RTY 查询性能诊断 | 否 |

`maintenance/` 的约束见 [`maintenance/README.md`](maintenance/README.md)。

本地生成的 `__pycache__/`、`.DS_Store` 等文件不属于源码，也不应提交。
