import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  getKc,
  loadAuth,
  loadOrgPackage,
  loadStoredActiveChangeSet,
  saveAuth,
  saveOrgPackage,
  storeActiveChangeSet,
  type AuthConfig,
  type StoredActiveChangeSet,
} from "@/kc/client";
import { getSchema, packageLabel } from "@/kc/schema";
import type { ChangeSet, PackageInfo } from "@/kc/types";

export type ActiveChangeSet = StoredActiveChangeSet;

interface AppState {
  ready: boolean;
  error: string | null;
  orgPackage: string;
  /** Human-readable name of active org package (root labels, else code). */
  orgPackageLabel: string;
  packages: PackageInfo[];
  packageDisplayName: (code: string) => string;
  setOrgPackage: (code: string) => void;
  reloadPackages: () => Promise<void>;
  auth: AuthConfig;
  setAuth: (a: AuthConfig) => void;
  /** Authenticated subject from /v1/me (or auth.subject in dev). */
  actorSubject: string | null;
  actorRoles: string[];
  lastChangeSet: ChangeSet | null;
  pushChangeSet: (cs: ChangeSet | null) => void;
  reloadSchema: () => Promise<void>;
  /** Manual open ChangeSet mode. */
  activeChangeSet: ActiveChangeSet | null;
  enableManualChangeSet: (comment?: string) => Promise<void>;
  commitManualChangeSet: () => Promise<ChangeSet | null>;
  cancelManualChangeSet: () => Promise<void>;
  resumeChangeSet: (id: string) => Promise<void>;
  /** Increments when graph visibility may change (commit/cancel/resume). */
  graphEpoch: number;
  bumpGraphEpoch: () => void;
}

const Ctx = createContext<AppState | null>(null);

function toStored(cs: ChangeSet): ActiveChangeSet {
  return {
    id: cs.id,
    status: cs.status || "open",
    comment: cs.comment,
    openedAt: cs.openedAt,
    actor: cs.actor,
    claimCount: Array.isArray(cs.claims) ? cs.claims.length : undefined,
  };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orgPackage, setOrgPackageState] = useState(loadOrgPackage);
  const [packages, setPackages] = useState<PackageInfo[]>([]);
  const [auth, setAuthState] = useState(loadAuth);
  const [lastChangeSet, setLastChangeSet] = useState<ChangeSet | null>(null);
  const [activeChangeSet, setActiveChangeSet] = useState<ActiveChangeSet | null>(null);
  const [actorSubject, setActorSubject] = useState<string | null>(null);
  const [actorRoles, setActorRoles] = useState<string[]>([]);
  const [graphEpoch, setGraphEpoch] = useState(0);
  const [csReady, setCsReady] = useState(false);

  const bumpGraphEpoch = useCallback(() => setGraphEpoch((n) => n + 1), []);

  const applyActive = useCallback((cs: ActiveChangeSet | null) => {
    storeActiveChangeSet(cs);
    getKc().setManualChangeSet(cs?.id || null);
    setActiveChangeSet(cs);
  }, []);

  const reloadPackages = useCallback(async () => {
    try {
      const res = await getKc().listPackages();
      setPackages(res.items);
    } catch {
      setPackages([]);
    }
  }, []);

  const reloadSchema = useCallback(async () => {
    setError(null);
    const kc = getKc();
    kc.setAuth(loadAuth());
    try {
      await kc.healthz();
      try {
        const me = await kc.me();
        setActorSubject(me.subject || loadAuth().subject || null);
        setActorRoles(me.roles || (loadAuth().roles || "").split(",").map((r) => r.trim()).filter(Boolean));
      } catch {
        const a = loadAuth();
        setActorSubject(a.subject || null);
        setActorRoles((a.roles || "").split(",").map((r) => r.trim()).filter(Boolean));
      }
      await getSchema().load(true);
      setReady(true);
      await reloadPackages();
    } catch (e) {
      setReady(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [reloadPackages]);

  useEffect(() => {
    void reloadSchema();
  }, [reloadSchema]);

  // Restore open ChangeSet from session after schema is ready
  useEffect(() => {
    if (!ready || csReady) return;
    const stored = loadStoredActiveChangeSet();
    if (!stored?.id) {
      applyActive(null);
      setCsReady(true);
      return;
    }
    void (async () => {
      try {
        const cs = await getKc().getChangeSet(stored.id);
        if (cs.status !== "open") {
          applyActive(null);
        } else {
          applyActive(toStored(cs));
        }
      } catch {
        applyActive(null);
      } finally {
        setCsReady(true);
      }
    })();
  }, [ready, csReady, applyActive]);

  const setOrgPackage = useCallback((code: string) => {
    saveOrgPackage(code);
    setOrgPackageState(code);
  }, []);

  const setAuth = useCallback(
    (a: AuthConfig) => {
      saveAuth(a);
      getKc().setAuth(a);
      setAuthState(a);
      applyActive(null);
      setCsReady(false);
      void reloadSchema();
    },
    [reloadSchema, applyActive],
  );

  const enableManualChangeSet = useCallback(
    async (comment?: string) => {
      if (activeChangeSet?.id) return;
      const cs = await getKc().openChangeSet({
        comment: comment || "IT Map manual ChangeSet",
        operationType: "manual",
      });
      applyActive(toStored(cs));
      setLastChangeSet({ ...cs, status: "open" });
      bumpGraphEpoch();
    },
    [activeChangeSet?.id, applyActive, bumpGraphEpoch],
  );

  const commitManualChangeSet = useCallback(async () => {
    const id = activeChangeSet?.id;
    if (!id) return null;
    const committed = await getKc().commitChangeSet(id);
    applyActive(null);
    setLastChangeSet({ ...committed, status: "committed" });
    try {
      await getSchema().load(true);
    } catch {
      /* ignore */
    }
    bumpGraphEpoch();
    return committed;
  }, [activeChangeSet?.id, applyActive, bumpGraphEpoch]);

  const cancelManualChangeSet = useCallback(async () => {
    const id = activeChangeSet?.id;
    if (!id) {
      applyActive(null);
      return;
    }
    await getKc().cancelChangeSet(id);
    applyActive(null);
    setLastChangeSet({ id, status: "cancelled" });
    try {
      await getSchema().load(true);
    } catch {
      /* ignore */
    }
    bumpGraphEpoch();
  }, [activeChangeSet?.id, applyActive, bumpGraphEpoch]);

  const resumeChangeSet = useCallback(
    async (id: string) => {
      const cs = await getKc().getChangeSet(id);
      if (cs.status !== "open") {
        throw new Error("ChangeSet není open");
      }
      applyActive(toStored(cs));
      setLastChangeSet(cs);
      bumpGraphEpoch();
    },
    [applyActive, bumpGraphEpoch],
  );

  const packageDisplayName = useCallback(
    (code: string) => {
      const pkg = packages.find((p) => p.code === code);
      return packageLabel(pkg, code);
    },
    [packages],
  );

  const orgPackageLabel = packageDisplayName(orgPackage);

  const pushChangeSet = useCallback(
    (cs: ChangeSet | null) => {
      setLastChangeSet(cs);
      if (cs && activeChangeSet?.id && cs.id === activeChangeSet.id) {
        // Refresh claim count for banner when writing into open CS
        void getKc()
          .getChangeSet(cs.id)
          .then((fresh) => {
            if (fresh.status === "open") applyActive(toStored(fresh));
          })
          .catch(() => {});
      }
    },
    [activeChangeSet?.id, applyActive],
  );

  const value = useMemo(
    () => ({
      ready,
      error,
      orgPackage,
      orgPackageLabel,
      packages,
      packageDisplayName,
      setOrgPackage,
      reloadPackages,
      auth,
      setAuth,
      actorSubject,
      actorRoles,
      lastChangeSet,
      pushChangeSet,
      reloadSchema,
      activeChangeSet,
      enableManualChangeSet,
      commitManualChangeSet,
      cancelManualChangeSet,
      resumeChangeSet,
      graphEpoch,
      bumpGraphEpoch,
    }),
    [
      ready,
      error,
      orgPackage,
      orgPackageLabel,
      packages,
      packageDisplayName,
      setOrgPackage,
      reloadPackages,
      auth,
      setAuth,
      actorSubject,
      actorRoles,
      lastChangeSet,
      pushChangeSet,
      reloadSchema,
      activeChangeSet,
      enableManualChangeSet,
      commitManualChangeSet,
      cancelManualChangeSet,
      resumeChangeSet,
      graphEpoch,
      bumpGraphEpoch,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside provider");
  return v;
}
