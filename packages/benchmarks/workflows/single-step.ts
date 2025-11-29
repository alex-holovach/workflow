async function add(a: number, b: number): Promise<number> {
  'use step';
  return a + b;
}

export async function singleStep(a: number, b: number): Promise<number> {
  'use workflow';
  return await add(a, b);
}
