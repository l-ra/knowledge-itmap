### User

Pojdme spolu navrhnout kostru UX, ktera bude zalozena na diskusich z predchozich chatu a ktera bude vychazet z nasledujicich pozadavku:

- archimate je priznany koncept, ale k prostym archimate elementum UI doplnuje domenovy pohled architektury a tim trochu urcuje smer modelovani
- modelovani zacina vlozenim nektereho z prvku archimate pojmenovaného "lidsky a srozumitelne". Tedy např. přidat "Proces" pro business proces s drobnym vysvetlenim, Přidat Aplikaci, Přidat server, Pridat sitovy prvek, Pridat sluzbu infrastrury, Pridat sluzbu aplikace. T vse na jakemsi rozcestniku klidne i respekrujicim deleni archimate- business, applikace, infra
- Pri pridani prvku bude mozne editovat jeho zakladni vlastnosti - nazev, popis a oboje bude povinne a system se bude snazit odhalit duplicity, aby pripadne nabidl pouziti jiz existujiciho
- Jakmile je prvek identifikovany  pojmenovany a ma zakladni vlastnosti, otevirra se karta prvku, na ktere je mozne systematicky videt a editovat vazby a vztahy tohoto prvku a take vlastnosti samotne tohoto prvku. POmoci vazeb je mozne prochazet na dalsi prvky a to v obou smerech tzn. vazby jsou jak odchozi, tak prichozi a primarne maji domenovy vyznam i kdyz archimate podstata neni zastirana. I kdyz vzaby neexistuji, jsou na ne v UI pripraveny pozice (to pujde vypnout a zapnout neco jako zobraz mozne vazby)
- Vazby samotne jsou elementy, u kterych bude mozne zobrazit detail a upravovat jejich vlastnosti.
- UX bude koncipovano jako karty prvku, kde budou rozlozeny vazby do skupin podle povahy prvku
- Nevytvarime paralelni slovnik, jen mapujeme realne entity, o kterych mluvi lide na genericke archimate prvky, a tohle mapovani si take budeme ukladat v modelu, aby to pak slo pouzit pro UI
- UI vzdy dovoli explicitne pridat archimate element nebo relation ve sve zakladni podobe mimo zname prvky. V takovem pripade se UI dopta, jestli je nutne rozsirit ui mapovani a pridat dalsi opakovatelne pouzitelny typ prezentace konkretniho objektu v kontextu konkretniho typu elementu pro pristi editace.

Napriklad BusinessActor se pridava v nekolika pripadech, ktere budou popsany a jsou reprezentovany actorKind property:

- departement
- person
- external

Vazby, prodavane k akterovi jsou composition pro hierarchie, prirazeni

Dalsi priklad je BusinessRole, k roli mohou byt prirazeny osoby. Role muze byt prirazena do departmentu

Priklady nejsou zcela spravne a urcite nejsou vyceravajici,budeme navrhovat dalsi spolecne .. nebo ty budes navrhovat a ja schvalovat.

Pojdme spolecne navrhnout takove vice mene genericke daty rizene rozhrani.

Prosim kriticky rozbor tohoto navrhu.

### Assistant

Ten návrh má podle mě správný základ. Nejdůležitější je, že**ArchiMate zůstává datovým a sémantickým základem**, ale uživatel není nucen při každém kroku přemýšlet v terminologii metamodelu. To je podle mě podstatně robustnější směr než vytvářet alternativní modelovací jazyk nebo workflow založené primárně na otázkách.

Současně bych ale několik částí návrhu změnil dřív, než začneme kreslit konkrétní obrazovky.

## 1. Co považuji za nejsilnější část návrhu

Nejsilnější je tento princip:

**uživatel vytváří reálnou věc, systém ví, jak je tato věc reprezentována v ArchiMate**

Tedy například:

`Oddělení IT`→ UX profil`department`→ ArchiMate`BusinessActor`→ property např.`actorKind=department`

To je velmi dobrá hranice abstrakce.

Uživatel nemusí vědět, že „oddělení“ je BusinessActor. Pokročilý uživatel to ale vždy vidí a může se dostat k čisté ArchiMate reprezentaci.

Stejně dobré jsou podle mě čtyři další principy:

- **karta objektu jako hlavní pracovní plocha**, nikoli diagram,
- **navigace po vztazích**mezi kartami,
- zobrazení**příchozích i odchozích vazeb**,
- možnost kdykoli uniknout do**čistého ArchiMate authoringu**.

Tím vzniká spíš „architecture knowledge browser/editor“ než kreslicí nástroj.

# 2. Největší konceptuální problém: nějaký doménový slovník přece jen vzniká

Tvrzení:

„Nevytváříme paralelní slovník.“

bych mírně opravil.

Ve skutečnosti ho**vytváříme**, jen velmi tenký.

Například:

- Oddělení
- Osoba
- Externí organizace
- Aplikace
- Server
- Databáze
- Síťový prvek

nejsou ArchiMate typy.

Jsou to**doménové prezentační typy**.

To není chyba. Chyba by podle mě byla snažit se předstírat, že neexistují.

Doporučoval bych proto explicitní koncept:

### Presentation Profile

Například:
```
id: department

label: Oddělení
description: Organizační jednotka firmy

archimateElementType: BusinessActor

properties:
    actorKind = department
```

To není nový architektonický metamodel. Je to konfigurace toho,**jakým způsobem prezentujeme určitý opakující se způsob použití ArchiMate**.

Tento rozdíl bych držel velmi důsledně:
```
ArchiMate metamodel
        ↑
Presentation Profile
        ↑
Konkrétní instance
```

např.
```
BusinessActor
      ↑
department
      ↑
Oddělení IT
```

# 3. actorKind už ukazuje jeden problém taxonomie

Tvůj příklad:
```
BusinessActor

actorKind:
- department
- person
- external
```

bych takto nepoužil.

`department`a`person`popisují**povahu actoru**.

`external`popisuje**vztah actoru k organizaci**.

Jsou to dvě různé osy klasifikace.

Například externí může být:
```
Externí člověk
Externí firma
Externí organizační jednotka
```

Takže spíše něco jako:
```
actorKind:
    person
    organization
    organizationalUnit
```

a zvlášť třeba:
```
organizationScope:
    internal
    external
```

Nebo ještě lépe: nenechat všechny tyto věci vznikat jako jeden univerzální enum, ale nechat presentation profiles skládat několik properties.

Například:
```
profile: department

archimateType: BusinessActor

defaults:
    actorKind: organizationalUnit
    organizationScope: internal
```

a
```
profile: externalOrganization

archimateType: BusinessActor

defaults:
    actorKind: organization
    organizationScope: external
```

To je důležitý princip pro další návrh:**presentation profile není totéž jako hodnota jedné kind property**.

# 4. Pozor na předpoklad „lidský pojem → jeden ArchiMate element“

Tady očekávám nejvíc problémů.

Například „Server“.

Co tím uživatel myslí?

- fyzický server,
- virtuální server,
- OS instance,
- runtime node,
- nějaký serverový software?

To nemusí vést ke stejnému ArchiMate typu.

Podobně „síťový prvek“ může podle významu skončit jako`Device`,`Node`, případně se vůbec může ukázat, že uživatel myslí`Communication Network`.

Takže bych nedělal:
```
Server → Node
```

jako nezpochybnitelnou globální konstantu.

Spíš:
```
Přidat server

Co je to za server?

○ Fyzický server
○ Virtuální server
○ ...
```

Ale pozor: ani z toho bych nedělal wizard o pěti otázkách. Presentation profile může většinu rozhodnutí skrýt.

Tohle bude jedna z hlavních věcí, které musíme při návrhu jednotlivých profilů společně testovat.

# 5. Karta elementu je správné těžiště UX

Tady bych návrh téměř neměnil.

Představoval bych si kartu přibližně:
```
┌──────────────────────────────────────────────┐
│ Platební systém                              │
│ Aplikace · Application Component             │
│                                              │
│ Zajišťuje zpracování karetních plateb...     │
├──────────────────────────────────────────────┤
│ ZÁKLADNÍ INFORMACE                           │
│ vlastník, životní cyklus, kritičnost ...     │
├──────────────────────────────────────────────┤
│ POSKYTUJE                                    │
│   Payment API                                │
│   Authorization Service                      │
│                                              │
│   + přidat službu                            │
├──────────────────────────────────────────────┤
│ POUŽÍVÁ                                     │
│   Customer Registry                          │
│                                              │
│   + přidat používanou službu                 │
├──────────────────────────────────────────────┤
│ BĚŽÍ NA                                     │
│   APP-PROD-01                                │
│                                              │
│   + přidat infrastrukturu                    │
├──────────────────────────────────────────────┤
│ DATA                                         │
│   Transactions                               │
│                                              │
│   + přidat data                              │
└──────────────────────────────────────────────┘
```

A teprve v detailu:
```
Authorization Service
Application Service
Serving
Flow
Assignment
...
```

Uživatel tedy primárně čte**význam**, nikoli název ArchiMate relationship.

To je podle mě zásadní.

# 6. Vazby ano jako first-class objekty, ale ne jako „elementy“

Tady bych upravil terminologii.

ArchiMate odlišuje**elements**a**relationships**; nadřazený pojem je concept. Relationship tedy není ArchiMate Element.

Ale to nijak nebrání tomu, aby v našem datovém modelu byl relationship plnohodnotný objekt:
```
Relationship
    id
    type
    source
    target
    properties
    description
    metadata
```

a měl vlastní detail.

Takže:

**ano:**
```
Relationship má ID
Relationship má properties
Relationship lze otevřít
Relationship lze editovat
Relationship má historii
```

ale:

**ne:**
```
Relationship je Element
```

Tohle rozlišení se nám později vyplatí.

# 7. Ještě důležitější než karta elementu bude definice „relation slotu“

Tohle považuji za centrální stavební kámen celého UX.

Například profil:
```
Application
```

nebude pouze říkat:
```
archimateType = ApplicationComponent
```

ale také něco jako:
```
sections:

  services:
      label: Poskytuje služby
      relationship: Assignment
      target: ApplicationService

  processes:
      label: Podporuje procesy
      relationship: Serving
      target: BusinessProcess

  deployment:
      label: Běží na
      ...
```

Formálně bych tomu pracovně říkal třeba:

### Relation Slot

Má například:
```
id
label
description

relationshipType

direction:
    incoming | outgoing

targetElementTypes
targetPresentationProfiles

cardSection

cardinality

importance:
    required
    recommended
    optional

create:
    existing: true
    new: true
```

Tohle je podle mě ve skutečnosti**nejdůležitější metadata UX**, protože právě relation slots určují, co uživatel na kartě vůbec vidí.

# 8. „Zobraz možné vazby“ potřebuje tři úrovně, ne dvě

Tvůj nápad:

i když vazba neexistuje, UI pro ni má připravené místo

je dobrý, ale může velmi rychle vytvořit přeplněnou kartu.

ArchiMate má relativně obecnou sadu structural, dependency, dynamic a dalších relationships.

Proto bych rozlišoval:

### Existující

Vždy viditelné.
```
Poskytuje služby
  Payment API
```

### Doporučené

Profil říká, že pro tento typ objektu jsou důležité.
```
Běží na
  — zatím neuvedeno —
  + přidat
```

### Všechny možné ArchiMate vazby

Expert režim.
```
Zobrazit další možné vazby…
```

Jinak bychom jen převedli obrovskou ArchiMate relationship matrix z diagramu na kartu a UX problém by se vrátil jinou cestou.

# 9. Příchozí a odchozí vztahy jsou správně, ale jejich význam se musí překlápět

Tady bude velmi důležitá jedna drobnost.

ArchiMate relationship má source a target.

Doménový jazyk ale potřebuje čitelné labely v obou směrech.

Například Assignment u Business Actor / Business Role.

ArchiMate říká, že Business Actor může být přiřazen k Business Role; Business Role představuje odpovědnost, kterou actor může zastávat.

Z pohledu osoby tedy můžeme říct:
```
Zastává role
    Solution Architect
```

Z pohledu role:
```
Roli zastávají
    Jan Novák
```

Pod tím je pořád jedna relation:
```
Assignment
BusinessActor → BusinessRole
```

To je přesně ten typ translace, který by měl Presentation Profile obsahovat.

Například:
```
forwardLabel: Zastává role
reverseLabel: Roli zastávají
```

Nikdy bych kvůli tomu nevytvářel dvě vazby.

# 10. Tvůj příklad Role + Department je ve skutečnosti dobrý test systému

Například:
```
Department: IT
BusinessRole: Application Owner
```

Business Actor může být přiřazen k Business Role, takže oddělení modelované jako Business Actor může takovou roli zastávat. Přesně tento vzor používají i příklady ArchiMate s oddělením a rolí.

Ale UI by nemělo říkat:

„Role je přiřazena do departmentu.“

Spíše:

Na kartě oddělení:
```
Zastává role
   Application Owner
```

Na kartě role:
```
Zastávají
   IT Department
```

ArchiMate:
```
IT Department
BusinessActor

   Assignment
      ↓

Application Owner
BusinessRole
```

Tady krásně vidíme rozdíl mezi**směrem relationship**a**směrem lidské věty**.

# 11. Povinný popis při vytvoření bych zpochybnil

Tady bych byl proti původnímu návrhu.

Povinné:
```
název
popis
```

je metodicky hezké, ale v běžném používání pravděpodobně povede k:
```
Název: APP01
Popis: Aplikace APP01
```

tedy k datům bez hodnoty.

Navíc při objevování architektury často nejprve víme:

„Existuje server srv-app-23.“

a teprve později zjistíme, co přesně dělá.

Navrhoval bych proto:

### vytvoření

povinné:
```
typ
název
```

### kvalitativní kontrola
```
⚠ Chybí popis
```

a například stav:
```
Draft
Complete
```

Případně lze vyžadovat popis pro přechod do`Complete`.

To je podle mě lepší než zvyšovat bariéru vytvoření elementu.

# 12. Duplicate detection bych neodvozoval hlavně z popisu

Detekce duplicit je velmi dobrý požadavek.

Ale vstupy bych řadil zhruba:
```
1. stejný/exaktně podobný název
2. aliasy
3. stejný Presentation Profile
4. ArchiMate type
5. externí identifikátory
6. organizační / systémový kontext
7. podobný popis
```

Výsledek například:
```
Přidáváte aplikaci „SAP ERP“.

Možná již existuje:

SAP ERP
Aplikace
87 % podobnost

[ Použít existující ]
[ Přesto vytvořit nový ]
```

LLM nebo embedding search zde může pomoci**rankovat kandidáty**, ale neměl by rozhodovat o identitě objektu.

# 13. Raw ArchiMate fallback je důležitý, ale nedával bych otázku na nový profil po každém použití

Tvoje myšlenka:

Přidám čistý ArchiMate element → systém se zeptá, zda tím nemáme rozšířit UI.

Princip je správný.

Ale okamžitý dialog bych nepoužíval.

Uživatel někdy vytvoří například jeden specifický`BusinessEvent`, který nikdy nebude opakovaným doménovým typem.

Spíš:
```
Přidat ArchiMate element
    ↓
Business Event
    ↓
Element vytvořen
```

a nenápadná možnost:
```
Používáte tento ArchiMate typ bez prezentačního profilu.

[ Vytvořit prezentační profil ]
```

A ještě zajímavější by bylo, kdyby systém později zjistil:
```
Máte 14 BusinessActorů s actorKind=vendor.

Vytvořit z nich opakovaně použitelný typ „Dodavatel“?
```

Tím se Presentation Profiles mohou vyvíjet z reálného používání.

# 14. Mapování bych neukládal přímo mezi architektonické objekty

Tady bych ještě otevřel jednu architektonickou otázku.

Píšeš:

mapování si také budeme ukládat v modelu

Pokud tím myslíš „ve stejném repository“, souhlasím.

Pokud tím myslíš „jako další ArchiMate elementy vedle aplikací, serverů a procesů“, byl bych proti.

Raději:
```
repository

  architecture/
      elements
      relationships

  presentation/
      profiles
      relationSlots
      labels
      propertySchemas
```

Oboje:

- verzované,
- uložené,
- auditovatelné,
- datově řízené.

Ale prezentační metamodel nám neznečišťuje vlastní architektonický graf.

# 15. Výsledná obecná architektura UX se mi začíná rýsovat takto
```
                 ARCHIMATE METAMODEL
                        │
                        │ constrains
                        ▼
              ┌─────────────────────┐
              │ Presentation Profile│
              │                     │
              │ Department          │
              │ Application         │
              │ Person              │
              │ Server              │
              └──────────┬──────────┘
                         │
                         │ defines
                         ▼
              ┌─────────────────────┐
              │ Element Card        │
              │                     │
              │ properties          │
              │ relation slots      │
              │ labels              │
              │ actions             │
              └──────────┬──────────┘
                         │
                         ▼
              ARCHIMATE MODEL
                elements
                relationships
```

A relation slot:
```
Presentation Profile
        │
        ├── properties
        │
        ├── Relation Slot
        │      ├── UI label
        │      ├── ArchiMate relationship
        │      ├── source/target constraint
        │      ├── target profile
        │      ├── direction
        │      └── importance
        │
        └── other Relation Slot ...
```

Tahle struktura je podle mě generická dost na to, aby nebyla natvrdo naprogramovaná pro „aplikace“ nebo „servery“.

# 16. Čtyři otázky, které podle mě rozhodnou o kvalitě celého návrhu

**1. Může mít jeden ArchiMate element více prezentačních profilů?**

Například BusinessActor:
```
Dodavatel
Externí organizace
Partner
```

Je to jedna klasifikace, nebo může jeden actor být současně všemi třemi?

Můj předběžný názor: jeden**primární profile**+ další klasifikační properties/tags. Jinak se UI začne rozpadat.

**2. Jsou Presentation Profiles globální, nebo specifické pro konkrétní repository/organizaci?**

Například pojem „Aplikace“ může být téměř univerzální, zatímco „Technologická platforma ČS“ může být velmi lokální.

Můj návrh:
```
core profiles
organization profiles
```

s možností dědit/rozšiřovat.

**3. Budou relation slots pouze doporučení UX, nebo budou také validační pravidla?**

To je zásadní rozdíl:
```
„Aplikace typicky poskytuje Application Service“
```

versus
```
„Aplikace musí poskytovat Application Service“
```

První je UX guidance. Druhé už je metodika/governance.

Nemíchal bych je.

**4. Co se stane s existujícími objekty, když změníme Presentation Profile?**

Například:
```
server v1 → Node
server v2 → Device
```

To už není kosmetická změna.

Presentation Profiles proto podle mě budou potřebovat**identitu, verzi a případně migrace**.

## Celkové hodnocení

Směr bych zachoval.

Nevidím zásadní problém v samotné myšlence „karty místo diagramů“. Naopak, myslím, že jsme se dostali k mnohem vhodnějšímu modelu interakce než v předchozí variantě založené na řízeném průchodu otázkami.

Největší riziko je jiné: že do`Presentation Profiles`postupně nacpeme tolik sémantiky, pravidel a klasifikací, až**vedle ArchiMate fakticky vytvoříme druhý metamodel**.

Obrana proti tomu podle mě musí být jednoduché pravidlo:

**Presentation Profile smí pouze zpříjemňovat a omezovat způsob použití ArchiMate. Nesmí zavádět architektonickou sémantiku, kterou nelze jednoznačně převést na ArchiMate elementy, properties a relationships.**

Jako další krok bych proto ještě nekreslil obrazovky. Navrhl bych nejdřív**minimální datový model PresentationProfile + RelationSlot**a zkusil na něm současně namodelovat dva dost odlišné případy:**BusinessActor (Oddělení / Osoba / Externí organizace)**a**Application Component (Aplikace)**. Pokud stejný mechanismus bez speciálních hacků pokryje oba, máme pravděpodobně správnou kostru UX.

### Assistant

Rozuměl bych tomu méně jako „dalším profilem elementu“ a více jako**sadě modelovacích konvencí nad ArchiMate**. A právě proto bych možná název`ModelingProfile`změnil, protože může působit, že zavádíme další metamodel.

Příklad: ArchiMate nám řekne, jaké koncepty a vztahy existují a co znamenají. Ale ne vždy určí jediný způsob, jak konkrétní realitu modelovat. My si proto potřebujeme říct:**„V našem modelu budeme tento typ situace reprezentovat právě tímto ArchiMate vzorem.“**

Například:
```
Realita:
Aplikace běží na serveru.

Naše modelovací konvence:

ApplicationComponent
        ▲
        │ Realization
     Artifact
        ▲
        │ Assignment
       Node
```

To není PresentationProfile. PresentationProfile pouze řekne:
```
uživateli zobraz:
CRM
Běží na:
  APP-PROD-01
```

Modelovací konvence říká,**z jakého ArchiMate grafu se toto tvrzení skládá a jak se má při editaci vytvořit**.

Takže bych rozlišoval čtyři vrstvy:
```
1. ArchiMate
   Co je ApplicationComponent, Node, Assignment,
   Composition, Serving...

2. Modeling Conventions
   Jak konkrétní architektonické situace
   v našem repository zapisujeme pomocí ArchiMate.

3. Presentation Profiles
   Jak generické ArchiMate koncepty pojmenováváme
   a prezentujeme uživateli.

4. Card Definitions
   Jak tyto informace rozmístíme v UI.
```

Konkrétní příklad „server“:
```
ARCHIMATE

Node
Device
SystemSoftware
Artifact
TechnologyService
...
```

Naše**modelovací konvence**mohou říct:
```
"Server" modelujeme jako Node.

Fyzický hardware modelujeme jako Device.

Software tvořící runtime prostředí modelujeme
jako SystemSoftware.

Nasazení aplikace na server modelujeme
Node → Assignment → Artifact → Realization → ApplicationComponent.
```

Presentation profiles pak řeknou:
```
Node + nodeKind=server
    → "Server"

Device + deviceKind=server
    → "Fyzický server"

SystemSoftware + softwareKind=os
    → "Operační systém"
```

A karta:
```
APP-PROD-01
Server

Běží zde
  CRM

Platformní software
  RHEL 9
```

## Co by tedy Modeling Conventions obsahovaly

Ne všechny možné vztahy. Pouze naše rozhodnutí tam, kde potřebujeme**sjednotit způsob modelování**.

Například:
```
conventions:

  applicationDeployment:
    description: >
      Nasazení aplikace na technologický uzel.

    pattern:
      - Node
      - Assignment
      - Artifact
      - Realization
      - ApplicationComponent
```

Další:
```
  applicationDecomposition:
    pattern:
      parent: ApplicationComponent
      relationship: Composition
      child: ApplicationComponent
```

Další:
```
  applicationProvidesService:
    pattern:
      source: ApplicationComponent
      relationship: Realization
      target: ApplicationService
```

A třeba:
```
  organizationalHierarchy:
    pattern:
      parent: BusinessActor
      relationship: Composition
      child: BusinessActor
```

Tedy vlastně něco jako**katalog schválených ArchiMate patternů**.

## Ale tady bych opravil svůj předchozí návrh

Nemyslím si, že potřebujeme nutně velkou samostatnou entitu`ModelingProfile`.

Mohlo by to skončit přeinženýrované:
```
Metamodel
→ ModelingProfile
→ PresentationProfile
→ CardDefinition
→ SlotView
→ EditStrategy
→ ...
```

a vytvořili bychom si framework dřív, než víme, že ho potřebujeme.

Praktičtější by podle mě bylo začít s jednodušším pojmem:

### ModelingConvention nebo ModelingPattern

Například:
```
applicationDeployment
applicationDecomposition
organizationalHierarchy
technologyServiceRealization
```

PresentationProfile se na něj může odkazovat:
```
pathSlots:

  deployments:
    label: Běží na
    pattern: applicationDeployment
```

Editace pak používá stejný pattern:
```
editStrategy:
  pattern: applicationDeployment
```

To má velmi dobrou vlastnost:**zobrazení i editace používají stejnou definici ArchiMate vzoru**.

## Důležitá hranice

ModelingConvention nesmí říkat:

„Každá aplikace musí mít vlastníka.“

To je governance/quality pravidlo.

Ani:

„Sekci deployment zobraz jako tabulku.“

To je UI.

Má říkat pouze:

„Pokud v našem modelu tvrdíme, že aplikace X je nasazená na server Y, reprezentujeme toto tvrzení tímto ArchiMate patternem.“

To je podle mě přesná definice.

Takže výsledný model bych teď zjednodušil na:
```
ArchiMate
    │
    ├── ModelingConvention
    │      "Jak zapisujeme určitou skutečnost"
    │
    └── PresentationProfile
           "Jak pojmenováváme a prezentujeme určitý koncept"
                   │
                   ▼
             CardDefinition
                   │
                   ▼
                  UI
```

A`QualityRules`jsou vedle:
```
QualityRules
    "Co chceme mít v modelu vyplněno/propojeno"
```

Za mě je tedy`ModelingConvention`lepší název než`ModelingProfile`.**Nezavádíme nový modelovací jazyk. Jen explicitně zapisujeme, kterou z možných ArchiMate konstrukcí používáme pro opakující se doménovou situaci.**

Tohle bych držel jako velmi úzký koncept; jinak opravdu hrozí, že začneme budovat vlastní metodologii místo UX nad ArchiMate.

### User

Vsiml jsem si nekde v prikladech, ze soucasti profilu nebo karty je enumerace s vyctem hodnot. Nemelo by toto byt prebirano z modelu spise nez z prezentacich definic ?

### Assistant

Ano. Tohle je důležitá korekce.**Výčet povolených hodnot by obecně neměl být vlastností PresentationProfile ani CardDefinition, pokud je součástí datového modelu.**

Když jsme předtím měli něco jako:
```
lifecycle:
  source: property.lifecycle
  type: enum
  values:
    - planned
    - development
    - production
    - deprecated
    - retired
```

tak je to podle mě špatně umístěné, pokud`lifecycle`a jeho povolené hodnoty definuje schema repository.

Správnější vrstvení je:
```
Model / schema
    ↓
definuje property a její datový typ
    ↓
PresentationProfile
    ↓
říká, že tuto property chceme pro daný typ používat
    ↓
CardDefinition
    ↓
říká, kde a jak ji zobrazit
```

Například model:
```
properties:

  lifecycle:
    type: enum
    values:
      - planned
      - development
      - production
      - deprecated
      - retired
```

PresentationProfile pak pouze:
```
fields:

  lifecycle:
    source: property.lifecycle
```

A CardDefinition:
```
sections:
  - id: basic
    fields:
      - lifecycle
```

## Co ale může prezentace nad enumem měnit

Tady bych dovolil určitou prezentační konfiguraci, ale**ne samotnou sémantiku nebo validitu hodnot**.

Například model říká:
```
planned
development
production
deprecated
retired
```

PresentationProfile může říct:
```
lifecycle:
  source: property.lifecycle

  presentation:
    labels:
      planned: Plánováno
      development: Ve vývoji
      production: V provozu
      deprecated: Útlum
      retired: Vyřazeno
```

Případně:
```
presentation:
  order:
    - planned
    - development
    - production
    - deprecated
    - retired
```

To je v pořádku, protože:
```
"production"
```

je hodnota modelu,

zatímco:
```
"V provozu"
```

je její UX reprezentace.

Stejně tak bych připustil, že konkrétní profil zobrazí jen relevantní podmnožinu hodnot — ale tady už bych byl opatrný.

Například model dovoluje:
```
internal
external
unknown
```

a profil`ExternalOrganization`by mohl mít:
```
defaults:
  organizationScope: external
```

a v UI ji vůbec nedovolovat měnit.

Ale**nesmí tím vzniknout jiný enum**.

# Důležité rozdělení tří typů omezení

Podle mě bychom měli explicitně rozlišovat:

### 1. Datové omezení

Patří do model/schema.
```
lifecycle:
  type: enum
  values:
    - planned
    - production
    - retired
```

Říká:

žádná jiná hodnota není platná.

### 2. Profilové omezení

PresentationProfile může říct:
```
match:
  lifecycle: production
```

nebo:
```
defaults:
  lifecycle: planned
```

případně:
```
fieldOverrides:
  lifecycle:
    readOnly: true
```

Říká:

pro tento prezentační typ používáme property určitým způsobem.

Ale**nemění její datovou definici**.

### 3. Prezentační omezení

CardDefinition může říct:
```
view:
  lifecycle:
    widget: select
```

nebo třeba:
```
view:
  lifecycle:
    widget: badge
```

Říká jen:

jak se hodnota zobrazí/edituje.

# Ještě bych udělal jednu změnu oproti našemu dosavadnímu návrhu

Možná ani`type`nepatří do PresentationProfile.

Měli jsme:
```
fields:

  hostname:
    source: property.hostname
    type: string
```

Pokud schema už ví:
```
hostname:
  type: string
```

tak je`type: string`redundantní a potenciálně nebezpečný.

Stačilo by:
```
fields:

  hostname:
    source: property.hostname

  lifecycle:
    source: property.lifecycle
```

Renderer si načte schema:
```
property.lifecycle
    ↓
type = enum
allowedValues = [...]
```

a podle něj ví, že potřebuje nějaký enum editor.

CardDefinition může případně říct:
```
lifecycle:
  widget: dropdown
```

ale nemusí znovu definovat datový typ.

# To se týká i dalších věcí

Stejný princip bych použil nejen na enumy.

Například:
```
required
datatype
multiplicity
allowedValues
format
validation
```

Pokud jsou součástí modelového schema,**neměly by být duplikované v PresentationProfile**.

Presentation layer může maximálně zpřísnit UX:
```
model:
  description required = false
```

PresentationProfile:
```
description:
  recommended = true
```

QualityRule:
```
description should not be empty
```

Ale bylo by problematické, kdyby PresentationProfile tvrdil:
```
description required = true
```

a model přitom dovoloval prázdnou hodnotu, aniž bychom rozlišili „validitu dat“ a „kvalitu modelu“.

## Dostáváme tedy čistší rozdělení odpovědností
```
MODEL / SCHEMA
────────────────────────
Co může existovat?

property lifecycle
type enum
allowed values
multiplicity
validation
ArchiMate constraints

MODELING CONVENTION
────────────────────────
Jak určitou skutečnost zapisujeme?

Application deployment
Node → Artifact → ApplicationComponent

PRESENTATION PROFILE
────────────────────────
Jaký doménový význam dáváme konceptu?

ApplicationComponent
+ componentKind=application
→ "Aplikace"

a které modelové properties / slots
jsou pro něj relevantní

CARD DEFINITION
────────────────────────
Jak to zobrazujeme?

sekce
pořadí
collapsed
widget
label

QUALITY RULES
────────────────────────
Co považujeme za dobře popsaný model?

Aplikace by měla mít popis.
Aplikace by měla poskytovat alespoň jednu službu.
```

Tohle rozdělení je podle mě výrazně čistší.

A vidím v tom ještě jeden praktický přínos:**PresentationProfile se tím významně zmenší.**Nemusí duplikovat schema repository, což je přesně to, čemu bychom se měli vyhnout. Jinak bychom velmi rychle měli dvě autoritativní definice stejné property a řešili, která z nich platí.

### User

minimalizoval bych take ruzne labels, pokud je mozne je brat ze schema repozitory napr. u enumeraci

### Assistant

Souhlas. Tady bych šel ještě dál:**prezentační definice by měly obsahovat label jen tam, kde bez něj skutečně vzniká nový kontextový význam.**

Jinak hrozí, že budeme mít stejné texty na třech místech:
```
schema
presentation profile
card definition
```

a po čase se rozjedou.

Nejčistší pravidlo by bylo:

**Schema je primární zdroj názvů, popisů, datových typů a enum hodnot. PresentationProfile a CardDefinition pouze odkazují na modelové položky a text přepisují jen výjimečně.**

Například schema:
```
properties:
  lifecycle:
    label: Životní cyklus
    description: Stav prvku v jeho životním cyklu
    type: enum

    values:
      planned:
        label: Plánováno

      production:
        label: V provozu

      deprecated:
        label: V útlumu

      retired:
        label: Vyřazeno
```

PresentationProfile potom jen:
```
fields:
  - property: lifecycle
```

CardDefinition:
```
sections:
  - fields:
      - lifecycle
```

Renderer si vše ostatní načte ze schema.

To je výrazně lepší než:
```
lifecycle:
  label: Životní cyklus
  values:
    production: V provozu
```

znovu zapisovat do profilu.

## Rozlišil bych ale čtyři případy

### 1. Label property

Primárně ze schema.
```
lifecycle → Životní cyklus
hostname  → Hostname
```

Presentation override jen pokud má konkrétní kontext opravdu jiný význam.

Například stejná property může být obecně:
```
owner → Vlastník
```

ale v nějaké úzce specifické kartě může dávat smysl:
```
owner → Vlastník aplikace
```

Ani tam bych override nedělal bez důvodu.

### 2. Label enum hodnot

Tady bych byl ještě striktnější:

**vždy schema**, pokud nejde například o lokalizaci.
```
production → V provozu
```

je význam modelové hodnoty, nikoli vlastnost konkrétní karty.

Profil by neměl mít vlastní překlad:
```
production: Produkce
```

zatímco schema říká:
```
production: V provozu
```

To by vytvořilo přesně tu dvojí sémantiku, které se snažíme vyhnout.

### 3. Label PresentationProfile

Ten už ve schema být nemusí.

Například:
```
id: application.application
label: Aplikace
```

protože:
```
ApplicationComponent
```

je ArchiMate typ,

zatímco:
```
Aplikace
```

je náš doménový způsob jeho použití.

To je legitimní prezentační informace.

Podobně:
```
BusinessActor + actorKind=person
→ Osoba
```

`Osoba`není jen překlad`BusinessActor`, ale význam konkrétního profilu.

### 4. Label RelationSlot / PathSlot

Tady bych label v prezentační vrstvě ponechal.

Například ArchiMate schema zná:
```
Serving
Realization
Composition
Assignment
```

ale karta potřebuje říkat:
```
Poskytuje
Používá
Běží na
Podporuje procesy
Je součástí
```

Tyto labely**nelze bezpečně odvodit pouze z relationship type**.

Jedna`Serving`relationship může být podle kontextu prezentována třeba jako:
```
Používá službu
Podporuje proces
Poskytuje infrastrukturu
Je obsluhováno
```

Takže například:
```
consumedServices:
  relationship:
    type: Serving
    direction: incoming

  label: Používá služby
```

má podle mě smysl.

# Ještě bych minimalizoval labely sekcí

Například jsme měli:
```
sections:
  - id: platform
    label: Platformní software
    slots:
      - platformSoftware
```

Pokud sekce obsahuje jen jeden slot, můžeme klidně použít jeho label:
```
sections:
  - slot: platformSoftware
```

a renderer zobrazí:
```
PLATFORMNÍ SOFTWARE
```

podle:
```
platformSoftware:
  label: Platformní software
```

Teprve pokud sekce kombinuje více slotů:
```
INFRASTRUKTURNÍ SLUŽBY

Používá
...
Poskytuje
...
```

potřebuje CardDefinition vlastní section label:
```
- id: services
  label: Infrastrukturní služby

  slots:
    - consumedTechnologyServices
    - providedTechnologyServices
```

Tím zase odstraníme duplicitu.

## Dostáváme jednoduché pravidlo fallbacků

Renderer může při hledání textu postupovat:
```
explicit presentation override
        ↓ pokud není
PresentationProfile / Slot label
        ↓ pokud není
schema label
        ↓ pokud není
technical identifier
```

U property bych dokonce defaultoval ještě přísněji:
```
schema label
        ↓
explicit UI override
```

tj. profile vůbec nemusí mít label.

Například:
```
fields:
  - lifecycle
  - criticality
  - hostname
```

je podle mě ideální.

## V praxi by tedy Server mohl být podstatně stručnější

Místo:
```
fields:

  hostname:
    source: property.hostname
    type: string

  environment:
    source: property.environment
    type: enum
    values:
      - production
      - test
```

jen:
```
fields:
  - hostname
  - environment
  - criticality
  - ipAddresses
```

Schema už ví všechno ostatní:
```
label
description
datatype
allowed values
value labels
validation
```

A CardDefinition:
```
sections:

  - id: basic
    fields:
      - hostname
      - fqdn
      - environment
      - criticality
      - ipAddresses
```

To je přesně směr, který bych doporučil:**PresentationProfile má být spíš sada referencí a doménových vazeb než druhé schema.**

Jediné texty, které bych v něm očekával pravidelně, jsou hlavně:

- název samotného profilu, např.`Aplikace`,`Server`,`Osoba`,
- názvy`RelationSlot`a`PathSlot`, protože vyjadřují kontextový/doménový význam,
- případně specifický popis profilu.

Všechno ostatní bych se snažil tahat ze schema repository.

