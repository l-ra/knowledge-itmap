import { useEffect } from "react";
import { useApp } from "@/state/AppContext";

export function Toast() {
  const { lastChangeSet, pushChangeSet } = useApp();
  useEffect(() => {
    if (!lastChangeSet) return;
    const t = setTimeout(() => pushChangeSet(null), 4000);
    return () => clearTimeout(t);
  }, [lastChangeSet, pushChangeSet]);

  if (!lastChangeSet) return null;
  return (
    <div className="toast" role="status">
      Uloženo — ChangeSet <span className="mono">{lastChangeSet.id}</span>
      {lastChangeSet.operationType ? ` (${lastChangeSet.operationType})` : ""}
    </div>
  );
}
