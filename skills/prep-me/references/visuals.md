# Diagrams and video

## Diagrams

Diagrams are hand-written SVG files in `media/`. They must read well in light and dark themes, on a phone and on a laptop.

- **Self-contained.** No external images, fonts, scripts or CSS files. Use `font-family="system-ui, -apple-system, Segoe UI, sans-serif"`.
- **Own background.** Draw a full-size `<rect>` with a light fill (`#ffffff` or `#f8fafc`) first, so that dark text stays readable in dark mode.
- **Size.** Use a `viewBox` of `0 0 1280 720` and `width="1280"`. This fits a phone and also fills a video frame. Keep content at least 40 px from each edge.
- **Text.** 26 to 34 px for labels and 40 to 48 px bold for the title, in dark text (`#0f172a`). Nothing under 22 px. Keep labels to 1 to 4 words.
- **Color.** 3 to 4 colors, each with a meaning: blue `#2563eb` for the main flow, green `#16a34a` for value, orange `#ea580c` for risk, gray `#64748b` for supporting parts. Fill boxes with a light tint and stroke them with the full color.
- **Accessible.** Add `role="img"` on the root, and `<title>` and `<desc>` as its first children. The Markdown alt text says what the diagram shows.
- **Valid XML.** Escape `&` as `&amp;` and `<` as `&lt;`. `prep.mjs check` parses each embedded SVG.
- **Truthful.** Every label comes from a card. Mark a guess as a guess.

Useful shapes:

| Type | Use it for |
|---|---|
| Flow | How a business, process or decision works |
| Map of people | Who reports to whom, who decides, who introduced whom |
| Landscape | Players or options in a 2×2 or in columns |
| Timeline | How the situation got here, and what comes next |
| Before and after | What changes |

## The generated explainer

A 60 to 90 second video that teaches the core concept. Each scene is one picture and one short block of narration. Reuse the brief's diagrams where you can.

Write `media/video.json`:

```json
{
  "title": "How X works",
  "output": "explainer.mp4",
  "voice": "",
  "scenes": [
    { "image": "flow.svg", "narration": "One or two short sentences for this picture." },
    { "html": "<h1>Why it matters</h1><p>Three words here.</p>", "narration": "Say what the picture shows." }
  ]
}
```

- `image` is a path to an SVG, PNG or JPEG, relative to `video.json`.
- `html` is a fragment for a simple text card. The script centers it on a light background. Use either `image` or `html`.
- `voice` is an optional macOS voice name. An empty value uses the profile's voice or the system default.
- `output` is relative to `video.json`.

How to write it:

- Use 5 to 8 scenes and 150 to 220 words. People say about 150 words each minute.
- Start with the point. Scene 1 says what the concept is and why the viewer should care.
- Write for the ear: short sentences, no brackets, no citations, and no abbreviations that a voice will misread. Spell out odd terms the way they sound.
- Make the narration explain the picture. Do not read the labels aloud.
- Do not use private names or anything the route's rules forbid in the narration or on the screen.
- End with the one thing to remember.

The script makes the video, a caption file and `<output>-contact.png`, which shows one frame from each scene. Look at the contact sheet before you hand over.

Good voices sound far better than the default. On macOS, the user can add one in System Settings > Accessibility > Spoken Content > System Voice > Manage Voices. Tell the user once if the voice sounds robotic. Do not ask them to pay for anything.
