"""
Unit tests for AI service - token estimation, message truncation, context building
"""
import pytest
from app.services.ai_service import (
    _estimate_tokens,
    _format_context,
    _build_system_prompt,
    _truncate_messages,
)


class TestEstimateTokens:
    """Tests for token count estimation."""

    def test_empty_string(self):
        assert _estimate_tokens("") == 0

    def test_pure_ascii(self):
        # Roughly 4 chars ~= 1 token for ASCII
        text = "a" * 100
        estimated = _estimate_tokens(text)
        assert estimated == 150  # len * 1.5

    def test_chinese_chars(self):
        # Chinese chars: len * 1.5, but should match
        text = "中" * 100
        estimated = _estimate_tokens(text)
        assert estimated == 150

    def test_mixed_content(self):
        text = "Hello 你好 world 世界"
        estimated = _estimate_tokens(text)
        assert estimated > 0
        double_estimate = _estimate_tokens(text * 2)
        assert double_estimate > estimated
        assert _estimate_tokens(text) < 100


class TestFormatContext:
    """Tests for RTY context formatting."""

    def test_empty_context(self):
        from app.schemas.ai import RTYContext
        ctx = RTYContext()
        result = _format_context(ctx)
        assert "RTY" in result
        assert "总投入量" in result
        assert "0" in result

    def test_context_with_data(self):
        from app.schemas.ai import RTYContext
        ctx = RTYContext(
            totalInput=5000,
            totalDefect=50,
            avgRty=99.0,
            byBase=[
                {"base": "天津", "input": 3000, "defect": 30, "rty": 99.0},
                {"base": "昆山", "input": 2000, "defect": 20, "rty": 99.0},
            ],
            byModel=[
                {"model": "6210 C21", "input": 2500, "defect": 25, "rty": 99.0},
            ],
            topDefectModels=[
                {"model": "6210 C21", "defectCount": 25},
            ],
            recentTrend=[
                {"time": "2026-06", "rty": 99.0},
                {"time": "2026-07", "rty": 98.5},
            ],
        )
        result = _format_context(ctx)
        assert "5000" in result
        assert "50" in result
        assert "天津" in result
        assert "6210 C21" in result
        assert "2026-06" in result

    def test_context_partial_data(self):
        from app.schemas.ai import RTYContext
        ctx = RTYContext(
            totalInput=100,
            totalDefect=1,
            avgRty=99.0,
            byBase=[],
            byModel=[],
            topDefectModels=[],
            recentTrend=[],
        )
        result = _format_context(ctx)
        assert "100" in result
        assert "1" in result


class TestBuildSystemPrompt:
    """Tests for system prompt generation."""

    def test_prompt_contains_role(self):
        from app.schemas.ai import RTYContext
        ctx = RTYContext()
        prompt = _build_system_prompt(ctx)
        assert "数质看板" in prompt or "AI" in prompt or "RTY" in prompt
        assert len(prompt) > 50

    def test_prompt_includes_context_when_data_exists(self):
        from app.schemas.ai import RTYContext
        ctx = RTYContext(
            totalInput=1000,
            totalDefect=10,
            avgRty=99.0,
            byBase=[{"base": "天津", "input": 1000, "defect": 10, "rty": 99.0}],
            byModel=[],
            topDefectModels=[],
            recentTrend=[],
        )
        prompt = _build_system_prompt(ctx)
        assert "1000" in prompt


class TestTruncateMessages:
    """Tests for message history truncation to fit max token budget."""

    def test_empty_messages_kept(self):
        system = "You are an assistant."
        messages = []
        result = _truncate_messages(messages, system, max_tokens=1000)
        assert len(result) == 1
        assert result[0]["role"] == "system"

    def test_short_messages_preserved(self):
        system = "You are an assistant."
        messages = [
            {"role": "user", "content": "hello"},
            {"role": "assistant", "content": "hi there"},
        ]
        result = _truncate_messages(messages, system, max_tokens=10000)
        assert len(result) == 3  # system + user + assistant

    def test_exceeds_budget_drops_oldest_messages(self):
        system = "You are an assistant."  # ~25 chars → ~37 tokens
        messages = [
            {"role": "user", "content": "a" * 500},    # ~750 tokens
            {"role": "assistant", "content": "b" * 500},  # ~750 tokens
        ]
        # max_tokens = 100 should force dropping
        result = _truncate_messages(messages, system, max_tokens=100)
        # At least system + partial messages should remain
        assert len(result) >= 1
        assert result[0]["role"] == "system"

    def test_truncation_marks_truncated_content(self):
        system = "You are an assistant."
        messages = [
            {"role": "user", "content": "x" * 2000},
        ]
        result = _truncate_messages(messages, system, max_tokens=100)
        # Find the user message
        user_msgs = [m for m in result if m["role"] == "user"]
        assert len(user_msgs) <= 1
        if user_msgs:
            assert "截断" in user_msgs[0]["content"]

    def test_system_prompt_always_first(self):
        system = "SYS: " + "x" * 1000
        messages = [
            {"role": "assistant", "content": "response"},
            {"role": "user", "content": "query"},
        ]
        result = _truncate_messages(messages, system, max_tokens=100000)
        assert result[0]["role"] == "system"
        assert result[0]["content"] == system