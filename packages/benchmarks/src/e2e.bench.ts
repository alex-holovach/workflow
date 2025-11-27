import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { bench, describe } from 'vitest';
import { createBenchmarkFetcher } from './fetcher.js';
import { launchServer } from './server-launcher.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packagesDir = path.resolve(__dirname, '../..'); // benchmarks/src -> benchmarks -> packages

/**
 * E2E Workflow Latency Benchmarks
 *
 * Compares step execution latency between local (filesystem) and postgres worlds.
 * Tests measure the full workflow lifecycle: invoke -> step execution -> completion.
 *
 * Requires Docker to be running for postgres benchmarks.
 */

type BenchFetcher = ReturnType<typeof createBenchmarkFetcher>;

// Helper to poll until workflow completes
async function waitForCompletion(
  fetcher: BenchFetcher,
  runId: string,
  pollInterval = 5
) {
  let run = await fetcher.getRun(runId);
  while (run.status !== 'completed' && run.status !== 'failed') {
    await new Promise((r) => setTimeout(r, pollInterval));
    run = await fetcher.getRun(runId);
  }
  return run;
}

// Module-level setup - runs when file is imported
console.log('Setting up benchmark servers...');

// Use 'embedded' for local world (built-in alias), absolute path for postgres
const postgresWorldPath = path.join(
  packagesDir,
  'world-postgres/dist/index.js'
);

const localServerPromise = launchServer({ world: 'embedded' })
  .then((server) => {
    console.log('Local server ready on port:', server.info.port);
    return { fetcher: createBenchmarkFetcher(server.info.port), server };
  })
  .catch((err) => {
    console.error('Failed to start local server:', err);
    throw err;
  });

const postgresSetupPromise = (async () => {
  try {
    console.log('Starting postgres container...');
    const container = await new PostgreSqlContainer(
      'postgres:15-alpine'
    ).start();
    const connectionString = container.getConnectionUri();

    process.env.WORKFLOW_POSTGRES_URL = connectionString;
    process.env.DATABASE_URL = connectionString;

    console.log('Running postgres migrations...');
    execSync('pnpm --filter @workflow/world-postgres db:push', {
      stdio: 'inherit',
      env: process.env,
    });

    const server = await launchServer({ world: postgresWorldPath });
    console.log('Postgres server ready on port:', server.info.port);
    return {
      fetcher: createBenchmarkFetcher(server.info.port),
      server,
      container,
    };
  } catch (error) {
    console.warn('⚠ Postgres not available - Docker may not be running');
    return null;
  }
})();

// Cleanup on process exit
process.on('exit', () => {
  localServerPromise.then(({ server }) => server.kill()).catch(() => {});
  postgresSetupPromise
    .then((p) => {
      p?.server.kill();
      p?.container.stop();
    })
    .catch(() => {});
});

describe('Local World - Step Execution Latency', () => {
  bench(
    'single step (addition)',
    async () => {
      const { fetcher } = await localServerPromise;
      const { runId } = await fetcher.invoke(
        'workflows/addition.ts',
        'addition',
        [1, 2]
      );
      await waitForCompletion(fetcher, runId);
    },
    { iterations: 50, warmupIterations: 5 }
  );

  bench(
    'parallel steps (110 steps)',
    async () => {
      const { fetcher } = await localServerPromise;
      const { runId } = await fetcher.invoke(
        'workflows/noop.ts',
        'brokenWf',
        []
      );
      await waitForCompletion(fetcher, runId, 50);
    },
    { iterations: 10, warmupIterations: 2 }
  );

  bench(
    'invoke latency only',
    async () => {
      const { fetcher } = await localServerPromise;
      await fetcher.invoke('workflows/addition.ts', 'addition', [1, 2]);
    },
    { iterations: 100, warmupIterations: 10 }
  );
});

describe('Postgres World - Step Execution Latency', () => {
  // Note: Postgres is slower than local due to pg-boss queue and database overhead
  // Fewer iterations to keep benchmark time reasonable

  bench(
    'single step (addition)',
    async () => {
      const postgres = await postgresSetupPromise;
      if (!postgres) return;
      const { runId } = await postgres.fetcher.invoke(
        'workflows/addition.ts',
        'addition',
        [1, 2]
      );
      await waitForCompletion(postgres.fetcher, runId, 100); // Longer poll interval
    },
    { iterations: 10, warmupIterations: 2 }
  );

  bench(
    'parallel steps (110 steps)',
    async () => {
      const postgres = await postgresSetupPromise;
      if (!postgres) return;
      const { runId } = await postgres.fetcher.invoke(
        'workflows/noop.ts',
        'brokenWf',
        []
      );
      await waitForCompletion(postgres.fetcher, runId, 200); // Longer poll interval
    },
    { iterations: 3, warmupIterations: 1 }
  );

  bench(
    'invoke latency only',
    async () => {
      const postgres = await postgresSetupPromise;
      if (!postgres) return;
      await postgres.fetcher.invoke(
        'workflows/addition.ts',
        'addition',
        [1, 2]
      );
    },
    { iterations: 20, warmupIterations: 5 }
  );
});
