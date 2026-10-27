/**
 * Mock Supabase client builder for API route tests.
 * Supabase query builders are thenable — routes await them directly.
 */
export type QueryResult = { data: unknown; error: unknown; count?: number };

function buildChain(getResult: (from?: number, to?: number, select?: string) => QueryResult) {
  const chain: Record<string, unknown> = {};
  const methods = [
    "eq",
    "neq",
    "gte",
    "lte",
    "gt",
    "lt",
    "in",
    "order",
    "limit",
  ];

  for (const method of methods) {
    chain[method] = () => chain;
  }

  let rangeFrom = 0;
  let rangeTo: number | undefined;
  let selectCols = "";
  let singleRow = false;

  chain.single = () => {
    singleRow = true;
    return chain;
  };
  chain.maybeSingle = () => {
    singleRow = true;
    return chain;
  };

  chain.select = (cols?: string) => {
    selectCols = cols ?? "";
    return chain;
  };

  chain.range = (from: number, to: number) => {
    rangeFrom = from;
    rangeTo = to;
    return chain;
  };

  chain.then = (
    onFulfilled?: (value: QueryResult) => unknown,
    onRejected?: (reason: unknown) => unknown
  ) => {
    const result = getResult(rangeFrom, rangeTo, selectCols);
    const resolved =
      singleRow && Array.isArray(result.data)
        ? { ...result, data: (result.data as unknown[])[0] ?? null }
        : result;
    return Promise.resolve(resolved).then(onFulfilled, onRejected);
  };

  return chain;
}

export function createMockSupabase(handlers: Record<string, (select?: string) => QueryResult>) {
  return {
    from: (table: string) =>
      buildChain((from = 0, to?: number, select?: string) => {
        const result = handlers[table]?.(select) ?? { data: [], error: null };
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
