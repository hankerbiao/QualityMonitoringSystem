from fastapi import APIRouter, Depends, HTTPException, Request

from app.api.auth import get_current_user
from app.core.logger import audit_log
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
    - apiKey 仍由请求体传入（前端按次填入用户自有密钥），与设置中心的
      ``hasApiKey``（仅标识是否已配置）互不冲突，且密钥不回写响应。
    """
    if not body.config.apiUrl or not body.config.modelId or not body.config.apiKey:
        raise HTTPException(status_code=400, detail='AI 配置不完整，请检查 API 地址、模型 ID 和 API Key')

    try:
        answer = await ai_chat(
            config=body.config,
            messages=body.messages,
            context=body.context,
        )
        return ChatResponse(answer=answer)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
