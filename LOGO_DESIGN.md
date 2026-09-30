# HX Monogram Logo -- Design Logic

## Overview

The mark is one glyph that reads as both letters: an **H** whose two legs lean toward a shared vanishing point, with an **X** where the crossbar would be. It sits inside an open ring whose break is mended in gold.

```
    viewBox: 0 0 40 40
    ring:    center (20,20), radius 16, stroke 1.4
    render:  48 x 48 px in the nav (logo.svg, inlined by shared.js)
```

## Elements

| Element | Geometry | Meaning |
|---|---|---|
| Ring | arc from 290° to 340° is gold, the rest `currentColor` | Kintsugi: the break is kept and mended in gold, not hidden |
| H legs | (12.75,30.25) to (16.15,9.75) and (23.85,9.75) to (27.25,30.25), stroke 2.3 | Two paths converging on a horizon they never reach |
| X | crosses between the legs from y=16.75 to y=24.25, stroke 2.0, gold | The crossbar that holds the H together is the X |

The legs converge gently (top gap 7.7 units, base gap 14.5), halfway between a stronger perspective and near-parallel legs. Earlier versions converged so hard that the H read as an A.

## Color

- `currentColor` takes the theme's text accent: cyan in the dark theme, ink in the light theme.
- Gold comes from `var(--logo-gold, #C9A64E)`. The light theme sets `--logo-gold: #a8862e` in zen.css so the gold holds its contrast on paper.

## Favicon

`favicon.svg` drops the ring, which disappears at 16 px, and thickens the glyph on a dark rounded tile.
