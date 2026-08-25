from fastapi import APIRouter, Depends, HTTPException, Request

from app.api.auth import get_current_user
from app.core.logger import audit_log
from app.db.mongodb import get_database
from app.models.documents import Collections
from app.schemas.ai import ChatRequest, ChatResponse
from app.services.ai_service import chat as ai_chat

router = APIRouter()


@router.post('/chat', response_model=ChatResponse)
@audit_log("CHAT", "/api/ai/chat")
async def chat(
    body: ChatRequest,
    request: Request,
    _current_user: dict = Depends(get_current_user),  # noqa: B008
):
    """
    AI 对话接口。

    - 鉴权：要求登录态（审计日志据此记录真实操作用户）。
    - API Key 从服务端设置读取，不返回或持久化到浏览器。
    """
    config = body.config.model_copy()
    if not config.apiKey:
        ai_doc = await get_database()[Collections.CONFIGS].find_one({"key": "ai_config"})
        config.apiKey = (ai_doc or {}).get("apiKey", "")

    if not config.apiUrl or not config.modelId or not config.apiKey:
        raise HTTPException(status_code=400, detail='AI 配置不完整，请检查 API 地址、模型 ID 和 API Key')

    try:
        answer = await ai_chat(
            config=config,
            messages=body.messages,
            context=body.context,
        )
        return ChatResponse(answer=answer)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
