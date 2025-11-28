/**
 * Benchmark server for running workflow performance tests.
 * Exposes HTTP endpoints for invoking workflows and checking run status.
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { getRun, start } from 'workflow/api';
import { getWorld } from 'workflow/runtime';
import * as z from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// When compiled, this runs from dist/server.mjs, so go up one level to benchmarks/
const wellKnownDir = path.resolve(__dirname, '../.well-known/workflow/v1');

if (!process.env.WORKFLOW_TARGET_WORLD) {
  console.error(
    'Error: WORKFLOW_TARGET_WORLD environment variable is not set.'
  );
  process.exit(1);
}

// Use createRequire to load CommonJS modules from ESM
const require = createRequire(import.meta.url);
const flow = require(path.join(wellKnownDir, 'flow.cjs'));
const step = require(path.join(wellKnownDir, 'step.cjs'));

interface WorkflowManifest {
  workflows: Record<string, Record<string, { workflowId: string }>>;
}

const manifest: WorkflowManifest = JSON.parse(
  fs.readFileSync(path.join(wellKnownDir, 'manifest.debug.json'), 'utf-8')
);

const Invoke = z
  .object({
    file: z.string(),
    workflow: z.string(),
    args: z.unknown().array().default([]),
  })
  .transform((obj) => {
    const workflowsForFile = manifest.workflows[obj.file];
    if (!workflowsForFile) {
      throw new Error(`Unknown workflow file: ${obj.file}`);
    }
    const workflowMeta = workflowsForFile[obj.workflow];
    if (!workflowMeta) {
      throw new Error(`Unknown workflow: ${obj.workflow} in ${obj.file}`);
    }
    return {
      args: obj.args,
      workflow: workflowMeta,
    };
  });

const app = new Hono()
  .post('/.well-known/workflow/v1/flow', (ctx) => {
    return flow.POST(ctx.req.raw);
  })
  .post('/.well-known/workflow/v1/step', (ctx) => {
    return step.POST(ctx.req.raw);
  })
  .get('/_manifest', (ctx) => ctx.json(manifest))
  .post('/invoke', async (ctx) => {
    const json = await ctx.req.json().then(Invoke.parse);
    const handler = await start(json.workflow, json.args);
    return ctx.json({ runId: handler.runId });
  })
  .get('/runs/:runId', async (ctx) => {
    return ctx.json(await getWorld().runs.get(ctx.req.param('runId')));
  })
  .get('/runs/:runId/readable', async (ctx) => {
    const runId = ctx.req.param('runId');
    const run = getRun(runId);
    return new Response(run.getReadable());
  });

serve(
  {
    fetch: app.fetch,
    port: Number(process.env.PORT) || 0,
  },
  async (info) => {
    process.env.PORT = info.port.toString();

    const world = getWorld();
    if (world.start) {
      await world
        .start()
        .catch((err) => console.error('Error starting background tasks:', err));
    }

    // Write control message to fd3 for the launcher to know we're ready
    if (process.env.CONTROL_FD === '3') {
      const control = fs.createWriteStream('', { fd: 3 });
      control.write(`${JSON.stringify({ state: 'listening', info })}\n`);
      control.end();
    }
  }
);
