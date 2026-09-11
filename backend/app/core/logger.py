"""
Loguru Logger Module - 企业级日志系统

功能特性:
- 分级别日志记录 (DEBUG, INFO, WARNING, ERROR, CRITICAL)
- 操作审计日志 (谁 + 什么时间 + 执行了什么操作)
- 结构化日志输出 (JSON 格式可选)
- 日志轮转 (按大小和时间)
- 分类输出 (普通日志 + 审计日志)
"""
import sys
from datetime import datetime
from functools import wraps
from pathlib import Path

from fastapi import Request
from loguru import logger


class AuditLogger:
    """
    审计日志记录器

    专门用于记录用户操作行为:
    - 谁 (who): 用户ID、用户名、IP地址
    - 什么时间 (when): 操作时间
    - 执行了什么 (what): 操作类型、目标资源、操作详情
    - 结果如何 (result): 成功/失败、耗时
    """

    def __init__(self, audit_log_path: str):
        self.audit_log_path = Path(audit_log_path)
        self.audit_log_path.parent.mkdir(parents=True, exist_ok=True)

        # 独立的审计日志处理器 - 始终记录到单独文件
        self._audit_handler = None
        self._setup_audit_handler()

    def _setup_audit_handler(self):
        """设置审计日志处理器"""
        self._audit_handler = self.audit_log_path.open(
            mode='a',
            encoding='utf-8'
        )

        # 配置审计日志格式 - 结构化输出便于分析
        audit_format = (
            "{time:YYYY-MM-DD HH:mm:ss.SSS} | "
            "{extra[request_id]:<12} | "
            "{extra[user_id]:<20} | "
            "{extra[username]:<15} | "
            "{extra[client_ip]:<15} | "
            "{extra[action]:<25} | "
            "{extra[resource]:<30} | "
            "{extra[method]:<8} | "
            "{extra[status]:<8} | "
            "{extra[duration_ms]:<10} | "
            "{message}"
        )

        logger.configure(
            extra={"request_id": "-", "user_id": "-", "username": "-",
                   "client_ip": "-", "action": "-", "resource": "-",
                   "method": "-", "status": "-", "duration_ms": "-"}
        )

        # 添加审计日志专用sink
        logger.add(
            self._audit_handler,
            format=audit_format,
            level="INFO",
            filter=lambda record: record["extra"].get("audit", False),
            enqueue=True,  # 线程安全
        )

    def log(
        self,
        action: str,
        resource: str,
        user_id: str | None = None,
        username: str | None = "-",
        client_ip: str | None = None,
        method: str = "HTTP",
        status: str = "SUCCESS",
        duration_ms: float | None = None,
        details: str | None = None,
    ):
        """
        记录审计日志

        Args:
            action: 操作类型 (如: CREATE, UPDATE, DELETE, QUERY, LOGIN, etc.)
            resource: 操作的资源 (如: /api/rty/data, User:123, etc.)
            user_id: 用户ID
            username: 用户名
            client_ip: 客户端IP
            method: 操作方法 (HTTP Method 或业务操作类型)
            status: 操作状态 (SUCCESS, FAILED, PARTIAL)
            duration_ms: 操作耗时(毫秒)
            details: 额外详情
        """
        user_id_str = user_id or "anonymous"
        ip_str = client_ip or "unknown"
        duration_str = f"{duration_ms:.2f}ms" if duration_ms is not None else "-"
        message = details or f"{action} on {resource}"

        logger.log(
            "INFO",
            message,
            audit=True,
            user_id=user_id_str,
            username=username,
            client_ip=ip_str,
            action=action,
            resource=resource,
            method=method,
            status=status,
            duration_ms=duration_str,
        )

def setup_logger(
    log_dir: str = "logs",
    level: str = "INFO",
    rotation: str = "500 MB",
    retention: str = "30 days",
    compression: str = "zip",
    json_format: bool = False,
) -> AuditLogger:
    """
    配置 loguru 日志系统

    Args:
        log_dir: 日志目录
        level: 日志级别 (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        rotation: 日志轮转条件 (大小或时间)
        retention: 日志保留时间
        compression: 压缩格式
        json_format: 是否使用 JSON 格式

    Returns:
        AuditLogger 实例
    """
    # 清除默认处理器
    logger.remove()

    # 确保日志目录存在
    log_path = Path(log_dir)
    log_path.mkdir(parents=True, exist_ok=True)

    # 定义日志格式
    if json_format:
        # JSON 格式 - 便于日志分析系统处理
        log_format = (
            '{"time":"{time:YYYY-MM-DD HH:mm:ss.SSS}",'
            '"level":"{level}",'
            '"module":"{name}",'
            '"function":"{function}",'
            '"line":{line},'
            '"message":"{message}",'
            '"extra":{extra}}'
        )
    else:
        # 人类可读格式
        log_format = (
            "<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | "
            "<level>{level: <8}</level> | "
        "<magenta>{extra[request_id]:<12}</magenta> | "
        "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> | "
        "<level>{message}</level>"
        "<level>\n{exception}</level>"
    )

    # 控制台输出 - 带颜色
    logger.add(
        sys.stdout,
        format=log_format,
        level=level,
        colorize=True,
    )

    # 文件输出 - 普通日志 (按大小轮转)
    general_log_file = log_path / "app_{time:YYYY-MM-DD}.log"
    logger.add(
        general_log_file,
        format=log_format,
        level=level,
        rotation=rotation,
        retention=retention,
        compression=compression,
        enqueue=True,  # 异步写入，防止阻塞
        backtrace=True,  # 启用回溯
        diagnose=True,  # 启用诊断
    )

    # 错误日志单独记录 - 只记录 ERROR 及以上
    error_log_file = log_path / "error_{time:YYYY-MM-DD}.log"
    logger.add(
        error_log_file,
        format=log_format,
        level="ERROR",
        rotation=rotation,
        retention=retention,
        compression=compression,
        enqueue=True,
        backtrace=True,
        diagnose=True,
    )

    # 审计日志
    audit_log_file = log_path / "audit_{time:YYYY-MM-DD}.log"
    audit_logger = AuditLogger(str(audit_log_file))

    return audit_logger


def get_client_ip(request: Request) -> str:
    """从请求中提取客户端IP"""
    # 优先从 X-Forwarded-For 获取 (反向代理场景)
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()

    # 其次从 X-Real-IP 获取
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip

    # 最后使用直连IP
    if request.client:
        return request.client.host

    return "unknown"


def audit_log(
    action: str,
    resource: str,
    method: str = "HTTP",
):
    """
    装饰器 - 自动记录 API 操作的审计日志

    用法:
        @router.get("/data")
        @audit_log("QUERY", "/api/rty/data")
        async def get_data(request: Request):
            ...

    注意: 需要路由函数接受 Request 参数
    """
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # 尝试从参数中获取 Request
            request = kwargs.get('request')
            if not request:
                for arg in args:
                    if isinstance(arg, Request):
                        request = arg
                        break

            # 用户取自请求级上下文（由认证依赖写入），不再依赖测试用 Header
            from app.core.context import get_user
            user_id = get_user()
            client_ip = get_client_ip(request) if request else "unknown"

            # 让审计日志行也带上 request_id，便于与业务日志串联
            # 使用 get_audit_logger() 而非直接读全局变量：未初始化时安全降级为 NoOp，
            # 避免在测试/脚本/冷启动阶段触发 AttributeError('NoneType' has no attribute 'log')
            audit_logger = get_audit_logger()
            start_time = datetime.now()

            try:
                result = await func(*args, **kwargs)
                duration_ms = (datetime.now() - start_time).total_seconds() * 1000
                audit_logger.log(
                    action=action,
                    resource=resource,
                    user_id=user_id,
                    client_ip=client_ip,
                    method=method,
                    status="SUCCESS",
                    duration_ms=duration_ms,
                    details="Completed successfully",
                )
                return result
            except Exception as e:
                duration_ms = (datetime.now() - start_time).total_seconds() * 1000
                audit_logger.log(
                    action=action,
                    resource=resource,
                    user_id=user_id,
                    client_ip=client_ip,
                    method=method,
                    status="FAILED",
                    duration_ms=duration_ms,
                    details=f"Error: {str(e)}",
                )
                raise

        return wrapper
    return decorator


def log_info(message: str, **kwargs):
    """记录 INFO 级别日志"""
    logger.info(message, **kwargs)


def log_warning(message: str, **kwargs):
    """记录 WARNING 级别日志"""
    logger.warning(message, **kwargs)


def log_error(message: str, **kwargs):
    """记录 ERROR 级别日志"""
    logger.error(message, **kwargs)


def get_audit_logger() -> AuditLogger:
    """获取审计日志器；未初始化时返回空操作实现，避免 AttributeError"""
    return audit_logger or NoOpAuditLogger()


# 模块级别的审计日志器 (由 main.py 初始化)
audit_logger: AuditLogger | None = None


class NoOpAuditLogger:
    """空操作审计日志器 - 在日志系统初始化前使用"""

    def log(self, **kwargs):
        pass
