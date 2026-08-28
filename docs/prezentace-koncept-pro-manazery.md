---
marp: true
theme: default
paginate: true
size: 16:9
html: true
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
  svg.diagram {
    display: block;
    margin: 0.35em auto;
    max-width: 100%;
    height: auto;
  }
  svg.diagram-wide {
    width: 100%;
    max-height: 220px;
  }
  svg.diagram-flow {
    max-height: 300px;
  }
  svg.diagram-hub {
    max-height: 260px;
  }
  svg.diagram-screen {
    width: 100%;
    max-height: 380px;
  }
  .screen-caption {
    font-size: 0.85em;
    color: #5a6a7a;
    margin-top: 0.15em;
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

<svg class="diagram diagram-wide" viewBox="0 0 920 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Vertikála: organizace, business, aplikace, infrastruktura">
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" fill="#0f3d5c"/>
    </marker>
  </defs>
  <!-- columns -->
  <rect x="8" y="8" width="200" height="184" rx="10" fill="#e8f1f6" stroke="#0f3d5c" stroke-width="1.5"/>
  <rect x="244" y="8" width="200" height="184" rx="10" fill="#eef6ec" stroke="#2d6a4f" stroke-width="1.5"/>
  <rect x="480" y="8" width="200" height="184" rx="10" fill="#f5f0e8" stroke="#8a6a2f" stroke-width="1.5"/>
  <rect x="716" y="8" width="196" height="184" rx="10" fill="#f3eef6" stroke="#5c3d7a" stroke-width="1.5"/>
  <!-- titles -->
  <text x="108" y="36" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="15" font-weight="700" fill="#0f3d5c">ORGANIZACE</text>
  <text x="344" y="36" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="15" font-weight="700" fill="#2d6a4f">BUSINESS</text>
  <text x="580" y="36" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="15" font-weight="700" fill="#8a6a2f">APLIKACE</text>
  <text x="814" y="36" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="15" font-weight="700" fill="#5c3d7a">INFRASTRUKTURA</text>
  <!-- items -->
  <text x="108" y="72" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="13" fill="#1a2332">Útvar / osoba</text>
  <text x="108" y="96" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="13" fill="#1a2332">Role</text>
  <text x="344" y="72" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="13" fill="#1a2332">Funkce / proces</text>
  <text x="344" y="96" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="13" fill="#1a2332">Business služba</text>
  <text x="580" y="72" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="13" fill="#1a2332">Aplikační služba</text>
  <text x="580" y="96" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="13" fill="#1a2332">Aplikace / data</text>
  <text x="814" y="68" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" fill="#1a2332">Platforma / runtime</text>
  <text x="814" y="90" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" fill="#1a2332">Uzel / cluster</text>
  <text x="814" y="112" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" fill="#1a2332">Síť / zařízení</text>
  <text x="814" y="134" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" fill="#1a2332">Areál / lokace</text>
  <!-- arrows between columns -->
  <line x1="208" y1="100" x2="244" y2="100" stroke="#0f3d5c" stroke-width="2" marker-end="url(#arrow)"/>
  <line x1="444" y1="100" x2="480" y2="100" stroke="#0f3d5c" stroke-width="2" marker-end="url(#arrow)"/>
  <line x1="680" y1="100" x2="716" y2="100" stroke="#0f3d5c" stroke-width="2" marker-end="url(#arrow)"/>
</svg>

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

<svg class="diagram diagram-flow" viewBox="0 0 640 250" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="FaceUP realizuje službu, která slouží business funkci">
  <defs>
    <marker id="arrow2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" fill="#0f3d5c"/>
    </marker>
  </defs>
  <rect x="120" y="8" width="400" height="48" rx="8" fill="#f5f0e8" stroke="#8a6a2f" stroke-width="1.5"/>
  <text x="320" y="28" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="15" font-weight="700" fill="#1a2332">FaceUP</text>
  <text x="320" y="46" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" fill="#5a6a7a">Application Component</text>

  <line x1="320" y1="56" x2="320" y2="84" stroke="#0f3d5c" stroke-width="2" marker-end="url(#arrow2)"/>
  <text x="336" y="76" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" fill="#0f3d5c">Realization</text>

  <rect x="80" y="90" width="480" height="48" rx="8" fill="#f5f0e8" stroke="#8a6a2f" stroke-width="1.5"/>
  <text x="320" y="110" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="15" font-weight="700" fill="#1a2332">Whistleblowing Case Management</text>
  <text x="320" y="128" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" fill="#5a6a7a">Application Service</text>

  <line x1="320" y1="138" x2="320" y2="166" stroke="#0f3d5c" stroke-width="2" marker-end="url(#arrow2)"/>
  <text x="336" y="158" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" fill="#0f3d5c">Serving („podporuje“)</text>

  <rect x="100" y="172" width="440" height="48" rx="8" fill="#eef6ec" stroke="#2d6a4f" stroke-width="1.5"/>
  <text x="320" y="192" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="15" font-weight="700" fill="#1a2332">Whistleblowing Management</text>
  <text x="320" y="210" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" fill="#5a6a7a">Business Function</text>
</svg>

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

<svg class="diagram diagram-flow" viewBox="0 0 640 320" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Eramba přes Kubernetes a cluster k síti a DC">
  <defs>
    <marker id="arrow3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" fill="#0f3d5c"/>
    </marker>
  </defs>
  <rect x="140" y="4" width="360" height="40" rx="8" fill="#f5f0e8" stroke="#8a6a2f" stroke-width="1.5"/>
  <text x="320" y="22" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="14" font-weight="700" fill="#1a2332">GRC Eramba</text>
  <text x="320" y="38" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" fill="#5a6a7a">Application Component</text>

  <line x1="320" y1="44" x2="320" y2="64" stroke="#0f3d5c" stroke-width="2" marker-end="url(#arrow3)"/>
  <text x="336" y="60" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" fill="#0f3d5c">DeployedOn</text>

  <rect x="140" y="68" width="360" height="40" rx="8" fill="#f3eef6" stroke="#5c3d7a" stroke-width="1.5"/>
  <text x="320" y="86" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="14" font-weight="700" fill="#1a2332">Kubernetes</text>
  <text x="320" y="102" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" fill="#5a6a7a">System Software</text>

  <line x1="320" y1="108" x2="320" y2="128" stroke="#0f3d5c" stroke-width="2" marker-end="url(#arrow3)"/>
  <text x="336" y="124" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" fill="#0f3d5c">Assignment</text>

  <rect x="140" y="132" width="360" height="40" rx="8" fill="#f3eef6" stroke="#5c3d7a" stroke-width="1.5"/>
  <text x="320" y="150" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="14" font-weight="700" fill="#1a2332">prod-cluster</text>
  <text x="320" y="166" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" fill="#5a6a7a">Node</text>

  <line x1="320" y1="172" x2="320" y2="192" stroke="#0f3d5c" stroke-width="2" marker-end="url(#arrow3)"/>
  <text x="336" y="188" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" fill="#0f3d5c">memberOf / connectedTo</text>

  <rect x="140" y="196" width="360" height="40" rx="8" fill="#f3eef6" stroke="#5c3d7a" stroke-width="1.5"/>
  <text x="320" y="214" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="14" font-weight="700" fill="#1a2332">APP_NET</text>
  <text x="320" y="230" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" fill="#5a6a7a">Communication Network</text>

  <line x1="320" y1="236" x2="320" y2="256" stroke="#0f3d5c" stroke-width="2" marker-end="url(#arrow3)"/>

  <rect x="100" y="260" width="280" height="40" rx="8" fill="#f3eef6" stroke="#5c3d7a" stroke-width="1.5"/>
  <text x="240" y="278" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="14" font-weight="700" fill="#1a2332">DC Praha</text>
  <text x="240" y="294" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" fill="#5a6a7a">Facility</text>
  <line x1="380" y1="280" x2="430" y2="280" stroke="#0f3d5c" stroke-width="2" marker-end="url(#arrow3)"/>
  <rect x="430" y="260" width="160" height="40" rx="8" fill="#f3eef6" stroke="#5c3d7a" stroke-width="1.5"/>
  <text x="510" y="285" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="14" font-weight="700" fill="#1a2332">Location</text>
</svg>

Platformní služby (DB, IdP) podporují aplikaci přes **Serving** — stejně srozumitelně jako aplikační služby podporují byznys.

---

# Příklad: celá cesta „Compliance → Eramba → cluster“

<svg class="diagram diagram-wide" viewBox="0 0 900 230" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Cesta od odboru Compliance přes Erambu k infrastruktuře">
  <defs>
    <marker id="arrow4" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" fill="#0f3d5c"/>
    </marker>
    <marker id="arrow4up" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" fill="#2d6a4f"/>
    </marker>
  </defs>
  <!-- business row -->
  <rect x="20" y="16" width="150" height="44" rx="8" fill="#e8f1f6" stroke="#0f3d5c" stroke-width="1.5"/>
  <text x="95" y="43" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="13" font-weight="700" fill="#1a2332">Odbor Compliance</text>
  <line x1="170" y1="38" x2="200" y2="38" stroke="#0f3d5c" stroke-width="2" marker-end="url(#arrow4)"/>
  <rect x="200" y="16" width="70" height="44" rx="8" fill="#e8f1f6" stroke="#0f3d5c" stroke-width="1.5"/>
  <text x="235" y="43" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="13" font-weight="700" fill="#1a2332">DPO</text>
  <line x1="270" y1="38" x2="300" y2="38" stroke="#0f3d5c" stroke-width="2" marker-end="url(#arrow4)"/>
  <rect x="300" y="16" width="240" height="44" rx="8" fill="#eef6ec" stroke="#2d6a4f" stroke-width="1.5"/>
  <text x="420" y="43" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="13" font-weight="700" fill="#1a2332">ZoKI Compliance Mgmt</text>

  <!-- serving up from app -->
  <line x1="420" y1="110" x2="420" y2="60" stroke="#2d6a4f" stroke-width="2" marker-end="url(#arrow4up)"/>
  <text x="436" y="90" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" fill="#2d6a4f">Serving</text>

  <!-- app row -->
  <rect x="300" y="114" width="140" height="40" rx="8" fill="#f5f0e8" stroke="#8a6a2f" stroke-width="1.5"/>
  <text x="370" y="132" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" font-weight="700" fill="#1a2332">GRC Support</text>
  <text x="370" y="148" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="10" fill="#5a6a7a">App Service</text>
  <line x1="300" y1="134" x2="250" y2="134" stroke="#0f3d5c" stroke-width="2" marker-end="url(#arrow4)"/>
  <text x="255" y="124" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="10" fill="#0f3d5c">←</text>
  <rect x="80" y="114" width="170" height="40" rx="8" fill="#f5f0e8" stroke="#8a6a2f" stroke-width="1.5"/>
  <text x="165" y="132" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" font-weight="700" fill="#1a2332">Eramba</text>
  <text x="165" y="148" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="10" fill="#5a6a7a">App Component</text>

  <!-- deploy down -->
  <line x1="165" y1="154" x2="165" y2="178" stroke="#0f3d5c" stroke-width="2" marker-end="url(#arrow4)"/>
  <text x="176" y="172" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="10" fill="#0f3d5c">DeployedOn</text>

  <!-- infra row -->
  <rect x="40" y="182" width="120" height="36" rx="8" fill="#f3eef6" stroke="#5c3d7a" stroke-width="1.5"/>
  <text x="100" y="205" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" font-weight="700" fill="#1a2332">Kubernetes</text>
  <line x1="160" y1="200" x2="190" y2="200" stroke="#0f3d5c" stroke-width="2" marker-end="url(#arrow4)"/>
  <rect x="190" y="182" width="120" height="36" rx="8" fill="#f3eef6" stroke="#5c3d7a" stroke-width="1.5"/>
  <text x="250" y="205" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" font-weight="700" fill="#1a2332">prod-cluster</text>
  <line x1="310" y1="200" x2="340" y2="200" stroke="#0f3d5c" stroke-width="2" marker-end="url(#arrow4)"/>
  <rect x="340" y="182" width="100" height="36" rx="8" fill="#f3eef6" stroke="#5c3d7a" stroke-width="1.5"/>
  <text x="390" y="205" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" font-weight="700" fill="#1a2332">APP_NET</text>
  <line x1="440" y1="200" x2="470" y2="200" stroke="#0f3d5c" stroke-width="2" marker-end="url(#arrow4)"/>
  <rect x="470" y="182" width="70" height="36" rx="8" fill="#f3eef6" stroke="#5c3d7a" stroke-width="1.5"/>
  <text x="505" y="205" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" font-weight="700" fill="#1a2332">DC</text>
</svg>

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

<svg class="diagram diagram-wide" viewBox="0 0 940 130" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Sloupcové procházení od organizace po lokaci">
  <defs>
    <marker id="arrow5" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" fill="#0f3d5c"/>
    </marker>
  </defs>
  <!-- row 1 -->
  <rect x="8" y="10" width="100" height="36" rx="6" fill="#e8f1f6" stroke="#0f3d5c"/>
  <text x="58" y="33" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" font-weight="600" fill="#1a2332">Organizace</text>
  <line x1="108" y1="28" x2="124" y2="28" stroke="#0f3d5c" stroke-width="1.5" marker-end="url(#arrow5)"/>
  <rect x="124" y="10" width="100" height="36" rx="6" fill="#e8f1f6" stroke="#0f3d5c"/>
  <text x="174" y="33" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" font-weight="600" fill="#1a2332">Role / Osoba</text>
  <line x1="224" y1="28" x2="240" y2="28" stroke="#0f3d5c" stroke-width="1.5" marker-end="url(#arrow5)"/>
  <rect x="240" y="10" width="80" height="36" rx="6" fill="#eef6ec" stroke="#2d6a4f"/>
  <text x="280" y="33" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" font-weight="600" fill="#1a2332">Funkce</text>
  <line x1="320" y1="28" x2="336" y2="28" stroke="#0f3d5c" stroke-width="1.5" marker-end="url(#arrow5)"/>
  <rect x="336" y="10" width="80" height="36" rx="6" fill="#eef6ec" stroke="#2d6a4f"/>
  <text x="376" y="33" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" font-weight="600" fill="#1a2332">Proces</text>
  <line x1="416" y1="28" x2="432" y2="28" stroke="#0f3d5c" stroke-width="1.5" marker-end="url(#arrow5)"/>
  <rect x="432" y="10" width="130" height="36" rx="6" fill="#eef6ec" stroke="#2d6a4f"/>
  <text x="497" y="33" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" font-weight="600" fill="#1a2332">Business služba</text>
  <line x1="562" y1="28" x2="578" y2="28" stroke="#0f3d5c" stroke-width="1.5" marker-end="url(#arrow5)"/>
  <rect x="578" y="10" width="100" height="36" rx="6" fill="#f5f0e8" stroke="#8a6a2f"/>
  <text x="628" y="33" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" font-weight="600" fill="#1a2332">App služba</text>
  <line x1="678" y1="28" x2="694" y2="28" stroke="#0f3d5c" stroke-width="1.5" marker-end="url(#arrow5)"/>
  <rect x="694" y="10" width="90" height="36" rx="6" fill="#f5f0e8" stroke="#8a6a2f"/>
  <text x="739" y="33" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" font-weight="600" fill="#1a2332">Aplikace</text>

  <!-- row 2 -->
  <line x1="739" y1="46" x2="739" y2="68" stroke="#0f3d5c" stroke-width="1.5" marker-end="url(#arrow5)"/>
  <rect x="200" y="74" width="130" height="36" rx="6" fill="#f3eef6" stroke="#5c3d7a"/>
  <text x="265" y="97" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" font-weight="600" fill="#1a2332">System Software</text>
  <line x1="330" y1="92" x2="350" y2="92" stroke="#0f3d5c" stroke-width="1.5" marker-end="url(#arrow5)"/>
  <rect x="350" y="74" width="70" height="36" rx="6" fill="#f3eef6" stroke="#5c3d7a"/>
  <text x="385" y="97" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" font-weight="600" fill="#1a2332">Node</text>
  <line x1="420" y1="92" x2="440" y2="92" stroke="#0f3d5c" stroke-width="1.5" marker-end="url(#arrow5)"/>
  <rect x="440" y="74" width="110" height="36" rx="6" fill="#f3eef6" stroke="#5c3d7a"/>
  <text x="495" y="97" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" font-weight="600" fill="#1a2332">Síť / Device</text>
  <line x1="550" y1="92" x2="570" y2="92" stroke="#0f3d5c" stroke-width="1.5" marker-end="url(#arrow5)"/>
  <rect x="570" y="74" width="150" height="36" rx="6" fill="#f3eef6" stroke="#5c3d7a"/>
  <text x="645" y="97" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" font-weight="600" fill="#1a2332">Facility / Location</text>
  <path d="M739 68 L739 92 L570 92" fill="none" stroke="#0f3d5c" stroke-width="1.5"/>
</svg>

- **progressive disclosure** — nevidíte celý graf najednou
- nahoře **cesta fokusem** (breadcrumb grafem)
- stejná data, různé **šablony průchodu**:
  - business exploration
  - dopad aplikace
  - infrastruktura / technologická závislost

Klasický diagram je **doplňkový** pohled — ne hlavní způsob práce.

---

# Navigace v aplikaci — obrazovka 1

Klikáte zleva doprava. Výběr omezí další sloupec. Nahoře vzniká **cesta fokusem**.

<svg class="diagram diagram-screen" viewBox="0 0 960 360" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Obrazovka 1: výběr Compliance, DPO a připravený klik na Data Protection">
  <!-- window chrome -->
  <rect x="4" y="4" width="952" height="352" rx="10" fill="#f4f6f8" stroke="#9aa8b5" stroke-width="1.5"/>
  <rect x="4" y="4" width="952" height="36" rx="10" fill="#0f3d5c"/>
  <rect x="4" y="24" width="952" height="16" fill="#0f3d5c"/>
  <circle cx="24" cy="22" r="5" fill="#e8a0a0"/>
  <circle cx="42" cy="22" r="5" fill="#e8d48a"/>
  <circle cx="60" cy="22" r="5" fill="#9ec9a0"/>
  <text x="480" y="26" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="13" font-weight="600" fill="#ffffff">IT Map — Browser</text>

  <!-- focus path -->
  <rect x="16" y="48" width="700" height="28" rx="6" fill="#ffffff" stroke="#c5d0da"/>
  <text x="28" y="67" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" fill="#5a6a7a">Cesta:</text>
  <text x="72" y="67" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" font-weight="600" fill="#0f3d5c">OTE</text>
  <text x="100" y="67" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" fill="#9aa8b5">›</text>
  <text x="114" y="67" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" font-weight="600" fill="#0f3d5c">Compliance</text>
  <text x="198" y="67" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" fill="#9aa8b5">›</text>
  <text x="212" y="67" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" font-weight="600" fill="#0f3d5c">Petr Novák</text>
  <text x="286" y="67" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" fill="#9aa8b5">›</text>
  <text x="300" y="67" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" font-weight="700" fill="#c45c26">DPO</text>
  <text x="332" y="67" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" fill="#9aa8b5">› …</text>

  <!-- template chip -->
  <rect x="730" y="48" width="210" height="28" rx="6" fill="#e8f1f6" stroke="#0f3d5c"/>
  <text x="835" y="67" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" fill="#0f3d5c">Šablona: Business exploration</text>

  <!-- columns area -->
  <rect x="16" y="88" width="700" height="248" rx="8" fill="#ffffff" stroke="#c5d0da"/>

  <!-- col 1 Organization -->
  <rect x="24" y="96" width="160" height="232" rx="6" fill="#f8fafb" stroke="#d5dee6"/>
  <rect x="24" y="96" width="160" height="28" rx="6" fill="#e8f1f6"/>
  <rect x="24" y="112" width="160" height="12" fill="#e8f1f6"/>
  <text x="104" y="115" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" font-weight="700" fill="#0f3d5c">Organizace</text>
  <text x="36" y="148" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" fill="#5a6a7a">Finance</text>
  <text x="36" y="172" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" fill="#5a6a7a">Legal</text>
  <rect x="32" y="184" width="144" height="26" rx="4" fill="#0f3d5c"/>
  <text x="40" y="202" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" font-weight="700" fill="#ffffff">● Compliance</text>
  <text x="36" y="232" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" fill="#5a6a7a">IT</text>

  <!-- col 2 Role/Person -->
  <rect x="192" y="96" width="160" height="232" rx="6" fill="#f8fafb" stroke="#d5dee6"/>
  <rect x="192" y="96" width="160" height="28" rx="6" fill="#e8f1f6"/>
  <rect x="192" y="112" width="160" height="12" fill="#e8f1f6"/>
  <text x="272" y="115" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" font-weight="700" fill="#0f3d5c">Role / Osoba</text>
  <text x="204" y="148" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" fill="#5a6a7a">Petr Novák</text>
  <text x="204" y="166" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="10" fill="#9aa8b5"> osoba</text>
  <rect x="200" y="178" width="144" height="26" rx="4" fill="#0f3d5c"/>
  <text x="208" y="196" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" font-weight="700" fill="#ffffff">● DPO</text>
  <text x="204" y="224" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" fill="#5a6a7a">Compliance Officer</text>
  <text x="204" y="248" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" fill="#5a6a7a">Vedoucí odboru</text>

  <!-- col 3 Functions -->
  <rect x="360" y="96" width="170" height="232" rx="6" fill="#f8fafb" stroke="#d5dee6"/>
  <rect x="360" y="96" width="170" height="28" rx="6" fill="#eef6ec"/>
  <rect x="360" y="112" width="170" height="12" fill="#eef6ec"/>
  <text x="445" y="115" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" font-weight="700" fill="#2d6a4f">Funkce (DPO)</text>
  <rect x="368" y="136" width="154" height="26" rx="4" fill="#fff4ec" stroke="#c45c26" stroke-width="2"/>
  <text x="376" y="154" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" font-weight="700" fill="#c45c26">○ Data Protection</text>
  <text x="376" y="182" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" fill="#5a6a7a">ZoKI Compliance</text>
  <text x="376" y="206" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" fill="#5a6a7a">Whistleblowing</text>
  <!-- click hint -->
  <path d="M520 148 L545 135 L545 142 L570 142 L570 154 L545 154 L545 161 Z" fill="#c45c26"/>
  <text x="545" y="128" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="10" font-weight="700" fill="#c45c26">klik</text>

  <!-- col 4 placeholder -->
  <rect x="538" y="96" width="168" height="232" rx="6" fill="#eef1f4" stroke="#d5dee6" stroke-dasharray="4 3"/>
  <text x="622" y="200" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" fill="#9aa8b5">další sloupec</text>
  <text x="622" y="218" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" fill="#9aa8b5">po výběru →</text>

  <!-- inspector -->
  <rect x="728" y="88" width="212" height="248" rx="8" fill="#ffffff" stroke="#c5d0da"/>
  <rect x="728" y="88" width="212" height="28" rx="8" fill="#f0f3f6"/>
  <rect x="728" y="104" width="212" height="12" fill="#f0f3f6"/>
  <text x="834" y="107" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" font-weight="700" fill="#5a6a7a">Inspector</text>
  <text x="744" y="140" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="13" font-weight="700" fill="#1a2332">DPO</text>
  <text x="744" y="160" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" fill="#5a6a7a">typ: Business Role</text>
  <text x="744" y="186" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" fill="#5a6a7a">Assigned through:</text>
  <text x="744" y="204" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" fill="#0f3d5c">Petr Novák</text>
  <text x="744" y="236" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" fill="#5a6a7a">Funkce: 3 · Apps: —</text>
  <rect x="744" y="260" width="180" height="28" rx="6" fill="#e8f1f6" stroke="#0f3d5c"/>
  <text x="834" y="279" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" font-weight="600" fill="#0f3d5c">+ Přidat…</text>
</svg>

<p class="screen-caption">Krok: útvar → osoba/role → nabídka funkcí přiřazených roli DPO. Další sloupec ještě čeká na výběr.</p>

---

# Navigace v aplikaci — obrazovka 2

Po kliknutí na **Data Protection** se otevře další vrstva: procesy a podpora aplikacemi.

<svg class="diagram diagram-screen" viewBox="0 0 960 360" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Obrazovka 2: Data Protection vybraná, procesy a aplikační podpora">
  <!-- window chrome -->
  <rect x="4" y="4" width="952" height="352" rx="10" fill="#f4f6f8" stroke="#9aa8b5" stroke-width="1.5"/>
  <rect x="4" y="4" width="952" height="36" rx="10" fill="#0f3d5c"/>
  <rect x="4" y="24" width="952" height="16" fill="#0f3d5c"/>
  <circle cx="24" cy="22" r="5" fill="#e8a0a0"/>
  <circle cx="42" cy="22" r="5" fill="#e8d48a"/>
  <circle cx="60" cy="22" r="5" fill="#9ec9a0"/>
  <text x="480" y="26" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="13" font-weight="600" fill="#ffffff">IT Map — Browser</text>

  <!-- focus path extended -->
  <rect x="16" y="48" width="700" height="28" rx="6" fill="#ffffff" stroke="#c5d0da"/>
  <text x="28" y="67" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" fill="#5a6a7a">Cesta:</text>
  <text x="68" y="67" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" fill="#0f3d5c">OTE › Compliance › Petr Novák › DPO ›</text>
  <text x="368" y="67" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" font-weight="700" fill="#c45c26">Data Protection</text>
  <text x="478" y="67" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" fill="#9aa8b5">› Handle DSR</text>

  <rect x="730" y="48" width="210" height="28" rx="6" fill="#e8f1f6" stroke="#0f3d5c"/>
  <text x="835" y="67" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" fill="#0f3d5c">Šablona: Business exploration</text>

  <rect x="16" y="88" width="700" height="248" rx="8" fill="#ffffff" stroke="#c5d0da"/>

  <!-- col Function (selected context, narrower scroll feel - show last org cols condensed) -->
  <rect x="24" y="96" width="130" height="232" rx="6" fill="#f8fafb" stroke="#d5dee6"/>
  <rect x="24" y="96" width="130" height="28" rx="6" fill="#e8f1f6"/>
  <rect x="24" y="112" width="130" height="12" fill="#e8f1f6"/>
  <text x="89" y="115" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="10" font-weight="700" fill="#0f3d5c">Role / Osoba</text>
  <text x="36" y="148" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" fill="#5a6a7a">Petr Novák</text>
  <rect x="32" y="160" width="114" height="24" rx="4" fill="#0f3d5c"/>
  <text x="40" y="176" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" font-weight="700" fill="#ffffff">● DPO</text>
  <text x="36" y="204" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" fill="#5a6a7a">Officer</text>

  <!-- col Functions -->
  <rect x="162" y="96" width="150" height="232" rx="6" fill="#f8fafb" stroke="#d5dee6"/>
  <rect x="162" y="96" width="150" height="28" rx="6" fill="#eef6ec"/>
  <rect x="162" y="112" width="150" height="12" fill="#eef6ec"/>
  <text x="237" y="115" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="10" font-weight="700" fill="#2d6a4f">Funkce</text>
  <rect x="170" y="136" width="134" height="26" rx="4" fill="#2d6a4f"/>
  <text x="178" y="154" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" font-weight="700" fill="#ffffff">● Data Protection</text>
  <text x="178" y="182" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" fill="#5a6a7a">ZoKI Compliance</text>
  <text x="178" y="206" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" fill="#5a6a7a">Whistleblowing</text>

  <!-- col Processes -->
  <rect x="320" y="96" width="160" height="232" rx="6" fill="#f8fafb" stroke="#d5dee6"/>
  <rect x="320" y="96" width="160" height="28" rx="6" fill="#eef6ec"/>
  <rect x="320" y="112" width="160" height="12" fill="#eef6ec"/>
  <text x="400" y="115" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="10" font-weight="700" fill="#2d6a4f">Procesy</text>
  <rect x="328" y="136" width="144" height="26" rx="4" fill="#0f3d5c"/>
  <text x="336" y="154" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" font-weight="700" fill="#ffffff">● Handle DSR</text>
  <text x="336" y="182" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" fill="#5a6a7a">DPIA</text>
  <text x="336" y="206" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" fill="#5a6a7a">Breach Handling</text>
  <text x="336" y="230" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" fill="#5a6a7a">Audit support</text>
  <text x="336" y="260" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="10" fill="#9aa8b5">Processes 4</text>

  <!-- col App support -->
  <rect x="488" y="96" width="216" height="232" rx="6" fill="#f8fafb" stroke="#d5dee6"/>
  <rect x="488" y="96" width="216" height="28" rx="6" fill="#f5f0e8"/>
  <rect x="488" y="112" width="216" height="12" fill="#f5f0e8"/>
  <text x="596" y="115" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="10" font-weight="700" fill="#8a6a2f">Podpora (App)</text>
  <text x="500" y="148" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" font-weight="600" fill="#1a2332">Case Management</text>
  <text x="500" y="164" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="10" fill="#5a6a7a">App Service  ·  Serving</text>
  <text x="500" y="186" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" fill="#8a6a2f">← GRC Eramba</text>
  <text x="500" y="202" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="10" fill="#5a6a7a">Application Component</text>
  <line x1="500" y1="216" x2="688" y2="216" stroke="#e0e6eb"/>
  <text x="500" y="238" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" fill="#5a6a7a">Document Mgmt</text>
  <text x="500" y="254" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="10" fill="#5a6a7a">← SharePoint</text>
  <text x="500" y="286" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="10" fill="#9aa8b5">Apps 2 · dál: runtime / Node…</text>

  <!-- inspector -->
  <rect x="728" y="88" width="212" height="248" rx="8" fill="#ffffff" stroke="#c5d0da"/>
  <rect x="728" y="88" width="212" height="28" rx="8" fill="#f0f3f6"/>
  <rect x="728" y="104" width="212" height="12" fill="#f0f3f6"/>
  <text x="834" y="107" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" font-weight="700" fill="#5a6a7a">Inspector</text>
  <text x="744" y="140" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="13" font-weight="700" fill="#1a2332">Data Protection</text>
  <text x="744" y="160" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" fill="#5a6a7a">typ: Business Function</text>
  <text x="744" y="186" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" fill="#5a6a7a">Assignment ← DPO</text>
  <text x="744" y="210" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" fill="#5a6a7a">Processes 4</text>
  <text x="744" y="228" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" fill="#5a6a7a">App services 2</text>
  <text x="744" y="246" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" fill="#5a6a7a">Owners 1</text>
  <rect x="744" y="268" width="180" height="28" rx="6" fill="#e8f1f6" stroke="#0f3d5c"/>
  <text x="834" y="287" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" font-weight="600" fill="#0f3d5c">+ Přidat proces / app…</text>

  <!-- transition badge -->
  <rect x="16" y="330" width="200" height="0" fill="none"/>
</svg>

<p class="screen-caption">Stejný model, další sloupce: procesy funkce a aplikace, které je podporují. Dál lze pokračovat na runtime / cluster.</p>

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

<svg class="diagram diagram-hub" viewBox="0 0 780 240" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Knowledge Core uprostřed, kolem IT Map, agenti a integrace">
  <defs>
    <marker id="arrow6" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" fill="#0f3d5c"/>
    </marker>
  </defs>
  <rect x="200" y="16" width="380" height="70" rx="12" fill="#e8f1f6" stroke="#0f3d5c" stroke-width="2"/>
  <text x="390" y="46" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="16" font-weight="700" fill="#0f3d5c">Knowledge Core (model)</text>
  <text x="390" y="68" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" fill="#5a6a7a">entity · vztahy · verze · kdo</text>

  <line x1="280" y1="86" x2="130" y2="130" stroke="#0f3d5c" stroke-width="2" marker-end="url(#arrow6)"/>
  <line x1="390" y1="86" x2="390" y2="130" stroke="#0f3d5c" stroke-width="2" marker-end="url(#arrow6)"/>
  <line x1="500" y1="86" x2="650" y2="130" stroke="#0f3d5c" stroke-width="2" marker-end="url(#arrow6)"/>

  <rect x="30" y="136" width="200" height="84" rx="10" fill="#fff" stroke="#0f3d5c" stroke-width="1.5"/>
  <text x="130" y="162" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="14" font-weight="700" fill="#1a2332">IT Map (lidé)</text>
  <text x="130" y="184" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" fill="#5a6a7a">prohlížení</text>
  <text x="130" y="202" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" fill="#5a6a7a">editace</text>

  <rect x="290" y="136" width="200" height="84" rx="10" fill="#fff" stroke="#2d6a4f" stroke-width="1.5"/>
  <text x="390" y="162" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="14" font-weight="700" fill="#1a2332">Agenti / AI</text>
  <text x="390" y="184" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" fill="#5a6a7a">návrhy změn</text>
  <text x="390" y="202" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" fill="#5a6a7a">generované výstupy</text>

  <rect x="550" y="136" width="200" height="84" rx="10" fill="#fff" stroke="#5c3d7a" stroke-width="1.5"/>
  <text x="650" y="158" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="13" font-weight="700" fill="#1a2332">Integrace</text>
  <text x="650" y="178" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" fill="#5a6a7a">CI, CMDB, K8s…</text>
  <text x="650" y="196" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" fill="#5a6a7a">pozorovaný stav</text>
  <text x="650" y="212" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" fill="#5a6a7a">zpětná projekce</text>
</svg>

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

<svg class="diagram diagram-flow" viewBox="0 0 620 260" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Tok od vstupu přes agenta a schválení k release">
  <defs>
    <marker id="arrow7" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" fill="#0f3d5c"/>
    </marker>
  </defs>
  <rect x="150" y="8" width="320" height="40" rx="8" fill="#e8f1f6" stroke="#0f3d5c" stroke-width="1.5"/>
  <text x="310" y="33" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="14" font-weight="600" fill="#1a2332">Vstup (text / návrh)</text>

  <line x1="310" y1="48" x2="310" y2="70" stroke="#0f3d5c" stroke-width="2" marker-end="url(#arrow7)"/>

  <rect x="80" y="74" width="300" height="40" rx="8" fill="#eef6ec" stroke="#2d6a4f" stroke-width="1.5"/>
  <text x="230" y="99" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="13" font-weight="600" fill="#1a2332">Agent navrhne entity + vztahy</text>
  <line x1="380" y1="94" x2="420" y2="94" stroke="#0f3d5c" stroke-width="2" marker-end="url(#arrow7)"/>
  <rect x="420" y="74" width="160" height="40" rx="8" fill="#f5f0e8" stroke="#8a6a2f" stroke-width="1.5"/>
  <text x="500" y="99" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="13" font-weight="600" fill="#1a2332">ChangeSet v KC</text>

  <line x1="310" y1="114" x2="310" y2="136" stroke="#0f3d5c" stroke-width="2" marker-end="url(#arrow7)"/>

  <rect x="110" y="140" width="400" height="40" rx="8" fill="#fff" stroke="#0f3d5c" stroke-width="1.5"/>
  <text x="310" y="165" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="13" font-weight="600" fill="#1a2332">Architekt / vlastník zkontroluje a schválí</text>

  <line x1="310" y1="180" x2="310" y2="202" stroke="#0f3d5c" stroke-width="2" marker-end="url(#arrow7)"/>

  <rect x="150" y="206" width="320" height="40" rx="8" fill="#f3eef6" stroke="#5c3d7a" stroke-width="1.5"/>
  <text x="310" y="231" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="14" font-weight="700" fill="#1a2332">Nová verze / release modelu</text>
</svg>

Agent zrychluje **překlad reality do grafu** —  
nemění pravomoc rozhodnout, co je v modelu správně.

---

# 3) Zpětná vazba z reálného deploymentu

Provoz je často „napřed“ oproti dokumentaci. Agenti to srovnají:

<svg class="diagram diagram-flow" viewBox="0 0 640 280" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Zpětná projekce z provozu do modelu">
  <defs>
    <marker id="arrow8" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" fill="#0f3d5c"/>
    </marker>
  </defs>
  <rect x="100" y="8" width="440" height="40" rx="8" fill="#f3eef6" stroke="#5c3d7a" stroke-width="1.5"/>
  <text x="320" y="33" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="13" font-weight="600" fill="#1a2332">Kubernetes / CI / observabilita / CMDB</text>

  <line x1="320" y1="48" x2="320" y2="68" stroke="#0f3d5c" stroke-width="2" marker-end="url(#arrow8)"/>
  <text x="336" y="64" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" fill="#5a6a7a">pozorovaný stav</text>

  <rect x="70" y="76" width="500" height="40" rx="8" fill="#eef6ec" stroke="#2d6a4f" stroke-width="1.5"/>
  <text x="320" y="101" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="13" font-weight="600" fill="#1a2332">Agent mapuje na Node, System Software, DeployedOn, sítě…</text>

  <line x1="320" y1="116" x2="320" y2="140" stroke="#0f3d5c" stroke-width="2" marker-end="url(#arrow8)"/>

  <rect x="90" y="144" width="460" height="40" rx="8" fill="#f5f0e8" stroke="#8a6a2f" stroke-width="1.5"/>
  <text x="320" y="169" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="13" font-weight="600" fill="#1a2332">Návrh aktualizace modelu (diff)</text>

  <line x1="320" y1="184" x2="320" y2="208" stroke="#0f3d5c" stroke-width="2" marker-end="url(#arrow8)"/>

  <rect x="120" y="212" width="400" height="48" rx="8" fill="#e8f1f6" stroke="#0f3d5c" stroke-width="1.5"/>
  <text x="320" y="232" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="14" font-weight="700" fill="#1a2332">Schválení → model se přiblíží realitě</text>
  <text x="320" y="250" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" fill="#5a6a7a">s auditní stopou</text>
</svg>

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

<svg class="diagram diagram-hub" viewBox="0 0 720 300" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Model v KC, tři agentní cesty, ChangeSet, schválení, Release">
  <defs>
    <marker id="arrow9" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" fill="#0f3d5c"/>
    </marker>
  </defs>
  <rect x="20" y="70" width="140" height="70" rx="10" fill="#e8f1f6" stroke="#0f3d5c" stroke-width="2"/>
  <text x="90" y="100" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="13" font-weight="700" fill="#0f3d5c">Model v KC</text>
  <text x="90" y="120" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" fill="#5a6a7a">(zdroj pravdy)</text>

  <line x1="160" y1="90" x2="240" y2="40" stroke="#0f3d5c" stroke-width="1.5" marker-end="url(#arrow9)"/>
  <line x1="160" y1="105" x2="240" y2="105" stroke="#0f3d5c" stroke-width="1.5" marker-end="url(#arrow9)"/>
  <line x1="160" y1="120" x2="240" y2="170" stroke="#0f3d5c" stroke-width="1.5" marker-end="url(#arrow9)"/>

  <rect x="240" y="16" width="280" height="36" rx="8" fill="#fff" stroke="#2d6a4f" stroke-width="1.5"/>
  <text x="380" y="39" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" font-weight="600" fill="#1a2332">Generování výstupů</text>

  <rect x="240" y="86" width="280" height="36" rx="8" fill="#fff" stroke="#2d6a4f" stroke-width="1.5"/>
  <text x="380" y="109" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" font-weight="600" fill="#1a2332">Návrhy rozvoje (ze vstupů)</text>

  <rect x="240" y="156" width="280" height="36" rx="8" fill="#fff" stroke="#2d6a4f" stroke-width="1.5"/>
  <text x="380" y="179" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" font-weight="600" fill="#1a2332">Zpětná projekce (z deploymentu)</text>

  <line x1="520" y1="105" x2="560" y2="105" stroke="#0f3d5c" stroke-width="2"/>
  <line x1="560" y1="34" x2="560" y2="174" stroke="#0f3d5c" stroke-width="2"/>
  <line x1="560" y1="105" x2="580" y2="105" stroke="#0f3d5c" stroke-width="2" marker-end="url(#arrow9)"/>

  <rect x="580" y="50" width="120" height="50" rx="8" fill="#f5f0e8" stroke="#8a6a2f" stroke-width="1.5"/>
  <text x="640" y="72" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="11" font-weight="700" fill="#1a2332">ChangeSet</text>
  <text x="640" y="88" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="10" fill="#5a6a7a">+ provenance</text>

  <line x1="640" y1="100" x2="640" y2="130" stroke="#0f3d5c" stroke-width="2" marker-end="url(#arrow9)"/>

  <rect x="575" y="134" width="130" height="40" rx="8" fill="#fff" stroke="#0f3d5c" stroke-width="1.5"/>
  <text x="640" y="159" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="12" font-weight="600" fill="#1a2332">Schválení</text>

  <line x1="640" y1="174" x2="640" y2="204" stroke="#0f3d5c" stroke-width="2" marker-end="url(#arrow9)"/>

  <rect x="575" y="208" width="130" height="40" rx="8" fill="#f3eef6" stroke="#5c3d7a" stroke-width="1.5"/>
  <text x="640" y="233" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="13" font-weight="700" fill="#1a2332">Release</text>
</svg>

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
