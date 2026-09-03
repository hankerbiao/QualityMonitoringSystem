# 数据网关迁移运行方案

## 边界

数据网关只负责 SAP/HANA 同步、MongoDB 查询、字段投影和分页；不实现 RTY、LRR、MFR、DOA 的业务计算、指标阈值或 SCS 关联。质量监控后端继续作为 BFF 和计算层，保持前端响应协议不变。

保留在质量监控本地的来源：SCS `scs_doa_results`、`scs_change_results` 和 MES `machine_info`/`fault_info`。除 SCS 外，SAP/HANA 原始来源通过网关读取。

## 接口映射

| 看板/功能 | 网关接口 | 质量监控后端职责 |
| --- | --- | --- |
| RTY 订单 | `GET /api/orders/all` | 订单范围、机型目标、输入数计算 |
| RTY 故障关联 | `POST /api/faults/lookup` | SN 去重、缺陷归因、RTY 计算 |
| LRR BOM | `GET /api/views/ZSGV_ZSD124/stream`（TSV 原始字段流） | 发料汇总、订单分组、LRR 计算 |
| LRR 维修 | `GET /api/faults` | 维修匹配、明细和分页 |
| MFR 销售订单 | `GET /api/orders/all` | 在保过滤、月度分母和趋势 |
| DOA 销售订单 | `GET /api/orders/all` | 与本地 SCS 关联及 DOA 计算 |
| 工位通过率（RTY 子看板） | `GET /api/views/Z_V_ZMES_T_001/stream`、`POST /api/faults/by-sns` | 工位归一化、SN 去重、维修匹配和通过率 |
| 元数据浏览 | `/api/orders`、`/api/faults`、`/api/views/{viewID}` | 统一表格协议和权限 |

关键工位影像追溯（`process-records`）仍连接 MES 影像系统：网关当前没有 MES
影像凭证和图片代理能力，因此不伪装成已迁移。后续若要统一入口，应先在网关增加
只读 MES 适配器和短时授权代理，再迁移该页面；SCS 数据同样继续由质量监控本地保存。

## 发布步骤

1. 先启动网关并检查 `GET http://127.0.0.1:18080/api/health`，确认同步状态和索引创建完成。
2. 配置质量监控 `DATA_GATEWAY_URL`、超时和短缓存 TTL，启动后端 `4001` 与前端 `4000`。
3. 用相同日期和筛选条件对比旧快照与新 BFF 响应，重点核对订单数、故障数、RTY/LRR/MFR/DOA 汇总。
4. 观察错误率、响应耗时和网关 MongoDB 慢查询；异常时将 `DATA_GATEWAY_URL` 置空即可回退到本地兼容分支（本地源集合删除前）。
5. 连续观察一个完整业务周期后，先备份再运行 `scripts/drop_migrated_source_collections.py --apply` 清理五个已迁移源集合；SCS/MES 集合不得清理。

## 性能约束

- 网关使用投影、复合索引、批量 `$in` 故障查询和 gzip；LRR BOM 与工位默认 30 天窗口使用低开销 TSV 原始字段流，并在启动后预热 60 秒原始快照；质量后端复用连接池，并对重复原始读取启用可配置短 TTL（`DATA_GATEWAY_CACHE_TTL_SECONDS`，默认 10 秒）。
- 常规分页接口目标 P95 < 1 秒；RTY/MFR/DOA 典型日期范围目标 P95 < 5 秒。
- LRR 全量冷请求是例外：当前约 40 万行 BOM，实测原始 TSV 读取约 10 秒，质量后端计算之外的主要耗时来自 Mongo 扫描、编码和传输；短 TTL 命中约 1--2 秒。验收时分别记录冷请求和热请求，不以冷请求掩盖缓存命中率。
- 工位看板固定查询最近 30 天并命中网关预热缓存；不带日期的全量工位 TSV 可能超过 180MB，仅作为原始导出接口，不纳入看板 P95 目标。
- LRR 继续增长时，优先在网关增加按月份的原始流分段/预热缓存（仍只返回原始行），质量后端并发拉取后计算；不把发料汇总、故障关联或 LRR 指标下沉到网关。
- 网关和 BFF 均限制单次最大行数，超限返回明确错误，避免无界内存增长。

## 数据清理前检查

- `rg` 确认运行时代码不再直接读取待删集合；归档脚本不计入运行时，但需保留人工恢复说明。
- 完成网关故障演练、接口回归、前端看板抽样和备份校验。
- 清理后保留网关同步状态作为唯一 SAP/HANA 水位来源；运营页若仍读取本地同步集合，应先迁移该状态接口。
