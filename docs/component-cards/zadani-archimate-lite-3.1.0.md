# Zadání: archimate-lite 3.1.0 — taxonomie BusinessActor

**Stav:** splněno v `knowledge-models` (bundle 3.1.0 + demo + UI traversal seed)  
**Cílová verze:** `archimate-lite` **3.1.0**  
**Repo:** `knowledge-models`  
**Objednatel:** knowledge-itmap / režim Karty komponent  
**Navazuje na:** `docs/component-cards/rozhodnuti-v1.md`  
**Další krok:** [implementacni-plan-karty-v1.md](./implementacni-plan-karty-v1.md)

---

## 1. Proč

Enum `actorKind` dnes míchá dvě osy klasifikace:

| Stará hodnota | Co popisuje |
|---------------|-------------|
| `department` | povaha (organizační jednotka) |
| `person` | povaha (osoba) |
| `external` | vztah k organizaci (scope), ne povahu |

Karty potřebují čisté matchování PresentationProfile (`class` + property values). Proto oddělíme:

1. **povahu** actoru (`actorKind`)
2. **vztah k vlastní organizaci** (`organizationScope`)

Property `ownership` (`internal` / `external` / `shared`) **neměnit a nepřetěžovat** — zůstává pro provoz/vlastnictví prvků (aplikace, služby, sítě), ne pro klasifikaci BusinessActor.

---

## 2. Požadované změny metamodelu

### 2.1 `actorKind` — nové povolené hodnoty

**Bylo:** `department` | `person` | `external`  
**Má být:** `person` | `organizationalUnit` | `organization`

| Hodnota | Význam | CS label (enum) |
|---------|--------|-----------------|
| `person` | jmenovaná osoba | Osoba |
| `organizationalUnit` | organizační jednotka (útvar, tým, odbor) | Organizační jednotka |
| `organization` | organizace jako celek (firma, instituce, partner) | Organizace |

Aktualizovat u property `actorKind`:

- `labels` / `descriptions` (en + cs)
- `usageGuidance` / `usageExamples`
- enum `enums.actorKind` v `catalog.json`
- generované `enum/actorKind` + `allowedValue` v bundle

**Odebrat** hodnoty `department` a `external` z enumu (breaking pro instance — viz migrace).

`actorKind` zůstává **povinný** na `BusinessActor` (shape `aml-business-actor`, severity `error`).

### 2.2 Nová property `organizationScope`

| Pole | Hodnota |
|------|---------|
| `iriLocal` | `organizationScope` |
| `datatype` | `String` |
| `domain` | `["BusinessActor"]` |
| `minCount` | `1` |
| `maxCount` | `1` |
| `severity` | `error` |
| Enum | `internal` \| `external` |

| Hodnota | Význam | CS label |
|---------|--------|----------|
| `internal` | actor patří do modelované organizace | Interní |
| `external` | actor je mimo modelovanou organizaci | Externí |

Doporučené texty:

- **en label:** Organization scope  
- **cs description:** Určuje, zda je BusinessActor interní vůči modelované organizaci, nebo externí.  
- **usageGuidance:** Orthogonal to actorKind. A person may be internal or external; an organization is often external (vendor, regulator) but may be internal (legal entity inside the group). Do not use ownership for this — ownership is for who operates ApplicationComponent / TechnologyService / CommunicationNetwork.

Přidat shape required: do `aml-business-actor` doplnit `organizationScope` vedle `actorKind`.

### 2.3 Mapování PresentationProfile (kontrakt pro Karty)

Po 3.1.0 budou Karty matchovat:

| Profil | `actorKind` | `organizationScope` |
|--------|-------------|---------------------|
| Oddělení | `organizationalUnit` | `internal` |
| Osoba | `person` | `internal` |
| Externí organizace | `organization` | `external` |
| (volitelně později) Externí osoba | `person` | `external` |

### 2.4 Co neměnit

- Matice `AllowedRelationship`
- Ostatní enumy (`ownership`, `associationKind`, …)
- Význam Composition / Assignment u actorů
- Package `archimate-ui-traversal` schema classes (jen **seed data** a popisy, viz §4)

---

## 3. Migrace hodnot

### 3.1 Pravidla pro instance

| Staré `actorKind` | Nové `actorKind` | Nové `organizationScope` | Poznámka |
|-------------------|------------------|--------------------------|----------|
| `department` | `organizationalUnit` | `internal` | default; pokud je známý externí útvar, scope=`external` ručně |
| `person` | `person` | `internal` | default; konzultanti → `external` ručně |
| `external` | `organization` | `external` | typický význam starého „external“ = externí subjekt/org |

Pokud existuje instance se starým `external`, která je ve skutečnosti osoba, po migraci ručně: `actorKind=person`, `organizationScope=external`.

### 3.2 Artefakty k aktualizaci v `knowledge-models`

| Artefakt | Úprava |
|----------|--------|
| `archimate-lite/catalog.json` | version `3.1.0`, property, enum, shape, texty |
| `archimate-lite/releases/archimate-lite-3.1.0.bundle.json` | `build_bundle.py` |
| `archimate-lite/README.md` | aktuální bundle 3.1.0 |
| `docs/archimate-lite.md` | tabulka actorKind + organizationScope |
| `docs/archimate-lite-kc.md` | kontrakt, shape, enum listing |
| `archimate-lite-demo/catalog.json` | properties dle §3.1; dependency `releaseVersion` / range `^3.1.0` |
| Demo popis | zmínit 3.1.0 |

Demo dnes:

- `compliance-dept`: `department` → `organizationalUnit` + `organizationScope=internal`
- `petr-novak`, `jiri-kreuzman`: `person` → + `organizationScope=internal`

### 3.3 Kompatibilita importu

- 3.1.0 je **compat_breaking** vůči 3.0.0 kvůli změně enum hodnot a nové povinné property (stejný pattern jako jiné breaking bumpě).
- Dokumentovat: čerstvý import `kc-base` → `archimate-lite` 3.1.0 → `archimate-ui-traversal` (upravený seed) → demo.
- Existující org package: vyžaduje ChangeSet migraci statements `actorKind` + doplnění `organizationScope` (skript nebo ruční postup v release notes).

---

## 4. Související úpravy `archimate-ui-traversal` (povinný follow-up)

Seed a texty stále odkazují `department` / `person,external`. Bez úpravy se rozbije business-exploration template.

Minimálně v `generate_ui_profile_seed.py` + regenerace `ui-profile-seed.json` (+ případně bump package pokud publikuujete nový release):

| Místo | Bylo | Má být |
|-------|------|--------|
| Stage organization `actorKinds` | `department` | `organizationalUnit` |
| Stage people-roles `actorKinds` | `person,external` | `person` |
| Add-action department defaults | `actorKind: department` | `actorKind: organizationalUnit` + `organizationScope: internal` |
| Add-action person defaults | `actorKind: person` | + `organizationScope: internal` |
| Catalog usageExamples u `actorKinds` / `instanceFilter` | staré hodnoty | nové |

Volitelně později: stage nebo filtr pro `organization` + `organizationScope=external` (externí organizace). Pro 3.1.0 stačí nezlomit stávající dva sloupce.

Pokud UI traversal zůstane na 1.0.0 s upraveným seedem bez bump verze, explicitně to uveďte v release notes AML 3.1.0 (seed musí být nasazen současně).

---

## 5. Checklist spotřebitelů (knowledge-itmap) — po releasu 3.1.0

Tyto body **nejsou** součástí tohoto zadání na `knowledge-models`, ale musí proběhnout hned po něm (může IT Map agent / vývojář):

- [ ] `scripts/seed-demo.sh` → bundle `archimate-lite-3.1.0`
- [ ] `scripts/check-kc.sh` / README odkazy na verzi
- [ ] `src/domain/templates.ts` — `actorKinds` union + FALLBACK defaults
- [ ] `src/domain/traversal.ts` — `domainLabelFor` (organizationalUnit / organization + scope)
- [ ] `Inspector` / property edit — `organizationScope` u BusinessActor
- [ ] Dokumenty: `koncept-prochazeni-grafem.md`, funkční specifikace (zmínky department/external)

---

## 6. Akceptační kritéria

1. Package `archimate-lite` **3.1.0** se úspěšně buildí (`build_bundle.py`) a importuje do KC po `kc-base`.
2. Enum `actorKind` obsahuje právě `person`, `organizationalUnit`, `organization`.
3. Existuje property + enum `organizationScope` (`internal` \| `external`), domain `BusinessActor`, required ve shape `aml-business-actor`.
4. Demo instance mají obě properties dle mapování §3.1 a import projde bez shape error na actorech.
5. UI traversal seed nefiltruje na `department` / `external` jako actorKind.
6. Dokumentace v `knowledge-models/docs/` popisuje obě osy a rozdíl oproti `ownership`.
7. Release notes 3.1.0 obsahují breaking migraci §3.1.

---

## 7. Mimo rozsah

- PresentationProfile / RelationSlot / package `archimate-ui-cards` (samostatná práce v IT Map po tomto releasu)
- Změny matice vztahů
- Mining profilů, QualityRules
- Přejmenování `ownership`

---

## 8. Dodání

Očekávaný výstup:

1. PR / commit v `knowledge-models` s 3.1.0 bundle  
2. Aktualizovaný demo catalog  
3. Upravený UI traversal seed (nebo nový minor release)  
4. Krátké release notes s migrační tabulkou  

Po merge dejte vědět — IT Map naváže úpravou seed skriptů a implementací Karet proti 3.1.0.
