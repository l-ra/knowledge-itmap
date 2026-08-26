import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getKc, loadAuth, loadOrgPackage, saveAuth, saveOrgPackage, type AuthConfig } from "@/kc/client";
import { getSchema } from "@/kc/schema";
import type { ChangeSet } from "@/kc/types";

interface AppState {
  ready: boolean;
  error: string | null;
  orgPackage: string;
  setOrgPackage: (code: string) => void;
  auth: AuthConfig;
  setAuth: (a: AuthConfig) => void;
  lastChangeSet: ChangeSet | null;
  pushChangeSet: (cs: ChangeSet | null) => void;
  reloadSchema: () => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orgPackage, setOrgPackageState] = useState(loadOrgPackage);
  const [auth, setAuthState] = useState(loadAuth);
  const [lastChangeSet, setLastChangeSet] = useState<ChangeSet | null>(null);

  const reloadSchema = useCallback(async () => {
    setError(null);
    const kc = getKc();
    kc.setAuth(loadAuth());
    try {
      await kc.healthz();
      await getSchema().load(true);
      setReady(true);
    } catch (e) {
      setReady(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reloadSchema();
  }, [reloadSchema]);

  const setOrgPackage = useCallback((code: string) => {
    saveOrgPackage(code);
    setOrgPackageState(code);
  }, []);

  const setAuth = useCallback((a: AuthConfig) => {
    saveAuth(a);
    getKc().setAuth(a);
    setAuthState(a);
    void reloadSchema();
  }, [reloadSchema]);

  const value = useMemo(
    () => ({
      ready,
      error,
      orgPackage,
      setOrgPackage,
      auth,
      setAuth,
      lastChangeSet,
      pushChangeSet: setLastChangeSet,
      reloadSchema,
    }),
    [ready, error, orgPackage, setOrgPackage, auth, setAuth, lastChangeSet, reloadSchema],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside provider");
  return v;
}
