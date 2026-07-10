# 项目长期记忆 (QualityMonitoringSystem)

## 关键约定 / 决策
- **RTY 目标达成率单一数据源 = `configs.model_targets`（key=model_targets, 结构 `{targets: {机型: 值}}`）**。后端 `rty.py` 按 `product_family`(=product_model) 读取，未配置时**默认 100**。禁止在代码里写死 `99.0/99.5/98.5` 等兜底值（曾于 init_default_settings.py、init_db.py、AlertConfigModal.tsx、DEFAULT_MODEL_TARGETS 多处误导开发，已全部清除）。
- **RTY 列表 = `machine_info` 逐条展示（不聚合）**：`get_rty_list` 从 machine_info 分页读取，故障标记按本页 SN 查 fault_info。前端表单的 date_from/base/productModel/customer 等过滤参数当前被后端忽略（历史遗留，非本次范围）。
- **故障明细唯一真源 = `fault_info` 集合**（字段 sn/fault_category/fault_desc/repair_person/repair_time）。`defect_details` 集合已删除（2026-07-09），其旧脚本与孤儿模型已清理。
- 前端 `apiFetch` 自动附带 Bearer token，所以给 `/api/ai/chat` 等接口加 `Depends(get_current_user)` 鉴权与前端兼容，不会改坏线上。

## 结构要点
- 后端：FastAPI 单仓；聚合层从 MES 原始表 (machine_info/fault_info) 实时计算，不落独立 RTY 存储。
- 安全：MES 密码 GET 不返回（用 hasPassword 标志），PUT 忽略空密码；OA 密钥仍硬编码在 config.py（待线下轮换+环境变量注入）。
- 日志：RequestContextMiddleware 给每行日志绑 request_id；审计装饰器 `@audit_log` 走 `get_audit_logger()` 安全降级。
