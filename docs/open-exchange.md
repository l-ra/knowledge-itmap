# ArchiMate Open Exchange — import / export

IT Map umí načíst a zapsat **ArchiMate Model Exchange File Format** (Open Exchange XML 3.x) do aktivního **org package** v Knowledge Core.

UI: **Packages → ArchiMate Open Exchange**.

Vyžaduje nahraný metamodel **`archimate-lite` ≥ 3.2.1** (třídy `ExchangeForeign*`, properties `inView`, `exchangeXsiType`, `exchangeOpaque*`, `exchangeManaged`).

## Identita

| Open Exchange | Knowledge Core |
|---------------|----------------|
| `identifier` (např. `id-76f6…`) | `iriLocal` entity |
| — | public IRI = `package.iriBase` + `iriLocal` |
| — | alias `https://archimate.openexchange/id/{identifier}` (`kind=imported`) |

Při exportu se do XML znovu zapíše `iriLocal` jako `identifier`. Entity vytvořené v KC (slug `iriLocal`) se exportují stejně — stačí `instanceOf` ArchiMate třídy.

## Import

1. Zvolte aktivní org package.
2. **Import XML** — vyberte `.xml` (např. export z Archi).
3. Průběh běží v jednom ChangeSetu (`openExchangeImport`).
4. Po dokončení se zobrazí počty created/updated a případná **revize orphanů**.

### Mapování

- Známý `xsi:type` → odpovídající třída `archimate-lite`
- Neznámý typ (např. `AndJunction`) → `ExchangeForeignElement` / `ExchangeForeignRelationship` + `exchangeXsiType`
- Známé `<property key>` → Lite property statement
- Neznámé properties / XML atributy → `exchangeOpaqueProperties` (JSON) — **nezahazují se**
- Views → `DiagramView` + `ViewNode` / `ViewConnection` s `inView`, bounds, style, bendpoints

Zápis používá `X-Validation-Mode: relaxed` (OTE často nemá povinné Lite atributy jako `actorKind` / `flowLabel`).

### Orphan review (reimport)

Pokud v KC zůstanou **exchange-managed** entity, které v novém XML chybí, UI nabídne tabulku:

- **Ponechat** (výchozí)
- **Deprecovat**
- **Smazat**

Nic se nemaže automaticky. Entity vzniklé jen v KC (bez import aliasu) v review nejsou.

## Export

**Export XML** stáhne `{orgPackage}.xml` = aktuální ArchiMate obsah balíku:

- všechny aktivní instance `ArchiMateElement` / `ArchiMateRelationship` / view konceptů (včetně foreign a entit vytvořených v IT Map)
- `<organizations>` se dopočítají podle `archiLayer` (+ Relations, Views)
- opaque payload se emituje beze změny

## Programové API

```ts
import {
  importOpenExchange,
  exportOpenExchange,
  applyOpenExchangeOrphanActions,
} from "@/domain/openExchange";

await importOpenExchange({ xml, packageCode: "org-ote" });
const { xml: out } = await exportOpenExchange({ packageCode: "org-ote" });
```

Modul: [`src/domain/openExchange/`](../src/domain/openExchange/).

## Kontrakt metamodelu

Podrobnosti v package `archimate-lite` (entity `exchange-spec`) a v dokumentaci knowledge-models `docs/archimate-lite-kc.md` (sekce Open Exchange).

## Omezení v1

- Jeden org package na soubor (organizations ≠ multi-package split)
- Lite matice se při importu nevynucuje (jen warningy)
- UI needituje opaque bag (Extended inspector / statementy)
- Junctions nejsou nativní Lite třídy — jen foreign passthrough
