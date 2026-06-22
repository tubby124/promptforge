# Remote pack setup (GitHub Pages)

The extension fetches your style pack from a public URL every 6 hours. This lets you ship knowledge updates (new image styles, new role templates, tone tweaks) without re-publishing the extension code.

## Quick setup — 5 minutes

1. **Create a new GitHub repo** named `promptforge-packs` (public)
2. **Copy this folder's [default-pack.json](default-pack.json)** as the seed:
   ```
   cp ~/Downloads/PromptForge/packs/default-pack.json /path/to/promptforge-packs/v1.json
   ```
3. **Push it to GitHub:**
   ```
   cd /path/to/promptforge-packs
   git init && git add v1.json && git commit -m "init pack v1"
   git branch -M main
   git remote add origin https://github.com/YOUR-USER/promptforge-packs.git
   git push -u origin main
   ```
4. **Enable GitHub Pages** on the repo → Settings → Pages → Branch: `main`, Folder: `/ (root)` → Save
5. After ~30 seconds Pages serves the file at:
   ```
   https://YOUR-USER.github.io/promptforge-packs/v1.json
   ```
6. **Configure PromptForge** → Settings → "Style pack" section → paste the URL → Save → click "Refresh now" to verify

## Schema

Required:
```json
{ "version": "1.0.0", ... }
```

Recommended fields (all optional except `version`):

| Field | Type | Purpose |
|---|---|---|
| `version` | string | semver tag, surfaced in popup meta line |
| `updated` | string | ISO date, just informational |
| `universal_techniques` | string[] | bullet list of prompting techniques the model should always consider |
| `email_patterns` | string[] | category-specific guidance for email prompts |
| `code_patterns` | string[] | category-specific guidance for code prompts |
| `marketing_patterns` | string[] | category-specific guidance for marketing prompts |
| `research_patterns` | string[] | category-specific guidance for research prompts |
| `image_styles` | object | named style packs — see schema below |
| `image_quality_boosters` | string[] | tokens always layered into image prompts |
| `image_negative_defaults` | string[] | default negative tokens for SD/MJ |
| `profile_templates` | object | rich profile templates that prefill profile fields |
| `role_library` | object | named role templates the model can adopt |

### Image style schema

Each entry in `image_styles` can be a **string** (legacy, one-liner) OR a **structured object**:

```json
"cyberpunk-street": {
  "composition": "low angle, rain-slicked pavement reflections, dense vertical signage",
  "camera": "35mm at f/2, slight tilt-shift effect",
  "lighting": "neon dominated, magenta and cyan, holographic billboards",
  "color": "magenta, cyan, electric blue, sodium-vapor orange accents",
  "mood": "alienated, hyper-stimulated, gritty",
  "style": "Akira, Ghost in the Shell, Blade Runner influence",
  "quality": "8k, ultra-detailed, atmospheric particles"
}
```

The optimizer layers these into the final image-gen prompt so the model gets actual structured tokens to work with, not just a vibe word.

### Profile template schema

Use `profile_templates` when a template should prefill the full profile editor:

```json
"profile_templates": {
  "true-color-graphic-designer": {
    "name": "True Color Graphic Designer",
    "role": "Graphic designer and customer support assistant",
    "business": "True Color Display Printing Ltd.",
    "audience": "Local Saskatoon print customers",
    "voice": "Friendly, practical, clear, local",
    "mustInclude": "Product, size, quantity, deadline, file requirements",
    "mustAvoid": "Invented prices, fake QR codes, impossible turnaround promises",
    "signature": "True Color Display Printing",
    "notes": "Use for customer replies and print design prompts.",
    "customSystemPrompt": "Profile-specific optimizer instructions."
  }
}
```

All fields are optional. The settings page fills only blank fields, so users can apply a template without clobbering existing edits.

### Role library schema

```json
"role_library": {
  "real-estate-agent-calgary": "Calgary-based residential real estate agent with deep knowledge of inner-city neighborhoods, condos, and first-time buyer programs. Direct, honest, no high-pressure sales tactics. Cites recent comparable sales."
}
```

Role descriptions should:
- name the domain + years of experience
- name a specific constraint or value (what they care about, what they refuse to do)
- be 1-3 sentences max

Keep a matching `role_library` entry for important `profile_templates` when you want older extension builds to have a simple fallback.

## Cache + TTL

- Soft TTL: 6 hours — extension fetches in background on alarm
- Hard TTL: 30 days — if the URL is unreachable, the last good pack stays usable for a month before falling back to the bundled pack
- ETag support: extension sends `If-None-Match` on follow-up fetches; serve a stable ETag and you'll save bandwidth
- Force refresh: Settings → "Refresh now" button

## Validation

Before pushing changes, validate the JSON:
```
python3 -c "import json; json.load(open('v1.json')); print('OK')"
```

The extension validates `version` is a string and falls back to the bundled pack if not. Malformed JSON = silent fallback.

## Versioning strategy

Since the URL is hard-coded as `v1.json`, treat the schema as backward-compatible additions only. Breaking changes → ship a new URL (`v2.json`) and bump the extension's default pack URL via code release.

## Sharing with friends

Just give them the URL. Each user pastes it into their Settings. They get your packs, you get to iterate centrally.
