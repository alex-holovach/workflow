/**
 * Single-step benchmark workflow.
 * Measures the latency of executing one durable step.
 */

async function compute(a: number, b: number): Promise<number> {
  'use step';
  return a + b;
}

export async function singleStep(a: number, b: number): Promise<number> {
  'use workflow';
  return await compute(a, b);
}
