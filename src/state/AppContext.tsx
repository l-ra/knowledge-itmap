import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { schemaFingerprint } from "@/kc/schemaFingerprint";
import type { ChangeSet, PackageInfo } from "@/kc/types";
import {
  getNavigationResolver,
  loadStoredTemplateCode,
  resetNavigationResolver,
  saveStoredTemplateCode,
} from "@/domain/navigationProfile";
import type { ResolvedNavigationProfile } from "@/domain/navigationProfileTypes";
import { resetNavigationLoader } from "@/domain/navigationProfileLoader";
import { getCardsProfileLoader, resetCardsProfileLoader } from "@/domain/cards";
import { authQueryKey, queryKeys } from "./queryKeys";

export type ActiveChangeSet = StoredActiveChangeSet;

interface BootstrapData {
  packages: PackageInfo[];
  fingerprint: string;
  actorSubject: string | null;
  actorRoles: string[];
}

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
  /** Resolved KC navigation profile for active org. */
  navigationProfile: ResolvedNavigationProfile | null;
  navigationLoading: boolean;
  templateCode: string;
  setTemplateCode: (code: string) => void;
  reloadNavigationProfile: () => Promise<void>;
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

async function fetchBootstrap(opts?: { forceSchema?: boolean }): Promise<BootstrapData> {
  const kc = getKc();
  kc.setAuth(loadAuth());
  await kc.healthz();

  let actorSubject: string | null;
  let actorRoles: string[];
  try {
    const me = await kc.me();
    actorSubject = me.subject || loadAuth().subject || null;
    actorRoles =
      me.roles ||
      (loadAuth().roles || "")
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean);
  } catch {
    const a = loadAuth();
    actorSubject = a.subject || null;
    actorRoles = (a.roles || "")
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);
  }

  const [pkgRes, config] = await Promise.all([kc.listPackages(), kc.getSchemaConfig()]);
  const packages = pkgRes.items;
  const fingerprint = schemaFingerprint(packages, config.updatedAt);

  if (opts?.forceSchema) {
    await getSchema().clearPersisted();
    await getSchema().load({ force: true, fingerprint, config });
  } else {
    await getSchema().load({ fingerprint, config });
  }
  getCardsProfileLoader().clearCache();
  resetCardsProfileLoader();

  return { packages, fingerprint, actorSubject, actorRoles };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [orgPackage, setOrgPackageState] = useState(loadOrgPackage);
  const [auth, setAuthState] = useState(loadAuth);
  const [lastChangeSet, setLastChangeSet] = useState<ChangeSet | null>(null);
  const [activeChangeSet, setActiveChangeSet] = useState<ActiveChangeSet | null>(null);
  const [graphEpoch, setGraphEpoch] = useState(0);
  const [csReady, setCsReady] = useState(false);
  const [navigationProfile, setNavigationProfile] = useState<ResolvedNavigationProfile | null>(null);
  const [navigationLoading, setNavigationLoading] = useState(false);
  const [templateCode, setTemplateCodeState] = useState(loadStoredTemplateCode);

  const authKey = authQueryKey(auth);
  const bootstrapKey = queryKeys.bootstrap(authKey);

  const bootstrap = useQuery({
    queryKey: bootstrapKey,
    queryFn: () => fetchBootstrap(),
    staleTime: Infinity,
    gcTime: 1000 * 60 * 60,
    retry: 1,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  const ready = bootstrap.isSuccess;
  const error = bootstrap.error
    ? bootstrap.error instanceof Error
      ? bootstrap.error.message
      : String(bootstrap.error)
    : null;
  const packages = bootstrap.data?.packages ?? [];
  const actorSubject = bootstrap.data?.actorSubject ?? null;
  const actorRoles = bootstrap.data?.actorRoles ?? [];

  const bumpGraphEpoch = useCallback(() => {
    getKc().clearReadCache();
    setGraphEpoch((n) => n + 1);
  }, []);

  const reloadNavigationProfile = useCallback(async () => {
    if (!getSchema().isLoaded()) return;
    setNavigationLoading(true);
    resetNavigationLoader();
    resetNavigationResolver();
    try {
      const resolved = await getNavigationResolver().loadResolvedProfile(orgPackage);
      setNavigationProfile(resolved);
    } catch (e) {
      console.warn("Navigation profile load failed:", e);
      setNavigationProfile(null);
    } finally {
      setNavigationLoading(false);
    }
  }, [orgPackage]);

  const setTemplateCode = useCallback((code: string) => {
    saveStoredTemplateCode(code);
    setTemplateCodeState(code);
  }, []);

  const applyActive = useCallback((cs: ActiveChangeSet | null) => {
    storeActiveChangeSet(cs);
    getKc().setManualChangeSet(cs?.id || null);
    setActiveChangeSet(cs);
    // Profile/entity reads must see (or drop) the ChangeSet overlay.
    getCardsProfileLoader().clearCache();
    getKc().clearReadCache();
  }, []);

  const reloadPackages = useCallback(async () => {
    try {
      const res = await getKc().listPackages();
      // Package list only — do not change schema fingerprint (use reloadSchema after release import).
      qc.setQueryData<BootstrapData>(bootstrapKey, (old) =>
        old ? { ...old, packages: res.items } : old,
      );
      qc.setQueryData(queryKeys.packages, res.items);
    } catch {
      /* keep prior packages */
    }
  }, [qc, bootstrapKey]);

  const reloadSchema = useCallback(async () => {
    // Force network schema load; keep prior in-memory snap until replaced (no UI race).
    await qc.fetchQuery({
      queryKey: bootstrapKey,
      queryFn: () => fetchBootstrap({ forceSchema: true }),
    });
  }, [qc, bootstrapKey]);

  useEffect(() => {
    if (!ready) return;
    void reloadNavigationProfile();
  }, [ready, orgPackage, graphEpoch, reloadNavigationProfile]);

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
      void getSchema().invalidate();
      // New authKey → fresh bootstrap query; no manual reloadSchema needed.
    },
    [applyActive],
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

  const softReloadSchema = useCallback(async () => {
    try {
      const fp = bootstrap.data?.fingerprint;
      if (fp) await getSchema().load({ fingerprint: fp });
      else await getSchema().load(false);
    } catch {
      /* ignore */
    }
  }, [bootstrap.data?.fingerprint]);

  const commitManualChangeSet = useCallback(async () => {
    const id = activeChangeSet?.id;
    if (!id) return null;
    const committed = await getKc().commitChangeSet(id);
    applyActive(null);
    setLastChangeSet({ ...committed, status: "committed" });
    await softReloadSchema();
    bumpGraphEpoch();
    return committed;
  }, [activeChangeSet?.id, applyActive, bumpGraphEpoch, softReloadSchema]);

  const cancelManualChangeSet = useCallback(async () => {
    const id = activeChangeSet?.id;
    if (!id) {
      applyActive(null);
      return;
    }
    await getKc().cancelChangeSet(id);
    applyActive(null);
    setLastChangeSet({ id, status: "cancelled" });
    await softReloadSchema();
    bumpGraphEpoch();
  }, [activeChangeSet?.id, applyActive, bumpGraphEpoch, softReloadSchema]);

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
      navigationProfile,
      navigationLoading,
      templateCode,
      setTemplateCode,
      reloadNavigationProfile,
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
      navigationProfile,
      navigationLoading,
      templateCode,
      setTemplateCode,
      reloadNavigationProfile,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside provider");
  return v;
}
