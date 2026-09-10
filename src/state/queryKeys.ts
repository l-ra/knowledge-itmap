import type { AuthConfig } from "@/kc/types";

/** TanStack Query keys for IT Map bootstrap / metamodel. */
export const queryKeys = {
  bootstrap: (authKey: string) => ["bootstrap", authKey] as const,
  packages: ["packages"] as const,
  schema: (fingerprint: string) => ["schema", fingerprint] as const,
};

export function authQueryKey(auth: AuthConfig): string {
  return [auth.mode ?? "", auth.subject ?? "", auth.roles ?? "", auth.token ? "t" : ""].join("|");
}
