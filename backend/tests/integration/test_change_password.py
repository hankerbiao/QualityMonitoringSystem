"""Self-service password changes must revoke old credentials for every account role."""

import pytest

from app.auth_service import AuthService

NEW_PASSWORD = "NewPassword123"


async def login(client, username, password):
    response = await client.post(
        "/api/auth/login", json={"username": username, "password": password}
    )
    assert response.status_code == 200
    return response.json()


@pytest.mark.integration
class TestChangePassword:
    @pytest.mark.parametrize("username", ["admin", "alice"])
    async def test_changes_own_password_and_revokes_all_old_tokens(
        self, client, db_clean, username
    ):
        if username == "alice":
            await db_clean.users.insert_one(
                {
                    "username": "alice",
                    "itcode": "alice",
                    "role": "user",
                    "isActive": True,
                    "passwordHash": AuthService.hash_password("admin123"),
                }
            )
        original = await login(client, username, "admin123")
        other_session = await login(client, username, "admin123")
        response = await client.post(
            "/api/auth/change-password",
            headers={"Authorization": f"Bearer {original['access_token']}"},
            json={
                "username": "someone-else",
                "current_password": "admin123",
                "new_password": NEW_PASSWORD,
            },
        )
        assert response.status_code == 200
        assert response.json() == {"ok": True}
        assert await db_clean.sessions.count_documents({"username": username}) == 0
        for session in [original, other_session]:
            me = await client.get(
                "/api/auth/me", headers={"Authorization": f"Bearer {session['access_token']}"}
            )
            assert me.status_code == 401
            refresh = await client.post(
                "/api/auth/refresh", json={"refresh_token": session["refresh_token"]}
            )
            assert refresh.status_code == 401
        old_login = await client.post(
            "/api/auth/login", json={"username": username, "password": "admin123"}
        )
        assert old_login.status_code == 401
        new_session = await login(client, username, NEW_PASSWORD)
        me = await client.get(
            "/api/auth/me", headers={"Authorization": f"Bearer {new_session['access_token']}"}
        )
        assert me.status_code == 200
        assert me.json()["username"] == username
        assert (
            await client.post(
                "/api/auth/refresh", json={"refresh_token": new_session["refresh_token"]}
            )
        ).status_code == 200
        stored = await db_clean.users.find_one({"username": username})
        assert stored["passwordHash"].startswith("$argon2id$")
        assert AuthService.verify_password(NEW_PASSWORD, stored["passwordHash"])

    @pytest.mark.parametrize(
        ("current_password", "new_password", "status"),
        [
            ("wrong-password", NEW_PASSWORD, 400),
            ("admin123", "admin123", 400),
            ("admin123", "short", 422),
            ("", NEW_PASSWORD, 422),
            ("admin123", "a" * 129, 422),
        ],
    )
    async def test_invalid_changes_preserve_password_and_session(
        self, client, db_clean, current_password, new_password, status
    ):
        session = await login(client, "admin", "admin123")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        stored = await db_clean.users.find_one({"username": "admin"})
        original_hash = stored["passwordHash"]
        response = await client.post(
            "/api/auth/change-password",
            headers=headers,
            json={"current_password": current_password, "new_password": new_password},
        )
        assert response.status_code == status
        assert (await client.get("/api/auth/me", headers=headers)).status_code == 200
        assert (await db_clean.users.find_one({"username": "admin"}))[
            "passwordHash"
        ] == original_hash

    async def test_requires_login(self, client):
        response = await client.post(
            "/api/auth/change-password",
            json={"current_password": "admin123", "new_password": NEW_PASSWORD},
        )
        assert response.status_code == 401

    async def test_does_not_change_other_users_or_revoke_their_sessions(self, client, db_clean):
        admin = await login(client, "admin", "admin123")
        await db_clean.users.insert_one(
            {
                "username": "alice",
                "role": "user",
                "isActive": True,
                "passwordHash": AuthService.hash_password("alice-password"),
            }
        )
        alice = await login(client, "alice", "alice-password")
        response = await client.post(
            "/api/auth/change-password",
            headers={"Authorization": f"Bearer {alice['access_token']}"},
            json={
                "username": "admin",
                "current_password": "alice-password",
                "new_password": NEW_PASSWORD,
            },
        )
        assert response.status_code == 200
        assert (
            await client.get(
                "/api/auth/me", headers={"Authorization": f"Bearer {admin['access_token']}"}
            )
        ).status_code == 200
        await login(client, "admin", "admin123")

    async def test_disabled_account_cannot_change_password(self, client, db_clean):
        session = await login(client, "admin", "admin123")
        await db_clean.users.update_one({"username": "admin"}, {"$set": {"isActive": False}})
        response = await client.post(
            "/api/auth/change-password",
            headers={"Authorization": f"Bearer {session['access_token']}"},
            json={"current_password": "admin123", "new_password": NEW_PASSWORD},
        )
        assert response.status_code == 403
        assert (
            await client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
        ).status_code == 403
