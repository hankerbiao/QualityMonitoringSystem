# 维护脚本

本目录只保留只读诊断脚本，不应加入 cron、systemd timer 或其他日常调度。所有历史
数据同步、回填和写库维护脚本均已归档至 [`../archive/data_sync/`](../archive/data_sync/)。

所有写库脚本默认仅输出统计。执行前先确认 dry-run 输出，数据库备份完成后才传 `--apply`。

| 文件 | 用途 |
|---|---|
| `benchmark_rty.py` | 只读 RTY 查询性能与执行计划基准 |
