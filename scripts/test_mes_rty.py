"""
MES 数据采集测试脚本

功能:
1. 连接 MES 系统获取直通率数据
2. 分析返回的字段内容
3. 与前端 RTY 数据字段进行对比
4. 输出字段映射关系和缺失字段报告
"""
import sys
from pathlib import Path
from pprint import pprint
from datetime import datetime

# 添加 mes_client 路径
sys.path.insert(0, str(Path(__file__).parent / "mes_client"))

from mes_client import MesClient


def print_separator(title: str):
    """打印分隔标题"""
    print(f"\n{'='*60}")
    print(f"  {title}")
    print('='*60)


def analyze_rty_data_fields(data: list[dict]):
    """分析 RTY 数据的字段结构"""
    if not data:
        print("  无数据")
        return

    print(f"  数据条数: {len(data)}")

    # 获取所有字段
    all_fields = set()
    for item in data:
        all_fields.update(item.keys())

    print(f"  字段总数: {len(all_fields)}")
    print(f"  字段列表: {sorted(all_fields)}")

    # 显示第一条数据的完整内容
    print_separator("第一条数据完整内容")
    pprint(data[0])

    # 显示几条数据的样本
    print_separator("数据样本 (前5条)")
    for i, item in enumerate(data[:5]):
        print(f"\n--- 第 {i+1} 条 ---")
        for key, value in item.items():
            print(f"  {key}: {value}")


def compare_with_frontend_fields():
    """对比前端 RTY 数据字段"""
    print_separator("前端 RTYData 字段定义")

    frontend_fields = {
        "id": "记录ID",
        "time": "统计时间 (YYYY-MM-DD)",
        "model": "计算方法: 普通机型/复合机型/Qiandaohu一拖多机型",
        "productModel": "生产机型 (如 6210 C21 BOX)",
        "customer": "客户名称",
        "base": "基地 (天津/昆山/桐乡/大同)",
        "defectCount": "故障数量",
        "inputCount": "投入数量",
        "rtyRate": "直通率百分比",
        "targetRate": "目标直通率百分比",
    }

    for field, desc in frontend_fields.items():
        print(f"  {field}: {desc}")


def generate_field_mapping(mes_data: list[dict]):
    """生成字段映射关系"""
    if not mes_data:
        return

    print_separator("字段映射关系")

    # 典型字段映射 (基于 MES 返回的字段名)
    mes_fields = list(mes_data[0].keys())

    field_mapping = {
        # MES字段: (对应前端字段, 说明)
        "factoryname": ("base", "基地名称"),
        "productfamilyname": ("productModel", "产品族"),
        "s_NGCNT": ("defectCount", "不良数"),
        "qty": ("inputCount", "订单数量"),
        "rate_real": ("rtyRate", "实际直通率"),
        "rate_bz": ("targetRate", "标准直通率"),
        "s_SALENO": ("salesOrder", "销售单号 - 前端暂无"),
        "mfgordername": ("productionOrder", "生产订单号 - 前端暂无"),
        "s_MFGLINENAME": ("productLine", "产线名称 - 前端暂无"),
        "ordertypename": ("orderType", "订单类型 - 前端暂无"),
        "plannedstartdate": ("planStartDate", "计划开始日期 - 前端暂无"),
        "s_Mes_Planendtime": ("planEndDate", "计划结束时间 - 前端暂无"),
        "rate_status": ("status", "达成状态 - 前端暂无"),
    }

    print("\n  MES字段 -> 前端字段 (映射说明)")
    print("  " + "-" * 50)
    for mes_field, (frontend_field, desc) in field_mapping.items():
        exists = "✓" if mes_field in mes_fields else "✗"
        in_frontend = "已有" if frontend_field in ["base", "productModel", "defectCount",
                                                      "inputCount", "rtyRate", "targetRate"] else "需新增"
        print(f"  {exists} {mes_field:25} -> {frontend_field:20} [{in_frontend}] {desc}")

    # 分析缺失字段
    print_separator("缺失字段分析")

    frontend_core_fields = ["id", "time", "model", "productModel", "customer", "base",
                            "defectCount", "inputCount", "rtyRate", "targetRate"]
    frontend_extra_needed = ["salesOrder", "productionOrder", "status"]

    print("\n  前端已有字段 (核心):")
    for f in frontend_core_fields:
        print(f"    - {f}")

    print("\n  前端已有字段 (可选):")
    for f in frontend_extra_needed:
        print(f"    - {f}")

    print("\n  MES 有但前端缺失的字段 (需要新增):")
    missing_from_frontend = ["s_SALENO", "mfgordername", "s_MFGLINENAME",
                              "ordertypename", "plannedstartdate", "s_Mes_Planendtime", "rate_status"]
    for f in missing_from_frontend:
        if f in mes_fields:
            print(f"    - {f}")


def main():
    """主函数"""
    print_separator("MES 数据采集测试")
    print(f"  测试时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    # MES 连接配置
    MES_BASE_URL = "http://10.8.101.49:9991"
    MES_USERNAME = "liushy2"
    MES_PASSWORD = "Lsy825516"

    # 基地配置
    BASES = {
        "1000": "天津",
        "2000": "盘锦",
        "3000": "昆山",
        "7000": "太原",
        "8000": "安阳",
        "9000": "桐乡",
    }

    try:
        # 创建客户端
        print_separator("连接 MES 系统")
        print(f"  地址: {MES_BASE_URL}")
        print(f"  用户: {MES_USERNAME}")

        client = MesClient(
            base_url=MES_BASE_URL,
            username=MES_USERNAME,
            password=MES_PASSWORD,
        )

        # 登录
        print("\n  正在登录...")
        login_resp = client.login()
        print(f"  ✓ 登录成功: {login_resp['data'].get('userName', 'N/A')}")
        print(f"  ✓ Token 有效期: 约 2 小时")

        # 获取用户信息
        user_info = client.get_current_user_info()
        print(f"  ✓ 登录用户: {user_info['data'].get('userTrueName', 'N/A')}")
        print(f"  ✓ 部门: {user_info['data'].get('roleName', 'N/A')}")

        # 获取基地列表
        print_separator("获取基地列表")
        bases = client.get_bases()
        print(f"  可用基地数量: {len(bases)}")
        for b in bases:
            print(f"    {b['factoryid']}: {b['factoryname']} ({b['factorycode']})")

        # 获取各基地直通率数据
        all_rty_data = []
        print_separator("获取各基地直通率数据")

        for base_id, base_name in BASES.items():
            print(f"\n  正在获取 {base_name} (ID: {base_id}) 数据...")
            try:
                rates = client.get_order_direct_rate(base=base_id)
                print(f"    ✓ 获取成功: {len(rates)} 条记录")
                for r in rates:
                    r['base_name'] = base_name  # 添加基地名称
                all_rty_data.extend(rates)
            except Exception as e:
                print(f"    ✗ 获取失败: {e}")

        print(f"\n  总计获取: {len(all_rty_data)} 条记录")

        # 分析字段结构
        print_separator("RTY 数据字段分析")
        analyze_rty_data_fields(all_rty_data)

        # 对比前端字段
        compare_with_frontend_fields()

        # 生成字段映射
        generate_field_mapping(all_rty_data)

        # 输出汇总报告
        print_separator("汇总报告")

        print("""
  ┌─────────────────────────────────────────────────────────────┐
  │                      字段对比总结                              │
  ├─────────────────────────────────────────────────────────────┤
  │  前端已有字段:                                                 │
  │    ✓ time, model, productModel, base, defectCount,           │
  │      inputCount, rtyRate, targetRate                         │
  │                                                             │
  │  前端已有但未使用:                                             │
  │    ○ customer (客户名称 - MES无此字段)                         │
  │                                                             │
  │  需要从 MES 采集的新增字段:                                    │
  │    ★ s_SALENO (销售单号)                                      │
  │    ★ mfgordername (生产订单号)                                │
  │    ★ s_MFGLINENAME (产线名称)                                 │
  │    ★ ordertypename (订单类型)                                 │
  │    ★ rate_status (达成状态)                                   │
  │                                                             │
  │  时间相关字段:                                                 │
  │    ○ plannedstartdate (计划开始日期) 可用于 time               │
  │    ○ s_Mes_Planendtime (计划结束时间)                          │
  │                                                             │
  │  需确认字段:                                                   │
  │    ? customer (客户名称) - MES 无此字段，需确认数据来源          │
  │    ? model (计算方法) - 普通机型/复合机型 如何确定              │
  └─────────────────────────────────────────────────────────────┘
        """)

        # 保存原始数据到文件
        import json
        output_file = Path(__file__).parent / "mes_rty_data_raw.json"
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(all_rty_data, f, ensure_ascii=False, indent=2)
        print(f"\n  原始数据已保存到: {output_file}")

        # 保存字段分析报告
        report_file = Path(__file__).parent / "mes_fields_report.txt"
        with open(report_file, "w", encoding="utf-8") as f:
            f.write("MES RTY 数据字段分析报告\n")
            f.write(f"生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
            f.write(f"数据总量: {len(all_rty_data)} 条\n\n")
            f.write("字段列表:\n")
            if all_rty_data:
                for field in sorted(all_rty_data[0].keys()):
                    f.write(f"  - {field}\n")
        print(f"  字段报告已保存到: {report_file}")

        print_separator("测试完成")
        return all_rty_data

    except Exception as e:
        print(f"\n  ✗ 错误: {e}")
        import traceback
        traceback.print_exc()
        return None


if __name__ == "__main__":
    main()