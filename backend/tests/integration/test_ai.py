"""
Integration tests for AI chat API endpoint
"""
from unittest.mock import MagicMock, patch

import pytest


@pytest.mark.integration
class TestAIChat:
    """Tests for POST /api/ai/chat"""

    def _auth(self, make_test_access_token, itcode: str = "testuser") -> dict:
        """构造 Authorization 头（/api/ai/chat 现已要求鉴权）"""
        token = make_test_access_token(itcode)
        return {"Authorization": f"Bearer {token}"}

    def _make_mock_response(self, status_code: int, json_data: dict, text: str = ""):
        """Build a mock httpx response that works as an async context manager."""
        mock_resp = MagicMock()
        mock_resp.status_code = status_code
        mock_resp.json.return_value = json_data
        mock_resp.text = text
        return mock_resp

    async def test_missing_api_url_returns_400(self, client, make_test_access_token):
        """apiUrl is required."""
        response = await client.post(
            "/api/ai/chat",
            headers=self._auth(make_test_access_token),
            json={
                "config": {
                    "apiUrl": "",
                    "modelId": "gpt-4o-mini",
                    "apiKey": "sk-test",
                    "maxTokens": 4096,
                },
                "messages": [{"role": "user", "content": "hello"}],
                "context": {"totalInput": 100, "totalDefect": 1, "avgRty": 99.0},
            },
        )
        assert response.status_code == 400

    async def test_missing_model_id_returns_400(self, client, make_test_access_token):
        """modelId is required."""
        response = await client.post(
            "/api/ai/chat",
            headers=self._auth(make_test_access_token),
            json={
                "config": {
                    "apiUrl": "https://api.example.com/v1/chat/completions",
                    "modelId": "",
                    "apiKey": "sk-test",
                    "maxTokens": 4096,
                },
                "messages": [{"role": "user", "content": "hello"}],
                "context": {"totalInput": 100, "totalDefect": 1, "avgRty": 99.0},
            },
        )
        assert response.status_code == 400

    async def test_missing_api_key_returns_400(self, client, make_test_access_token):
        """apiKey is required."""
        response = await client.post(
            "/api/ai/chat",
            headers=self._auth(make_test_access_token),
            json={
                "config": {
                    "apiUrl": "https://api.example.com/v1/chat/completions",
                    "modelId": "gpt-4o-mini",
                    "apiKey": "",
                    "maxTokens": 4096,
                },
                "messages": [{"role": "user", "content": "hello"}],
                "context": {"totalInput": 100, "totalDefect": 1, "avgRty": 99.0},
            },
        )
        assert response.status_code == 400

    async def test_valid_request_with_mocked_ai(self, client, make_test_access_token):
        """Valid config should call AI API and return response (mocked)."""
        mock_response_data = {
            "choices": [
                {"message": {"content": "本月 RTY 整体呈下降趋势，建议关注 6210 C21 机型。"}}
            ]
        }

        mock_resp = self._make_mock_response(200, mock_response_data)

        class MockAsyncClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                pass

            async def post(self, url, **kwargs):
                return mock_resp

        with patch("app.services.ai_service.httpx.AsyncClient", return_value=MockAsyncClient()):
            response = await client.post(
                "/api/ai/chat",
                headers=self._auth(make_test_access_token),
                json={
                    "config": {
                        "apiUrl": "https://api.example.com",
                        "modelId": "gpt-4o-mini",
                        "apiKey": "sk-test",
                        "maxTokens": 4096,
                    },
                    "messages": [{"role": "user", "content": "分析本月 RTY 趋势"}],
                    "context": {
                        "totalInput": 5000,
                        "totalDefect": 50,
                        "avgRty": 99.0,
                    },
                },
            )

        assert response.status_code == 200
        data = response.json()
        assert "answer" in data
        assert len(data["answer"]) > 0

    async def test_ai_api_error_returns_500(self, client, make_test_access_token):
        """AI API returning non-200 should return 500."""
        mock_resp = self._make_mock_response(500, {}, "Internal server error")

        class MockAsyncClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                pass

            async def post(self, url, **kwargs):
                return mock_resp

        with patch("app.services.ai_service.httpx.AsyncClient", return_value=MockAsyncClient()):
            response = await client.post(
                "/api/ai/chat",
                headers=self._auth(make_test_access_token),
                json={
                    "config": {
                        "apiUrl": "https://api.example.com",
                        "modelId": "gpt-4o-mini",
                        "apiKey": "sk-test",
                        "maxTokens": 4096,
                    },
                    "messages": [{"role": "user", "content": "分析"}],
                    "context": {"totalInput": 100, "totalDefect": 1, "avgRty": 99.0},
                },
            )

        assert response.status_code == 500

    async def test_system_prompt_includes_rty_context(self, client, make_test_access_token):
        """Verify system prompt contains RTY data when provided."""
        captured_json = {}

        mock_resp = self._make_mock_response(200, {"choices": [{"message": {"content": "分析完成"}}]})

        class MockAsyncClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                pass

            async def post(self, url, **kwargs):
                captured_json.update(kwargs.get("json", {}))
                return mock_resp

        with patch("app.services.ai_service.httpx.AsyncClient", return_value=MockAsyncClient()):
            response = await client.post(
                "/api/ai/chat",
                headers=self._auth(make_test_access_token),
                json={
                    "config": {
                        "apiUrl": "https://api.example.com",
                        "modelId": "gpt-4o-mini",
                        "apiKey": "sk-test",
                        "maxTokens": 4096,
                    },
                    "messages": [{"role": "user", "content": "分析"}],
                    "context": {
                        "totalInput": 10000,
                        "totalDefect": 100,
                        "avgRty": 99.0,
                    },
                },
            )

        assert response.status_code == 200
        messages = captured_json.get("messages", [])
        system_msgs = [m for m in messages if m["role"] == "system"]
        assert len(system_msgs) >= 1
        assert "10000" in system_msgs[0]["content"]
