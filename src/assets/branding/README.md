# Purview logo asset pack

The three SVG master files use a transparent canvas and automatically switch their ink/wordmark between near-black and white using `prefers-color-scheme`. Purple brand elements remain consistent in both modes. All lettering is outlined vector geometry, so no fonts are required.

## SVG masters

- `purview-icon.svg` — square mark for NuGet, GitHub avatars, favicons, and package listings
- `purview-logo-horizontal.svg` — compact horizontal mark and wordmark
- `purview-banner.svg` — wide banner crop with generous transparent side spacing

## PNG exports

PNG files are explicitly rendered as `light` or `dark`, because PNG itself cannot react to the viewer's color scheme. All PNGs retain transparent backgrounds.

- Icon: 64, 128, 256, 512, and 1024 px square
- Horizontal: 600×206, 1200×411, and 2400×823 px
- Banner: 1280×320 and 2560×640 px

The icon also includes themed-background PNGs at every icon size:

- `background-square` — a full square light or dark tile
- `background-rounded` — a rounded light or dark tile with transparent outer corners

## Brand colors

- Purple: `#8B3DFF`
- Deep purple: `#6820D2`
- Light-mode ink: `#17141F`
- Dark-mode ink: `#FFFFFF`

Use the light PNG on light backgrounds and the dark PNG on dark backgrounds. For web use, prefer the adaptive SVG master.
