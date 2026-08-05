# Docker deployment

The Compose project runs the React production build behind Nginx and the
FastAPI application as separate containers. Nginx forwards `/api`, `/health`,
and `/ws-voice`; MongoDB remains the existing external service at port `27019`.

## First deployment

Run all commands from the repository root:

```bash
cp docker/.env.example docker/.env
```

Edit `docker/.env` and set strong values for `JWT_SECRET`,
`ALERT_TOKEN_SECRET`, `DEFAULT_ADMIN_PASSWORD`, and `OA_JWT_SECRET`. Generate
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

Open `http://localhost:3000`. The backend health endpoint is available at both
`http://localhost:3000/health` and `http://localhost:8000/health`.

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
