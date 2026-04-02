# Design System Specification: Institutional Intelligence

## 1. Overview & Creative North Star
### The Creative North Star: "The Sovereign Observer"
This design system is engineered for high-stakes, institutional-grade decision-making. It rejects the playful, "bubbly" trends of consumer tech in favor of **The Sovereign Observer**—a visual language that is calm, authoritative, and profoundly organized. 

The system breaks the "template" look by utilizing **intentional tonal depth** instead of structural lines. We achieve a premium editorial feel through high-contrast typography scales (pairing massive, quiet headlines with dense, precise data) and a "monolithic" layout philosophy. Elements don't just sit on a page; they are carved out of a dark, digital slate.

---

## 2. Colors & Surface Philosophy
The palette is rooted in deep obsidian and steel, providing a low-strain environment for long-duration analysis.

### Tonal Tokens
*   **Background (Deep Charcoal):** `#131314` (The base "void")
*   **Surface (Steel Gray):** `#1c1b1c` to `#353436` (The layered panels)
*   **Primary (Electric Blue):** `#adc6ff` (Focus & Action)
*   **Tertiary (Teal):** `#00dfc1` (Approval & Success)
*   **Warning (Amber):** `#FFB703` (Cautionary states)
*   **Error (Restrained Red):** `#ffb4ab` (Critical failure)
### The "No-Line" Rule
Prohibit the use of 1px solid borders for sectioning or layout containment. Boundaries must be defined solely through background color shifts. A `surface-container-low` section sitting on a `surface` background creates a natural, sophisticated break that feels integrated rather than boxed-in.

### The Glass & Gradient Rule
To move beyond a flat "SaaS" look, floating elements (modals, status overlays, or AI thinking-panels) must use **Glassmorphism**.
*   **Backdrop Blur:** 12px – 20px.
*   **Fill:** `surface_variant` at 60% opacity.
*   **Signature Gradients:** Use a subtle linear gradient (Top-Left to Bottom-Right) transitioning from `primary` to `primary_container` for high-level CTAs to provide "visual soul."

---

## 3. Typography
The system utilizes **Inter** for its neutral, architectural quality. To maintain institutional authority, we leverage "Tabular Numbers" for all data points to ensure vertical alignment in dense tables.

*   **Display (lg/md):** 3.5rem / 2.75rem. Used for primary dashboard metrics. Light weight (300).
*   **Headline (sm):** 1.5rem. Used for major section headers.
*   **Title (sm):** 1rem. Semi-bold. Used for card titles.
*   **Body (md):** 0.875rem. The workhorse for all data interpretation.
*   **Label (sm):** 0.6875rem. All-caps with 0.05em tracking for metadata.

**Hierarchy Note:** Use `on_surface_variant` (muted gray) for labels and `on_surface` (near white) for data values to create immediate visual scannability.
---

## 4. Elevation & Depth
Depth is a functional tool, not a decoration. We achieve hierarchy through **Tonal Layering**.

### The Layering Principle
Stacking defines importance.
1.  **Level 0 (Base):** `surface_dim` (#131314).
2.  **Level 1 (Section):** `surface_container_low`.
3.  **Level 2 (Card/Action):** `surface_container_high`.
4.  **Level 3 (Interactive):** `surface_bright`.

### Ambient Shadows
Shadows must be invisible until noticed.
*   **Blur:** 32px – 64px.
*   **Opacity:** 4% - 8%.
*   **Color:** Tinted with `surface_tint` (#adc6ff) to mimic a cool, electronic glow rather than a muddy black shadow.

### The "Ghost Border" Fallback
If accessibility requires a container edge, use the **Ghost Border**: `outline_variant` at 15% opacity. Never use a 100% opaque border.

---

## 5. Components

### AI Thinking Components (Signature)
*   **Process Traces:** Use `tertiary` (Teal) with a subtle pulse animation (0.4 opacity glow) to indicate live computation.
*   **Inference Cards:** Use a `surface_container_highest` background with a 4px `primary` accent bar on the left edge.
### Buttons & Chips
*   **Primary Button:** `primary` background with `on_primary` text. Sharp 4px corners (`DEFAULT` roundedness).
*   **Secondary Button:** `surface_container_highest` background. No border.
*   **Chips:** High-density, 20px height. Use `label-sm` typography. Avoid rounded pills; use `sm` (2px) radius for an institutional look.

### Input Fields
*   **Text Inputs:** No bottom line. Use `surface_container_low` as the field fill. On focus, transition the background to `surface_container_highest` and apply a `ghost border` of the `primary` color.

### Lists & Tables
*   **Forbid Dividers:** Use `8px` (1) or `12px` (1.5) vertical whitespace to separate list items. 
*   **Alternating Rows:** Use a subtle shift from `surface` to `surface_container_lowest` for high-density data tables.

---

## 6. Do's and Don'ts

### Do
*   **Do** use Tabular Numbers (`font-variant-numeric: tabular-nums`) for all numerical data.
*   **Do** respect the 24px (3) internal padding for all containers to allow the data to "breathe."
*   **Do** use asymmetrical layouts—place heavy data blocks against wide, empty "observation" spaces.

### Don't
*   **Don't** use large corner radii. This system is "Sharp" (4px max). Anything more feels like a toy.
*   **Don't** use pure black (#000000) or pure white (#FFFFFF). Use the defined surface and "on-surface" tokens to maintain tonal sophistication.
*   **Don't** use dividers. If the layout feels messy, increase whitespace or adjust the background tone of the container.