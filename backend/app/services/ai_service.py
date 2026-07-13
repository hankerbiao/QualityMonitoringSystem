import httpx

from app.schemas.ai import AIConfig, AIMessage, RTYContext


def _estimate_tokens(text: str) -> int:
    return int(len(text) * 1.5)


def _format_context(ctx: RTYContext) -> str:
    lines = ['【RTY 数据上下文】']
    lines.append(f'总投入量: {ctx.totalInput} 台')
    lines.append(f'总故障数: {ctx.totalDefect} 件')
    lines.append(f'综合平均直通率: {ctx.avgRty:.2f}%')
    if ctx.byBase:
        lines.append('--- 按基地统计 ---')
        for b in ctx.byBase:
            lines.append(f"  {b['base']}: 投入{b['input']}台 故障{b['defect']}件 直通率{b['rty']:.2f}%")
    if ctx.byModel:
        lines.append('--- 按机型统计 ---')
        for m in sorted(ctx.byModel, key=lambda x: x['rty'])[:10]:
            lines.append(f"  {m['model']}: 投入{m['input']}台 故障{m['defect']}件 直通率{m['rty']:.2f}%")
    if ctx.topDefectModels:
        lines.append('--- 故障高发机型 TOP5 ---')
        for m in ctx.topDefectModels:
            lines.append(f"  {m['model']}: 故障 {m['defectCount']} 件")
    if ctx.recentTrend:
        lines.append('--- 近月直通率趋势 ---')
        for t in ctx.recentTrend:
            lines.append(f"  {t['time']}: {t['rty']:.2f}%")
    return '\n'.join(lines)


def _build_system_prompt(ctx: RTYContext) -> str:
    base = (
        '你是"QualiBoard 品质看板"的 AI 质量分析助手，专门分析 RTY（整机综合直通率）数据。'
        '请根据提供的 RTY 数据上下文，用专业、简洁的语言回答用户关于质量数据分析的问题。'
        '回复应当包含具体数据指标、问题根因分析，以及可操作的改善建议。'
        '如果数据不足无法回答，请明确说明。\n'
    )
    if ctx.totalInput > 0:
        base += '\n' + _format_context(ctx)
    return base


def _truncate_messages(
    messages: list[dict],
    system_content: str,
    max_tokens: int,
) -> list[dict]:
    """
    截断消息历史，使其总 token 数不超过 max_tokens。
    保留 system prompt，从最早的人类消息开始丢弃。
    """
    result = [{'role': 'system', 'content': system_content}]
    used = _estimate_tokens(system_content)

    for msg in messages:
        content: str = msg.get('content', '')
        msg_tokens = _estimate_tokens(content) + 10
        if used + msg_tokens > max_tokens:
            remaining = max_tokens - used - 10
            if remaining > 50:
                result.append({'role': msg['role'], 'content': content[:int(remaining / 1.5)] + '...(截断)'})
            used = max_tokens
            break
        result.append(msg)
        used += msg_tokens

    return result


async def chat(config: AIConfig, messages: list[AIMessage], context: RTYContext) -> str:
    system_prompt = _build_system_prompt(context)

    msgs_for_api = _truncate_messages(
        [m.model_dump() for m in messages],
        system_prompt,
        config.maxTokens,
    )

    async with httpx.AsyncClient(timeout=60.0, trust_env=False) as client:
        base_url = config.apiUrl.rstrip('/').removesuffix('/chat/completions').removesuffix('/v1/chat/completions')
        response = await client.post(
            base_url + '/chat/completions',
            headers={
                'Authorization': f'Bearer {config.apiKey}',
                'Content-Type': 'application/json',
            },
            json={
                'model': config.modelId,
                'messages': msgs_for_api,
                'max_tokens': config.maxTokens,
                'temperature': 0.7,
            },
        )
        if response.status_code != 200:
            raise Exception(f'AI API error {response.status_code}: {response.text}')

        data = response.json()
        return data['choices'][0]['message']['content']

