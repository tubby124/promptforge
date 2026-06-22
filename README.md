# PromptForge

Profile-aware prompt optimizer for ChatGPT, Claude, Gemini, Perplexity, Grok, Midjourney, and friends.

Built as a Chrome extension. Calls **Claude Haiku 4.5 via OpenRouter** to rewrite your raw input into a precision-crafted prompt, automatically wrapped in your saved persona (role + business + audience + voice). Auto-detects category (email / image-gen / code / marketing / research) and routes to the right system-prompt chain.

Two modes:
- **Sharpen (default)** — light pass. Cleans grammar, clarifies ambiguity, bakes persona in briefly. Output is roughly the same length as your input. Voice-preserving.
- **Deep** — full Lyra-4D heavyweight optimization. Structured sections, role assignment, target-AI tuning, output spec. Use for complex multi-step tasks. Image-gen always uses Deep regardless of toggle.

Designed for personal + small-team use. Not on the Chrome Web Store.

---

## Install (once per machine)

1. **Clone or download** this folder somewhere stable:
   ```
   git clone https://github.com/tubby124/promptforge ~/Apps/PromptForge
   ```
   (Or just keep it where it lives now: `~/Downloads/PromptForge`.)

2. **Open Chrome** → `chrome://extensions`
3. Toggle **Developer mode** (top-right)
4. Click **"Load unpacked"** → select the `PromptForge` folder
5. Pin the extension to the toolbar (puzzle icon → pin PromptForge)
6. The Options page opens automatically on first install. Set up:
   - **OpenRouter API key** → get one at https://openrouter.ai/keys (~$5 of credit goes a long way at ~$0.004/optimization with Haiku 4.5)
   - **At least one profile** (your role, business, audience, voice). The default profile works but is generic.

That's it. You're set.

---

## How to use

### From the toolbar
- Click the PromptForge icon → paste your rough prompt → pick category (or leave on Auto) → **Optimize**
- Click **Copy** or **Inject into page** (when you're on a supported LLM site)

### From inside any supported LLM site
- A floating ⚒ button appears in the bottom-right corner of chatgpt.com / claude.ai / gemini.google.com / perplexity.ai / grok.com / x.com/i/grok
- Click it → opens the optimizer with whatever you typed already pre-filled
- Or use the keyboard shortcut: **Cmd+Shift+O** (Mac) / **Ctrl+Shift+O** (Win/Linux)

### Working from an image
- Click **Add image** in the popup and attach up to 3 PNG/JPG/WebP reference images
- Type what you want changed, e.g. "resize this for a 4x8 ft banner, change the red to True Color blue, keep the logo sharp"
- Leave Category on Auto or choose **Image edit / resize**
- PromptForge sends the reference image to the optimizer model and returns a clean image-editing prompt for ChatGPT image generation or another vision-capable image model
- Images are not saved to history; history keeps only the text request plus file names/dimensions

### Categories — what changes
| Category | What the optimizer does |
|---|---|
| **email** | Returns a send-ready email with subject line, body, and your saved signature. No commentary. |
| **image-gen** | Returns a single dense prompt with subject + composition + camera/lens + lighting + style + quality tokens. Ready for Midjourney/DALL-E/Sora/Stable Diffusion. |
| **image-edit** | Returns a precise edit prompt based on attached reference image(s): what to change, what to preserve, output size, colour/file constraints, and proof checks. |
| **code** | Returns a precise technical request with stack, constraints, expected interface, deliverable definition. |
| **marketing** | Audience + channel + hook + CTA + voice + anti-pattern guardrails. |
| **research** | Scope + source preferences + depth + output structure + citation requirements. |
| **general** | Universal `[ROLE] [CONTEXT] [TASK] [CONSTRAINTS] [OUTPUT FORMAT]` structure. |

### Target AI tuning
The optimizer adapts output style per target:
- **Claude** → XML tags
- **ChatGPT** → labeled sections
- **Midjourney** → dense single-line prompt with flags
- etc.

---

## OTA style pack updates (the magic)

Most updates ship without re-installing the extension.

**Architecture:**
- The **engine** (rewriter, UI, OpenRouter caller) ships in the extension code itself.
- The **knowledge** (image-gen styles, role library, category guidance, marketing patterns) lives in a JSON file at a URL you control.
- The extension fetches that JSON every 6 hours (and on browser start) and caches it locally.

**Default pack URL:** `https://tubby124.github.io/promptforge-packs/v1.json`

### To add a new image-gen style (or anything else)
1. Edit `v1.json` in your `promptforge-packs` repo
2. Push to GitHub → GitHub Pages serves it on the CDN
3. All users get it next time their browser starts (or within 6h, or instantly when they click "Refresh now" in Settings)

### Setting up your own pack URL
1. Create a GitHub repo, e.g. `promptforge-packs`
2. Copy `packs/default-pack.json` from this repo as the seed
3. Enable GitHub Pages → branch `main`, folder `/`
4. Pack will be served at `https://YOUR-USER.github.io/promptforge-packs/v1.json`
5. Update the **Pack URL** in PromptForge → Settings

The pack must include `{ "version": "..." }` at minimum. The full schema is documented inline in [packs/default-pack.json](packs/default-pack.json).

---

## Extension code auto-update (private CRX channel)

If you want code updates without telling friends to "go to chrome://extensions and reload":

1. Build a signed `.crx` from this folder (Chrome has built-in packaging at `chrome://extensions` → "Pack extension")
2. Host the `.crx` + an `updates.xml` on GitHub Releases
3. Add to `manifest.json`:
   ```json
   "update_url": "https://github.com/tubby124/promptforge/releases/download/latest/updates.xml"
   ```
4. Re-pack and re-distribute one final time. Chrome will then poll daily and auto-install future versions.

For now (v0.1) the easiest path is: tell your friends to `git pull && reload extension`. Once the engine stabilizes (probably v0.5), wire up the CRX channel.

---

## File layout

```
PromptForge/
├── manifest.json          # MV3 manifest
├── background.js          # service worker — OpenRouter calls, pack fetching, tab injection
├── popup.html/css/js      # main optimizer UI (action popup)
├── options.html/css/js    # settings + profile editor + pack URL config
├── content.js/content.css # floating ⚒ button on LLM sites
├── lib/
│   ├── optimizer.js       # Lyra 4-D system prompt builder
│   ├── profiles.js        # profile CRUD in chrome.storage.local
│   ├── packs.js           # OTA pack fetcher + cache + TTL
│   └── categorize.js      # auto-detect category + target AI from URL
├── packs/
│   └── default-pack.json  # bundled fallback pack (used until OTA fetch succeeds)
├── icons/                 # 16/48/128 PNGs (regenerate with scripts/gen-icons.py)
└── scripts/
    └── gen-icons.py       # Pillow-based icon generator
```

---

## Security model

- **API key** is stored in `chrome.storage.local` only. Never synced. Never logged. Never sent anywhere except OpenRouter.
- Each user supplies their own key. There's no shared key, no proxy, no centralized billing.
- Profiles are stored locally only. Your business context never leaves your machine except as part of the prompt you actively send.
- The pack URL is fetched with `cache: 'no-cache'` and validated for shape before use. Schema is checked; a malformed pack falls back to the bundled one.

---

## Cost

Claude Haiku 4.5 via OpenRouter pricing (current as of June 2026):
- Input: ~$1 per million tokens
- Output: ~$5 per million tokens
- Typical optimization: ~800 in / ~600 out = **~$0.004 per click**
- $5 of OpenRouter credit = ~1,250 optimizations

You can change the model in Settings if you want higher quality (Sonnet 4.6, ~5× cost) or alternative providers (GPT-4.1, Gemini 2.5 Flash, Llama 4).

---

## Roadmap

- [x] v0.1 — core optimizer, profiles, OTA pack, popup + content script
- [x] v0.2 — Sharpen/Deep mode toggle, SSE streaming, OTA-managed site adapters, system-prompt debug pane, model verification on save, profile templates, profile export/import, rate-limit backoff
- [ ] v0.3 — per-site adapters that read existing site context (e.g. current Claude conversation history) into the prompt
- [ ] v0.4 — side-by-side diff view of original vs optimized
- [ ] v0.5 — CRX auto-update channel
- [ ] v0.6 — "explain why I changed it" toggle (returns reasoning alongside the prompt)

---

Built by Hasan. Pull requests welcome from the few people who have this.
