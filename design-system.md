# Lathar Labs design system (dashboard)

Starts from the live console's `static/tokens.css` ("Paper & Forest", which is still a proposal
there too), so both Lathar Labs tools look like one product. Changes from it:
a dark mode, a denser app type scale, and no serif inside the app.

## Brand
- Wordmark: the text **Lathar Labs** in Hanken Grotesk 600, tracking -0.01em. "Labs"
  is in `--text-secondary`. There is no logo mark yet.
- Not WhatsApp's green and not its logo. This is our tool, not Meta's.

## Type
- UI: Hanken Grotesk (OFL, self-hosted woff2 reused from the console). Mono:
  `ui-monospace` for IDs, keys and error codes only.
- Scale: 12/16 meta · 13/18 table header · 14/20 body (the app default) · 16/24 card figure
  label · 28/36 weight 380 page title · 32/40 weight 500 KPI figure, `font-variant-numeric: tabular-nums`.

## Colour tokens (semantic only; components never use a raw hex)
| token | light | dark |
|---|---|---|
| --bg | #fbfaf7 | #121311 |
| --surface (sidebar, hover) | #f3f1ec | #1a1c19 |
| --surface-raised (cards) | #ffffff | #1e201d |
| --text | #1b1a17 | #ecebe6 |
| --text-secondary | #524e46 | #b4b1a8 |
| --border | #e4e0d7 | #2c2e2a |
| --border-strong | #8d887c | #6b6e66 |
| --accent | #1f6f4a | #4fb487 |
| --accent-subtle | #e3efe8 | #1c3328 |
| --on-accent | #ffffff | #0b1a12 |
| --success / -bg | #17663d / #e4f2e9 | #6fd19c / #173024 |
| --warning / -bg | #855600 / #fbf0d3 | #e8b85a / #33280f |
| --error / -bg | #ab2a1f / #fbe9e5 | #f08a7e / #3a1a16 |

Secondary text is at least 7:1 on every background in both themes (raised from 6:1 after review).

## Space and shape
4px base: 4 8 12 16 24 32 48. Control height 36 (dense) or 40. Radius: buttons
(primary and secondary) and segmented controls 999 (pills, as in the bar); inputs,
nav rows and menus 8; cards 12; chips 999. Elevation means a border. `--shadow-float` is only for popovers, dialogs and toasts.

## Motion
150 to 200ms, `cubic-bezier(0.16, 1, 0.3, 1)`, transform and opacity only, instant
under reduced motion. framer-motion handles presence (toasts, sheets, dialogs). No GSAP and no
Lenis in the app: there is no scroll-linked motion in a data tool.

## Components (shadcn/ui, restyled through these tokens)
Button (primary is filled, at most one per screen; secondary is a neutral pill; ghost is
icon only), Card, Table, Chip/Badge (status), Dropdown filter chip, Dialog (confirm
before any send or delete), Toast (Sonner), Skeleton, EmptyState (one line plus one action).
