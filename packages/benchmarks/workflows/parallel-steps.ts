async function work(i: number): Promise<number> {
  'use step';
  return i;
}

export async function parallelSteps(count: number): Promise<number[]> {
  'use workflow';
  return Promise.all(Array.from({ length: count }, (_, i) => work(i)));
}
