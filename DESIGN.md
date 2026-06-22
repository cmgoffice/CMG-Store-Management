---
name: CMG Azure Operations
source_project: CMG Store Management System
stitch_project_id: "17618968177635510134"
device_type: DESKTOP
color_mode: LIGHT
updated_from_stitch: "2026-06-22T04:34:30.103705Z"
---

# CMG Store Management System Design

## Design Intent

The CMG Store Management System uses a soft analytics dashboard style for construction logistics, inventory review, dispatch, receiving, approvals, and shipment management. The interface should feel modern, polished, and operational, with a vivid purple navigation rail, rounded white work surfaces, colorful summary cards, and clean ERP-style tables inside a softer visual shell.

The product should avoid looking like a plain admin template. Navigation and primary dashboard surfaces should carry the Stitch-inspired character: purple gradient sidebar, pill-shaped active navigation, white rounded panels, light lavender page background, soft shadows, and bright gradient metric cards.

## Color Palette

### Core Colors

| Token | Value | Usage |
| --- | --- | --- |
| `primary` | `#005faa` | Primary actions, active navigation, focus states |
| `primary-container` | `#0078d4` | Strong Azure fills and selected states |
| `on-primary` | `#ffffff` | Text and icons on primary fills |
| `secondary` | `#595f64` | Secondary controls and supporting labels |
| `secondary-container` | `#dae0e6` | Secondary chips, quiet fills |
| `tertiary` | `#006d05` | Success, received, completed states |
| `tertiary-container` | `#22881d` | Strong success fills |
| `error` | `#ba1a1a` | Errors and destructive states |
| `error-container` | `#ffdad6` | Error badge backgrounds |

### Surfaces

| Token | Value | Usage |
| --- | --- | --- |
| `background` | `#f9f9ff` | App background |
| `surface` | `#f9f9ff` | Default page surface |
| `surface-container-lowest` | `#ffffff` | Cards, tables, elevated panels |
| `surface-container-low` | `#f1f3ff` | Subtle grouped sections |
| `surface-container` | `#e9edff` | Tonal containers |
| `surface-container-high` | `#e1e8fd` | Raised or selected panels |
| `surface-container-highest` | `#dce2f7` | Highest tonal container |
| `surface-dim` | `#d3daef` | Muted backgrounds |
| `surface-variant` | `#dce2f7` | Alternate surface areas |

### Text And Lines

| Token | Value | Usage |
| --- | --- | --- |
| `on-background` | `#141b2b` | Primary page text |
| `on-surface` | `#141b2b` | Primary panel text |
| `on-surface-variant` | `#404752` | Secondary text |
| `outline` | `#717783` | Strong dividers and borders |
| `outline-variant` | `#c0c7d4` | Default table, card, and input borders |
| `inverse-surface` | `#293040` | Dark surfaces |
| `inverse-on-surface` | `#edf0ff` | Text on dark surfaces |
| `inverse-primary` | `#a3c9ff` | Azure accent on dark surfaces |

### Semantic Status Colors

Use semantic colors consistently across badges, filters, table cells, and summaries.

| Status | Foreground | Background | Notes |
| --- | --- | --- | --- |
| Pending | `#d97706` | `#fff7ed` | Waiting for approval or action |
| In Transit | `#0078d4` | `#eef6ff` | Dispatch, shipment, or transfer in progress |
| Received | `#107c10` | `#edf7ed` | Completed receiving or successful stock movement |
| Error | `#ba1a1a` | `#ffdad6` | Failed, blocked, rejected, or destructive state |

## Typography

Use Inter for all UI text. It is the source typography from Stitch and should remain the default for English and Thai content.

| Role | Font | Size | Weight | Line Height | Letter Spacing | Usage |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `display` | Inter | 36px | 700 | 44px | -0.02em | Page-level dashboard titles |
| `headline-lg` | Inter | 28px | 600 | 36px | -0.01em | Major screen headings |
| `headline-md` | Inter | 20px | 600 | 28px | 0 | Section headings and panel titles |
| `headline-sm` | Inter | 16px | 600 | 24px | 0 | Card titles and compact section titles |
| `body-lg` | Inter | 16px | 400 | 24px | 0 | Important descriptive text |
| `body-md` | Inter | 14px | 400 | 20px | 0 | Default app, table, form, and sidebar text |
| `label-md` | Inter | 12px | 500 | 16px | 0.01em | Table headers, field labels, metadata |
| `label-sm` | Inter | 11px | 600 | 14px | 0 | Status badges and dense labels |

### Thai Text Handling

For Thai content, preserve Inter and increase line height by about 10% where tone marks or stacked vowels risk crowding. Do not reduce line height below the design token values in tables, badges, or compact controls.

## Layout And Spacing

| Token | Value | Usage |
| --- | --- | --- |
| `unit` | 4px | Smallest spacing step |
| `sidebar_width` | 260px | Full desktop sidebar |
| `container_max` | 1440px | Maximum content width |
| `gutter` | 24px | Desktop page gutter |
| `margin_mobile` | 16px | Mobile page margin |
| `stack_gap` | 12px | Default vertical component gap |

Use an 8px visual rhythm for page layout and table spacing. Data rows should default to 12px vertical padding, with a compact mode at 8px for high-volume inventory screens.

## Shape

| Token | Value | Usage |
| --- | --- | --- |
| `sm` | 0.125rem | Tiny controls |
| `DEFAULT` | 0.25rem | Buttons, inputs, cards, tables |
| `md` | 0.375rem | Slightly larger controls |
| `lg` | 0.5rem | Dialogs and prominent containers |
| `xl` | 0.75rem | Large panels when needed |
| `full` | 9999px | Status badges and pills |

The default visual language is soft and precise. Prefer 4px corners for operational UI. Use full pills only for status badges and compact tag-like metadata.

## Sidebar Menu

### Structure

Desktop uses a fixed 260px left sidebar. Tablet should collapse to a 72px icon rail. Mobile should collapse into a drawer or compact menu.

### Menu Items

The Stitch project contains these primary app areas:

| Label | Purpose |
| --- | --- |
| Dashboard | Operational overview and analytics summary |
| Store Inventory | Stock levels, item movement, and inventory review |
| Dispatch & Receiving | Receiving flow, dispatch tracking, and goods movement |
| Shipment Management | Shipment list, tracking state, and logistics coordination |
| Approve | Approval queue and request review |
| Project List | Project-level inventory or logistics grouping |

### Sidebar Styling

- Sidebar background should use a purple gradient, roughly `#7b4df6` to `#4f2ed9`.
- Add a darker mini vertical rail on the far left using translucent deep purple.
- The mini rail is fixed at about 64px wide and sits flush to the left edge.
- The mini rail should include a vertical CMG wordmark and compact project quick-switch buttons generated from the Project list.
- Project quick-switch buttons use short project identifiers such as `74`, `88`, `91`, and `99`, each inside a small rounded colorful square.
- Sidebar primary text should use near-white lavender (`#f7f2ff`).
- Sidebar muted text and group labels should use pale lavender (`#d7c9ff`) with reduced opacity.
- Sidebar dividers should use white at about 12-16% opacity.
- Use 24px high-contrast icons paired with `body-md` labels.
- Active items use a white pill background, purple text, and a white rail marker.
- Hover states should use white at about 12% opacity.
- Sidebar grouping should rely on spacing and subtle tonal backgrounds instead of heavy shadows.
- Keep hit targets at least 48px high for pointer and touch comfort.

## Dashboard Visual Style

- Page background should be very light lavender (`#f7f5ff`) with subtle radial color washes.
- Header search should be a wide white pill with soft shadow, category selector, and search icon.
- KPI cards should use bright gradients:
  - Pink: `#ff7a9d` to `#f3527d`
  - Purple: `#d688ff` to `#8b4df4`
  - Green: `#79e6c1` to `#35bd7f`
  - Yellow: `#f8e95a` to `#e8c92c`
- Content panels should be white, borderless, rounded 14px, and use soft lavender shadows.
- Tables remain clean and ERP-readable, but should live inside rounded white surfaces instead of hard bordered grids.

## Components

### Data Tables

Data tables are the core surface of the app. Use sticky headers, compact row density, subtle row hover using the light Azure surface tint, and inline status badges. Table borders should use `outline-variant` with low visual weight.

### Status Badges

Badges use `label-sm`, semi-bold weight, and pill corners. Keep badge language short and consistent across screens: Pending, In Transit, Received, Rejected, Draft, Completed.

### Inputs

Inputs use a 1px `outline-variant` border, 4px radius, and white or near-white surface fill. Focus states use a 2px Azure ring with low opacity.

### Buttons

Primary buttons use solid Azure with white text. Secondary buttons should be quiet, using Azure text or a low-contrast outline. Avoid decorative gradients and heavy shadows.

### Role Switcher

Place the role switcher in the top-right header. Use `label-md` text, a chevron icon, and a light Level 2 dropdown surface with a subtle border and low-opacity shadow.
