# @workflow/benchmarks

Latency benchmarks for Workflow DevKit world implementations.

## Running

```bash
pnpm bench:local     # Local World only
pnpm bench:postgres  # Postgres World only (requires Docker)
pnpm bench           # All benchmarks
```

## Requirements

- **Local World**: None
- **Postgres World**: Docker (uses `postgres:15-alpine`)
