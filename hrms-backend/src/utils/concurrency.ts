/**
 * `fn` over every item, at most `limit` at a time, results in the items' order.
 *
 * For the payroll screens, which work a month out employee by employee: one at
 * a time, a hundred people at a dozen round trips each kept the Payroll Run
 * spinning until the request gave up. All at once would put a hundred
 * people's worth of queries on the database in the same instant. A few at a
 * time is most of the speed for little of the load.
 */
export async function mapInOrder<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
