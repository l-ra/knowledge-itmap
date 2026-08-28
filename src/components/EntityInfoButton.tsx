interface Props {
  title?: string;
  onClick: (e: { stopPropagation: () => void; preventDefault: () => void }) => void;
}

export function EntityInfoButton({ title = "Inspekce", onClick }: Props) {
  return (
    <button
      type="button"
      className="entity-info-btn"
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onClick(e);
      }}
    >
      i
    </button>
  );
}
