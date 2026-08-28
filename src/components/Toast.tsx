import { useEffect } from "react";
import { useApp } from "@/state/AppContext";

export function Toast() {
  const { lastChangeSet, pushChangeSet, activeChangeSet } = useApp();
  useEffect(() => {
    if (!lastChangeSet) return;
    const t = setTimeout(() => pushChangeSet(null), 4000);
    return () => clearTimeout(t);
  }, [lastChangeSet, pushChangeSet]);

  if (!lastChangeSet) return null;

  const status = lastChangeSet.status;
  let msg: string;
  if (status === "cancelled") {
    msg = "ChangeSet zrušen";
  } else if (status === "open") {
    msg =
      lastChangeSet.operationType === "manual"
        ? "Manuální ChangeSet otevřen"
        : "Uloženo do open ChangeSetu";
  } else if (activeChangeSet && lastChangeSet.id === activeChangeSet.id) {
    msg = "Uloženo do open ChangeSetu";
  } else {
    msg = "ChangeSet potvrzen";
  }

  return (
    <div className="toast" role="status">
      {msg} — <span className="mono">{lastChangeSet.id}</span>
      {lastChangeSet.operationType ? ` (${lastChangeSet.operationType})` : ""}
    </div>
  );
}
