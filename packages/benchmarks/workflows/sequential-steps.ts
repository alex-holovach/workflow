/**
 * Sequential-steps benchmark workflow.
 * Measures the latency of executing N steps sequentially (one after another).
 */

async function work(i: number): Promise<number> {
  'use step';
  return i;
}

export async function sequentialSteps(count: number): Promise<number[]> {
  'use workflow';
  const results: number[] = [];
  for (let i = 0; i < count; i++) {
    results.push(await work(i));
  }
  return results;
}
