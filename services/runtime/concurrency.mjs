export async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const consume = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  };
  const workers = Math.min(Math.max(1, Number(limit) || 1), Math.max(1, items.length));
  await Promise.all(Array.from({ length: workers }, () => consume()));
  return results;
}
