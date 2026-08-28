import type { TraversalTemplate } from "@/domain/templates";

interface Props {
  title: string;
  templates: TraversalTemplate[];
  defaultTemplateCode: string;
  onClose: () => void;
  onConfirm: (templateCode: string) => void;
}

export function SpawnFlowDialog({ title, templates, defaultTemplateCode, onClose, onConfirm }: Props) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal spawn-flow-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const code = String(fd.get("template") || defaultTemplateCode);
            onConfirm(code);
          }}
        >
          <div className="field">
            <label htmlFor="spawn-template">Traversal šablona</label>
            <select id="spawn-template" name="template" defaultValue={defaultTemplateCode}>
              {templates.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.labelCs}
                </option>
              ))}
            </select>
          </div>
          <div className="modal-actions">
            <button type="button" className="toolbar-btn" onClick={onClose}>
              Zrušit
            </button>
            <button type="submit" className="toolbar-btn primary">
              Vytvořit tok
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
