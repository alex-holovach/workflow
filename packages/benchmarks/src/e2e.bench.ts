import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { bench, beforeAll, describe } from 'vitest';
import { createBenchmarkFetcher } from './fetcher.js';
import { launchServer } from './server-launcher.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packagesDir = path.resolve(__dirname, '../..');
const postgresWorldPath = path.join(
  packagesDir,
  'world-postgres/dist/index.js'
);

type BenchFetcher = ReturnType<typeof createBenchmarkFetcher>;

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

let localServerPromise: ReturnType<typeof launchServer> | null = null;
function getLocalServer() {
  if (!localServerPromise) {
    localServerPromise = launchServer({ world: 'embedded' });
  }
  return localServerPromise;
}

let postgresSetupPromise: Promise<{
  fetcher: BenchFetcher;
  server: Awaited<ReturnType<typeof launchServer>>;
  container: Awaited<ReturnType<PostgreSqlContainer['start']>>;
}> | null = null;

async function getPostgresSetup() {
  if (!postgresSetupPromise) {
    postgresSetupPromise = (async () => {
      const container = await new PostgreSqlContainer(
        'postgres:15-alpine'
      ).start();
      process.env.WORKFLOW_POSTGRES_URL = container.getConnectionUri();
      process.env.DATABASE_URL = container.getConnectionUri();

      execSync('pnpm --filter @workflow/world-postgres db:push', {
        stdio: 'inherit',
        env: process.env,
      });

      const server = await launchServer({ world: postgresWorldPath });
      return {
        fetcher: createBenchmarkFetcher(server.info.port),
        server,
        container,
      };
    })();
  }
  return postgresSetupPromise;
}

process.on('exit', () => {
  localServerPromise?.then((server) => server.kill()).catch(() => {});
  postgresSetupPromise
    ?.then((p) => {
      p.server.kill();
      p.container.stop();
    })
    .catch(() => {});
});

async function getLocalFetcher() {
  const server = await getLocalServer();
  return createBenchmarkFetcher(server.info.port);
}

async function getPostgresFetcher() {
  const postgres = await getPostgresSetup();
  return postgres.fetcher;
}

describe('Local World - Step Execution Latency', () => {
  bench(
    'single step',
    async () => {
      const fetcher = await getLocalFetcher();
      const { runId } = await fetcher.invoke(
        'workflows/single-step.ts',
        'singleStep',
        [1, 2]
      );
      await waitForCompletion(fetcher, runId);
    },
    { iterations: 10, warmupIterations: 2 }
  );

  bench(
    'parallel steps (20)',
    async () => {
      const fetcher = await getLocalFetcher();
      const { runId } = await fetcher.invoke(
        'workflows/parallel-steps.ts',
        'parallelSteps',
        [20]
      );
      await waitForCompletion(fetcher, runId, 50);
    },
    { iterations: 5, warmupIterations: 1 }
  );

  bench(
    'sequential steps (10)',
    async () => {
      const fetcher = await getLocalFetcher();
      const { runId } = await fetcher.invoke(
        'workflows/sequential-steps.ts',
        'sequentialSteps',
        [10]
      );
      await waitForCompletion(fetcher, runId, 20);
    },
    { iterations: 5, warmupIterations: 1 }
  );

  bench(
    'invoke latency only',
    async () => {
      const fetcher = await getLocalFetcher();
      await fetcher.invoke('workflows/single-step.ts', 'singleStep', [1, 2]);
    },
    { iterations: 20, warmupIterations: 3 }
  );
});

describe('Postgres World - Step Execution Latency', () => {
  beforeAll(() => getPostgresSetup());

  bench(
    'single step',
    async () => {
      const fetcher = await getPostgresFetcher();
      const { runId } = await fetcher.invoke(
        'workflows/single-step.ts',
        'singleStep',
        [1, 2]
      );
      await waitForCompletion(fetcher, runId, 100);
    },
    { iterations: 3, warmupIterations: 1 }
  );

  bench(
    'parallel steps (20)',
    async () => {
      const fetcher = await getPostgresFetcher();
      const { runId } = await fetcher.invoke(
        'workflows/parallel-steps.ts',
        'parallelSteps',
        [20]
      );
      await waitForCompletion(fetcher, runId, 200);
    },
    { iterations: 2, warmupIterations: 1 }
  );

  bench(
    'sequential steps (10)',
    async () => {
      const fetcher = await getPostgresFetcher();
      const { runId } = await fetcher.invoke(
        'workflows/sequential-steps.ts',
        'sequentialSteps',
        [10]
      );
      await waitForCompletion(fetcher, runId, 200);
    },
    { iterations: 2, warmupIterations: 1 }
  );

  bench(
    'invoke latency only',
    async () => {
      const fetcher = await getPostgresFetcher();
      await fetcher.invoke('workflows/single-step.ts', 'singleStep', [1, 2]);
    },
    { iterations: 10, warmupIterations: 2 }
  );
});
