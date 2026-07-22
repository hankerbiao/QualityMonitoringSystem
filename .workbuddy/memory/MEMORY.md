# 项目长期记忆 (QualityMonitoringSystem)

## 关键约定 / 决策
- **RTY 目标达成率单一数据源 = `configs.model_targets`（key=model_targets, 结构 `{targets: {机型: 值}}`）**。后端 `rty.py` 按 `product_family`(=product_model) 读取，未配置时**默认 100**。禁止在代码里写死 `99.0/99.5/98.5` 等兜底值（曾于 init_default_settings.py、init_db.py、AlertConfigModal.tsx、DEFAULT_MODEL_TARGETS 多处误导开发，已全部清除）。
- **RTY 列表 = `machine_info` 逐条展示（不聚合）**：`get_rty_list` 从 machine_info 分页读取，故障标记按本页 SN 查 fault_info。前端表单的 date_from/base/productModel/customer 等过滤参数当前被后端忽略（历史遗留，非本次范围）。
- **故障明细唯一真源 = `fault_info` 集合**（字段 sn/fault_category/fault_desc/repair_person/repair_time）。`defect_details` 集合已删除（2026-07-09），其旧脚本与孤儿模型已清理。
- **LRR「有装配扫号 / 无装配扫号」= 两条独立接口数据源（非单表字段）**：`有装配扫号` 来自装配扫号接口集合 `assembly_records`（分母 `totalCount` 来自此）；`无装配扫号` 来自**另一个**故障接口集合 `fault_info`（分子 `faultCount` 来自此，`totalCount=None`）。后端 `lrr.py` 用 `assembly_records.product_no ∪ fault_info.reinsert_lot` 并集 + `totalCount is None` 判定分类。`无装配扫号` 的物料**不在** `assembly_records` 里（即不是"装配表缺数据"，而是根本来自另一接口）。任何 LRR 相关开发都不要假设这是同一张表的某个标志位。
- 前端 `apiFetch` 自动附带 Bearer token，所以给 `/api/ai/chat` 等接口加 `Depends(get_current_user)` 鉴权与前端兼容，不会改坏线上。
- **告警邮件报表链接 = 免登录签名 URL**：前端路由 `/alert-report/:token` 放在 `ProtectedLayout` 之外；公开页必须用普通 `fetch`（禁止 `apiFetch`，否则匿名访问会被踢到登录）。后端 `GET /api/alert-report/{token}` 校验 HMAC-SHA256 签名 token（`app/libs/alert_token.py`，纯标准库）后实时聚合 `machine_info`+`fault_info`，聚合逻辑复用 `rty.py` 过滤条件（`app/services/alert_report.py`）。邮件发送时调用 `create_alert_token(context)` + `build_alert_report_url(token)` 拼链接。**安全**：`ALERT_TOKEN_SECRET` 默认值已入 git，生产必须用环境变量覆盖并轮换；token 默认 7 天过期（`ALERT_TOKEN_TTL_DAYS`）。DEBUG 下另有 `POST /api/alert-report/preview`（需登录）可生成测试链接。

## 结构要点
- 后端：FastAPI 单仓；聚合层从 MES 原始表 (machine_info/fault_info) 实时计算，不落独立 RTY 存储。
- 安全：MES 密码 GET 不返回（用 hasPassword 标志），PUT 忽略空密码；OA 密钥仍硬编码在 config.py（待线下轮换+环境变量注入）。
- 日志：RequestContextMiddleware 给每行日志绑 request_id；审计装饰器 `@audit_log` 走 `get_audit_logger()` 安全降级。
