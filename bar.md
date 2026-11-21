# The bar

Reference: **Mercury demo dashboard**, https://demo.mercury.com/dashboard and
https://demo.mercury.com/transactions (public, fetched 2026-11-20;
reference images kept out of this repo). Secondary, for the KPI strip only: Plausible's live demo,
https://plausible.io/plausible.io.

Chosen over Plausible (good KPI strip, but sparse) and Sentry's sandbox (it wants an email address before it lets you in, so it was not fetched).

Every line below is a mechanism a critic can check on a screenshot. Each one is a pass or a fail.

1. **One filled button per screen.** The primary action is the only filled accent
   control. Every other action is a neutral pill or a ghost icon button. Accent colour
   appears in only two other places: the active chart series and focus rings.
2. **Hairlines, not shadows.** Cards and tables use a 1px border, a 12px radius and no
   drop shadow. Separators run the full row width. A shadow means the thing floats
   (a popover, dialog or toast) and nothing else.
3. **Numbers are set, not dumped.** Figures use tabular numerals. Units and decimals sit
   smaller than the main figure ("98.4%" has a smaller ".4%"). Numbers are right-aligned in tables.
   A trend is an arrow plus a signed delta, never colour alone.
4. **The chrome recedes.** The sidebar is a tinted surface with 36px nav rows (a 16px icon
   and a label). The active row is a filled tint pill, not an accent bar. The page title is the largest
   text on screen, in a light display weight. There is nothing decorative: no gradients behind
   content, no illustrations, no emoji.
5. **Charts carry one idea.** One highlighted series with a soft fill, no y-axis, no
   gridlines, about 5 muted x-axis labels. A comparison series, if any, is a neutral dashed line.
6. **Status lives in chips.** Red, amber and green appear only inside a status chip (a tinted
   background with darker text, contrast of at least 4.5:1) or on a signed delta. No coloured card backgrounds.
7. **Dense but calm.** Table rows are 44 to 50px, headers are 13px and muted, and filters sit as one
   row of outline dropdown chips above the content. At 390px wide the sidebar becomes a
   drawer, the primary action goes full width, cards stack, and nothing scrolls sideways.

Motion (a dashboard, so there is no scroll-linked motion): state changes take 150 to 200ms with one
easing curve, `cubic-bezier(0.16, 1, 0.3, 1)`. Only transform and opacity animate.
Everything is instant under `prefers-reduced-motion`.

Honesty rule (from the owner): every number shown is either real data from the
database or labelled **Test fixture** in the UI. The app never shows fake live metrics.
