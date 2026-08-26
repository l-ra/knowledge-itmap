# archimate-lite 2.1.0 — přesný výčet rozšíření

**Účel:** Checklist pro implementaci v repozitáři `knowledge-core` **před** startem aplikace IT Map.  
**Základ:** `archimate-lite-2.0.0` · **Cíl:** `archimate-lite-2.1.0` (additive, bez breaking changes)  
**Související:** [`funkcni-specifikace.md`](funkcni-specifikace.md) §5

Legenda stavu:
- **NOVÉ** — v 2.0.0 neexistuje, nutno přidat
- **ROZŠÍŘIT** — existuje, nutno doplnit constraints / enum / matici / shape
- **EXISTUJE** — v 2.0.0 již k dispozici, IT Map využije beze změny

---

## 1. Nové třídy (`classes[]`)

| # | `iriLocal` | `parent` | `archiLayer` | Stav | Poznámka |
|---|------------|----------|--------------|------|----------|
| C1 | `BusinessFunction` | `ArchiMateElement` | `business` | **NOVÉ** | Standardní ArchiMate prvek; chybí v 2.0.0 |

---

## 2. Nové properties — prvky (element attributes)

| # | `iriLocal` | datatype | `domain` | Stav | Popis |
|---|------------|----------|----------|------|-------|
| P1 | `actorKind` | String | `BusinessActor` | **NOVÉ** | `department` \| `person` \| `external` |
| P2 | `ownership` | String | `ApplicationComponent`, `TechnologyService`, `CommunicationNetwork` | **NOVÉ** | `internal` \| `external` \| `shared` |
| P3 | `networkKind` | String | `CommunicationNetwork` | **NOVÉ** | Typ síťového segmentu — viz enum §4.3 |
| P4 | `networkRole` | String | `CommunicationNetwork` | **NOVÉ** | `production` \| `management` \| `backup` \| `dmz` \| `wan` \| `other` |

### Existující properties pro network prvky (bez změny definice, využití v IT Map)

| `iriLocal` | `domain` (2.0.0) | Stav |
|------------|------------------|------|
| `vlanId` | `CommunicationNetwork` | **EXISTUJE** |
| `cidr` | `CommunicationNetwork` | **EXISTUJE** |
| `routingDomain` | `CommunicationNetwork` | **EXISTUJE** |
| `zone` | `ArchiMateConcept` | **EXISTUJE** — doplnit usage pro CommunicationNetwork |
| `site` | `ArchiMateConcept` | **EXISTUJE** |
| `environment` | `ArchiMateElement` | **EXISTUJE** |
| `fqdn`, `vip`, `ipAddress` | `TechnologyInterface` | **EXISTUJE** |

---

## 3. Nové properties — vztahy (relationship attributes)

Vztah = first-class entita (`instanceOf` → třída vztahu). Properties s doménou na vztahu:

| # | `iriLocal` | datatype | `domain` | Stav | Popis |
|---|------------|----------|----------|------|-------|
| R1 | `associationKind` | String | `Association` | **NOVÉ** | Sémantika association — viz enum §4.2 |
| R2 | `flowLabel` | String | `Flow` | **NOVÉ** | Povinný business popis „co teče“ (metodika) |
| R3 | `flowKind` | String | `Flow` | **NOVÉ** | Druh toku — viz enum §4.4 |
| R4 | `relationshipNote` | String | `ArchiMateRelationship` | **NOVÉ** | Volitelná poznámka; povinná při `associationKind=other` |

### Existující properties pro Flow (bez změny definice, IT Map v Basic/Extended využije)

| `iriLocal` | `domain` (2.0.0) | Stav | IT Map usage |
|------------|------------------|------|--------------|
| `messageOrObject` | `ArchiMateConcept` | **EXISTUJE** | **ROZŠÍŘIT** — doplnit `domain` i na `Flow` (viz §5) |
| `protocol` | `ArchiMateConcept` | **EXISTUJE** | Doporučené u Flow L2+ |
| `port` | `ArchiMateConcept` | **EXISTUJE** | Doporučené u Flow L2+ |
| `synchronous` | `ArchiMateConcept` | **EXISTUJE** | Volitelné u Flow |
| `authentication` | `ArchiMateConcept` | **EXISTUJE** | Volitelné u Flow |
| `sourceZone` | `Flow` | **EXISTUJE** | Síťový kontext toku |
| `targetZone` | `Flow` | **EXISTUJE** | Síťový kontext toku |
| `direction` | `Flow` | **EXISTUJE** | `inbound` \| `outbound` \| `bidirectional` (enum §4.5) |
| `firewallPolicyReference` | `Flow` | **EXISTUJE** | Reference na FW policy |
| `dependencyType` | `ArchiMateRelationship` | **EXISTUJE** | **ROZŠÍŘIT** enum — viz §4.6 |
| `dependencyStrength` | `ArchiMateRelationship` | **EXISTUJE** | mandatory \| optional |
| `degradedMode` | `ArchiMateRelationship` | **EXISTUJE** | |
| `businessImpact` | `ArchiMateRelationship` | **EXISTUJE** | |
| `accessMode` | `Access` | **EXISTUJE** | read \| write \| readWrite |

---

## 4. Nové enum instance (`StringEnum` v kc-base mechanismus)

| # | Entity `iriLocal` | Property | Hodnoty | Stav |
|---|-------------------|----------|---------|------|
| E1 | `enum/actorKind` | `actorKind` | `department`, `person`, `external` | **NOVÉ** |
| E2 | `enum/ownership` | `ownership` | `internal`, `external`, `shared` | **NOVÉ** |
| E3 | `enum/associationKind` | `associationKind` | viz tabulka níže | **NOVÉ** |
| E4 | `enum/networkKind` | `networkKind` | viz tabulka níže | **NOVÉ** |
| E5 | `enum/networkRole` | `networkRole` | `production`, `management`, `backup`, `dmz`, `wan`, `other` | **NOVÉ** |
| E6 | `enum/flowKind` | `flowKind` | viz tabulka níže | **NOVÉ** |
| E7 | `enum/flowDirection` | `direction` | `inbound`, `outbound`, `bidirectional` | **NOVÉ** (formalizace existující usage) |
| E8 | `enum/dependencyType` | `dependencyType` | viz tabulka níže | **ROZŠÍŘIT** (2.0.0 má jen usage text) |

### E3 — `associationKind`

| Hodnota | Význam | Typický source → target |
|---------|--------|-------------------------|
| `reportsTo` | Reportní linie | BusinessActor(person) → BusinessActor(person) |
| `deputizesFor` | Zastupování | BusinessActor(person) → BusinessActor(person) |
| `locatedIn` | Umístění v areálu | Node → Facility |
| `connectedTo` | Připojení k síti | Node → CommunicationNetwork |
| `memberOf` | Uzel patří do síťového segmentu | Node → CommunicationNetwork |
| `routesThrough` | Tok/směrování přes path | Flow/Path kontext |
| `spans` | Path/spojení mezi sítěmi | Path → CommunicationNetwork |
| `uses` | Obecné použití | různé |
| `other` | Výjimka | vyžaduje `relationshipNote` |

### E4 — `networkKind`

| Hodnota | Význam |
|---------|--------|
| `vlan` | VLAN segment |
| `subnet` | IP subnet |
| `wan` | WAN link |
| `dmz` | DMZ |
| `overlay` | Overlay síť (VXLAN, …) |
| `management` | Management síť |
| `storage` | Storage síť |
| `other` | Ostatní |

### E6 — `flowKind`

| Hodnota | Význam | Příklad |
|---------|--------|---------|
| `data` | Datový tok | API payload, DB query |
| `event` | Událost / message | Kafka OrderCreated |
| `control` | Řídicí signál | health check, orchestration |
| `physical` | Fyzický tok | materiál, médium |

### E8 — `dependencyType` (formalizace)

| Hodnota | Význam |
|---------|--------|
| `runtime` | Runtime závislost |
| `data` | Datová závislost |
| `identity` | Identita / auth |
| `network` | Síťová závislost |
| `build-time` | Build/deploy |
| `organizational` | Org./procesní (Assignment kontext) |

---

## 5. Úpravy existujících properties

| Property | Změna | Důvod |
|----------|-------|-------|
| `messageOrObject` | **ROZŠÍŘIT** `domain`: přidat explicitně `Flow` (místo jen `ArchiMateConcept`) | Jasná vazba na Flow; `flowLabel` = business popis, `messageOrObject` = technický název payloadu |
| `zone` | **ROZŠÍŘIT** usageGuidance — doporučení pro `CommunicationNetwork` a `Node` | Konzistence network modelu |
| `accessMode` | **EXISTUJE** — ověřit enum instance `enum/accessMode` | read, write, readWrite |

---

## 6. Nové shapes

| # | `code` | `class` | `requiredProperties` | `severity` | Stav |
|---|--------|---------|---------------------|------------|------|
| S1 | `aml-business-function` | `BusinessFunction` | — (warning: chybí `modelingDepth`) | warning | **NOVÉ** |
| S2 | `aml-business-actor` | `BusinessActor` | `actorKind` | error | **NOVÉ** |
| S3 | `aml-association` | `Association` | — (warning: chybí `associationKind`) | warning | **NOVÉ** |
| S4 | `aml-flow` | `Flow` | `flowLabel` | error | **NOVÉ** |
| S5 | `aml-communication-network` | `CommunicationNetwork` | `networkKind` | warning | **NOVÉ** |
| S6 | `aml-flow-network-detail` | `Flow` | `flowLabel`, `protocol` | warning | **NOVÉ** | Pouze when `modelingDepth` ≥ infrastructure/network |

### Úpravy existujících shapes

| Shape | Změna | Stav |
|-------|-------|------|
| `aml-element` | Podmíněná pravidla: pokud `BusinessActor` → vyžadovat `actorKind` (nebo delegovat na S2) | **ROZŠÍŘIT** |
| `aml-relationship` | Beze změny (`relSource`, `relTarget`) | **EXISTUJE** |

---

## 7. Rozšíření AllowedRelationship matice

Zachovat **všechny** záznamy z 2.0.0. Přidat:

### 7.1 Business / organizace

| type | source | target | Stav |
|------|--------|--------|------|
| Composition | BusinessActor | BusinessActor | **NOVÉ** |
| Assignment | BusinessActor | BusinessFunction | **NOVÉ** |
| Assignment | BusinessRole | BusinessFunction | **NOVÉ** |
| Assignment | BusinessRole | BusinessProcess | **NOVÉ** |
| Composition | BusinessFunction | BusinessProcess | **NOVÉ** |
| Realization | BusinessFunction | BusinessService | **NOVÉ** |
| Realization | BusinessProcess | BusinessService | **NOVÉ** |
| Serving | ApplicationService | BusinessFunction | **NOVÉ** |
| Triggering | BusinessProcess | BusinessProcess | **NOVÉ** |
| Association | BusinessActor | BusinessActor | **NOVÉ** |

### 7.2 Aplikační hloubka

| type | source | target | Stav |
|------|--------|--------|------|
| Serving | ApplicationService | ApplicationFunction | **NOVÉ** |
| Realization | ApplicationComponent | ApplicationFunction | **NOVÉ** |
| Composition | ApplicationCollaboration | ApplicationComponent | **NOVÉ** |
| Flow | ApplicationComponent | DataObject | **NOVÉ** |
| Flow | ApplicationFunction | ApplicationFunction | **NOVÉ** |
| Triggering | ApplicationProcess | ApplicationProcess | **NOVÉ** |

### 7.3 Flow — business ↔ application (metodická pravidla)

| type | source | target | Stav | Poznámka |
|------|--------|--------|------|----------|
| Flow | ApplicationComponent | ApplicationComponent | **EXISTUJE** | Zachovat |
| Flow | ApplicationComponent | TechnologyService | **NOVÉ** | Datový tok na platformní službu |
| Flow | TechnologyService | ApplicationComponent | **NOVÉ** | Reverse datový tok |
| Flow | Node | Node | **NOVÉ** | Síťový provoz mezi uzly (via Path nebo přímo) |
| — | BusinessProcess | ApplicationComponent | **ZAKÁZÁNO** | Metodika: použít Serving, ne Flow |
| — | BusinessProcess | ApplicationService | **ZAKÁZÁNO** | Metodika: použít Serving |

*(Zákazy implementuje IT Map ValidationService; v AllowedRelationship se neuvádějí — matice je allow-list.)*

### 7.4 Network / infrastruktura

| type | source | target | Stav |
|------|--------|--------|------|
| Composition | CommunicationNetwork | CommunicationNetwork | **NOVÉ** | Nested segments |
| Composition | Node | Node | **NOVÉ** | Cluster → worker |
| Assignment | Device | Node | **NOVÉ** | |
| Association | Device | Facility | **NOVÉ** | |
| Association | Node | CommunicationNetwork | **EXISTUJE** | |
| Serving | Device | CommunicationNetwork | **EXISTUJE** | |
| Serving | TechnologyService | ApplicationService | **NOVÉ** | |
| Realization | Node | TechnologyService | **NOVÉ** | Node hostí tech službu |
| Association | Path | CommunicationNetwork | **NOVÉ** | Path spojuje sítě |
| Association | Path | Node | **NOVÉ** | Path prochází uzlem |
| Flow | CommunicationNetwork | CommunicationNetwork | **NOVÉ** | WAN peering, inter-VLAN (s flowLabel) |
| Flow | Path | Path | **NOVÉ** | Logická cesta |

### 7.5 Existující záznamy 2.0.0 (referenční — neměnit)

Již present: Assignment BusinessActor→BusinessRole, BusinessRole→BusinessService, Realization AppComponent→BusinessService/AppService, Serving AppService→BusinessProcess, Serving TechnologyService→AppComponent, Access, Flow App→App, DeployedOn, Assignment SystemSoftware→Node, Association Node→Facility, Facility→Location, Assignment Artifact→Node, atd.

---

## 8. Usage anotace (doplnit `usageGuidance` + `usageExamples`)

| Objekt | Stav | Minimální obsah |
|--------|------|-----------------|
| `BusinessFunction` | **NOVÉ** | Rozdíl Function vs Process; příklady odpovědností |
| `actorKind` | **NOVÉ** | Kdy department/person/external |
| `ownership` | **NOVÉ** | EU registry = external |
| `associationKind` | **NOVÉ** | reportsTo vs Composition |
| `flowLabel` | **NOVÉ** | „Co teče“ — ne zaměňovat s `messageOrObject` |
| `flowKind` | **NOVÉ** | data vs event |
| `networkKind` | **NOVÉ** | vlan vs wan vs dmz |
| `networkRole` | **NOVÉ** | production vs management |
| `Path` | **ROZŠÍŘIT** | Kdy použít Path místo Flow nebo Association |
| `Flow` (třída) | **ROZŠÍŘIT** | Metodické pravidlo: Flow ≠ „uses“; vždy flowLabel |
| `CommunicationNetwork` | **ROZŠÍŘIT** | Povinnost networkKind pro L3+ |

---

## 9. Dokumentace a artefakty (knowledge-core)

| # | Artefakt | Stav |
|---|----------|------|
| D1 | `models/archimate-lite/catalog.json` | aktualizovat dle §1–8 |
| D2 | `models/archimate-lite/load.py` | idempotentní load nových objektů |
| D3 | `models/archimate-lite/build_bundle.py` | generovat `archimate-lite-2.1.0.bundle.json` |
| D4 | `docs/models/archimate-lite.md` | doplnit BusinessFunction, network/flow pravidla |
| D5 | `docs/models/archimate-lite-kc.md` | nové shapes, enumy, matice |
| D6 | Seed / test instance | Compliance + network demo (§10) |

---

## 10. Akceptační test — demo instance

Model musí jít zapsat **výhradně** proti archimate-lite 2.1.0:

```text
# Business (jako dříve)
Odbor Compliance [BusinessActor, actorKind=department]
  → Petr Novák [actorKind=person] → DPO [BusinessRole]
  → Data Protection [BusinessFunction]

Petr Novák ── Association(associationKind=reportsTo) ──▶ Jiri Kreuzman

# Application + Flow
CRM Backend ── Flow(flowLabel="Customer orders", flowKind=data, protocol=HTTPS) ──▶ Payment Gateway
CRM Backend ── Access(accessMode=readWrite) ──▶ CustomerData [DataObject]

# Network
APP_NET [CommunicationNetwork, networkKind=vlan, cidr=10.1.0.0/16, networkRole=production]
prod-cluster [Node] ── Association(associationKind=memberOf) ──▶ APP_NET
DC-WAN [CommunicationNetwork, networkKind=wan, networkRole=wan]
  ── Flow(flowLabel="Inter-DC replication", flowKind=data, protocol=TCP, port=5432) ──▶ APP_NET
wan-path [Path] ── Association(associationKind=spans) ──▶ DC-WAN
```

---

## 11. Souhrnný počet změn

| Kategorie | Nové | Rozšířit | Beze změny (využít) |
|-----------|------|----------|---------------------|
| Třídy | 1 | 0 | ~40 existujících |
| Properties (element) | 4 | 1 | ~15 network-related |
| Properties (relationship) | 4 | 1 | ~12 flow/network |
| Enum instance | 8 | 0 | accessMode, modelingDepth, … |
| Shapes | 6 | 1 | aml-element, aml-relationship |
| AllowedRelationship | ~28 řádků | 0 | ~20 existujících |
| Usage anotace | 8 | 3 | — |

**Celkem:** ~51 additive položek v catalog.json (+ odpovídající statementy v bundle).

---

## 12. Mimo rozsah 2.1.0 (k diskusi)

| Položka | Důvod odložení |
|---------|----------------|
| UI traversal konfigurace | Viz [`navrh-ui-konfiguracni-vrstvy.md`](navrh-ui-konfiguracni-vrstvy.md) — samostatné rozhodnutí |
| `BusinessCollaboration`, `BusinessInteraction` | Metodika IT Map nevyžaduje |
| L5 detail (jednotlivé porty switchů, firewall rules) | Mimo granularitu archimate-lite |
