import os
import subprocess
from pathlib import Path

import pytest

DEPLOY_SCRIPT = Path(__file__).resolve().parents[3] / "deploy-online.sh"


def git(directory, *args):
    return subprocess.run(
        ["git", "-C", str(directory), *args],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


@pytest.fixture
def deployment(tmp_path):
    origin = tmp_path / "origin.git"
    source = tmp_path / "source"
    remote = tmp_path / "remote"
    source.mkdir()
    git(tmp_path, "init", "--bare", str(origin))
    git(source, "init", "-b", "main")
    git(source, "config", "user.email", "deploy@example.test")
    git(source, "config", "user.name", "Deployment test")
    (source / "docker").mkdir()
    (source / "docker/compose.yaml").write_text("services: {}\n")
    (source / ".gitignore").write_text("docker/.env\n")
    git(source, "add", ".")
    git(source, "commit", "-m", "Initial configuration")
    git(source, "remote", "add", "origin", str(origin))
    git(source, "push", "-u", "origin", "main")
    git(tmp_path, "clone", "-b", "main", str(origin), str(remote))
    (remote / "docker/.env").write_text("JWT_SECRET=test-secret\n")
    (source / "version").write_text("updated\n")
    git(source, "add", "version")
    git(source, "commit", "-m", "Application update")
    git(source, "push")

    tools = tmp_path / "bin"
    tools.mkdir()
    docker = tools / "docker"
    docker.write_text(
        "#!/usr/bin/env bash\n"
        'printf "%s\\n" "$*" >> "$DOCKER_CALLS"\n'
        'if [[ "$1" == inspect ]]; then printf "healthy\\n";\n'
        'elif [[ "$*" == *"ps -q"* ]]; then printf "container-id\\n"; fi\n'
    )
    docker.chmod(0o755)
    calls = tmp_path / "docker-calls"
    environment = {
        **os.environ,
        "PATH": f"{tools}{os.pathsep}{os.environ['PATH']}",
        "APP_DIR": str(remote),
        "DEPLOY_BRANCH": "main",
        "DEPLOY_COMMIT": git(source, "rev-parse", "HEAD"),
        "HTTP_PROXY_URL": "",
        "SOCKS_PROXY_URL": "",
        "DOCKER_CALLS": str(calls),
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": os.devnull,
    }
    script = (
        DEPLOY_SCRIPT.read_text().split("<<'REMOTE_SCRIPT'\n", 1)[1].split("\nREMOTE_SCRIPT", 1)[0]
    )

    def run():
        return subprocess.run(
            ["bash"],
            input=script,
            env=environment,
            text=True,
            capture_output=True,
            timeout=10,
        )

    return source, remote, calls, environment, run


def test_deploy_updates_exact_commit_and_preserves_remote_configuration(deployment):
    _source, remote, calls, environment, run = deployment
    config = remote / "docker/compose.yaml"
    config.write_text("services: {}\n# Production configuration\n")

    result = run()

    assert result.returncode == 0, result.stderr
    assert git(remote, "rev-parse", "HEAD") == environment["DEPLOY_COMMIT"]
    assert "Production configuration" in config.read_text()
    assert (remote / "docker/.env").read_text() == "JWT_SECRET=test-secret\n"
    assert "up -d --build" in calls.read_text()


def test_deploy_rejects_another_remote_branch_before_building(deployment):
    _source, remote, calls, _environment, run = deployment
    git(remote, "switch", "-c", "other")

    result = run()

    assert result.returncode != 0
    assert "remote branch must be main" in result.stderr
    assert "up -d --build" not in calls.read_text()


def test_deploy_rejects_branch_that_advanced_after_push(deployment):
    source, _remote, calls, _environment, run = deployment
    git(source, "commit", "--allow-empty", "-m", "Concurrent update")
    git(source, "push")

    result = run()

    assert result.returncode != 0
    assert "branch changed after push" in result.stderr
    assert "up -d --build" not in calls.read_text()


def test_deploy_rejects_conflicting_remote_configuration(deployment):
    source, remote, calls, environment, run = deployment
    (source / "docker/compose.yaml").write_text("services: {}\n# New tracked configuration\n")
    git(source, "add", "docker/compose.yaml")
    git(source, "commit", "-m", "Configuration update")
    git(source, "push")
    environment["DEPLOY_COMMIT"] = git(source, "rev-parse", "HEAD")
    (remote / "docker/compose.yaml").write_text("services: {}\n# Local configuration\n")

    result = run()

    assert result.returncode != 0
    assert "remote configuration conflicts" in result.stderr
    assert "up -d --build" not in calls.read_text()
