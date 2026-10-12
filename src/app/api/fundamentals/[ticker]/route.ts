import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export const revalidate = 900; // 15-minute cache — EOD data

function margin(numer: number | null | undefined, denom: number | null | undefined): number | null {
  if (numer == null || denom == null || denom === 0) return null;
  return numer / denom;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { ticker: string } }
) {
  const { ticker } = params;
  if (!/^[A-Z0-9.\-]{1,20}$/i.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker format" }, { status: 400 });
  }
  const sb = createServerClient();

  const [incomeRes, balanceRes, cashflowRes, metricsRes, growthRes, fundRes] = await Promise.all([
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
    sb
      .from("financial_reports")
      .select("date, fiscal_year, period, data")
      .eq("symbol", ticker)
      .eq("report_type", "growth")
      .eq("period", "FY")
      .order("date", { ascending: false })
      .limit(10),
    sb
      .from("fundamentals_snapshot")
      .select(
        "f_score, f_score_detail, fundamental_verdict, fundamental_summary, composite_factor_score, value_score, quality_score, growth_score, earnings_quality_score, leverage_score, accruals_ratio, interest_coverage"
      )
      .eq("symbol", ticker)
      .maybeSingle(),
  ]);

  const queryError = [incomeRes, balanceRes, cashflowRes, metricsRes, growthRes].find((r) => r.error);
  if (queryError?.error) {
    console.error("Supabase fundamentals/ticker query error:", queryError.error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const incomeRows = (incomeRes.data ?? []).map((r: any) => ({
    year: r.fiscal_year,
    date: r.date,
    revenue: r.data?.revenue,
    grossProfit: r.data?.grossProfit,
    operatingIncome: r.data?.operatingIncome,
    netIncome: r.data?.netIncome,
    ebitda: r.data?.ebitda,
    eps: r.data?.epsDiluted ?? r.data?.eps,
    grossMargin: margin(r.data?.grossProfit, r.data?.revenue),
    opMargin: margin(r.data?.operatingIncome, r.data?.revenue),
    netMargin: margin(r.data?.netIncome, r.data?.revenue),
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
    currentRatio: margin(r.data?.totalCurrentAssets, r.data?.totalCurrentLiabilities),
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
    peRatio: r.data?.peRatio,
    pbRatio: r.data?.pbRatio,
  }));

  const growthRows = (growthRes.data ?? []).map((r: any) => ({
    year: r.fiscal_year,
    date: r.date,
    revenueGrowth: r.data?.revenueGrowth ?? r.data?.growthRevenue,
    netIncomeGrowth: r.data?.netIncomeGrowth ?? r.data?.growthNetIncome,
    epsGrowth: r.data?.epsgrowth ?? r.data?.growthEPS ?? r.data?.epsGrowth,
    operatingIncomeGrowth: r.data?.operatingIncomeGrowth ?? r.data?.growthOperatingIncome,
    freeCashFlowGrowth: r.data?.freeCashFlowGrowth ?? r.data?.growthFreeCashFlow,
  }));

  const fund = fundRes.data ?? null;

  return NextResponse.json({
    income: incomeRows,
    balance: balanceRows,
    cashflow: cashflowRows,
    metrics: metricsRows,
    growth: growthRows,
    analysis: fund
      ? {
          fScore: fund.f_score,
          fScoreDetail: fund.f_score_detail,
          verdict: fund.fundamental_verdict,
          summary: fund.fundamental_summary,
          compositeScore: fund.composite_factor_score,
          valueScore: fund.value_score,
          qualityScore: fund.quality_score,
          growthScore: fund.growth_score,
          earningsQualityScore: fund.earnings_quality_score,
          leverageScore: fund.leverage_score,
          accrualsRatio: fund.accruals_ratio,
          interestCoverage: fund.interest_coverage,
        }
      : null,
  });
}
