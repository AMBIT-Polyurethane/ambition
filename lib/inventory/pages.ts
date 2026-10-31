/** Every row of a query, 1,000 at a time (the API returns at most 1,000 rows per request). Give it a stable order. */
export async function every<T>(make: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>, max = 50_000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await make(from, from + 999);
    if (error || !data) break;
    out.push(...(data as T[]));
    if (data.length < 1000) break;
  }
  return out;
}
