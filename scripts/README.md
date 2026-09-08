# 脚本目录

## 数据来源

SAP/HANA 业务数据由独立数据网关提供。本仓库不再包含同步、抓取、回填或写入这些数据的
历史脚本，且不得为应用配置此类定时任务。

## 当前保留脚本

| 文件 | 用途 | 写入数据库 |
|---|---|---|
| `export_doa_is_5000.py` | 导出已有 DOA 数据到 Excel | 否 |
| `export_station_records.py` | 导出已有工位记录到 Excel | 否 |
| `maintenance/benchmark_rty.py` | RTY 网关查询性能诊断 | 否 |

`maintenance/` 的约束见 [`maintenance/README.md`](maintenance/README.md)。

本地生成的 `__pycache__/`、`.DS_Store` 等文件不属于源码，也不应提交。
