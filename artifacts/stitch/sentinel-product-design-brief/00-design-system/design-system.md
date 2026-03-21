# Design System Specification

## 1. Overview & Creative North Star: "The Obsidian Sanctuary"
The digital landscape is often noisy and intrusive. This design system is the antithesis of that chaos. Our Creative North Star is **The Obsidian Sanctuary**—a high-end, editorial approach to privacy and focus that feels less like a utility and more like a bespoke physical workspace. 

We reject the "template" look of modern SaaS. Instead of rigid grids and heavy borders, we use **Intentional Asymmetry** and **Tonal Depth** to guide the eye. By leveraging a high-contrast typography scale (pairing the architectural weight of Manrope with the precision of Inter), we create an environment that feels authoritative yet invisible, allowing the user’s work to remain the hero.

---

## 2. Color & Atmospheric Theory
The palette is rooted in deep graphite and charcoal, providing a low-light environment that reduces eye strain and signals a "private" mode of operation.

### Surface Hierarchy & Nesting
We move beyond flat UI by treating the screen as a series of nested physical layers. 
- **The Base:** Use `surface` (#131313) for the primary application background.
- **The Depth:** Use `surface-container-low` (#1C1B1B) for secondary sidebars and `surface-container-highest` (#353534) for active floating elements. 
- **The "No-Line" Rule:** 1px solid borders are strictly prohibited for sectioning. Boundaries must be defined solely through background color shifts or subtle tonal transitions between `surface-container` tiers.

### The Glass & Gradient Rule
To achieve a premium, Windows-native "Mica" or "Acrylic" feel:
- **Floating Elements:** Use `surface_variant` with a 60% opacity and a `backdrop-filter: blur(20px)`.
- **Signature Gradients:** Main CTAs should utilize a subtle linear gradient from `primary` (#CDBDFF) to `primary_container` (#7C4DFF) at a 135-degree angle to provide "visual soul."

---

## 3. Typography: The Editorial Scale
We employ a dual-typeface system to balance character with legibility.

- **Display & Headlines (Manrope):** These are used sparingly to create focal points. Large scale differences (e.g., `display-lg` for timer states) create a sense of importance and calm.
- **Body & UI Labels (Inter):** Used for all functional data. Inter provides the "mechanical" precision required for a privacy-first app.

| Role | Token | Typeface | Size | Intent |
| :--- | :--- | :--- | :--- | :--- |
| Focus State | `display-lg` | Manrope | 3.5rem | High-impact, glanceable data. |
| Section Head | `headline-sm` | Manrope | 1.5rem | Editorial grouping. |
| Functional | `body-md` | Inter | 0.875rem | Standard interaction text. |
| Metadata | `label-sm` | Inter | 0.6875rem | Non-critical privacy details. |

---

## 4. Elevation & Depth: Tonal Layering
In this design system, shadows and borders are secondary to light and material.

- **The Layering Principle:** Depth is achieved by "stacking." A `surface-container-lowest` card sitting on a `surface-container-low` section creates a natural "sunken" or "lifted" effect without artificial lines.
- **Ambient Shadows:** When an element must float (e.g., a modal), use a high-spread, low-opacity shadow. Use `on-surface` (#E5E2E1) at 4% opacity with a 32px blur to mimic natural ambient light.
- **The "Ghost Border" Fallback:** If accessibility requires a stroke, use the `outline-variant` (#494455) at 15% opacity. Never use 100% opaque strokes.

---

## 5. Component Architecture

### Buttons: High-Tactility Controls
- **Primary:** Gradient fill (`primary` to `primary_container`), `md` (0.375rem) corner radius. Text is `on_primary_container`.
- **Secondary:** Ghost style. No background, `outline-variant` ghost border (20% opacity).
- **Tertiary:** Text-only using `primary` color, reserved for low-priority desktop actions.

### Cards & Focus Containers
- **Construction:** Utilize `surface-container-low` with a `lg` (0.5rem) corner radius. 
- **Spacing:** Use a minimum of `spacing-6` (1.3rem) internal padding to ensure "breathing room."
- **Constraint:** Forbid the use of divider lines. Separate content blocks using `spacing-4` (0.9rem) vertical gaps or a shift to `surface-container-lowest`.

### Desktop-Specific Inputs
- **Toggles:** Use `primary` for the "on" state. The "thumb" should be a soft `surface_bright` white to contrast against the dark graphite track.
- **Privacy Inputs:** Text fields use `surface-container-highest` backgrounds with a `sm` (0.125rem) bottom-only accent in `primary` when focused.

### Specialized Components
- **The Focus Ring:** A large, circular progress indicator using `primary` for work sessions, `tertiary` (#3CE36A) for short breaks, and `secondary` (#8DCDFF) for long breaks.
- **The Stealth Ledger:** A compact list of privacy interventions using `body-sm` typography and `surface-container-low` backgrounds to minimize visual weight.

---

## 6. Do’s and Don’ts

### Do:
- **Use Vertical Rhythm:** Leverage the `spacing-10` and `spacing-12` tokens to create distinct editorial sections.
- **Embrace Glassmorphism:** Use backdrop blurs for overlay panels to keep the user grounded in their desktop environment.
- **Prioritize Legibility:** Ensure all `on-surface-variant` text meets a 4.5:1 contrast ratio against the graphite backgrounds.

### Don't:
- **No Mobile Patterns:** Avoid bottom navigation or hamburger menus. Use a persistent sidebar or top-level "breadstyle" tabs.
- **No Harsh Borders:** Do not use `outline` at 100% opacity. It breaks the "Obsidian Sanctuary" immersion.
- **No Standard Grids:** Avoid strictly equal column widths; try a 60/40 or 70/30 split to create a more premium, custom-built feel.