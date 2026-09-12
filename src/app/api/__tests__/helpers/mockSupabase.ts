/**
 * Mock Supabase client builder for API route tests.
 * Supabase query builders are thenable — routes await them directly.
 */
export type QueryResult = { data: unknown; error: unknown; count?: number };

function buildChain(getResult: (from?: number, to?: number) => QueryResult) {
  const chain: Record<string, unknown> = {};
  const methods = [
    "select",
    "eq",
    "neq",
    "gte",
    "lte",
    "gt",
    "lt",
    "in",
    "order",
    "limit",
    "single",
    "maybeSingle",
  ];

  for (const method of methods) {
    chain[method] = () => chain;
  }

  let rangeFrom = 0;
  let rangeTo: number | undefined;

  chain.range = (from: number, to: number) => {
    rangeFrom = from;
    rangeTo = to;
    return chain;
  };

  chain.then = (
    onFulfilled?: (value: QueryResult) => unknown,
    onRejected?: (reason: unknown) => unknown
  ) => Promise.resolve(getResult(rangeFrom, rangeTo)).then(onFulfilled, onRejected);

  return chain;
}

export function createMockSupabase(handlers: Record<string, () => QueryResult>) {
  return {
    from: (table: string) =>
      buildChain((from = 0, to?: number) => {
        const result = handlers[table]?.() ?? { data: [], error: null };
        if (result.error || !Array.isArray(result.data)) return result;
        // Honour .range() so fetchAll pagination terminates
        const end = typeof to === "number" ? to + 1 : undefined;
        const page = (result.data as unknown[]).slice(from, end);
        return { ...result, data: page };
      }),
  };
}

export function mockNextRequest(url: string): Request {
  return new Request(url);
}
