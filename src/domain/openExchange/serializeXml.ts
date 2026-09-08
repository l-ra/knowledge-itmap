import type {
  ExchangeModel,
  ExchangeOrgItem,
  ExchangeProperty,
  ExchangeStyle,
  ExchangeViewNode,
  LangText,
} from "./types";
import { ARCHIMATE_NS, XSI_NS } from "./parseXml";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function langAttrs(lt?: LangText): string {
  if (lt?.lang) return ` xml:lang="${esc(lt.lang)}"`;
  return "";
}

function writeLangEl(tag: string, lt: LangText | undefined, indent: string): string {
  if (!lt?.text) return "";
  return `${indent}<${tag}${langAttrs(lt)}>${esc(lt.text)}</${tag}>\n`;
}

function writeProperties(props: ExchangeProperty[], indent: string): string {
  if (!props.length) return "";
  let out = `${indent}<properties>\n`;
  for (const p of props) {
    out += `${indent}  <property key="${esc(p.key)}">${esc(p.value)}</property>\n`;
  }
  out += `${indent}</properties>\n`;
  return out;
}

function writeStyle(style: ExchangeStyle | undefined, indent: string): string {
  if (!style) return "";
  const lines: string[] = [];
  const pairs: Array<[string, string | undefined]> = [
    ["fillColor", style.fillColor],
    ["lineColor", style.lineColor],
    ["fontColor", style.fontColor],
    ["fontName", style.fontName],
    ["fontSize", style.fontSize],
    ["lineWidth", style.lineWidth],
    ["textAlignment", style.textAlignment],
  ];
  for (const [k, v] of pairs) {
    if (v != null && v !== "") lines.push(`${indent}  <${k}>${esc(v)}</${k}>`);
  }
  if (style.raw) {
    for (const [k, v] of Object.entries(style.raw)) {
      if (k.startsWith("@") || pairs.some(([pk]) => pk === k)) continue;
      if (v != null && v !== "") lines.push(`${indent}  <${k}>${esc(v)}</${k}>`);
    }
  }
  if (!lines.length) return `${indent}<style/>\n`;
  return `${indent}<style>\n${lines.join("\n")}\n${indent}</style>\n`;
}

function writeNode(n: ExchangeViewNode, indent: string): string {
  const attrs = [`identifier="${esc(n.identifier)}"`, `xsi:type="${esc(n.xsiType)}"`];
  if (n.elementRef) attrs.push(`elementRef="${esc(n.elementRef)}"`);
  if (n.x != null) attrs.push(`x="${n.x}"`);
  if (n.y != null) attrs.push(`y="${n.y}"`);
  if (n.w != null) attrs.push(`w="${n.w}"`);
  if (n.h != null) attrs.push(`h="${n.h}"`);
  const body =
    writeStyle(n.style, indent + "  ") + n.children.map((c) => writeNode(c, indent + "  ")).join("");
  if (!body) return `${indent}<node ${attrs.join(" ")}/>\n`;
  return `${indent}<node ${attrs.join(" ")}>\n${body}${indent}</node>\n`;
}

function writeOrg(items: ExchangeOrgItem[], indent: string): string {
  let out = "";
  for (const it of items) {
    const attrs: string[] = [];
    if (it.identifier) attrs.push(`identifier="${esc(it.identifier)}"`);
    if (it.identifierRef) attrs.push(`identifierRef="${esc(it.identifierRef)}"`);
    const inner =
      writeLangEl("label", it.label, indent + "  ") + writeOrg(it.children, indent + "  ");
    if (!inner && attrs.length) {
      out += `${indent}<item ${attrs.join(" ")}/>\n`;
    } else {
      out += `${indent}<item${attrs.length ? " " + attrs.join(" ") : ""}>\n${inner}${indent}</item>\n`;
    }
  }
  return out;
}

/** Serialize AST to Open Exchange XML (ArchiMate 3.x Diagram schema). */
export function serializeOpenExchangeXml(model: ExchangeModel): string {
  let out = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  out += `<model xmlns="${ARCHIMATE_NS}" xmlns:xsi="${XSI_NS}"`;
  out += ` xsi:schemaLocation="${ARCHIMATE_NS} http://www.opengroup.org/xsd/archimate/3.1/archimate3_Diagram.xsd"`;
  if (model.identifier) out += ` identifier="${esc(model.identifier)}"`;
  out += `>\n`;
  out += writeLangEl("name", model.name, "  ");
  out += writeLangEl("documentation", model.documentation, "  ");

  out += `  <elements>\n`;
  for (const e of model.elements) {
    const extra = Object.entries(e.extraAttrs)
      .map(([k, v]) => ` ${k}="${esc(v)}"`)
      .join("");
    out += `    <element identifier="${esc(e.identifier)}" xsi:type="${esc(e.xsiType)}"${extra}>\n`;
    out += writeLangEl("name", e.name, "      ");
    out += writeLangEl("documentation", e.documentation, "      ");
    out += writeProperties(e.properties, "      ");
    out += `    </element>\n`;
  }
  out += `  </elements>\n`;

  out += `  <relationships>\n`;
  for (const r of model.relationships) {
    const extra = Object.entries(r.extraAttrs)
      .map(([k, v]) => ` ${k}="${esc(v)}"`)
      .join("");
    out += `    <relationship identifier="${esc(r.identifier)}" xsi:type="${esc(r.xsiType)}" source="${esc(r.source)}" target="${esc(r.target)}"${extra}>\n`;
    out += writeLangEl("name", r.name, "      ");
    out += writeLangEl("documentation", r.documentation, "      ");
    out += writeProperties(r.properties, "      ");
    out += `    </relationship>\n`;
  }
  out += `  </relationships>\n`;

  if (model.organizations.length) {
    out += `  <organizations>\n`;
    out += writeOrg(model.organizations, "    ");
    out += `  </organizations>\n`;
  }

  out += `  <views>\n    <diagrams>\n`;
  for (const v of model.views) {
    out += `      <view identifier="${esc(v.identifier)}" xsi:type="${esc(v.xsiType || "Diagram")}">\n`;
    out += writeLangEl("name", v.name, "        ");
    for (const n of v.nodes) out += writeNode(n, "        ");
    for (const c of v.connections) {
      const attrs = [
        `identifier="${esc(c.identifier)}"`,
        `xsi:type="${esc(c.xsiType || "Relationship")}"`,
        `source="${esc(c.source)}"`,
        `target="${esc(c.target)}"`,
      ];
      if (c.relationshipRef) attrs.push(`relationshipRef="${esc(c.relationshipRef)}"`);
      let body = writeStyle(c.style, "          ");
      for (const bp of c.bendpoints) {
        body += `          <bendpoint x="${bp.x}" y="${bp.y}"/>\n`;
      }
      if (!body) out += `        <connection ${attrs.join(" ")}/>\n`;
      else out += `        <connection ${attrs.join(" ")}>\n${body}        </connection>\n`;
    }
    out += `      </view>\n`;
  }
  out += `    </diagrams>\n  </views>\n`;
  out += `</model>\n`;
  return out;
}
