# Design System Specification: Obsidian Elite

## 1. Overview & Creative North Star

### The Creative North Star: "The Tactical Command Center"
This design system is engineered to feel like a high-end, mission-critical interface. It moves beyond standard mobile UI by embracing an aesthetic of **Obsidian Depth**—where the interface isn't just a flat screen, but a series of layered, translucent glass panels floating in a pressurized, dark environment. 

We break the "template" look by utilizing intentional asymmetry in data density and high-contrast typographic scales. Information isn't just displayed; it is "monitored." By leveraging deep charcoal foundations and surgical strikes of vibrant "System Online" green and "Execution" blue, we create a tool that feels authoritative, elite, and ultra-fast.

---

## 2. Colors

The palette is rooted in deep obsidian and charcoal to preserve the user's focus during high-intensity trading sessions.

### Surface Hierarchy & Nesting
To achieve a premium feel, we prohibit the use of standard 1px solid borders for sectioning. 
- **The "No-Line" Rule:** Visual boundaries are created through background shifts. A `surface-container-low` (#131314) card sits on a `surface` (#0e0e0f) background.
- **Tonal Layering:** 
    - **Base:** `surface` (#0e0e0f)
    - **Primary Containers:** `surface-container` (#1a191b)
    - **Elevated Elements:** `surface-container-high` (#201f21)
- **The "Glass & Gradient" Rule:** Use `surface-bright` (#2c2c2d) at 40% opacity with a `20px` backdrop-blur for floating modals or status bars. For primary actions, use a subtle linear gradient from `primary` (#9cff93) to `primary-container` (#00fc40) to add "soul" to the digital execution.
### Functional Accents
- **System Online (Primary):** `#9cff93` — Used for active engines, successful pips, and "Go" states.
- **Execution (Secondary):** `#669dff` — Used for trade executions, liquidity markers, and buy-side actions.
- **Alert (Tertiary/Error):** `#ff7162` — Reserved strictly for liquidations, errors, and critical stop-losses.

---

## 3. Typography

The system utilizes a dual-font strategy to balance aggressive technicality with high-readability.

- **Display & Headlines (Space Grotesk):** This font brings a futuristic, "NASA-spec" aesthetic to the interface. Use `display-lg` (3.5rem) for major portfolio balances and `headline-sm` (1.5rem) for section headers like "6-Layer Pipeline Engine."
- **Data & Body (Inter):** Inter is used for all high-density data. Its neutral, clean architecture ensures that even at `label-sm` (0.6875rem), complex trading pairs and timestamps remain legible.
- **Hierarchy through Scale:** We use extreme contrast between Title and Label scales. A massive `title-lg` price sits next to a tiny, dimmed `label-sm` "24H Change" to create an editorial, professional hierarchy.

---

## 4. Elevation & Depth

Standard shadows are too "web-like" for this system. We use **Tonal Stacking** and **Ambient Glows**.

- **The Layering Principle:** Depth is achieved by placing `surface-container-highest` elements atop `surface-container-low`. The change in luminosity defines the edge, not a stroke.
- **Ambient Shadows:** For "floating" elements like trade confirmation sheets, use a shadow with a `40px` blur, 6% opacity, tinted with `#9cff93` (if successful) or the `on-surface` color.
- **The "Ghost Border" Fallback:** If a separation is required for accessibility, use the `outline-variant` (#484849) at **15% opacity**. It should be felt, not seen.
- **Glassmorphism:** Apply to navigation bars and side-drawers using `surface-container-lowest` at 60% opacity with a heavy `blur(12px)`.
---

## 5. Components

### Buttons
- **Primary (Execution):** Gradient fill (Secondary to Secondary-Dim), `md` (0.375rem) corner radius. No border. White text.
- **Secondary (Monitoring):** `surface-container-highest` fill with a `Ghost Border`.
- **Tertiary (Neutral):** Transparent background, `label-md` uppercase text with high letter spacing.

### Data Cards
- **Forbid Divider Lines:** Use `Spacing 4` (0.9rem) or `Spacing 5` (1.1rem) to separate content.
- **Pipeline Indicators:** Use a `0.25rem` (DEFAULT) rounded corner for status pips. A glowing `primary` shadow (`blur 4px`) indicates an active process.

### Input Fields
- **Obsidian Style:** Background: `surface-container-lowest`. Bottom-only "Ghost Border" that transitions to a 100% opaque `primary` stroke on focus. 
- **Typography:** Placeholder text uses `on-surface-variant`.

### Lists & Feeds
- **Zebra Striping:** Use alternating `surface` and `surface-container-low` backgrounds instead of lines.
- **Leading Elements:** Icons should be encased in a `surface-container-high` circle with 40% opacity.

### Pipeline Engine Blocks
- Specific to this app: Use a "Cellular" layout. Each engine (e.g., "ML Model") is a vertical container with a `surface-container` background and a centered icon using `primary_dim`.
---

## 6. Do's and Don'ts

### Do
- **DO** use `Space Grotesk` for numbers that represent high-value data.
- **DO** use background color shifts to define the "Mission Control" zones.
- **DO** use `secondary` (Blue) for active "Long" positions and `tertiary` (Red) for "Short" or "Alert" states.
- **DO** maintain a "Data-First" density; users are professionals who prefer information over whitespace.

### Don't
- **DON'T** use 100% opaque white borders. It breaks the "Tactical Command" immersion.
- **DON'T** use standard Material Design blue. Use the specified `Execution Blue` (#669dff).
- **DON'T** use large corner radii. Stick to `DEFAULT` (0.25rem) or `md` (0.375rem) to maintain a sharp, technical look.
- **DON'T** use drop shadows on cards sitting on the grid. Only use shadows for elements that physically "float" above the interface.