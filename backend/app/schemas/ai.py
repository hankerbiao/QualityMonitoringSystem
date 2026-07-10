from pydantic import BaseModel, Field


class AIMessage(BaseModel):
    role: str = Field(..., pattern='^(system|user|assistant)$')
    content: str


class AIConfig(BaseModel):
    apiUrl: str
    modelId: str
    apiKey: str
    maxTokens: int = 4096


class RTYContext(BaseModel):
    totalInput: int = 0
    totalDefect: int = 0
    avgRty: float = 0.0
    byBase: list[dict] = Field(default_factory=list)
    byModel: list[dict] = Field(default_factory=list)
    topDefectModels: list[dict] = Field(default_factory=list)
    recentTrend: list[dict] = Field(default_factory=list)


class ChatRequest(BaseModel):
    config: AIConfig
    messages: list[AIMessage]
    context: RTYContext


class ChatResponse(BaseModel):
    answer: str
