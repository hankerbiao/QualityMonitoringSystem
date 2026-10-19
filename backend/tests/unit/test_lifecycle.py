
from app.core import lifecycle


def test_shutdown_scheduler_handles_scheduler_error(monkeypatch):
    errors: list[str] = []
    monkeypatch.setattr(lifecycle, "log_error", lambda message: errors.append(message))

    class BrokenScheduler:
        def shutdown(self, *, wait):
            raise RuntimeError("closed twice")

    lifecycle.shutdown_scheduler(BrokenScheduler())

    assert errors and "关闭异常" in errors[0]


def test_create_scheduler_rolls_back_when_job_registration_fails(monkeypatch):
    errors: list[str] = []
    monkeypatch.setattr(lifecycle, "log_error", lambda message: errors.append(message))

    class BrokenScheduler:
        def __init__(self):
            self.shutdown_called = False

        def add_job(self, *args, **kwargs):
            raise RuntimeError("scheduler unavailable")

        def shutdown(self, *, wait):
            self.shutdown_called = True

    scheduler = BrokenScheduler()
    monkeypatch.setattr(
        "apscheduler.schedulers.asyncio.AsyncIOScheduler",
        lambda: scheduler,
    )

    assert lifecycle.create_scheduler() is None
    assert scheduler.shutdown_called
    assert any("启动失败" in message for message in errors)


def test_create_scheduler_does_not_register_unbounded_lrr_prewarm(monkeypatch):
    jobs: list[dict[str, object]] = []

    class Scheduler:
        def add_job(self, func, trigger, **kwargs):
            jobs.append({"func": func, "trigger": trigger, **kwargs})

        def start(self):
            return None

    monkeypatch.setattr(
        "apscheduler.schedulers.asyncio.AsyncIOScheduler",
        Scheduler,
    )

    scheduler = lifecycle.create_scheduler()

    assert scheduler is not None
    assert [job["id"] for job in jobs] == ["weekly_production_alert"]
