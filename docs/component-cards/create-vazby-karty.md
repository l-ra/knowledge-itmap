# Přidávání vazeb z karet (create-slice)

**Stav:** implementace  
**Datum rozhodnutí:** 2026-09-11  
**Navazuje na:** [rozhodnuti-v1.md](./rozhodnuti-v1.md), [implementacni-plan-karty-v1.md](./implementacni-plan-karty-v1.md), [koncept-karet-komponent.md](./koncept-karet-komponent.md)

---

## Cíl

Na kartě elementu umožnit přidat vazbu:

1. **Ze RelationSlot** — typ a směr pevně z prezentačního profilu (bez výběru ArchiMate typu).
2. **Z expertní sekce** — výběr typu z plné matice `AllowedRelationship` (subject jako source nebo target).

Obě cesty podporují **napojení existující entity** i **vytvoření nového souseda**.

---

## Uzavřená rozhodnutí

| Téma | Rozhodnutí |
|------|------------|
| Slot create | Link + create souseda ve stejném slice |
| Expert | Plná AllowedRelationship matice + seskupení outgoing/incoming + search |
| Validace | Slot ≠ matice; zápis vždy `assertAllowed` |
| UI | Cards-own dialog; ne reuse Browse `AddDialog` / `AddActionDef` |
| Write | `ModelService` (`linkElement` / `createTypedElement`) |
| Duplikát | Blokovat stejný typ + pár entit |
| Edit props vztahu | Mimo slice (jen `relationshipDefaults` / UI fallback při create) |
| Hub create | Mimo slice |
| Mining profilů | Ne |

---

## UX

### Ze slotu

- CTA **+ přidat** v hlavičce viditelné slot sekce.
- Dialog: Napojit existující (default) / Vytvořit novou.
- Filtr kandidátů: `targetClasses` (+ soft `targetProfileCodes` pokud řešitelné).
- Vyloučit entity už napojené ve slotu.
- `relationshipDefaults` ze slotu → props vztahu; jinak UI fallback pro `associationKind` / `flowLabel`.

### Expert

- Sekce „Další možné vazby“ je skrytá defaultně, ale vždy v tray (i při 0 existujících expert hranách).
- CTA **+ přidat vazbu** → výběr řádku matice → link/create cíle.

Po úspěchu: reload `CardViewModel`; pinboard se nemění, dokud uživatel souseda neotevře.

---

## Technický přehled

```text
Slot / Expert CTA
    → SlotAddDialog
    → slotWrite (resolve endpoints, listAllowedForSubject)
    → ModelService.linkElement | createTypedElement
    → assertAllowed
    → reload card
```

Klíčové soubory:

- `packages/archimate-core/src/cards/slotWrite.ts`
- `src/components/SlotAddDialog.tsx`
- `src/pages/CardsPage.tsx`
- `archimate-ui-cards`: volitelné `relationshipDefaults` na RelationSlot

---

## Akceptace

1. Slot Role na Oddělení: napojit existující BusinessRole → Assignment.
2. Stejný slot: vytvořit novou roli + Assignment.
3. Slot Nadřízený: `associationKind=reportsTo` z defaults nebo UI fallback.
4. Expert: přidat Serving, který na entitě ještě nebyl.
5. Nepovolená kombinace → chyba, žádný zápis.
6. Duplikát → chyba.
7. Žádný import `AddActionDef` / `traversal.ts` v cards write path.

---

## Non-goals

- Hub „přidat prvek“ bez vazby
- ModelingConvention / multi-hop
- Edit detailu vztahu
- Mining PresentationProfile
- Import traversal UI
