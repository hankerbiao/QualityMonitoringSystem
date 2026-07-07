from fastapi import APIRouter, HTTPException
from app.schemas.ai import ChatRequest, ChatResponse
from app.services.ai_service import chat as ai_chat

router = APIRouter()


@router.post('/chat', response_model=ChatResponse)
async def chat(request: ChatRequest):
    if not request.config.apiUrl or not request.config.modelId or not request.config.apiKey:
        raise HTTPException(status_code=400, detail='AI 配置不完整，请检查 API 地址、模型 ID 和 API Key')

    try:
        answer = await ai_chat(
            config=request.config,
            messages=request.messages,
            context=request.context,
        )
        return ChatResponse(answer=answer)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))