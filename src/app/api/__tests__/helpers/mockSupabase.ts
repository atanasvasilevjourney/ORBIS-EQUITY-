/**
 * Mock Supabase client builder for API route tests.
 * Supabase query builders are thenable — routes await them directly.
 */
export type QueryResult = { data: unknown; error: unknown; count?: number };

function buildChain(getResult: () => QueryResult) {
  const chain: Record<string, unknown> = {};
  const methods = [
    "select", "eq", "gte", "lte", "gt", "order", "limit", "range", "single",
  ];

  for (const method of methods) {
    chain[method] = () => chain;
  }

  chain.then = (
    onFulfilled?: (value: QueryResult) => unknown,
    onRejected?: (reason: unknown) => unknown
  ) => Promise.resolve(getResult()).then(onFulfilled, onRejected);

  return chain;
}

export function createMockSupabase(handlers: Record<string, () => QueryResult>) {
  return {
    from: (table: string) =>
      buildChain(() => handlers[table]?.() ?? { data: [], error: null }),
  };
}

export function mockNextRequest(url: string): Request {
  return new Request(url);
}
