import type { Metadata } from "next";
import { PortfolioStudio } from "@/components/portfolio/PortfolioStudio";

export const metadata: Metadata = {
  title: "Portfolio Studio · Orbis",
  description: "Simple long-term stock book and Pro systematic quant stack.",
};

export default function PortfolioPage() {
  return <PortfolioStudio />;
}
