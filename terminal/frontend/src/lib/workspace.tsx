// Workspace state: pages of panels, security link groups, persistence.
import { createContext, useContext, useEffect, useReducer, type ReactNode } from "react";
import { functionFor, type PanelType } from "./commands";

export type LinkGroup = "A" | "B" | "C";
export const LINK_GROUPS: LinkGroup[] = ["A", "B", "C"];

export interface PanelState {
  id: string;
  type: PanelType;
  symbol?: string;
  link: LinkGroup | null;
  x: number;
  y: number;
  w: number;
  h: number;
  opts?: Record<string, any>;
}

export interface Page {
  id: string;
  name: string;
  panels: PanelState[];
}

export interface Workspace {
  version: number;
  pages: Page[];
  active: number;
  links: Record<LinkGroup, string>;
  focused: string | null;
}

let counter = 0;
export const uid = () => `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

const p = (type: PanelType, x: number, y: number, w: number, h: number, link: LinkGroup | null = "A", extra: Partial<PanelState> = {}): PanelState => ({
  id: uid(),
  type,
  link,
  x,
  y,
  w,
  h,
  ...extra,
});

export function defaultWorkspace(): Workspace {
  return {
    version: 1,
    active: 0,
    focused: null,
    links: { A: "AAPL", B: "SPY", C: "NVDA" },
    pages: [
      {
        id: uid(),
        name: "Markets",
        panels: [
          p("monitor", 0, 0, 4, 12),
          p("chart", 4, 0, 5, 12),
          p("world", 9, 0, 3, 12),
          p("news", 0, 12, 4, 10, null),
          p("movers", 4, 12, 4, 10),
          p("sectors", 8, 12, 4, 10, null),
        ],
      },
      {
        id: uid(),
        name: "Equity",
        panels: [
          p("quote", 0, 0, 3, 12),
          p("chart", 3, 0, 6, 12),
          p("insights", 9, 0, 3, 12),
          p("fundamentals", 0, 12, 6, 10),
          p("news", 6, 12, 3, 10),
          p("filings", 9, 12, 3, 10),
        ],
      },
      {
        id: uid(),
        name: "Options",
        panels: [p("options", 0, 0, 8, 22), p("intraday", 8, 0, 4, 10), p("quote", 8, 10, 4, 12)],
      },
      {
        id: uid(),
        name: "Macro",
        panels: [
          p("yield", 0, 0, 5, 11, null),
          p("eco", 5, 0, 7, 11, null),
          p("fx", 0, 11, 4, 11, null),
          p("commodities", 4, 11, 4, 11, null),
          p("crypto", 8, 11, 4, 11, null),
        ],
      },
      {
        id: uid(),
        name: "Trading",
        panels: [
          p("ticket", 0, 0, 3, 14),
          p("chart", 3, 0, 5, 14, "A", { opts: { range: "6M" } }),
          p("portfolio", 8, 0, 4, 14),
          p("blotter", 0, 14, 7, 8),
          p("alerts", 7, 14, 5, 8),
        ],
      },
      {
        id: uid(),
        name: "Research",
        panels: [
          p("analyst", 0, 0, 5, 13),
          p("correlation", 5, 0, 4, 9, null),
          p("earnings", 9, 0, 3, 9, null),
          p("notes", 5, 9, 7, 4),
          p("api", 0, 13, 12, 9, null),
        ],
      },
    ],
  };
}

export type Action =
  | { t: "open"; type: PanelType; symbol?: string; reuse?: boolean }
  | { t: "close"; id: string }
  | { t: "update"; id: string; patch: Partial<PanelState> }
  | { t: "opts"; id: string; opts: Record<string, any> }
  | { t: "layout"; layout: { i: string; x: number; y: number; w: number; h: number }[] }
  | { t: "link"; group: LinkGroup; symbol: string }
  | { t: "page"; index: number }
  | { t: "addPage"; name?: string }
  | { t: "renamePage"; index: number; name: string }
  | { t: "removePage"; index: number }
  | { t: "focus"; id: string | null }
  | { t: "replace"; ws: Workspace };

function mapPage(ws: Workspace, fn: (pg: Page) => Page): Workspace {
  return { ...ws, pages: ws.pages.map((pg, i) => (i === ws.active ? fn(pg) : pg)) };
}

export function focusedGroup(ws: Workspace): LinkGroup {
  const page = ws.pages[ws.active];
  const f = page?.panels.find((x) => x.id === ws.focused);
  return f?.link ?? "A";
}

export function reducer(ws: Workspace, a: Action): Workspace {
  switch (a.t) {
    case "open": {
      const page = ws.pages[ws.active];
      const def = functionFor(a.type);
      const group = focusedGroup(ws);
      const sym = a.symbol?.toUpperCase();
      const existing = a.reuse !== false ? page.panels.find((x) => x.type === a.type) : undefined;
      let next = ws;
      if (sym && (!existing || existing.link)) {
        const g = existing?.link ?? group;
        next = { ...next, links: { ...next.links, [g]: sym } };
      }
      if (existing) {
        if (sym && !existing.link) {
          next = mapPage(next, (pg) => ({ ...pg, panels: pg.panels.map((x) => (x.id === existing.id ? { ...x, symbol: sym } : x)) }));
        }
        return { ...next, focused: existing.id };
      }
      const panel: PanelState = {
        id: uid(),
        type: a.type,
        link: def.needsSymbol || ["news", "monitor", "movers", "analyst"].includes(a.type) ? group : null,
        x: 0,
        y: page.panels.reduce((m, x) => Math.max(m, (x.y || 0) + x.h), 0),
        w: def.w,
        h: def.h,
      };
      if (sym && !panel.link) panel.symbol = sym;
      return { ...mapPage(next, (pg) => ({ ...pg, panels: [...pg.panels, panel] })), focused: panel.id };
    }
    case "close":
      return { ...mapPage(ws, (pg) => ({ ...pg, panels: pg.panels.filter((x) => x.id !== a.id) })), focused: ws.focused === a.id ? null : ws.focused };
    case "update":
      return mapPage(ws, (pg) => ({ ...pg, panels: pg.panels.map((x) => (x.id === a.id ? { ...x, ...a.patch } : x)) }));
    case "opts":
      return mapPage(ws, (pg) => ({ ...pg, panels: pg.panels.map((x) => (x.id === a.id ? { ...x, opts: { ...x.opts, ...a.opts } } : x)) }));
    case "layout": {
      const byId = new Map(a.layout.map((l) => [l.i, l]));
      return mapPage(ws, (pg) => ({
        ...pg,
        panels: pg.panels.map((x) => {
          const l = byId.get(x.id);
          return l ? { ...x, x: l.x, y: l.y, w: l.w, h: l.h } : x;
        }),
      }));
    }
    case "link":
      return { ...ws, links: { ...ws.links, [a.group]: a.symbol.toUpperCase() } };
    case "page":
      return a.index >= 0 && a.index < ws.pages.length ? { ...ws, active: a.index, focused: null } : ws;
    case "addPage":
      return { ...ws, pages: [...ws.pages, { id: uid(), name: a.name ?? `Page ${ws.pages.length + 1}`, panels: [] }], active: ws.pages.length, focused: null };
    case "renamePage":
      return { ...ws, pages: ws.pages.map((pg, i) => (i === a.index ? { ...pg, name: a.name } : pg)) };
    case "removePage": {
      if (ws.pages.length <= 1) return ws;
      const pages = ws.pages.filter((_, i) => i !== a.index);
      return { ...ws, pages, active: Math.min(ws.active, pages.length - 1), focused: null };
    }
    case "focus":
      return ws.focused === a.id ? ws : { ...ws, focused: a.id };
    case "replace":
      return a.ws;
  }
}

const STORAGE_KEY = "odp-terminal-workspace-v2";

function loadInitial(): Workspace {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const ws = JSON.parse(raw) as Workspace;
      if (ws.version === 1 && ws.pages?.length) return { ...ws, focused: null };
    }
  } catch {
    /* ignore */
  }
  return defaultWorkspace();
}

interface Ctx {
  ws: Workspace;
  dispatch: (a: Action) => void;
}

const WorkspaceContext = createContext<Ctx | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [ws, dispatch] = useReducer(reducer, undefined, loadInitial);
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(ws));
      } catch {
        /* ignore */
      }
    }, 300);
    return () => clearTimeout(id);
  }, [ws]);
  return <WorkspaceContext.Provider value={{ ws, dispatch }}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace outside provider");
  return ctx;
}

/** Resolve the security a panel is showing. */
export function panelSymbol(ws: Workspace, panel: PanelState): string | undefined {
  return panel.link ? ws.links[panel.link] : panel.symbol;
}
