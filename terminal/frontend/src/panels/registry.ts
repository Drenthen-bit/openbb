import type { ComponentType } from "react";
import type { PanelType } from "../lib/commands";
import type { PanelProps } from "./types";
import ChartPanel from "./ChartPanel";
import { CommoditiesPanel, CryptoPanel, EarningsPanel, EcoPanel, FxPanel, MonitorPanel, MoversPanel, NewsPanel, SectorsPanel, WorldPanel } from "./MarketPanels";
import { FilingsPanel, FundamentalsPanel, InsightsPanel, OptionsPanel, QuotePanel } from "./SecurityPanels";
import { AlertsPanel, BlotterPanel, PortfolioPanel, TicketPanel } from "./TradingPanels";
import { AnalystPanel, ApiPanel, CorrelationPanel, NotesPanel, YieldPanel } from "./ResearchPanels";
import { HelpPanel, SettingsPanel } from "./SystemPanels";

export const PANELS: Record<PanelType, ComponentType<PanelProps>> = {
  chart: ChartPanel,
  intraday: ChartPanel,
  quote: QuotePanel,
  monitor: MonitorPanel,
  news: NewsPanel,
  options: OptionsPanel,
  fundamentals: FundamentalsPanel,
  yield: YieldPanel,
  eco: EcoPanel,
  earnings: EarningsPanel,
  world: WorldPanel,
  fx: FxPanel,
  crypto: CryptoPanel,
  commodities: CommoditiesPanel,
  movers: MoversPanel,
  sectors: SectorsPanel,
  portfolio: PortfolioPanel,
  ticket: TicketPanel,
  blotter: BlotterPanel,
  alerts: AlertsPanel,
  insights: InsightsPanel,
  analyst: AnalystPanel,
  correlation: CorrelationPanel,
  filings: FilingsPanel,
  api: ApiPanel,
  notes: NotesPanel,
  help: HelpPanel,
  settings: SettingsPanel,
};
