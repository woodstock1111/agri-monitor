---
name: agri-monitor-design
description: Use this skill to generate well-branded interfaces and assets for Agri Monitor (智慧农业 / AI 智慧农业 Agent), either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.

The system is a Chinese-language smart-agriculture admin SPA built around the "iOS 17/18 Liquid Glass" override layer of the upstream `agri-monitor` codebase. The mascot is **小薯 (Xiǎo Shǔ — "Little Sweet Potato")** — a pixel-art kawaii character that represents the AI agent. Default UI language is **Simplified Chinese**; the audience is agronomists at a tropical-crops research institute.

Key files:
- `colors_and_type.css` — all design tokens (colors, type scale, radii, shadows, glass system).
- `assets/agent-sweet-potato.png` — mascot. Always render with `image-rendering: pixelated` to preserve crisp pixels.
- `assets/logo.jpg` — institute crest.
- `preview/` — small "design system tab" cards demonstrating every primitive.
- `ui_kits/web-app/` — full React click-thru recreation of the admin app (Login, Dashboard, Realtime data, agent chat).

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. Lean on Font Awesome 6 Free Solid for all icons (CDN: `https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css`). If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.
