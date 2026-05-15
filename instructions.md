You are a senior design systems specialist. Your task is to create a complete Figma file for the **Sarawak Design System**, a regional layer built on top of the **Malaysia Government Design System (MYDS)**.

**Core Philosophy:**
- **Structure & Behaviour = MYDS** (component API, spacing scale, radius, shadow, interaction patterns).
- **Visual Identity = Sarawak** (Trisakti palette, Pua Kumbu motifs, bilingual BM/EN labels, cultural sensitivity).
- All 37 MYDS components are inherited and reskinned. The Sarawak theme is applied as a token override layer – no component logic changes.
- Always use component properties and variants to reflect the states/variants table below.
- Use auto‑layout and Figma’s library features. Every component must be a publishable library component.

---

### 1. FILE STRUCTURE
Create four pages:
- **🎨 Foundations** (color styles, text styles, tokens, grid, spacing, shadows, motifs)
- **🧱 Components** (organised by Atomic level: Atoms / Molecules / Organisms; tag each frame with the MYDS component name)
- **🔄 Patterns** (assembled templates from MYDS patterns + Sarawak additions)
- **✦ AI Surfaces** (new 2026 AI interface components)

---

### 2. DESIGN TOKENS & STYLES
Publish all styles globally with the naming convention below.

#### 2.1 COLOUR STYLES
Create these exact colours as Figma colour styles (use the hex values given).

**Sarawak Trisakti (Flag) Palette**
- `srwk/merah` – #CC2020 – Primary actions, focus background
- `srwk/kuning` – #F4C417 – Focus ring, accent, highlights
- `srwk/hitam` – #1A1A1A – Dark surfaces, text primary

**Pua Kumbu Natural Dye Palette**
- `pua/rust` – #8B3A2A – Secondary dark, code backgrounds
- `pua/terra` – #C05A35 – Gradients, spotlight backgrounds
- `pua/indigo` – #2A3F6B – Info secondary, deep blue
- `pua/ivory` – #FBF7EE – Page surface (replaces MYDS white)
- `pua/cream` – #F5EDD8 – Muted background, table headers
- `pua/umber` – #4A2E1A – Code block backgrounds

**Kenyalang / Rainforest Semantic Palette**
- `horn/orange` – #E07A2A – Warning states (hornbill beak)
- `horn/green` – #2D6A3F – Success states (canopy)
- `horn/sky` – #3A6EA8 – Info states, links (Sarawak river)

**MYDS‑compatible Semantic Tokens** (use the same labels, but the Sarawak hex values)
- `bg/primary` → #CC2020
- `bg/primary-hover` → #A81A1A
- `bg/success` → #2D6A3F
- `bg/warning` → #E07A2A
- `bg/danger` → #C0392B (distinct danger red)
- `bg/info` → #3A6EA8
- `bg/surface` → #FBF7EE (pua‑ivory)
- `bg/muted` → #F5EDD8 (pua‑cream)
- `txt/900` → #1A1A1A
- `txt/700` → #3A3530
- `txt/500` → #6B5E52
- `txt/300` → #A89882
- `otl/default` → #D4C9B8
- `otl/strong` → #A8987E
- `fr/primary` → #F4C417 (gold focus ring)

#### 2.2 TYPOGRAPHY STYLES
| Style Name | Font Family | Weight | Size / Line‑height | Use |
|------------|-------------|--------|---------------------|-----|
| `head/display` | Poppins | 700 | clamp(2.1rem, 3.4vw, 3.1rem) / 1.15 | Hero title |
| `head/h1` | Poppins | 600 | 1.72rem / 1.25 | Section headings |
| `head/h2` | Poppins | 600 | 1.04rem / 1.25 | Sub‑section headings |
| `head/h3` | Poppins | 500 | 0.93rem / 1.25 | Card titles, panel headers |
| `body/large` | Noto Sans | 400 | 1.04rem / 1.75 | Inset text, intro paragraphs |
| `body/default` | Noto Sans | 400 | 1rem / 1.75 | Body copy |
| `body/small` | Noto Sans | 400 | 0.85rem / 1.55 | Supporting text, captions |
| `body/caption` | Noto Sans | 400 | 0.79rem / 1.4 | Labels, metadata |
| `mono/large` | IBM Plex Mono | 400 | 0.81rem / 1.75 | Code blocks |
| `mono/small` | IBM Plex Mono | 400 | 0.63rem / 1.4 | Inline code, tags |
| `label/uppercase` | IBM Plex Mono | 500 | 0.7rem / 1.4, letter‑spacing 0.1em | Section eyebrow, table headers |

#### 2.3 SPACING & RADIUS
- Spacing scale (base‑4, inherited from MYDS): 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80px.
- Radius scale: `r-sm`=4px, `r-md`=6px, `r-lg`=8px, `r-xl`=12px, `r-2xl`=16px, `r-full`=9999px.
- Shadows (use Figma effect styles):  
  `sh-sm` = 0 1px 2px rgba(26,26,26,0.08)  
  `sh-md` = 0 2px 8px rgba(26,26,26,0.10)  
  `sh-lg` = 0 4px 20px rgba(26,26,26,0.12)

#### 2.4 MOTIFS & DECORATIVE ELEMENTS
- **Trisakti stripe**: a 3–4px high rectangle that spans container width, with a gradient of merah (0‑40%), kuning (40‑60%), and transparent (60‑100%). Use as a decorative element only, never functional.
- **Pua Kumbu eight‑pointed star pattern**: create a tiling SVG component (opacity 0.07 – 0.12) that can be placed as a background overlay on dark containers (hero, sidebar). Provide as a separate `Pattern/Background` component.
- **Bunga Terung swirl**: a small 16×16px SVG used as a decorative accent on section dividers.

---

### 3. COMPONENT LIBRARY
Create every component listed below as a **Figma component** with auto‑layout and component properties (booleans, variants, instance swaps). Follow the MYDS naming but apply the Sarawak theme.  
All interactive components must include the **gold focus ring** (`fr/primary`) applied on `:focus-visible`. On white/ivory backgrounds, add a 2px black outer border to the focus ring to ensure 3:1 contrast.  
For citizen‑facing government interfaces, use **BM labels by default** (Bahasa Malaysia). Store English labels as a secondary property.

#### 3.1 ATOMS
- **Button**  
  - Variants: `primary-fill`, `primary-ghost`, `secondary-fill`, `danger-fill`  
  - Sizes: `small`, `medium`, `large`  
  - States: default, hover, focus, active, disabled, loading  
  - Additional props: icon (left/right), fullWidth, label text (BM + EN)
- **Text Input**  
  - States: default, focus (gold ring), error (danger border), disabled  
  - Include character count space, BM placeholder text
- **Tag / Pill**  
  - Variants: `default`, `primary` (merah), `success` (green), `warning` (orange), `danger`, `info`  
  - Optional dismiss icon
- **Checkbox**  
  - Checked fill: merah, focus: gold ring, indeterminate state
- **Radio**  
  - Selected dot: merah, focus: gold ring
- **Toggle / Switch**  
  - On: merah track, off: grey
- **Phase Banner**  
  - Fixed layout: yellow tag (“BETA”) + text + feedback link
- **Skip Link**  
  - Default hidden, on focus: merah background, white text
- **Trisakti Stripe** (Sarawak‑specific) – decorative only
- **Icon** – from the Sarawak icon library (provide a few sample instances)

#### 3.2 MOLECULES
- **Search Bar** – Input + search icon + clear button. BM placeholder “Cari…”
- **Breadcrumb** – Links + separators. Active page colour: merah.
- **Pagination** – Active page: merah fill, white text. Prev/next ghost buttons.
- **Callout** – Variants: `info` (horn‑sky), `success` (horn‑green), `warning` (horn‑orange), `danger`. Include callout label and body text slot.
- **Inset Text** – Left border: 4px merah.
- **Summary List** – Key‑value rows (key column: cream bg, value: white). Can contain edit links.
- **Task List (Progress steps)** – Active: merah, completed: green, pending: grey.
- **Tooltip** – Background hitam, text ivory.

#### 3.3 ORGANISMS
- **Table** – Header: cream, sorted column: merah underline, row hover: ivory.
- **Accordion** – Expand icon: merah, open section: 3px merah left border.
- **Alert Dialog** – Modal with title, text, primary (merah) and secondary (ghost) buttons. Focus‑trapped.
- **Tabs** – Active tab: 2px merah underline. Max 5 tabs. Keyboard navigation.
- **Cookies Banner** – Mandatory: primary‑fill accept, ghost decline.
- **Sarawak Header** (Sarawak‑specific) – Contains Trisakti stripe, black nav bar, logo/crest slot, navigation links (gold hover, gold underline active), BM/EN toggle.

#### 3.4 AI SURFACE COMPONENTS (New 2026)
- **StreamingText** – Progressive text with a merah blinking cursor.
- **ChatBubble** – Variants: user (kuning bg, hitam text), assistant (ivory bg, dark text), system (cream bg).
- **ToolUseIndicator** – Pulsing merah dot when active, expandable output panel.
- **CitationBadge** – Cream background, merah number.
- **ConversationThread** – Full chat interface with ivory background, Trisakti stripe header.
- **AgentStatusBar** – Multi‑step progress: active = merah, complete = green, pending = grey.

---

### 4. PATTERNS (Page)
Assemble the components above into reusable pattern templates (Figma frames, not library components). Include:
- Single‑column form with inline validation, BM labels, required asterisks.
- Multi‑step wizard with Task List, Backlink, and "Simpan & Teruskan Kemudian" button.
- Table with filters, search bar, pagination.
- Empty state with hornbill illustration, BM heading, CTA.

---

### 5. IMPORTANT NOTES
- Always enable **component properties** and **variants** so designers can swap states, toggle icons, and change text.
- Store the **Sarawak‑specific token library** as a separate Figma library linked to the main MYDS library.
- Add a dedicated page that explains the **Sarawak Identity** (Trisakti, Pua Kumbu, Kenyalang) with visual examples and the cultural sensitivity notice.
- The final Figma file should be ready to be published as a team library. Name it **“Sarawak Design System v1.0.0”**.

Generate the full design system based on the description above in Figma.