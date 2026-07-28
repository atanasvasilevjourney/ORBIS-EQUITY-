import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { ticker: string } }
) {
  const { ticker } = params;
  if (!/^[A-Z0-9.\-]{1,20}$/i.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker format" }, { status: 400 });
  }
  const sb = createServerClient();

  // Fetch all report types in parallel
  const [incomeRes, balanceRes, cashflowRes, metricsRes] = await Promise.all([
    sb
      .from("financial_reports")
      .select("date, fiscal_year, period, data")
      .eq("symbol", ticker)
      .eq("report_type", "income")
      .eq("period", "FY")
      .order("date", { ascending: false })
      .limit(10),
    sb
      .from("financial_reports")
      .select("date, fiscal_year, period, data")
      .eq("symbol", ticker)
      .eq("report_type", "balance")
      .eq("period", "FY")
      .order("date", { ascending: false })
      .limit(10),
    sb
      .from("financial_reports")
      .select("date, fiscal_year, period, data")
      .eq("symbol", ticker)
      .eq("report_type", "cashflow")
      .eq("period", "FY")
      .order("date", { ascending: false })
      .limit(10),
    sb
      .from("financial_reports")
      .select("date, fiscal_year, period, data")
      .eq("symbol", ticker)
      .eq("report_type", "metrics")
      .eq("period", "FY")
      .order("date", { ascending: false })
      .limit(10),
  ]);

  // Extract key trends from income statements
  const incomeRows = (incomeRes.data ?? []).map((r: any) => ({
    year: r.fiscal_year,
    date: r.date,
    revenue: r.data?.revenue,
    grossProfit: r.data?.grossProfit,
    operatingIncome: r.data?.operatingIncome,
    netIncome: r.data?.netIncome,
    ebitda: r.data?.ebitda,
    eps: r.data?.epsDiluted ?? r.data?.eps,
    grossMargin:
      r.data?.revenue > 0
        ? r.data?.grossProfit / r.data?.revenue
        : null,
    netMargin:
      r.data?.revenue > 0
        ? r.data?.netIncome / r.data?.revenue
        : null,
  }));

  const balanceRows = (balanceRes.data ?? []).map((r: any) => ({
    year: r.fiscal_year,
    date: r.date,
    totalAssets: r.data?.totalAssets,
    totalLiabilities: r.data?.totalLiabilities,
    totalEquity: r.data?.totalStockholdersEquity ?? r.data?.totalEquity,
    totalDebt: r.data?.totalDebt,
    cash: r.data?.cashAndCashEquivalents,
    netDebt: r.data?.netDebt,
    currentRatio:
      r.data?.totalCurrentLiabilities > 0
        ? r.data?.totalCurrentAssets / r.data?.totalCurrentLiabilities
        : null,
  }));

  const cashflowRows = (cashflowRes.data ?? []).map((r: any) => ({
    year: r.fiscal_year,
    date: r.date,
    operatingCF: r.data?.operatingCashFlow,
    capex: r.data?.capitalExpenditure,
    freeCashFlow: r.data?.freeCashFlow,
    dividendsPaid: r.data?.commonDividendsPaid,
    buybacks: r.data?.commonStockRepurchased,
  }));

  const metricsRows = (metricsRes.data ?? []).map((r: any) => ({
    year: r.fiscal_year,
    date: r.date,
    roe: r.data?.returnOnEquity,
    roa: r.data?.returnOnAssets,
    roic: r.data?.returnOnInvestedCapital,
    evEbitda: r.data?.evToEBITDA,
    fcfYield: r.data?.freeCashFlowYield,
    earningsYield: r.data?.earningsYield,
  }));

  return NextResponse.json({
    income: incomeRows,
    balance: balanceRows,
    cashflow: cashflowRows,
    metrics: metricsRows,
  });
}
