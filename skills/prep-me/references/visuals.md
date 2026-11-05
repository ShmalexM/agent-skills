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
- **Ready to build up.** Wrap each part that a video reveals in `<g data-step="1">`, `<g data-step="2">` and so on. Parts with no `data-step` always show. In a Markdown embed, the SVG shows complete.

Useful shapes:

| Type | Use it for |
|---|---|
| Flow | How a business, process or decision works |
| Map of people | Who reports to whom, who decides, who introduced whom |
| Landscape | Players or options in a 2×2 or in columns |
| Timeline | How the situation got here, and what comes next |
| Before and after | What changes |

## Generated videos

Make a series of 2 to 4 videos, 45 to 90 seconds each, and one concept in each. A video teaches. It does not repeat the brief's advice. A viewer who knew nothing can explain the concept afterward.

Write one `media/NN-name.json` for each:

```json
{
  "title": "How X works",
  "output": "01-how-x-works.mp4",
  "voice": "",
  "pronounce": { "MDR": "M D R", "SOC": "sock" },
  "scenes": [
    { "html": "<h1>The short answer</h1><p>Six words here.</p>", "narration": "Say the point first." },
    { "image": "flow.svg", "steps": [
      { "narration": "This part appears first, while the voice explains it." },
      { "narration": "This part appears next." }
    ] }
  ]
}
```

- `image` is a path to an SVG, PNG or JPEG, relative to the JSON file.
- `html` is a fragment for a simple text card. The script centers it on a light background. Use either `image` or `html`.
- `steps` builds the picture as the voice speaks. Step 1 reveals `data-step="1"`, step 2 adds `data-step="2"`, and so on. Each new part fades in. Use `steps` or `narration`, not both.
- `pronounce` fixes words that the voice misreads. It changes only the audio, so the captions keep the written form.
- `voice` is optional. It can be a path to a piper `.onnx` model or a macOS voice name.
- `output` is relative to the JSON file.

How to write it:

- Use 130 to 220 words in each video. People hear about 150 words each minute.
- Build up at least one diagram in every video. A picture that changes while the voice explains it holds attention, and a static slide does not.
- Start with the point. Say what the concept is and why the viewer should care.
- Use one concrete picture or analogy, and real numbers from the cards.
- Write for the ear: short sentences, no brackets and no citations. Make the narration explain the picture. Do not read the labels aloud.
- Do not use private names or anything the route's rules forbid in the narration or on the screen.
- End with the one thing to remember.

The script makes the video, a caption file and `<output>-contact.png`, which shows one frame from each step. Look at the contact sheet before you hand over.

## The voice

The script prefers [piper](https://github.com/OHF-Voice/piper1-gpl), a free neural voice that runs locally. It sounds far better than the system voices. To set it up:

```bash
uv tool install piper-tts
mkdir -p ~/.local/share/piper-voices && cd ~/.local/share/piper-voices
curl -LO https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/high/en_US-lessac-high.onnx
curl -LO https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/high/en_US-lessac-high.onnx.json
```

The script uses the first model in that folder, or the one that `PREP_ME_PIPER_MODEL` or `voice` names. With no model, it uses macOS `say` or `espeak-ng` and prints a warning.
