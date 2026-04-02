# Design System Specification: Institutional Obsidian

## 1. Overview & Creative North Star
**Creative North Star: The Sovereign Terminal**
This design system is not a dashboard; it is an instrument of precision. It rejects the cluttered, "gamified" aesthetic of retail trading in favor of a disciplined, editorial-grade environment. The "Sovereign Terminal" philosophy balances high-density data with an expansive sense of calm.

To move beyond "template" UI, we utilize **Asymmetric Precision**. Layouts should avoid perfect bilateral symmetry, instead using the Spacing Scale to create intentional "weighted" zones. Overlapping glass panels and tonal layering replace standard grids, creating a sense of depth that feels like looking through high-end optical equipment rather than a flat liquid crystal display.

---

## 2. Colors & Tonal Depth
The palette is rooted in the "Obsidian" spectrum—a series of near-black neutrals that prioritize eye endurance for long-duration institutional use.

### The "No-Line" Rule
**Explicit Instruction:** Traditional 1px solid borders for sectioning are prohibited. Boundaries must be defined solely through background color shifts. Use `surface-container-low` for large section backgrounds resting on a `surface` base. If a boundary feels missing, increase the spacing—do not add a line.

### Surface Hierarchy & Nesting
Treat the UI as a physical stack of semi-translucent materials.
*   **Base Layer:** `surface` (#131314) - The foundational "desk" surface.
*   **Secondary Layer:** `surface-container-low` (#1C1B1C) - Used for primary workspace areas.
*   **Tertiary Layer:** `surface-container-high` (#2A2A2B) - For active widgets or focused analytical modules.
*   **Floating Layer:** `surface-container-highest` (#353436) - Reserved for dropdowns and context menus.
### The "Glass & Gradient" Rule
To elevate the "Institutional" feel, primary CTAs and active state indicators must use a subtle linear gradient: `primary` (#A4C9FF) to `primary-container` (#4D93E2) at a 135-degree angle. This provides a "machine-tooled" metallic finish that flat colors cannot replicate.

---

## 3. Typography
We use a dual-typeface strategy to separate "The Narrative" from "The Data."

*   **Display & Headlines (Manrope):** Chosen for its geometric authority. Use `display-md` for portfolio totals and `headline-sm` for market sectors. The wide tracking in Manrope conveys an elite, editorial tone.
*   **Interface & Data (Inter):** The workhorse. Use `label-md` for all technical metadata. Inter's tall x-height ensures that even at `body-sm`, strike prices and contract codes remain hyper-legible.
*   **The Quantitative Shift:** For live price tickers, apply `font-feature-settings: "tnum" 1` (tabular figures) to prevent "jumping" text during rapid price movements.

---

## 4. Elevation & Depth

### The Layering Principle
Depth is achieved through Tonal Layering. Place a `surface-container-lowest` card inside a `surface-container-low` section to create a "recessed" effect. This mimics a physical terminal where modules are carved into the frame.

### Ambient Shadows
Shadows are strictly for "floating" elements (Modals/Popovers). 
*   **Value:** 0px 12px 32px
*   **Color:** `on-surface` at 6% opacity.
*   **Intent:** It should look like a soft glow of light being blocked, not a black smudge.
### The "Ghost Border" Fallback
If accessibility requirements demand a container boundary, use a **Ghost Border**: `outline-variant` (#414751) at 15% opacity. It should be felt, not seen.

### Glassmorphism
For persistent overlays (e.g., a floating Trade Execution bar), use:
*   **Background:** `surface-variant` at 60% opacity.
*   **Backdrop Blur:** 12px to 20px.
*   **Effect:** This anchors the element in 3D space while maintaining the "Obsidian" depth.

---

## 5. Components

### Buttons
*   **Primary:** Gradient of `primary` to `primary-container`. `radius-sm` (0.125rem) for a sharp, disciplined look. 
*   **Secondary:** Ghost style. No background, `outline-variant` border (20% opacity).
*   **State:** On hover, increase `surface-tint` overlay by 8%.

### Quantitative Cards
*   **Constraint:** Forbid divider lines.
*   **Structure:** Use `spacing-5` (1.1rem) to separate the "Metric Label" from the "Value." Use a background shift to `surface-container-highest` on hover to indicate interactivity.

### Input Fields
*   **Default:** `surface-container-lowest` background. No border.
*   **Active:** A 1px bottom-border of `primary` (#A4C9FF) only. This mimics high-end audio equipment interfaces.
*   **Error:** Replace the bottom-border with `error` (#FFB4AB).
### Data Visualizations (Analytical Charts)
*   **Success Green:** `tertiary` (#61DE8A) for long positions.
*   **Alert Red:** `error` (#FFB4AB) for short positions.
*   **Neutral:** `secondary` (#AFCBD8) for volume profiles.
*   **Guideline:** Use a 0.5px `outline` for grid lines, set to 10% opacity.

---

## 6. Do's and Don'ts

### Do
*   **Do** prioritize vertical rhythm using the `spacing-4` (0.9rem) and `spacing-8` (1.75rem) increments.
*   **Do** use `letter-spacing: 0.05em` for all `label-sm` text to increase institutional authority.
*   **Do** allow data density to be high, provided the surface nesting clearly defines the hierarchy.

### Don't
*   **Don't** use pure black (#000000). It kills the depth of the "Obsidian" effect.
*   **Don't** use `radius-xl` or `full` on anything except status pips. Rounded corners are for consumer apps; sharp/subtle corners are for professional tools.
*   **Don't** use "Electric" or "Neon" effects. If a color glows, it must be muted and intentional, like a physical LED indicator on a server rack.