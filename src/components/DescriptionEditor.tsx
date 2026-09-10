import { useLayoutEffect, useRef } from "react";
import type { LangMap } from "@/kc/types";

const PRESET_LANGS = ["cs", "en"] as const;

function autosizeTextarea(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

export function normalizeLangMap(map: Record<string, string> | null | undefined): LangMap {
  if (!map) return {};
  return Object.fromEntries(
    Object.entries(map)
      .map(([lang, text]) => [lang.trim().toLowerCase(), text.trim()] as const)
      .filter(([lang, text]) => lang && text),
  );
}

export function langMapsEqual(
  a: Record<string, string> | null | undefined,
  b: Record<string, string> | null | undefined,
): boolean {
  const na = normalizeLangMap(a);
  const nb = normalizeLangMap(b);
  const keys = new Set([...Object.keys(na), ...Object.keys(nb)]);
  for (const k of keys) {
    if ((na[k] || "") !== (nb[k] || "")) return false;
  }
  return true;
}

/** Draft for the editor: at least one row so the user can type. */
export function descriptionsDraftFrom(map?: LangMap | null): Record<string, string> {
  if (map && Object.keys(map).length > 0) return { ...map };
  return { cs: "" };
}

export function preferredDescription(map?: LangMap | null): string {
  if (!map) return "";
  return (map.cs || map.en || Object.values(map).find((v) => v.trim()) || "").trim();
}

interface Props {
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  disabled?: boolean;
  label?: string;
  idPrefix?: string;
}

export function DescriptionEditor({
  value,
  onChange,
  disabled,
  label = "Popis",
  idPrefix = "desc",
}: Props) {
  const entries = Object.entries(value);
  const used = new Set(Object.keys(value).map((l) => l.toLowerCase()));
  const textRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());

  useLayoutEffect(() => {
    for (const el of textRefs.current.values()) autosizeTextarea(el);
  }, [value]);

  function langOptions(current: string): string[] {
    const opts = new Set<string>([...PRESET_LANGS, current.toLowerCase()]);
    return [...opts].filter(Boolean);
  }

  function setLang(oldLang: string, nextLangRaw: string) {
    const nextLang = nextLangRaw.trim().toLowerCase() || "cs";
    if (nextLang === oldLang) return;
    if (used.has(nextLang) && nextLang !== oldLang.toLowerCase()) return;
    const next: Record<string, string> = {};
    for (const [lang, text] of Object.entries(value)) {
      if (lang === oldLang) next[nextLang] = text;
      else next[lang] = text;
    }
    onChange(next);
  }

  function setText(lang: string, text: string) {
    onChange({ ...value, [lang]: text });
  }

  function removeLang(lang: string) {
    const next = { ...value };
    delete next[lang];
    onChange(Object.keys(next).length ? next : { cs: "" });
  }

  function addLang() {
    const nextCode = PRESET_LANGS.find((code) => !used.has(code)) || `l${entries.length + 1}`;
    onChange({ ...value, [nextCode]: "" });
  }

  const canAdd = PRESET_LANGS.some((code) => !used.has(code)) || entries.length < 4;

  return (
    <div className="field description-editor">
      <div className="description-editor-heading">
        <span className="description-editor-label">{label}</span>
        {canAdd && (
          <button type="button" className="link-btn" disabled={disabled} onClick={addLang}>
            + jazyk
          </button>
        )}
      </div>
      {entries.map(([lang, text], index) => {
        const selectId = `${idPrefix}-lang-${index}`;
        const textId = `${idPrefix}-text-${index}`;
        const refKey = `${lang}-${index}`;
        return (
          <div className="description-editor-row" key={refKey}>
            <label className="description-editor-lang" htmlFor={selectId}>
              Jazyk
              <select
                id={selectId}
                value={lang}
                disabled={disabled}
                onChange={(e) => setLang(lang, e.target.value)}
              >
                {langOptions(lang).map((code) => (
                  <option key={code} value={code} disabled={used.has(code) && code !== lang}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
            <label className="description-editor-text" htmlFor={textId}>
              Text
              <textarea
                id={textId}
                ref={(el) => {
                  if (el) textRefs.current.set(refKey, el);
                  else textRefs.current.delete(refKey);
                  autosizeTextarea(el);
                }}
                value={text}
                disabled={disabled}
                rows={1}
                placeholder="Volitelný popis"
                onChange={(e) => {
                  autosizeTextarea(e.currentTarget);
                  setText(lang, e.target.value);
                }}
              />
            </label>
            <button
              type="button"
              className="description-editor-remove"
              disabled={disabled || entries.length <= 1}
              title="Odebrat jazyk"
              aria-label={`Odebrat popis ${lang}`}
              onClick={() => removeLang(lang)}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
