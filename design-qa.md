# Design QA: Landing voice fullscreen

## Comparison inputs

- Reference: `/var/folders/w9/xglfj8k10sd5vqsxr5vhs71w0000gn/T/codex-clipboard-ea5c1006-485a-4fbd-af76-728533585ace.png` (1200 x 600)
- Implementation: `/tmp/codori-design-qa/landing-voice-final-1200x600.png` (1200 x 600)
- Side-by-side comparison: `/tmp/codori-design-qa/landing-voice-final-comparison.png` (2400 x 600)
- Browser viewport: 1200 x 600
- State: landing route with the fullscreen voice presentation active and the pointer at 1010 x 455

## Findings

- The fullscreen layer measured exactly 1200 x 600 at origin 0 x 0 and covered the complete browser viewport, including the normal sidebar area.
- The CSS-only background preserves the reference's navy, blue-violet, pink, and mint distribution. The implementation is intentionally a little softer around the pointer because the cursor bloom blends into the same palette.
- The background animation runs for 34 seconds and changes hue, saturation, scale, rotation, and four independent background positions.
- Pointer movement from the upper-left to the lower-right produced opposing layer offsets of approximately 16-32 pixels in the captured state, confirming the intended parallax response.
- The desktop pointer bloom measured 1000 x 780 with a 42-pixel blur and palette-tinted layers; its edge no longer reads as a hard circle.
- The Exit control remained visible at the top-right safe-area offset. Escape and the button share the same stop action.
- The isolated visual preview did not attach a backend avatar resource, so its sprite is absent from the screenshot. The existing centered avatar layer remained present in the DOM above the background.
- Browser console verification returned no warnings or errors for the final visual state.

## Comparison history

1. Replaced the initial raster-backed concept with four CSS radial-gradient layers at the user's request.
2. Reworked the initial compact white pointer circle into a larger, blurred blue-violet-cyan bloom.
3. Added damped cursor parallax to all four background layers and pulled the color centers inward after side-by-side comparison showed the first CSS pass was too washed out.

## Final result

passed
