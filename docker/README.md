# Docker deployment

The Compose project runs the React production build behind Nginx and the
FastAPI application as separate containers. Nginx forwards `/api` and `/health`;
MongoDB remains the existing external service at port `27019`.

## First deployment

Run all commands from the repository root:

```bash
cp docker/.env.example docker/.env
```

Edit `docker/.env` and set strong values for `JWT_SECRET`,
`ALERT_TOKEN_SECRET`, `DEFAULT_ADMIN_PASSWORD`, and `DEFAULT_ADMIN_USERNAME`. Set
`AUTH_COOKIE_SECURE=true` when the frontend is served over HTTPS. The backend rejects
missing, placeholder, or weak production credentials. Generate
the process-record encryption key with the backend image after it is built:

```bash
docker compose -f docker/compose.yaml build backend
docker compose -f docker/compose.yaml run --rm backend \
  python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Put the printed value in `PROCESS_RECORD_CREDENTIAL_KEY`, then start the stack:

```bash
docker compose -f docker/compose.yaml up -d --build
```

Initialize the default MongoDB configuration only when deploying against a new
database. This command can overwrite existing business configuration, so it is
kept out of the normal startup path:

```bash
docker compose -f docker/compose.yaml --profile tools run --rm init-config
```

Open `http://localhost:4000`. The backend health endpoint is available at both
`http://localhost:4000/health` and `http://localhost:4001/health`.

## Frontend Entry Paths

Both `/` and `/QualiBoard` serve the application directly, without an HTTP
redirect. `/QualiBoard/` also works. The browser router selects its base path
from the entry URL, so login, logout, and dashboard navigation keep the chosen
prefix. For example, `/QualiBoard/rty` supports direct access and page reloads.

Both entries share one build. Built assets use `/QualiBoard/assets/`, and API
requests use the current entry prefix (`/api/` or `/QualiBoard/api/`). Nginx
internally removes `/QualiBoard/` before serving assets, routing API requests,
or serving `index.html` for frontend routes. The browser URL stays unchanged.

A gateway can expose the application at `https://your-domain/QualiBoard/` by
proxying `/QualiBoard/` to the frontend container, preserving the request path.
No domain-root `/assets/` or `/api/` gateway routes are required.

## Operations

```bash
# Service state and health
docker compose -f docker/compose.yaml ps

# Follow all logs
docker compose -f docker/compose.yaml logs -f

# Rebuild and restart after an update
docker compose -f docker/compose.yaml up -d --build

# Stop containers without deleting the log volume
docker compose -f docker/compose.yaml down
```

The backend runs one Uvicorn worker because its in-process APScheduler jobs
must not execute more than once. Backend application logs are stored in the
named volume `quality-monitoring-system_backend_logs`.
