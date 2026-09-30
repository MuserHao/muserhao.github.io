# HX Monogram Logo -- Design Logic

## Overview

The mark is one glyph that reads as both letters: an **H** whose two legs lean toward a shared vanishing point, with an **X** where the crossbar would be. It sits inside a ring broken into three symmetric strokes; the top break, where the legs point, is mended in gold.

```
    viewBox: 0 0 40 40
    ring:    center (20,20), radius 16, stroke 1.4
    render:  48 x 48 px in the nav (logo.svg, inlined by shared.js)
```

## Elements

| Element | Geometry | Meaning |
|---|---|---|
| Ring | three equal brush strokes around r=16, each swelling in the middle and tapering at both ends; breaks centered at 270° (top), 30° and 150° (SVG angles), 22° wide | Three-fold symmetry; the circle is held together by its breaks |
| Gold seam | a thin gold arc (stroke 0.9) in the top break only | Kintsugi on the break the two legs point at: the horizon they never reach is the part mended in gold |
| H legs | filled, tapering from 3.0 wide at the base (y=30.25) to 1.7 at the top (y=9.75); centerlines (12.75,30.25) to (16.15,9.75), mirrored | Two paths narrowing toward a horizon they never reach. Both tops are cut on one horizontal line: the horizon |
| X | gold, stroke 1.7, from y=16.75 to y=24.25, drawn under the legs so its ends tuck behind them | The crossbar that holds the H together is the X |

The legs converge gently (top gap about 7.7 units, base gap about 14.5). Earlier versions converged so hard that the H read as an A.

## Color

- `currentColor` takes the theme's text accent: cyan in the dark theme, ink in the light theme.
- Gold comes from `var(--logo-gold, #C9A64E)`. The light theme sets `--logo-gold: #a8862e` in zen.css so the gold holds its contrast on paper.

## Favicon

`favicon.svg` drops the ring, which disappears at 16 px, and draws a heavier version of the glyph on a dark rounded tile.
