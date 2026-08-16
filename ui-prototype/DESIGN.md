---
name: Caddy Flow Control
colors:
  surface: '#0b1326'
  surface-dim: '#0b1326'
  surface-bright: '#31394d'
  surface-container-lowest: '#060e20'
  surface-container-low: '#131b2e'
  surface-container: '#171f33'
  surface-container-high: '#222a3d'
  surface-container-highest: '#2d3449'
  on-surface: '#dae2fd'
  on-surface-variant: '#c2c6d6'
  inverse-surface: '#dae2fd'
  inverse-on-surface: '#283044'
  outline: '#8c909f'
  outline-variant: '#424754'
  surface-tint: '#adc6ff'
  primary: '#adc6ff'
  on-primary: '#002e6a'
  primary-container: '#4d8eff'
  on-primary-container: '#00285d'
  inverse-primary: '#005ac2'
  secondary: '#c0c1ff'
  on-secondary: '#1000a9'
  secondary-container: '#3131c0'
  on-secondary-container: '#b0b2ff'
  tertiary: '#ffb786'
  on-tertiary: '#502400'
  tertiary-container: '#df7412'
  on-tertiary-container: '#461f00'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#d8e2ff'
  primary-fixed-dim: '#adc6ff'
  on-primary-fixed: '#001a42'
  on-primary-fixed-variant: '#004395'
  secondary-fixed: '#e1e0ff'
  secondary-fixed-dim: '#c0c1ff'
  on-secondary-fixed: '#07006c'
  on-secondary-fixed-variant: '#2f2ebe'
  tertiary-fixed: '#ffdcc6'
  tertiary-fixed-dim: '#ffb786'
  on-tertiary-fixed: '#311400'
  on-tertiary-fixed-variant: '#723600'
  background: '#0b1326'
  on-background: '#dae2fd'
  surface-variant: '#2d3449'
typography:
  display:
    fontFamily: Geist
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Geist
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
  headline-sm:
    fontFamily: Geist
    fontSize: 18px
    fontWeight: '500'
    lineHeight: '1.4'
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  code-block:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.7'
  label-caps:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1'
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  container-padding: 24px
  gutter: 16px
  sidebar-width: 260px
  stack-gap: 12px
---

## Brand & Style
The design system is engineered for technical efficiency and precision, targeting DevOps engineers and system administrators. The aesthetic leans into a **Modern Technical** style—a fusion of high-utility minimalism and developer-centric ergonomics. 

The interface prioritizes reduced cognitive load through a "Developer Dark" environment, utilizing deep spatial layering and focused density. It avoids unnecessary ornamentation, favoring structural clarity, crisp borders, and a systematic approach to information hierarchy that mirrors the logical structure of a Caddyfile.

## Colors
The palette is anchored by a deep slate foundation to minimize eye strain during long configuration sessions. 

- **Primary Canvas**: Use `#0f172a` for the base background.
- **Surface Elevation**: Use `#1e293b` for cards and containers to create a subtle lift.
- **Accents**: The primary blue (`#3b82f6`) is reserved strictly for high-priority actions and active states. 
- **Syntax Highlighting**: A custom palette for code blocks ensures that Caddy directives, matchers, and values are instantly distinguishable. High contrast ratios (minimum 7:1 for body text) are maintained throughout the interface.

## Typography
This design system employs a dual-font strategy to separate UI navigation from technical data.

- **UI Interface**: Geist and Inter handle the application framework. Headlines use Geist for its precise, technical geometry, while Inter provides legible, neutral body copy.
- **Data & Code**: JetBrains Mono is used for all monospaced requirements, including config editors, terminal outputs, and small labels (e.g., status codes or port numbers).
- **Hierarchy**: Use `label-caps` for metadata like "LAST DEPLOYED" or "SERVER STATUS" to provide a clear distinction from interactive text.

## Layout & Spacing
The layout follows a **Fixed-Fluid hybrid model**. A narrow, fixed sidebar (260px) houses the primary navigation and server list, while the main content area expands to fill the viewport.

- **Grid**: Use a 12-column grid for complex dashboards, but prioritize vertical stacks for configuration forms to maintain a clear top-to-bottom reading path.
- **Rhythm**: All spacing is derived from a 4px base unit. Component internal padding should default to 12px (3 units) or 16px (4 units).
- **Responsive**: On tablet, the sidebar collapses into a drawer. On mobile, the interface stacks entirely, and font sizes for code blocks reduce to 13px to maximize horizontal space.

## Elevation & Depth
In this design system, depth is communicated through **Tonal Layers** and **Low-Contrast Outlines** rather than heavy shadows.

- **Level 0 (Background)**: `#0f172a` — The base layer.
- **Level 1 (Cards/Sidebar)**: `#1e293b` — Raised surfaces. Use a 1px solid border of `#334155` to define edges.
- **Level 2 (Modals/Popovers)**: `#1e293b` — Highest elevation. Add a subtle, diffused shadow: `0 10px 25px -5px rgba(0, 0, 0, 0.5)`.
- **Interactions**: On hover, interactive elements should increase their border brightness or background tint slightly, rather than "lifting" off the page.

## Shapes
The design system utilizes a **Soft (0.25rem)** roundedness approach. This maintains a professional, structured feel that aligns with the precision of a developer tool while avoiding the aggressive sharpness of pure brutalism.

- **Standard Elements**: Buttons, inputs, and small chips use 4px (`0.25rem`) corners.
- **Containers**: Large dashboard cards and code editor blocks use 8px (`0.5rem`) corners.
- **Status Indicators**: Status dots (e.g., Server Up/Down) are the only fully circular elements.

## Components
- **Buttons**:
    - *Primary*: Solid `#3b82f6` with white text.
    - *Secondary*: Outline style with `#334155` borders and `#94a3b8` text.
- **Inputs**: Use `#0f172a` for the background (inset look) with a 1px border of `#334155`. On focus, the border transitions to the primary blue.
- **Code Editor**: The centerpiece component. It should include line numbers, a subtle vertical "indent guide" line, and a distinct "Active Line" highlight using a slight background tint (`rgba(59, 130, 246, 0.05)`).
- **Status Chips**: Small, monospaced badges used for HTTP methods (GET, POST) or Caddy status (Running, Reloading). Use low-saturation background tints with high-saturation text for readability.
- **Config Diff**: For version control, use a full-width block with green (addition) and red (deletion) line-level backgrounds at 15% opacity.