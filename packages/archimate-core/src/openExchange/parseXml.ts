import { DOMParser as XmldomParser } from "@xmldom/xmldom";
import type {
  ExchangeBendpoint,
  ExchangeElement,
  ExchangeModel,
  ExchangeOrgItem,
  ExchangeProperty,
  ExchangeRelationship,
  ExchangeStyle,
  ExchangeView,
  ExchangeViewConnection,
  ExchangeViewNode,
  LangText,
} from "./types";

export const ARCHIMATE_NS = "http://www.opengroup.org/xsd/archimate/3.0/";
export const XSI_NS = "http://www.w3.org/2001/XMLSchema-instance";
const XML_NS = "http://www.w3.org/XML/1998/namespace";

/** Browser DOMParser or @xmldom/xmldom in Node. */
export function parseXmlDocument(xml: string): globalThis.Document {
  if (typeof globalThis.DOMParser !== "undefined") {
    return new globalThis.DOMParser().parseFromString(xml, "application/xml");
  }
  // xmldom's Document is structurally compatible for our Element traversal.
  const doc = new XmldomParser().parseFromString(xml, "application/xml");
  return doc as unknown as globalThis.Document;
}

function localName(el: Element): string {
  return el.localName || el.tagName.replace(/^.*:/, "");
}

function elementChildren(parent: Element): Element[] {
  const kids = (parent as Element & { children?: HTMLCollection }).children;
  if (kids && kids.length !== undefined) {
    return Array.from(kids);
  }
  return Array.from(parent.childNodes).filter((n): n is Element => n.nodeType === 1);
}

function childElements(parent: Element, name?: string): Element[] {
  return elementChildren(parent).filter((c) => (name ? localName(c) === name : true));
}

function firstChild(parent: Element, name: string): Element | undefined {
  return childElements(parent, name)[0];
}

function textContent(el: Element | undefined): string {
  return (el?.textContent || "").trim();
}

function langText(el: Element | undefined): LangText | undefined {
  if (!el) return undefined;
  const text = textContent(el);
  if (!text) return undefined;
  const lang = el.getAttributeNS(XML_NS, "lang") || el.getAttribute("xml:lang") || undefined;
  return { lang, text };
}

function xsiType(el: Element): string {
  return (
    el.getAttributeNS(XSI_NS, "type") ||
    el.getAttribute("xsi:type") ||
    el.getAttribute("type") ||
    ""
  );
}

function readProperties(parent: Element): ExchangeProperty[] {
  const propsEl = firstChild(parent, "properties");
  if (!propsEl) return [];
  return childElements(propsEl, "property").map((p) => ({
    key: p.getAttribute("key") || p.getAttribute("propertyDefinitionRef") || "",
    value: textContent(p) || p.getAttribute("value") || "",
  })).filter((p) => p.key);
}

function readStyle(parent: Element): ExchangeStyle | undefined {
  const styleEl = firstChild(parent, "style");
  if (!styleEl) return undefined;
  const style: ExchangeStyle = { raw: {} };
  for (const c of childElements(styleEl)) {
    const n = localName(c);
    const t = textContent(c);
    if (style.raw) style.raw[n] = t;
    if (n === "fillColor") style.fillColor = t;
    else if (n === "lineColor") style.lineColor = t;
    else if (n === "fontColor") style.fontColor = t;
    else if (n === "fontName") style.fontName = t;
    else if (n === "fontSize") style.fontSize = t;
    else if (n === "lineWidth") style.lineWidth = t;
    else if (n === "textAlignment") style.textAlignment = t;
  }
  // Also capture attributes on style
  for (const attr of Array.from(styleEl.attributes)) {
    if (attr.name.startsWith("xmlns")) continue;
    style.raw = style.raw || {};
    style.raw[`@${attr.name}`] = attr.value;
  }
  return style;
}

function numAttr(el: Element, name: string): number | undefined {
  const v = el.getAttribute(name);
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function readNode(el: Element): ExchangeViewNode {
  const known = new Set(["Element", "Label", "Container"]);
  const type = xsiType(el) || "Element";
  const node: ExchangeViewNode = {
    identifier: el.getAttribute("identifier") || "",
    xsiType: type,
    elementRef: el.getAttribute("elementRef") || undefined,
    x: numAttr(el, "x"),
    y: numAttr(el, "y"),
    w: numAttr(el, "w"),
    h: numAttr(el, "h"),
    style: readStyle(el),
    children: childElements(el, "node").map(readNode),
  };
  if (!known.has(type) || (!node.elementRef && type !== "Label" && type !== "Container")) {
    // Keep a compact opaque note; full re-serialize still uses structured fields when present
    node.opaqueFragment = JSON.stringify({
      xsiType: type,
      attrs: Object.fromEntries(
        Array.from(el.attributes)
          .filter((a) => !a.name.startsWith("xmlns"))
          .map((a) => [a.name, a.value]),
      ),
    });
  }
  return node;
}

function readConnection(el: Element): ExchangeViewConnection {
  const bendpoints: ExchangeBendpoint[] = childElements(el, "bendpoint").map((b) => ({
    x: Number(b.getAttribute("x") || 0),
    y: Number(b.getAttribute("y") || 0),
  }));
  return {
    identifier: el.getAttribute("identifier") || "",
    xsiType: xsiType(el) || "Relationship",
    relationshipRef: el.getAttribute("relationshipRef") || undefined,
    source: el.getAttribute("source") || "",
    target: el.getAttribute("target") || "",
    bendpoints,
    style: readStyle(el),
  };
}

function readOrgItem(el: Element): ExchangeOrgItem {
  return {
    identifier: el.getAttribute("identifier") || undefined,
    identifierRef: el.getAttribute("identifierRef") || undefined,
    label: langText(firstChild(el, "label")),
    children: childElements(el, "item").map(readOrgItem),
  };
}

const STRUCTURAL_ATTRS = new Set([
  "identifier",
  "source",
  "target",
  "elementRef",
  "relationshipRef",
  "x",
  "y",
  "w",
  "h",
  "type",
]);

function extraAttrs(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.includes(":") ? attr.localName || attr.name.split(":").pop()! : attr.name;
    if (name.startsWith("xmlns") || name === "type") continue;
    if (attr.namespaceURI === XSI_NS) continue;
    if (STRUCTURAL_ATTRS.has(name)) continue;
    out[name] = attr.value;
  }
  return out;
}

/**
 * Parse Open Exchange XML string into AST.
 * Uses DOMParser in browser / happy-dom; @xmldom/xmldom in Node.
 */
export function parseOpenExchangeXml(xml: string): ExchangeModel {
  const doc = parseXmlDocument(xml);
  const errEl =
    typeof doc.querySelector === "function" ? doc.querySelector("parsererror") : null;
  if (errEl) {
    throw new Error(
      `Invalid Open Exchange XML: ${errEl.textContent?.slice(0, 200) || "parse error"}`,
    );
  }
  const root = doc.documentElement;
  if (!root || localName(root) !== "model") {
    throw new Error("Open Exchange root element must be <model>");
  }

  const elementsEl = firstChild(root, "elements");
  const relationshipsEl = firstChild(root, "relationships");
  const organizationsEl = firstChild(root, "organizations");
  const viewsEl = firstChild(root, "views");
  const diagramsEl = viewsEl ? firstChild(viewsEl, "diagrams") : undefined;

  const elements: ExchangeElement[] = (elementsEl ? childElements(elementsEl, "element") : []).map((el) => ({
    identifier: el.getAttribute("identifier") || "",
    xsiType: xsiType(el),
    name: langText(firstChild(el, "name")),
    documentation: langText(firstChild(el, "documentation")),
    properties: readProperties(el),
    extraAttrs: extraAttrs(el),
  }));

  const relationships: ExchangeRelationship[] = (relationshipsEl
    ? childElements(relationshipsEl, "relationship")
    : []
  ).map((el) => ({
    identifier: el.getAttribute("identifier") || "",
    xsiType: xsiType(el),
    source: el.getAttribute("source") || "",
    target: el.getAttribute("target") || "",
    name: langText(firstChild(el, "name")),
    documentation: langText(firstChild(el, "documentation")),
    properties: readProperties(el),
    extraAttrs: extraAttrs(el),
  }));

  const organizations: ExchangeOrgItem[] = organizationsEl
    ? childElements(organizationsEl, "item").map(readOrgItem)
    : [];

  const views: ExchangeView[] = (diagramsEl ? childElements(diagramsEl, "view") : []).map((el) => ({
    identifier: el.getAttribute("identifier") || "",
    xsiType: xsiType(el) || "Diagram",
    name: langText(firstChild(el, "name")),
    nodes: childElements(el, "node").map(readNode),
    connections: childElements(el, "connection").map(readConnection),
  }));

  return {
    identifier: root.getAttribute("identifier") || "",
    name: langText(firstChild(root, "name")),
    documentation: langText(firstChild(root, "documentation")),
    elements,
    relationships,
    organizations,
    views,
  };
}

export function collectXmlIdentifiers(model: ExchangeModel): Set<string> {
  const ids = new Set<string>();
  if (model.identifier) ids.add(model.identifier);
  for (const e of model.elements) if (e.identifier) ids.add(e.identifier);
  for (const r of model.relationships) if (r.identifier) ids.add(r.identifier);
  const walkOrg = (items: ExchangeOrgItem[]) => {
    for (const it of items) {
      if (it.identifier) ids.add(it.identifier);
      walkOrg(it.children);
    }
  };
  walkOrg(model.organizations);
  const walkNode = (n: ExchangeViewNode) => {
    if (n.identifier) ids.add(n.identifier);
    n.children.forEach(walkNode);
  };
  for (const v of model.views) {
    if (v.identifier) ids.add(v.identifier);
    v.nodes.forEach(walkNode);
    for (const c of v.connections) if (c.identifier) ids.add(c.identifier);
  }
  return ids;
}
