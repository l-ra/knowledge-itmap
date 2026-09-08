/** In-memory AST for ArchiMate Model Exchange File Format 3.x */

export type LangText = { lang?: string; text: string };

export type ExchangeProperty = {
  key: string;
  value: string;
};

export type ExchangeElement = {
  identifier: string;
  xsiType: string;
  name?: LangText;
  documentation?: LangText;
  properties: ExchangeProperty[];
  /** Extra XML attributes (e.g. accessType on relationships mirrored here for elements if any). */
  extraAttrs: Record<string, string>;
};

export type ExchangeRelationship = {
  identifier: string;
  xsiType: string;
  source: string;
  target: string;
  name?: LangText;
  documentation?: LangText;
  properties: ExchangeProperty[];
  extraAttrs: Record<string, string>;
};

export type ExchangeOrgItem = {
  identifier?: string;
  identifierRef?: string;
  label?: LangText;
  children: ExchangeOrgItem[];
};

export type ExchangeStyle = {
  fillColor?: string;
  lineColor?: string;
  fontColor?: string;
  fontName?: string;
  fontSize?: string;
  lineWidth?: string;
  textAlignment?: string;
  raw?: Record<string, string>;
};

export type ExchangeBendpoint = { x: number; y: number };

export type ExchangeViewNode = {
  identifier: string;
  xsiType: string;
  elementRef?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  style?: ExchangeStyle;
  children: ExchangeViewNode[];
  /** Opaque payload when xsiType is not Element/Label/Container we fully model. */
  opaqueFragment?: string;
};

export type ExchangeViewConnection = {
  identifier: string;
  xsiType: string;
  relationshipRef?: string;
  source: string;
  target: string;
  bendpoints: ExchangeBendpoint[];
  style?: ExchangeStyle;
  opaqueFragment?: string;
};

export type ExchangeView = {
  identifier: string;
  xsiType: string;
  name?: LangText;
  nodes: ExchangeViewNode[];
  connections: ExchangeViewConnection[];
  opaqueFragment?: string;
};

export type ExchangeModel = {
  identifier: string;
  name?: LangText;
  documentation?: LangText;
  elements: ExchangeElement[];
  relationships: ExchangeRelationship[];
  organizations: ExchangeOrgItem[];
  views: ExchangeView[];
};

export type ImportWarning = {
  level: "warning" | "info";
  code: string;
  message: string;
  identifier?: string;
};

export type OrphanCandidate = {
  entityId: string;
  iriLocal: string;
  label: string;
  kind: "element" | "relationship" | "view" | "viewNode" | "viewConnection" | "other";
  incomingRefCount?: number;
};

export type OrphanAction = "keep" | "deprecate" | "delete";

export type ImportResult = {
  created: number;
  updated: number;
  warnings: ImportWarning[];
  orphans: OrphanCandidate[];
  xmlIdentifiers: Set<string>;
};

export type ExportResult = {
  xml: string;
  elementCount: number;
  relationshipCount: number;
  viewCount: number;
};
