# The "neighborhood" redesign

A visual redesign of Localo inspired by **Nextdoor**, landed on the branch
`redesign/nextdoor`. Nothing about how the app *works* changed — same screens,
same routes, same repositories, same flows. Only the way it looks.

## How to go back

Three levels of undo, cheapest first:

| I want… | Do this |
| --- | --- |
| The old **colors** only, keeping the new layouts | `src/theme/theme.ts` → `DESIGN = 'classic'` |
| The **entire** old design back | `git checkout main` (this work lives on `redesign/nextdoor`) |
| To see exactly what the app looked like before | `git checkout design-before-nextdoor` (tag on the pre-redesign commit) |

The `classic` color scheme is kept in `theme.ts` alongside the new one, so the
first row is a one-word change that needs no git at all.

## What the reference actually looks like

Taken from Nextdoor's own store listing (the app isn't distributed in India, so
the store screenshots are the source):

- A **warm off-white** background — not blue-gray — with pure white cards on top.
- **One** brand color for actions, active states and links, with no second
  accent competing with it. Nextdoor's own is a forest green; **Localo uses a
  warm orange** (`#F2681F`) with a peach companion tone (`#FFE2CC`) — Sagar's
  call, and it suits an Indian local marketplace better than the green did.
- Cards separated by a **thin warm border**, not drop shadows.
- **Pill-shaped** buttons and chips; generously rounded corners throughout.
- A quiet, **flat top bar** — location on the left, small icons on the right.
  No gradients, no colored header block.
- **Stroked line icons** at a consistent weight, filled in when active.

## What changed here

**Tokens** (`src/theme/theme.ts`)
- New `neighborhood` color scheme (orange on warm paper); old navy/blue scheme
  kept as `classic`.
- Radii bumped (`sm` 8→10, `md` 12→14, `lg` 16→18, `xl` 20→24).

**New: `src/components/ui/Icon.tsx`**
- A line-icon set drawn with `react-native-svg` (already a dependency — no new
  package). Emoji were doing icon duty in the navigation and cards, which is the
  main reason the app read as unfinished: they render differently on every
  platform, ignore the theme color, and don't share a baseline.
- Emoji are still used as *content* — a category's 🍔, a deal's badge. The icon
  set is for interface furniture only.

**Primitives**
- `Button` — pill-shaped, borderless, slightly taller, bold label.
- `Card` — full 1px warm border instead of a hairline.
- `Tag` — selected chips go solid brand orange; unselected are white with a border.
- `Stars` — drawn stars instead of ★/☆ glyphs.

**Chrome**
- Bottom tab bar — line icons that fill in when active, no top border.
- Stack header — round back button with a drawn arrow, bolder title, no shadow.

**Screens**
- Home / Stalls / My Business — the blue **gradient sheet is gone**, replaced by
  a flat white header closed with a hairline. All three share it, so the top of
  the app is consistent.
- `ModePills` — one segmented control (white track, orange active segment) rather
  than three floating translucent pills that needed a colored backdrop to read.
- `BusinessCard` — bold name, one muted meta line, soft status chip, icon-led
  metadata.
- New `features/businesses/StatusChip.tsx` — shared by the card and the business
  page so "Open now" looks the same in both.

## Where the color lives

The first pass was too white — a calm palette read as an unfinished one. Color
is deliberately concentrated in three places rather than sprinkled everywhere:

- **The home header sheet AND the bottom tab bar**, both `colors.headerTint`
  (the peach companion tone). Using the same color top and bottom bookends the
  app and leaves the content quiet in between. The mode-pill track and the
  search field go white on top of it so they still read as controls.
- **The category strip**, where every category wears its **own** color from
  `domain/intents.ts` — Food red, Groceries green, Health blue, and so on — as a
  tinted tile, a ring when active, and a matching underline. This is the most
  colorful thing on the page, which is right: it's also the most tappable.
- **The active bottom tab**, whose icon sits in a solid orange pill (a soft
  tint would vanish into the peach bar behind it).

Everything else (cards, body, chrome) stays quiet so those three read clearly.
The one deliberate exception is `StatusChip`, which stays **green** for
open/available — that's the one place the color should mean the conventional
thing rather than carry the brand.

## Known gaps

- **Emoji still appear in action labels and section headings** on the deeper
  screens (`🧭 Get directions`, `📖 View menu & order`, workspace tiles, and so
  on). Converting those to the icon set is a mechanical sweep across roughly 60
  screens that hasn't been done yet.
- The design is **photo-led in the reference but not here** — most businesses
  have no hero image, so cards lead with text. Adding business cover photos
  would do more for the look than any further styling.
- The **deals carousel** keeps its colorful gradient cards. They're content
  rather than chrome, and they give the otherwise-quiet page its color.
