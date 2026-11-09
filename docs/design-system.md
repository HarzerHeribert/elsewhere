# Elsewhere design system

Elsewhere is a shared world for people and digital characters. The interface should make the connection between observation, decisions, actions, memories, and human interaction understandable. The lettering and character art can be distinctive; they are not the product’s central explanation. The live reference is `/design-system.html`, built from production components rather than a separate mock-up. The asset gallery is `/brand/index.html`.

## References and interpretation

Benji Taylor’s [Family Values](https://benji.org/family-values) informed the decision to retain world context behind focused panels and use motion to explain state changes. [Honkish](https://benji.org/honkish) informed the emphasis on distinctive type and truthful presence. [Morphing icons with Claude](https://benji.org/morphing-icons-with-claude) informed the shared-line icon experiment. These are design references, not copied assets or installed libraries.

For Elsewhere this means: keep the world visible; reveal one focused task at a time; reserve conspicuous playfulness for character and discovery. Common controls should feel responsive without becoming a repeated performance.

## Source of truth

| Layer                   | Source                                                  | Consumers                                   |
| ----------------------- | ------------------------------------------------------- | ------------------------------------------- |
| Semantic tokens         | `elsewhere/web/src/ui/tokens.css`                       | World, specimen, exported gallery CSS       |
| Reusable control styles | `elsewhere/web/src/ui/components.css`                   | Button, badge, field, segment controls      |
| Existing UI mapping     | `elsewhere/web/src/ui/application.css`                  | World navigation, panels, forms and dialogs |
| React primitives        | `elsewhere/web/src/ui/`                                 | Real account/world dialogs and specimen     |
| Interactive reference   | `elsewhere/web/src/design-system/`                      | `/design-system.html`                       |
| Logo source             | `scripts/generate-wordmark.py` and `assets/brand/type/` | Filled SVG wordmark outlines and local font |
| Character / doorway     | `elsewhere/web/src/brandArtwork.ts`                     | UI and exported assets                      |

Import the styles in this order: `styles.css` (tokens and components), then `ui/application.css`. New components should consume `--ew-*` tokens rather than add palette literals or private motion timings. The application mapping preserves existing selectors and responsive layout. All product CSS colors use semantic roles; the map, message feed, wishes, controls, account forms, and activity views share the palette. Primary and secondary actions use the shared Button component.

## Color and meaning

The interface uses **two calm base colors and one accent**. Do not add separate green, yellow, blue or red palettes for ordinary controls or statuses. Surface variation comes from ink/paper neutrals and terracotta tints.

| Role                | Token                        | Value / use                |
| ------------------- | ---------------------------- | -------------------------- |
| Primary text / base | `--ew-ink`, `--ew-text`      | Deep ink `#243b36`         |
| Page / base         | `--ew-paper`                 | Warm paper `#f4f0e4`       |
| Accent              | `--ew-accent`, `--ew-action` | Muted terracotta `#99583f` |
| Raised surface      | `--ew-surface`               | Paper tint `#fffdf5`       |
| Quiet surface       | `--ew-surface-muted`         | Paper shade `#eae7de`      |
| Supporting text     | `--ew-text-muted`            | Ink neutral `#606c61`      |
| Selection / notice  | `--ew-accent-soft`           | Terracotta tint `#eddfd4`  |
| Focus               | `--ew-focus`                 | Terracotta                 |

Use the accent sparingly for a primary action, selected item, focus ring, or detail in the mark. Most of the page remains neutral. Success uses ink; waiting and errors use terracotta with explicit labels. A dot cannot stand alone as proof of connection or activity, and color cannot distinguish warning from failure by itself. Destructive actions need clear language and appropriate confirmation.

Reading surfaces stay opaque over the moving world. Illustrations and the 3D world can retain natural colors; they do not expand the interface palette. Verified contrast on paper: ink 10.51:1, supporting text 4.83:1, terracotta 4.82:1. Chalk labels on terracotta are 5.40:1.

## Type and identity

Averia Serif Libre Bold gives headings a slightly irregular, printed character. System sans handles body text, controls, and longer passages. Monospace is limited to metadata. The original local font is served unchanged and avoids third-party requests; unsupported characters fall back to the serif stack. The original font and SIL OFL license are retained under `assets/brand/type/`.

- Body: 14 px, line-height 1.6.
- Labels: 12 px; captions: 11 px; section metadata: 10 px.
- Panel title: 26 px; display titles: 36–70 px depending on width.
- Display weight: 700, tracking around −0.025 em. Do not use the display face for dense controls.

The lowercase wordmark is outlined Averia, with subtle rotations and baseline offsets. Its `e` uses the font’s filled contour and open counter, never overlapping monoline strokes. Keep the SVG proportional. Navigation uses a 155 px wordmark, narrowing to 109 px on small screens; test legibility there before approving a large logo.

Regenerate outlines and the font with `python3 scripts/generate-wordmark.py` (fontTools required), then run `node --import tsx scripts/export-brand-assets.ts`. The second command also copies the source tokens into the static brand gallery. Rerender the RAEA ident when its SVG inputs change; do not ship a stale poster or video.

## Space, shape, and elevation

Use the 4 px spacing scale: 4, 8, 12, 16, 20, 24, 32, 48. Controls typically use 12–16 px horizontal padding; panels use 24 px, or 20 px on narrow screens. Separate content groups with 24–32 px rather than adding nested cards.

Corners: 8 px inset, 12 px control, 20 px panel. Pill rounding is for badges. Primary actions and important icon buttons have 44 px minimum targets; compact desktop dismiss controls are 36 px. Do not trade content space for exaggerated rounding.

`--ew-shadow-rest` is for a reading surface, `--ew-shadow-float` for world overlays, and `--ew-shadow-modal` for focused dialogs.

## Components and states

`Button` supports primary, secondary, quiet and danger variants. It defaults to `type="button"`; form actions must explicitly use `type="submit"`. `busy` disables the control and exposes `aria-busy`. Keep the visible label specific, such as “Signing in…”. Use one primary action per focused task.

`StatusBadge` provides neutral, live, waiting and error tones. Callers own the truth of the label. Do not generate a “live” state without a connection.

Fields retain labels, use `aria-describedby` for help/errors and `aria-invalid` for validation. Put error text next to the input. Loading, unavailable, empty and success states must preserve the user’s context and input.

Reuse `Modal` for focus containment, Escape dismissal, and restoring focus to the opening control. Use headings and a clear close control. Existing world panels remain contextual, with their navigation visible. Avoid replacing a panel with a full-page scene for a short action.

The specimen’s note form is local-only and explicitly says so. It must not send data to the application API or imply a real delivery.

## Motion

| Interaction        | Duration | Behavior                                           |
| ------------------ | -------- | -------------------------------------------------- |
| Press              | 100 ms   | A 1 px press, slight scale; no delay before action |
| Control feedback   | 160 ms   | Color and selection change                         |
| Panel / icon       | 240 ms   | Short directional entry or geometry interpolation  |
| Character flourish | 600 ms   | Infrequent and interaction-triggered               |

Use `cubic-bezier(0.22, 0.75, 0.25, 1)`. Desktop panels arrive horizontally; mobile sheets arrive vertically. Preserve the surface when only its contents change. Avoid infinite decorative motion in frequently used controls.

`MorphIcon` retains three lines, interpolates from its current coordinates when interrupted, and cancels animation on unmount. Reduced motion sets durations to zero, removes transforms, and immediately settles geometry. Check the transition itself, not only its endpoints.

RAEA authors the downloadable brand film. The world UI uses browser/CSS/React motion and the resident uses Three.js. The native RAEA engine is not shipped as an application dependency, and video is not a substitute for working controls.

## Voice and acceptance

Lead with the shared world and what people and characters can do in it. The core line is “Digital lives. Shared worlds.” Explain interactions, decisions, memories, and changes to the environment. Introduce Hubert as the first resident, not as the product’s whole purpose. Keep anatomy, renderer details, model routing, and file paths out of product introductions. Technical explanations belong in operator/developer documentation; privacy information stays beside the actions it affects. Avoid mascot jokes as a substitute for a useful explanation. Never promise instant replies or capabilities that are not connected.

Before shipping: inspect at desktop and 390 px; check actual font and asset loading; test keyboard navigation, focus return, empty/error/loading states, reduced motion, interrupted animation, and form submission. Verify contrast for each new text/background combination. Keep decorative motion optional and video playback user initiated.

Relevant automated checks: `tests/e2e/design-system.spec.ts` plus the existing world, account and modal tests. The design-system page is a separate Vite entry and is included in the production build.
