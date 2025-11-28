import { WorkflowRunSchema } from '@workflow/world';
import * as z from 'zod';

const Invoke = z.object({ runId: z.coerce.string() });

export function createBenchmarkFetcher(port: number) {
  const baseUrl = `http://localhost:${port}`;

  return {
    async invoke(file: string, workflow: string, args: unknown[]) {
      const response = await fetch(`${baseUrl}/invoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file, workflow, args }),
      });

      if (!response.ok) {
        throw new Error(
          `Invoke failed: ${response.status} ${response.statusText}`
        );
      }

      return Invoke.parse(await response.json());
    },

    async getRun(id: string) {
      const response = await fetch(`${baseUrl}/runs/${encodeURIComponent(id)}`);

      if (!response.ok) {
        throw new Error(
          `Get run failed: ${response.status} ${response.statusText}`
        );
      }

      return WorkflowRunSchema.parseAsync(await response.json());
    },
  };
}
