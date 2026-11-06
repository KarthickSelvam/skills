# Visual system: the signal-box mimic panel

The engine's look is fixed on purpose, so every explorer reads the same way. Extend it; don't restyle it per flow.

## World

The panel is a railway signal box's mimic board:
- **Cabinet:** a dark green-black frame (`#262d29`).
- **Board:** grey-green enamel (`#c6d0c1`) with black track lines and insulated-joint ticks at each step boundary.
- **Nameplates:** black with cream lettering, one per lane.
- **Detail plate:** an enamel-white card (`#eff1e8`) beside the board.
- **Console:** lever buttons along the bottom.
- **Type:** Bahnschrift (DIN signage lettering) for everything, and Cascadia Mono for code.

## Lamp grammar

Each colour means exactly one state. Never use them for decoration.

| Lamp | Colour | Meaning |
|---|---|---|
| White | `#fbf8ec` | The route is set (the step is selected and not yet run). |
| Amber | `#f2a516` | Moving: the outbound train, its occupied track, the current step. Also the Play lever. |
| Blue | `#6cb8e0` | Reply: the return train of a round trip, and its track. |
| Green | `#2e9a52` (text uses `#1f7a3d`) | Done. |
| Red | `#d4392a` | Stopped: failure branches only. |

Lit lamps are lenses (a radial highlight and a tight ring), not blurred halos.

## Geometry

| Element | Value |
|---|---|
| Lane height | 70px (28px folded) |
| Step column | 164px |
| Edge padding | 26px |
| Multi-hop routes | Step 16px right at each hop |
| Self-loops | Draw a small rectangle on the lane |
| Train | Moves by transform |
| Progress rail | Fills by `scaleX` |

Never animate layout properties.

## Depth and shape

- **Raised hardware:** hard 2–3px offset shadows with no blur (nameplates, levers).
- **Lamps:** recessed, with an inset shadow.
- **Corners:** 4px on plates and code, 3px on badges, circles for lamps and step studs.

## Breakpoints

| Width | Changes |
|---|---|
| ≤1100px | Route plates wrap to a second row; the keyboard hint is hidden. |
| ≤820px | The page scrolls, the plate stacks under the board, and the console is sticky. Lane kinds, the subtitle and route descriptions are hidden. |

## Accessibility (built in; keep it working)

- Keyboard: Space, ←/→, Home, sequence codes and T.
- Only the current step stud is a tab stop, marked `aria-current="step"`.
- Focus returns to the equivalent control after each re-render.
- Focus ring: ink outline plus an amber ring on light surfaces.
- A polite live region announces each step.
- Reduced motion jumps instead of animating.
