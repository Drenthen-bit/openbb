import type { PanelState } from "../lib/workspace";

export interface PanelProps {
  panel: PanelState;
  /** Security resolved from the panel's link group (or its own symbol). */
  symbol?: string;
  setSymbol: (symbol: string) => void;
  setOpts: (opts: Record<string, any>) => void;
  /** Execute a command-line string, e.g. "AAPL GP". */
  run: (command: string) => void;
}
