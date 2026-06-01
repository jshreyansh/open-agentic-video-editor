# Open-Agentic-Video-Editor

**Edit videos with AI. In your browser.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Open-Agentic-Video-Editor is a fully browser-based, multi-track video editor with a built-in agentic AI assistant. No install, no uploads — projects and media stay local, while editing, preview, AI generation, transcription, analysis, and export all run in the browser through WebGPU, WebCodecs, Web Workers, OPFS, and the File System Access API.

The AI chat panel lets you describe edits in plain language. The agent calls timeline tools in a multi-turn loop, sees the results of each action, and can ask clarifying questions before acting — so complex edits work reliably without blind JSON generation.

## Features

### AI Agentic Editing

- Multi-turn Gemini agent loop — AI calls tools, reads results, retries, and reasons across up to 8 iterations per request
- 30+ timeline tools: query state, move/trim/split clips, add text, voiceovers, effects, transitions, and more
- `ask_user` clarification tool — AI pauses and asks which clip or track you mean before acting
- Live tool progress shown in the chat panel as each action executes
- `add_captions_from_script` — paste a timestamped script and AI places captions over the video on a dedicated caption track
- `add_voiceover` — generate TTS audio from text and place it on the timeline synced to captions
- Focus tracking — AI remembers the last edited clip so you don't need to repeat context

### Voiceover Recording (DaVinci Resolve-style)

- Mic button in the transport bar launches a 3-2-1 countdown overlay
- Video plays while you narrate — recording syncs to the playhead position
- Stop button or end of timeline auto-stops recording
- Recording placed immediately as an audio item at the correct timeline position

### Timeline & Editing

- Multi-track timeline with video, audio, text, image, shape, mask, and compound clip items
- Linked audio/video editing with split, join, ripple, rolling, slip, slide, and rate-stretch tools
- Cut-centered transitions with live resize, alignment, source-time anchoring, and preview overlays
- Track mute/visibility/lock controls, linked sync badges, track push/pull, and close-gap workflows
- Filmstrip thumbnails, stereo waveforms, snap guides, markers, timecode, and undo/redo
- Source monitor with mark in/out, patch destinations, insert edits, and overwrite edits
- Project templates, auto-match canvas/FPS from first media, and configurable keyboard shortcuts

### Preview & Playback

- Real-time preview with transform, crop, corner-pin, mask, and group gizmos
- Frame-accurate playback through a custom `Clock` and composition runtime
- Fast scrub overlays, decoder prewarming, adaptive preview quality, and source warming
- Two-up and four-up edit panels for ripple, rolling, slip, and slide operations
- GPU color scopes: waveform, vectorscope, and histogram
- Separate project master bus and monitor/device volume

### Audio

- Clip volume, audio fades, track faders, master bus fader, and stereo LED meters
- Per-clip pitch shift in semitones/cents with SoundTouch preview playback
- Clip EQ and track EQ stages, including a compact six-band floating EQ panel
- Pitch, EQ, fades, volume, and transition audio paths are preserved in preview and export

### Effects, Masks & Compositing

All visual effects and compositing paths are WebGPU-first, with fallbacks where practical.

- **Blur:** gaussian, box, motion, radial, zoom
- **Color:** brightness, contrast, exposure, hue shift, saturation, vibrance, temperature/tint, levels, curves, color wheels, grayscale, sepia, invert
- **Distortion:** pixelate, RGB split, twirl, wave, bulge/pinch, kaleidoscope, mirror, fluted glass
- **Stylize:** vignette, film grain, sharpen, posterize, glow, edge detect, scanlines, color glitch
- **Keying:** chroma key with tolerance, softness, and spill suppression
- 25 blend modes, including multiply, screen, overlay, soft light, difference, hue, saturation, color, and luminosity
- Clip masks and pen paths with keyframeable geometry transforms

### Transitions

- Fade, wipe, slide, 3D flip, clock wipe, and iris transitions with directional variants
- Dissolve, sparkles, glitch, light leak, pixelate, chromatic aberration, and radial blur
- Adjustable duration, alignment, source anchoring, and Canvas 2D fallback for non-WebGPU paths

### Keyframe Animation

- Bezier graph editor, dopesheet, split view, and multi-curve overlays
- Easing presets: linear, ease-in, ease-out, ease-in-out, cubic-bezier, spring
- Auto-keyframe mode, tangent mirroring, property accordions, and marquee selection
- Animated transform, crop, mask, text, effect, and color properties

### Media & Analysis

- Import videos, audio, images, GIFs, SVGs, and generated assets without copying originals
- Proxy generation, thumbnail extraction, waveform caching, and media relinking
- Browser Whisper transcription with generated caption text items
- AI captioning with local vision-language providers and configurable sample cadence
- Scene detection with histogram, optical-flow, and optional model verification workflows
- Scene Browser for searching captioned media and reusing detected moments
- Local Kokoro text-to-speech voiceovers
- Local MusicGen music generation with presets, progress, and cancellation

### Projects & Storage

- Workspace folder persistence via the File System Access API
- Multi-workspace switcher with known workspace management
- Projects stored as plain files on disk, with legacy browser-storage migration
- Project soft-delete, restore, empty-trash, and permanent delete flows
- Project ZIP bundle export/import with Zod-validated schemas
- Auto-save, project thumbnails, workspace cache mirroring, and orphan cleanup

### Export

- In-browser rendering through WebCodecs and worker-backed render paths
- **Video containers:** MP4, WebM, MOV, MKV
- **Video codecs:** H.264, H.265, VP8, VP9, AV1, ProRes where supported
- **Audio export formats:** MP3, AAC, WAV/PCM
- Quality presets from low to ultra, with runtime capability checks and fallbacks

## Quick Start

**Prerequisites:** Node.js 22+ recommended, npm 11+, and a modern Chromium browser.

```bash
git clone https://github.com/shreyansjaiswal/open-agentic-video-editor.git
cd open-agentic-video-editor/editor
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in Chrome, Edge, Brave, or Arc.

### Workflow

1. Pick a workspace folder when prompted.
2. Create a project from the projects page.
3. Import media by dragging files into the media library.
4. Drag clips to the timeline, then trim, arrange, add effects, transitions, masks, captions, and audio work.
5. Open the AI chat panel and describe edits in plain language — the agent handles the rest.
6. Record a voiceover using the mic button in the transport bar while watching the video play.
7. Export directly from the browser.

## Browser Support

Chrome or Edge 113+ is recommended. Open-Agentic-Video-Editor depends on WebGPU, WebCodecs, OPFS, and the File System Access API, so a modern Chromium browser is required for the full workflow.

### Brave

Brave may disable the File System Access API. To enable it:

1. Navigate to `brave://flags/#file-system-access-api`
2. Change the setting from **Disabled** to **Enabled**
3. Click **Relaunch** to restart the browser

## Keyboard Shortcuts

| Action | Shortcut |
|---|---|
| Play / Pause | `Space` |
| Previous / Next frame | `Left` / `Right` |
| Previous / Next snap point | `Up` / `Down` |
| Go to start / end | `Home` / `End` |
| Split at playhead | `Ctrl+K` / `Alt+C` |
| Split at cursor | `Shift+C` |
| Join clips | `Shift+J` |
| Delete selected | `Delete` |
| Ripple delete | `Ctrl+Delete` |
| Freeze frame | `Shift+F` |
| Nudge item (1px / 10px) | `Shift+Arrow` / `Ctrl+Shift+Arrow` |
| Undo / Redo | `Ctrl+Z` / `Ctrl+Shift+Z` |
| Copy / Cut / Paste | `Ctrl+C` / `Ctrl+X` / `Ctrl+V` |
| Selection tool | `V` |
| Razor tool | `C` |
| Rate stretch tool | `R` |
| Rolling edit tool | `N` |
| Ripple edit tool | `B` |
| Slip tool | `Y` |
| Slide tool | `U` |
| Toggle snap | `S` |
| Add / Remove marker | `M` / `Shift+M` |
| Previous / Next marker | `[` / `]` |
| Add keyframe | `A` |
| Clear keyframes | `Shift+A` |
| Toggle keyframe editor | `Ctrl+Shift+A` |
| Keyframe view: graph / dopesheet / split | `1` / `2` / `3` |
| Group / Ungroup tracks | `Ctrl+G` / `Ctrl+Shift+G` |
| Mark In / Out | `I` / `O` |
| Clear In/Out | `Alt+X` |
| Insert / Overwrite edit | `,` / `.` |
| Open Scene Browser | `Ctrl+Shift+F` |
| Zoom in / out | `Ctrl+=` / `Ctrl+-` |
| Zoom to fit | `\` |
| Zoom to 100% | `Shift+\` |
| Save | `Ctrl+S` |
| Export | `Ctrl+Shift+E` |

## Tech Stack

- [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- [Vite+](https://github.com/voidzero-dev/vite-plus) for dev, build, lint, format, check, and tests
- [Vite](https://vite.dev/) + [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react)
- [WebGPU](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API) for effects, compositing, transitions, masks, scopes, and AI acceleration
- [WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API) for preview and export pipelines
- [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API) + OPFS for workspace-backed persistence and caches
- [Zustand](https://github.com/pmndrs/zustand) + [Zundo](https://github.com/charkour/zundo) for state management and undo/redo
- [TanStack Router](https://tanstack.com/router) for file-based, type-safe routing
- [Tailwind CSS 4](https://tailwindcss.com/) + [Radix UI](https://www.radix-ui.com/) + shadcn-style components
- [Mediabunny](https://mediabunny.dev/) for media decoding, metadata, and audio encoding support
- [Transformers.js](https://huggingface.co/docs/transformers.js) for local browser AI models
- [Kokoro.js](https://www.npmjs.com/package/kokoro-js) for WebGPU text-to-speech
- Web Workers and AudioWorklets for heavy media processing off the main thread

## Project Structure

```text
src/
|- app/                     # App bootstrap, error boundary, PWA install prompt, debug utilities
|- components/              # shadcn/ui components and brand assets
|- config/                  # Hotkeys and editor layout configuration
|- features/                # User-facing UI modules
|  |- ai-chat/               # Agentic AI chat: agent loop, tool registry, TTS, transcription
|  |- editor/                # Editor shell, toolbar, panels, dialogs, deps adapters
|  |- effects/               # Effect registry and effect UI
|  |- export/                # WebCodecs export pipeline and canvas fallback rendering
|  |- keyframes/             # Graph editor, dopesheet, animation resolvers
|  |- media-library/         # Import, metadata, proxies, transcription, captioning
|  |- preview/               # Program/source monitors, overlays, gizmos, scopes
|  |- project-bundle/        # ZIP and JSON project import/export
|  |- projects/              # Project list, templates, migration, trash
|  |- scene-browser/         # Caption and scene search UI
|  |- settings/              # Settings store, hotkey editor, model cache controls
|  |- timeline/              # Timeline UI, tools, stores, services, workers
|  |- voiceover/             # DaVinci-style voiceover recording feature
|  \- workspace-gate/        # Workspace picker, permission gate, workspace switcher
|- runtime/                 # Playback and rendering engines (not user-facing UI)
|  |- composition-runtime/   # Composition renderer, media layout, audio graph, masks
|  \- player/                # Clock, player primitives, video source pools
|- infrastructure/          # Platform adapters: browser, storage, GPU, analysis, audio, thumbnails
|- routes/                  # TanStack Router file routes
|- shared/                  # Framework-agnostic primitives + cross-feature state
\- types/                   # Shared TypeScript types
```

Feature modules use their local `deps/` adapters for all cross-feature imports. Platform-coupled code (GPU, ML, audio, storage, browser) lives in `@/infrastructure/*`.

## Contributing

Open-Agentic-Video-Editor is open source. Contributions, bug reports, and feature requests are welcome.

- **Report bugs:** open an issue
- **Suggest features:** start a discussion
- **Pull requests:** welcome — please open an issue first for larger changes

## License

[MIT](LICENSE)
