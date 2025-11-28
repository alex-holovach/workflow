/**
 * Parallel-steps benchmark workflow.
 * Measures the latency of executing N steps in parallel using Promise.all.
 */

async function work(i: number): Promise<number> {
  'use step';
  return i;
}

export async function parallelSteps(count: number): Promise<number[]> {
  'use workflow';
  const promises = Array.from({ length: count }, (_, i) => work(i));
  return Promise.all(promises);
}
