# Cards workspace UI (záložky + sloupce + pinboard + inplace)

**Stav:** implementováno  
**Scope:** pouze režim Karty (`/cards`) — **ne** Browser / Traversal  
**Kód:** `src/pages/CardsPage.tsx`, styly v `src/styles.css`

## Záložky (tab shell)

Úsporná hlavička záložek nahrazuje breadcrumbs / „← Hub“ / „Všechny karty“.

| Záložka | Chování |
|---------|---------|
| **Karty** (hub) | První, nezavíratelná. Výběr entity ze seznamu. Menu **Karty** / `+` přepne sem. |
| Workspace tab | Titulek = **kořenová karta** (první entita procházení). Zavírací ×. |
| **+** | Aktivuje hub pro výběr další karty → nová workspace záložka. |

- Klik v hubu otevře **novou** workspace záložku a aktivuje ji.
- Ikona **↗** na kartě otevře tuto entitu jako **kořen nové záložky**.
- URL: hub = `/cards`; aktivní workspace = `/cards/:focusId`. Stav sloupců žije v React state záložky (ne v lineárním trailu).

## Model workspace (uvnitř záložky)

```ts
type CardRef = {
  entityId: string;
  openedFrom?: {
    entityId: string;
    slotId?: string;
    slotLabel?: string;
    relationshipId?: string;
    relationshipType?: string;
    direction?: "outgoing" | "incoming";
  };
};

// tab state
{ rootEntityId, title, columns: CardRef[][], focusId }
```

- Entita je ve workspace záložce **nejvýše jednou**; další „otevři“ jen přesune focus.
- Soft větvení **A**: otevření do další úrovně nepřepisuje pravé sloupce.
- Zavření poslední karty v záložce záložku zavře a vrátí na hub (nebo sousední tab).

## Soft větvení (A)

Otevření vazby do **další úrovně** přidá kartu do sloupce `depth+1`.  
Karty už otevřené napravo **nezmizí**.

**Zavření karty s potomky:** dialog  
`OK = zavřít včetně potomků (kaskáda)` / `Zrušit = zavřít jen tuto`.  
Potomci = karty s `openedFrom` (tranzitivně) ukazující na zavíranou entitu.

**Úrovně:** klik na „Úroveň X“ sbalí sloupec do vertikálního chipu `Úroveň X (N)`; klik znovu rozbalí.  
V rozbalené úrovni ikona oka = skrýt všechny sekce všech karet v úrovni.

Provenance: **Otevřeno z: &lt;zdroj&gt; · &lt;slot&gt;**.  
U expert hran navíc **· &lt;relationshipType&gt; · forward|inverse**.

## Inplace

| Akce | UI | Chování |
|------|-----|---------|
| Další úroveň | klik na název | soft append do dalšího sloupce |
| Inplace | `↓` | vnořená karta pod řádkem vazby |

Sousedé ve slotu jsou **tabulka**: Název · Typ · ↓.  
Další úroveň = klik na název; inplace = ↓.

Z inplace lze znovu otevřít inplace (**neomezená hloubka**); entita už přítomná v inplace cestě má ↓ vypnuté (ochrana proti cyklu A→B→A).  
Každé inplace zanoření spouští vlastní `loadCard` (síť + DOM).

## Šířka úrovně

Úroveň má resize handle na pravém okraji (táhnout). Rozsah cca 14–64 rem; stav šířky je per-session v záložce.

## Hustota karty

- **Inplace** karta: všechny sekce default skryté, bez řádku „Otevřeno z:“.
- Prázdný **popis** (column) default skrytý.
- **Základní informace** default viditelné, lze skrýt (chip).
- **Properties** a **Další vazby** default skryté.
- Prázdné sloty default skryté.
- Skrývání: ikona oka + tooltip; tray chipů se **počtem položek**.
- Chipy s **0 položkami** jsou default schované za **…** na konci seznamu chipů (kliknutím se rozbalí).
- Ikona oka na konci tray: skrýt/zobrazit vše.
- Karta se vždy načítá s expert daty; viditelnost řídí UI skrytí.

## Deeplink a bookmarky

Schema **`v: 2`** (aktuální). Starší odkazy/`localStorage` s `v: 1` se při načtení migrují.

| Akce | Kde | Výsledek |
|------|-----|----------|
| Kopírovat odkaz záložky | tabbar ↗ | `/cards/:focusId?ws=gz1.<base64url gzip JSON>` |
| Kopírovat odkaz sestavy | tabbar ↗ | `/cards?shell=gz1.<base64url gzip JSON>` |
| Uložit záložku / sestavu | tabbar ↗ | `localStorage` klíč `itmap.cards.bookmarks` (+ `schemaVersion`) |
| Obnovit | Hub → **Uložené** (modal) | otevře tab nebo celý shell |

Snapshot záložky obsahuje: root, title, focus, columns (+ openedFrom), šířky sloupců, sbalené úrovně a **`cardUi`** (skryté sekce, otevřené inplace, empty chips) pro každý `panelKey` včetně vnořeného inplace.

Transient UI (editace popisu, systémové menu) se **neserializuje**.

URL payload: JSON → **gzip** (`CompressionStream`) → base64url, prefix `gz1.`.  
Starší nekomprimované base64url odkazy se stále dekódují. Bookmarks v `localStorage` zůstávají nekomprimované JSON.

Modul: `src/domain/cards/workspaceShare.ts`.

## Oddělení od Browseru

Karty nesdílí TraversalEngine, FlowColumns ani `archimate-ui-traversal` šablony.
