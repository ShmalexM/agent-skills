# Diagram style

Pack diagrams are hand-written SVG files, saved next to the pack and embedded with `![alt](file.svg)`. They must read well in light and dark themes, on a phone and on a laptop, in Obsidian, GitHub and a browser.

## Rules

- **Self-contained.** No external images, fonts, scripts or CSS files. Use `font-family="system-ui, -apple-system, Segoe UI, sans-serif"`.
- **Own background.** Draw a full-size `<rect>` with a light fill (`#ffffff` or `#f8fafc`) and rounded corners first. Notes apps in dark mode then still show dark text on a light card.
- **Size.** `viewBox` about 720 wide by 300 to 520 tall, with `width="720"`. No content within 16 px of the edge.
- **Text.** 14 to 16 px for labels, 18 to 20 px bold for the title, and dark text (`#0f172a`). No text under 12 px. Keep labels to 1 to 4 words, and use the same terms as the pack.
- **Color.** 3 to 4 colors at most, each with a meaning, for example:
  - blue `#2563eb` for the main flow;
  - green `#16a34a` for money or value in;
  - orange `#ea580c` for risk or failure;
  - gray `#64748b` for supporting parts.
  Fill boxes with a light tint of the color (for example `#dbeafe`) and stroke them with the full color.
- **Arrows.** Define one `<marker>` arrowhead in `<defs>` and reuse it. Label an arrow when the label explains the step ("pays $100", "mints 100 tokens").
- **Accessible.** Add `<title>` and `<desc>` as the first children of `<svg>`, and add `role="img"` on the root. The alt text in the Markdown says what the diagram shows.
- **Valid XML.** Escape `&` as `&amp;` and `<` as `&lt;` in text. `queue.mjs check` parses every embedded SVG.

## Diagram types that usually help

| Type | Use it for | Shape |
|---|---|---|
| How it works | a mechanism or loop | 4 to 7 boxes left to right, numbered arrows, an optional return path |
| Landscape | types, players or options | a 2×2 grid, or 3 to 5 columns with one example each |
| Timeline | how something got here | a horizontal line with 4 to 8 dated events |
| Before and after | what changes | two panels side by side with the same layout |

## Skeleton

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 320" width="720" role="img">
  <title>How X works</title>
  <desc>Step-by-step flow: A sends B to C, which ...</desc>
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="#334155"/>
    </marker>
  </defs>
  <rect x="0" y="0" width="720" height="320" rx="16" fill="#f8fafc"/>
  <text x="24" y="40" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="20" font-weight="700" fill="#0f172a">How X works</text>
  <rect x="24" y="120" width="150" height="64" rx="10" fill="#dbeafe" stroke="#2563eb" stroke-width="2"/>
  <text x="99" y="157" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="15" fill="#0f172a">Step one</text>
  <line x1="174" y1="152" x2="250" y2="152" stroke="#334155" stroke-width="2" marker-end="url(#arrow)"/>
</svg>
```
