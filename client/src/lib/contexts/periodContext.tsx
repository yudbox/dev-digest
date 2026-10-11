/* periodContext.tsx — the ONE stats period shared by Agent Performance, Agent
   Stats and Skill Stats. Persisted in localStorage so it survives reloads and
   follows the user between screens. Modelled on repoContext.tsx. */
"use client";

import React from "react";
import {
  DEFAULT_PERIOD,
  PERIOD_STORAGE_KEY,
  localTz,
  parseStoredPeriod,
  periodToQuery,
  serializePeriod,
  type Period,
} from "../utils/period";

interface PeriodContextValue {
  period: Period;
  setPeriod: (p: Period) => void;
  /** Querystring for the stats endpoints (`range=…&tz=…` or `from/to/tz`). */
  query: string;
  /**
   * False until the stored period has been read. Stats hooks wait for it so the
   * first request uses the user's period, not the default one.
   */
  ready: boolean;
}

const PeriodCtx = React.createContext<PeriodContextValue>({
  period: DEFAULT_PERIOD,
  setPeriod: () => {},
  query: "",
  ready: false,
});

export function PeriodProvider({ children }: { children: React.ReactNode }) {
  const [period, setPeriodState] = React.useState<Period>(DEFAULT_PERIOD);
  const [tz, setTz] = React.useState<string | null>(null);

  // Read once after mount (localStorage does not exist during SSR).
  React.useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(PERIOD_STORAGE_KEY);
    } catch {
      /* private mode / blocked storage → default */
    }
    setPeriodState(parseStoredPeriod(stored));
    setTz(localTz());
  }, []);

  const setPeriod = React.useCallback((p: Period) => {
    setPeriodState(p);
    try {
      localStorage.setItem(PERIOD_STORAGE_KEY, serializePeriod(p));
    } catch {
      /* ignore: the choice still applies for this session */
    }
  }, []);

  const value = React.useMemo<PeriodContextValue>(
    () => ({
      period,
      setPeriod,
      query: tz ? periodToQuery(period, tz) : "",
      ready: tz !== null,
    }),
    [period, setPeriod, tz],
  );

  return <PeriodCtx.Provider value={value}>{children}</PeriodCtx.Provider>;
}

export function usePeriod() {
  return React.useContext(PeriodCtx);
}
