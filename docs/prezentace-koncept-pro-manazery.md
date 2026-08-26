---
marp: true
theme: default
paginate: true
size: 16:9
title: Modelování IT organizace — koncept pro manažery
description: Přehled přístupu k modelování organizace (podmnožina ArchiMate, plná vertikála business→infra, Knowledge Core, výhled s agenty)
style: |
  section {
    font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    color: #1a2332;
  }
  h1, h2 {
    color: #0f3d5c;
  }
  section.lead h1 {
    font-size: 2.1em;
  }
  section.lead p {
    font-size: 1.15em;
    color: #3a4a5c;
  }
  table {
    font-size: 0.82em;
  }
  blockquote {
    border-left: 4px solid #0f3d5c;
    color: #2c3e50;
    font-size: 1.05em;
  }
  strong {
    color: #0f3d5c;
  }
  footer {
    color: #6b7c8d;
    font-size: 0.7em;
  }
  section.section-title {
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  section.section-title h1 {
    font-size: 2.4em;
  }
  .muted {
    color: #5a6a7a;
    font-size: 0.9em;
  }
  code {
    font-size: 0.88em;
  }
---

<!-- _class: lead -->
<!-- _footer: "" -->

# Modelování IT organizace

**Přehled přístupu pro vedení**

Od lidí a odpovědností přes aplikace až k infrastruktuře —  
jeden model, více pohledů, řízená změna.

<p class="muted">Podmnožina ArchiMate · model jako data · IT Map · Knowledge Core · výhled s agenty</p>

---

# Obsah

1. **Koncept modelu** — podmnožina ArchiMate, data místo diagramů  
2. **Stavební kameny** — business → aplikace → infrastruktura  
3. **Aplikace a Knowledge Core** — jak s modelem pracujeme dnes  
4. **Výhled** — model jako zdroj pravdy, agenti, verzování a provenance

---

<!-- _class: section-title -->

# 1. Koncept modelu

Podmnožina ArchiMate · data místo diagramů · celá vertikála

---

# Co chceme vědět o organizaci

Stejné otázky — od byznysu až k technice:

1. **Kdo** je v útvaru (lidé, role)?
2. **Za co** odpovídá (oblasti práce, procesy)?
3. **Jakou hodnotu** poskytuje (business služby)?
4. **Čím** je to podporováno (aplikace, data)?
5. **Kde to běží** (platforma, clustery, sítě, lokace)?

> Cíl není kreslit „krásné diagramy“.  
> Cíl je mít **sdílenou mapu napříč celou vertikálou**, kterou lze procházet a dotazovat.

---

# Proč řízená podmnožina ArchiMate

ArchiMate je široký standard. My bereme **jen to, co potřebujeme** — ale **v plné hloubce** od organizace po infrastrukturu.

| Bez metodiky | S řízenou podmnožinou |
| ------------ | --------------------- |
| Každý odbor modeluje jinak | Stejná gramatika napříč organizací |
| Desítky typů a vztahů | Malý, srozumitelný slovník |
| Diagram = pravda | Data = pravda, pohledy = výstup |
| Obtížné dopadové analýzy | Dotazy napříč vrstvami |

> Nezjednodušujeme tím, že se zastavíme u aplikací.  
> Zjednodušujeme **slovník** — vertikála zůstává kompletní.

---

# Model = data, ne sada diagramů

| Diagram jako zdroj pravdy | Model jako knowledge graph |
| ------------------------- | -------------------------- |
| Každý odbor kreslí „svůj“ obrázek | Jedna společná databáze faktů |
| Stejná informace na více místech | Jedna entita, více pohledů |
| Aktualizace = překreslení | Aktualizace = změna vztahu / vlastnosti |
| Dopad změny se hledá „očima“ | Dopad se **prochází grafem** (role → app → cluster) |

**Diagram (pohled) je výstup z dat** — ne místo, kde se pravda „žije“.

---

# Celá vertikála v jednom modelu

```text
ORGANIZACE          BUSINESS              APLIKACE              INFRASTRUKTURA
───────────         ────────              ────────              ──────────────
Útvar / osoba  →    Funkce / proces  →    Aplikační služba  →   Platforma / runtime
Role           →    Business služba  →    Aplikace / data   →   Uzel / cluster
                                                              →   Síť / zařízení
                                                              →   Areál / lokace
```

Z libovolného bodu lze jít **dolů** (jak je to realizováno) i **nahoru** (koho to ovlivní).

---

# Co z toho plyne pro řízení

- Jedna odpověď: „kdo používá systém X?“ i „kde běží X a na čem závisí?“
- Dopadová analýza: změna role, aplikace, clusteru nebo sítě
- Stejná řeč pro byznys, aplikační a infrastrukturní týmy
- Podklad pro audit, compliance, portfolio i provoz — bez překreslování

---

<!-- _class: section-title -->

# 2. Stavební kameny modelu

Business · aplikace · infrastruktura

---

# Business vrstva — sedm základních pojmů

| Ve skutečnosti | V modelu | Příklady |
| -------------- | -------- | -------- |
| Útvar / tým | **Business Actor** (oddělení) | Odbor Compliance |
| Jmenovaná osoba | **Business Actor** (osoba) | Petr Novák |
| Pozice / mandát | **Business Role** | DPO, Compliance Officer |
| Stabilní oblast práce | **Business Function** | Správa compliance, ESG |
| Konkrétní aktivita | **Business Process** | Zveřejnění smlouvy v registru |
| Služba pro spotřebitele | **Business Service** | Právní podpora |
| — | — | — |

Oddělujeme **kdo / v jaké roli / co dělá** — při změně osoby se mění jen přiřazení, ne celá mapa práce.

---

# Funkce vs. proces — jednoduchý test

> **„Za co odpovídáte?“** → **Business Function**  
> (Compliance, veřejné zakázky, ochrana dat, ESG…)

> **„Co se stane, když nastane X?“** → **Business Process**  
> (zveřejnit smlouvu, zaregistrovat účastníka trhu…)

Pro mapu odborů jsou **funkce primární**.  
Procesy přidáváme, když má aktivita jasný začátek, konec a výsledek.

---

# Aplikační vrstva — systémy, služby, data

| Ve skutečnosti | V modelu | Příklady |
| -------------- | -------- | -------- |
| IT systém / produkt | **Application Component** | FaceUP, Prodis, SAP, Eramba |
| Funkce, kterou systém nabízí | **Application Service** | Whistleblowing Case Mgmt |
| Aplikační data / registry | **Data Object** | Evidence smluv, účastníci trhu |

**Pravidlo:** pojmenovaný systém = **Application Component**.  
**Application Service** = konkrétní funkcionalita — ne synonymum pro „aplikaci“.

Volitelně: `ownership` = interní / externí / sdílené (např. EU registry).

---

# Propojení business ↔ aplikace

```text
FaceUP                         [Application Component]
   │ Realization
   ▼
Whistleblowing Case Management [Application Service]
   │ Serving  („podporuje“)
   ▼
Whistleblowing Management      [Business Function]
```

- **Serving** = systém poskytuje funkcionalitu práci  
- **ne** „odpovídá za“ (to je Assignment u lidí/rolí)
- Mezi aplikacemi **Flow** jen když něco konkrétního teče (data) — vždy s popiskem

---

# Technologická a infrastrukturní vrstva

| Ve skutečnosti | V modelu | Příklady |
| -------------- | -------- | -------- |
| Platformní služba | **Technology Service** | databáze, DNS, IdP, storage |
| Runtime / middleware | **System Software** | Kubernetes, PostgreSQL, Kafka |
| Uzel / cluster / VM | **Node** | prod-cluster, app-vm-01 |
| Fyzické zařízení | **Device** | server, switch |
| Síť / zóna | **Communication Network** | APP_NET, DMZ |
| Datacentrum / areál | **Facility** | DC Praha |
| Geografická lokace | **Location** | lokalita / region |

Hloubka detailu se řídí potřebou (kritická aplikace → více; katalogová položka → méně).

---

# Propojení aplikace ↔ infrastruktura

```text
GRC Eramba                 [Application Component]
   │ DeployedOn
   ▼
Kubernetes                 [System Software]
   │ Assignment
   ▼
prod-cluster               [Node]
   │ memberOf / connectedTo
   ▼
APP_NET                    [Communication Network]
   │
   ▼
DC Praha                   [Facility]  →  Location
```

Platformní služby (DB, IdP) podporují aplikaci přes **Serving** — stejně srozumitelně jako aplikační služby podporují byznys.

---

# Příklad: celá cesta „Compliance → Eramba → cluster“

```text
Odbor Compliance → DPO → ZoKI Compliance Management
        ↑ Serving
GRC Support [App Service] ← Eramba [App Component]
                                │ DeployedOn
                                ▼
                         Kubernetes → prod-cluster → APP_NET → DC
```

Manažerská otázka i technická otázka končí ve **stejném grafu** — liší se jen místo, kde začnete.

---

# Vztahy napříč vertikálou (řídicí pravidla)

| Vztah | Typický význam |
| ----- | -------------- |
| **Composition** | útvar obsahuje útvar/lidi; cluster obsahuje nody |
| **Assignment** | role vykonává práci; software běží na uzlu |
| **Realization** | práce → služba; aplikace → aplikační služba |
| **Serving** | funkcionalita / platforma podporuje spotřebitele |
| **DeployedOn** | aplikace běží na runtime / platformě |
| **Access** | aplikace přistupuje k datům |
| **Flow** | identifikovatelný tok (data) — vždy s popiskem |
| **Triggering** | A skutečně spouští B |
| **Association** | reports to, umístění v síti/areálu, výjimky |

Cíl: **každý vztah má právě jeden business/technický význam.**

---

<!-- _class: section-title -->

# 3. Aplikace a Knowledge Core

Jak s modelem pracujeme dnes

---

# Ne další „kreslicí ArchiMate“

Aplikace **IT Map** je specializovaný editor v jazyce organizace:

- uživatel přidává: osobu, roli, funkci, proces, systém, platformu, uzel…
- **nevybírá** desítky ArchiMate typů a vztahů
- vztahy systém **odvodí** z kontextu (WHO / WHAT / SUPPORT / WHERE)

> Uživatel popisuje realitu.  
> Systém pod tím udržuje validní ArchiMate graf.

---

# Hlavní UI: sloupcové procházení celé vertikály

```text
Organizace → Role/Osoba → Funkce → Proces → Business služba
  → App služba → Aplikace → System Software → Node
  → Síť / Device → Facility / Location
```

- **progressive disclosure** — nevidíte celý graf najednou
- nahoře **cesta fokusem** (breadcrumb grafem)
- stejná data, různé **šablony průchodu**:
  - business exploration
  - dopad aplikace
  - infrastruktura / technologická závislost

Klasický diagram je **doplňkový** pohled — ne hlavní způsob práce.

---

# Knowledge Core — zdroj pravdy už dnes

**Knowledge Core (KC)** je společná platforma pro znalostní model:

- úložiště entit a vztahů (knowledge graph)
- metamodel **archimate-lite** (řízená podmnožina ArchiMate)
- balíčky organizace, **ChangeSet / Release** (řízená změna)
- open-world vlastnosti (doplňující atributy bez přestavby schématu)

**IT Map** = doménové rozhraní.  
**KC** = kanonický model, ze kterého čtou lidé, nástroje i budoucí agenti.

---

# Co to přinese uživatelům

- Stejná mapa pro byznys, aplikace i provoz
- Rychlé odpovědi napříč vertikálou („kdo / za co / čím / kde“)
- Editace bez znalosti ArchiMate
- Kontroly: osoba bez role, aplikace bez vazby na práci, app bez deploymentu…
- Jedna pravda — více pohledů a výstupů

---

<!-- _class: section-title -->

# 4. Výhled do budoucna

Model jako zdroj pravdy · agenti · verzování a provenance

---

# Ambice: živý model organizace

Dnes: lidé modelují a procházejí graf v IT Map.  

**Výhled:** Knowledge Core zůstává **jediným zdrojem pravdy** a nad ním pracují lidé **i agenti**:

- generují výstupy pro řízení a provoz
- pomáhají rozvíjet model ze vstupů analýz a návrhů
- promitají stav reálného deploymentu zpět do modelu

Aby to bylo důvěryhodné, musí mít model **verzování** a **provenance** (kdo / co / z čeho vzniklo).

---

# Knowledge Core jako zdroj pravdy

```text
        ┌─────────────────────────────────┐
        │     Knowledge Core (model)      │
        │  entity · vztahy · verze · kdo  │
        └───────────────┬─────────────────┘
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
   IT Map (lidé)   Agenti / AI     Integrace (CI, CMDB, K8s…)
   prohlížení      návrhy změn     pozorovaný stav
   editace         generované      zpětná projekce
                   výstupy
```

Žádný paralelní „pravdivý“ diagram, wiki ani tabulka —  
všechny cesty vedou do **stejného grafu**.

---

# Agenti: tři hlavní role

| Role agenta | Co dělá | Příklad |
| ----------- | ------- | ------- |
| **Výstupy** | Z modelu generuje dokumenty a pohledy | dopadová analýza, mapa odboru, podklad pro audit |
| **Rozvoj modelu** | Ze vstupů (analýzy, návrhy, RFCs) navrhuje další verzi modelu | nová aplikace + vazby na funkce a deployment |
| **Zpětná projekce** | Z reálného provozu doplňuje / opravuje technickou vrstvu | cluster, image, síťové vazby z Kubernetes / CI |

Člověk **schvaluje** — agent **navrhuje a připravuje ChangeSet**.

---

# 1) Agenti generují výstupy

Model už obsahuje fakta — agent z nich skládá srozumitelné artefakty:

- přehled útvaru (kdo / role / funkce / aplikace)
- dopad vypnutí systému nebo změny role
- podklady pro compliance a audit
- pohledy pro různé audience (vedení vs. provoz)

Výstup je **odvozený** — při změně modelu lze regenerovat.  
Není třeba udržovat paralelně Word/PowerPoint jako zdroj pravdy.

---

# 2) Agenti pomáhají s rozvojem modelu

Vstup: analýza, návrh řešení, zápis z workshopu, ArchiMate fragment, ticket…

```text
Vstup (text / návrh)
        │
        ▼
Agent navrhne entity + vztahy  →  ChangeSet v KC
        │
        ▼
Architekt / vlastník zkontroluje a schválí
        │
        ▼
Nová verze / release modelu
```

Agent zrychluje **překlad reality do grafu** —  
nemění pravomoc rozhodnout, co je v modelu správně.

---

# 3) Zpětná vazba z reálného deploymentu

Provoz je často „napřed“ oproti dokumentaci. Agenti to srovnají:

```text
Kubernetes / CI / observabilita / CMDB
        │ pozorovaný stav
        ▼
Agent mapuje na Node, System Software, DeployedOn, sítě…
        │
        ▼
Návrh aktualizace modelu (diff proti aktuální verzi)
        │
        ▼
Schválení → model se přiblíží realitě
```

Cíl: **as-is technická vrstva** se neudržuje ručně „od stolu“,  
ale řízeně doplňuje z provozu — s auditní stopou.

---

# Verzování — předpoklad důvěry

Bez verzí nelze bezpečně nechat agentům měnit model.

V Knowledge Core:

- **ChangeSet** — navrhovaná sada změn (člověk nebo agent)
- **Release** — publikovaná, odkazovatelná verze balíčku / modelu
- možnost porovnat verze („co se změnilo od minulého čtvrtletí?“)
- oddělení návrhu od přijatého stavu

Stejný mechanismus slouží lidem i agentům —  
agent je další autor změn, ne paralelní databáze.

---

# Provenance — kdo co udělal a z čeho

Ke každé významné změně patří kontext:

| Otázka | Co model uchovává |
| ------ | ----------------- |
| **Kdo** | člověk, agent, integrační úloha |
| **Co** | které entity / vztahy se změnily |
| **Kdy** | čas ChangeSetu / release |
| **Z čeho** | zdroj: workshop, RFC, K8s snapshot, import |
| **Proč** | odkaz na požadavek / rozhodnutí |

> Bez provenance je automatizace riziková.  
> S provenance je automatizace **auditovatelná** — vhodné i pro regulované prostředí.

---

# Jak to dohromady drží

```text
           ┌── Generování výstupů (reporty, pohledy)
           │
Model v KC ┼── Návrhy rozvoje (ze vstupů analýz)
 (SoT)     │
           └── Zpětná projekce (z deploymentu)
                    │
                    ▼
            ChangeSet + provenance
                    │
                    ▼
              Schválení člověkem
                    │
                    ▼
                 Release
```

Lidé řídí význam. Agenti škálují práci.  
Model zůstává jednou pravdou napříč časem.

---

# Shrnutí pro rozhodnutí

1. **Úzký slovník, plná vertikála** — od lidí po sítě a lokace.  
2. **Pravda je v datech (KC)** — pohledy a dokumenty jsou výstup.  
3. **IT Map** zpřístupní model byznysu i IT bez znalosti ArchiMate.  
4. **Výhled:** agenti nad stejným modelem — výstupy, rozvoj, sync z provozu.  
5. **Verze + provenance** jsou podmínkou důvěryhodné automatizace.

---

<!-- _class: lead -->
<!-- _footer: "" -->

# Další krok

Potvrdit s vedením:

- rozsah první vlny (které útvary / systémy),
- požadovanou hloubku infrastruktury,
- priority výhledových scénářů (výstupy · rozvoj · sync z provozu).

<p class="muted">Podklady: concept-modelovani-business-a-app.md · koncept-metodiky a aplikace.md · funkční specifikace</p>
