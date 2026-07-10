"""
脚本: 从前端 mock 数据导入 RTY 数据到后端 MongoDB

使用方法:
  cd backend
  python import_mock_data.py
"""
import asyncio
import sys
from datetime import datetime
from pathlib import Path

# 添加 backend 目录到路径
sys.path.insert(0, str(Path(__file__).parent))


# 默认 mock 数据 (与前端 mockData.ts 一致)
BASES = ['天津', '昆山', '桐乡', '大同']
CUSTOMERS = ['客户A', '客户B', '客户C']
MODELS = ['6210 C21 BOX', '6210 C21', '6210 C31', '普通机型']
MODEL_CATEGORIES = ['普通机型', '复合机型', '普通机型', '普通机型']


def rand(min_val: int, max_val: int) -> int:
    """生成随机整数"""
    import random
    return random.randint(min_val, max_val)


def round_rty(defect: int, input_val: int) -> float:
    """计算 RTY"""
    if input_val == 0:
        return 100.0
    return round(((input_val - defect) / input_val) * 100, 3)


def generate_mock_data():
    """生成模拟数据"""
    mock_rty_data = []

    # 生成2025-07到2026-06各个月份的数据
    months = [
        '2025-07-15', '2025-08-15', '2025-09-15', '2025-10-15',
        '2025-11-15', '2025-12-15', '2026-01-15', '2026-02-15',
        '2026-03-15', '2026-04-15', '2026-05-15', '2026-06-15'
    ]

    record_id = 0
    for time_str in months:
        for base in BASES:
            for customer in CUSTOMERS:
                for mi, product_model in enumerate(MODELS):
                    record_id += 1
                    input_count = rand(500, 2500)

                    # 根据机型分配不同的 RTY 分布
                    defect_count: int
                    if mi == 0:  # 6210 C21 BOX - 优秀
                        defect_count = max(1, rand(1, max(1, int(input_count * 0.001))))
                    elif mi == 1:  # 6210 C21 - 良好
                        defect_count = rand(max(1, max(1, int(input_count * 0.001))), max(1, int(input_count * 0.005)))
                    elif mi == 2:  # 6210 C31 - 正常
                        defect_count = rand(max(1, int(input_count * 0.005)), max(1, int(input_count * 0.01)))
                    else:  # 普通机型 - 波动大
                        rty_bucket = rand(1, 10)
                        if rty_bucket <= 2:
                            defect_count = max(1, rand(1, max(1, int(input_count * 0.001))))
                        elif rty_bucket <= 4:
                            defect_count = rand(max(1, int(input_count * 0.001)), max(1, int(input_count * 0.005)))
                        elif rty_bucket <= 6:
                            defect_count = rand(max(1, int(input_count * 0.005)), max(1, int(input_count * 0.01)))
                        elif rty_bucket <= 8:
                            defect_count = rand(max(1, int(input_count * 0.01)), max(1, int(input_count * 0.02)))
                        else:
                            defect_count = rand(max(1, int(input_count * 0.02)), max(1, int(input_count * 0.05)))

                    rty_rate = round_rty(defect_count, input_count)

                    mock_rty_data.append({
                        "recordId": str(record_id),
                        "time": time_str,
                        "model": MODEL_CATEGORIES[mi],
                        "productModel": product_model,
                        "customer": customer,
                        "base": base,
                        "defectCount": defect_count,
                        "inputCount": input_count,
                        "rtyRate": rty_rate,
                        "targetRate": 100,
                    })

    return mock_rty_data


def generate_input_details():
    """生成投入明细数据"""
    product_lines = ['L1', 'L2', 'L3', 'L4', 'L5']
    input_details = {}

    for i in range(1, 433):
        key = str(i)
        num_inputs = rand(2, 5)
        details = []

        for inp in range(num_inputs):
            details.append({
                "id": f"i{key}-{inp}",
                "workOrder": f"WO-{key}-{str(inp + 1).zfill(2)}",
                "productLine": product_lines[rand(0, len(product_lines) - 1)],
                "count": rand(100, 800),
            })

        input_details[key] = details

    return input_details


async def import_data():
    """导入数据到 MongoDB"""
    from app.db.mongodb import connect_to_mongo, get_database
    from app.models.documents import Collections

    print("正在连接 MongoDB...")
    await connect_to_mongo()

    db = get_database()

    # 清空现有数据 (可选)
    print("正在清空现有 RTY 数据...")
    await db[Collections.RTY_DATA].delete_many({})
    await db[Collections.INPUT_DETAILS].delete_many({})

    # 生成并导入 RTY 数据
    print("正在生成 RTY 数据...")
    mock_rty = generate_mock_data()

    documents = []
    for item in mock_rty:
        documents.append({
            "time": item["time"],
            "model": item["model"],
            "productModel": item["productModel"],
            "customer": item["customer"],
            "base": item["base"],
            "defectCount": item["defectCount"],
            "inputCount": item["inputCount"],
            "rtyRate": item["rtyRate"],
            "targetRate": item["targetRate"],
            "createdAt": datetime.utcnow(),
            "updatedAt": datetime.utcnow(),
        })

    result = await db[Collections.RTY_DATA].insert_many(documents)
    print(f"✓ 已导入 {len(result.inserted_ids)} 条 RTY 数据")

    # 导入投入明细
    print("正在导入投入明细...")
    input_details = generate_input_details()

    input_docs = [
        {"recordId": key, "details": details, "updatedAt": datetime.utcnow()}
        for key, details in input_details.items()
    ]

    if input_docs:
        await db[Collections.INPUT_DETAILS].insert_many(input_docs)
        print(f"✓ 已导入 {len(input_docs)} 条投入明细")

    print("\n导入完成!")
    print(f"总计: {len(mock_rty)} 条 RTY 记录")


if __name__ == "__main__":
    asyncio.run(import_data())
