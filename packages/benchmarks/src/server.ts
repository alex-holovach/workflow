/**
 * Benchmark server for running workflow performance tests.
 * Exposes HTTP endpoints for invoking workflows and checking run status.
 */

import fs from 'node:fs';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { getRun, start } from 'workflow/api';
import { getWorld } from 'workflow/runtime';
import * as z from 'zod';

import flow from '../.well-known/workflow/v1/flow.js';
import manifest from '../.well-known/workflow/v1/manifest.debug.json' with {
  type: 'json',
};
import step from '../.well-known/workflow/v1/step.js';

if (!process.env.WORKFLOW_TARGET_WORLD) {
  console.error(
    'Error: WORKFLOW_TARGET_WORLD environment variable is not set.'
  );
  process.exit(1);
}

type Files = keyof typeof manifest.workflows;
type Workflows<F extends Files> = keyof (typeof manifest.workflows)[F];

const Invoke = z
  .object({
    file: z.literal(Object.keys(manifest.workflows) as Files[]),
    workflow: z.string(),
    args: z.unknown().array().default([]),
  })
  .transform((obj) => {
    const file = obj.file as keyof typeof manifest.workflows;
    const workflow = z
      .literal(
        Object.keys(manifest.workflows[file]) as Workflows<typeof file>[]
      )
      .parse(obj.workflow);
    return {
      args: obj.args,
      workflow: manifest.workflows[file][workflow],
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
