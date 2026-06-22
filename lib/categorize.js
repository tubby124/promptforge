// Heuristic auto-categorization. Cheap, deterministic, runs in the popup.
// Returns one of: email | image-gen | image-edit | code | marketing | research | general

const IMAGE_EDIT_HINTS = [
  /\b(edit|modify|change|adjust|retouch|clean\s*up|fix|enhance|upscale|resize|crop|extend|remove\s+background|background\s+removal)\b/i,
  /\b(change|replace|make).{0,40}\b(color|colour|background|text|logo|shirt|sign|banner|sky|object)\b/i,
  /\b(make).{0,50}\b(happier|brighter|darker|cleaner|sharper|bigger|smaller|more\s+\w+|less\s+\w+)\b/i,
  /\b(remove|add|replace).{0,50}\b(handlebar|wheel|face|background|logo|text|object|person|shadow|reflection|artifact)\b/i,
  /\b(reference\s+image|attached\s+image|use\s+this\s+image|from\s+this\s+image|based\s+on\s+this\s+photo)\b/i,
  /\b(print[- ]?ready|bleed|safe\s*margin|CMYK|dpi|resolution|aspect\s*ratio)\b/i,
];

const IMAGE_GEN_HINTS = [
  /\b(image|picture|photo|render|illustration|portrait|landscape|wallpaper|logo|icon|poster|thumbnail)\b/i,
  /\b(draw|paint|sketch|generate|create|make).{0,40}\b(image|picture|photo|art|illustration|of\s+(a|an)\s+\w+)\b/i,
  /\b(midjourney|dall[- ]?e|stable\s*diffusion|sora|flux|sdxl|comfyui|leonardo|runway)\b/i,
  /^\s*\/imagine\b/i,
  /\b(cyberpunk|anime|photoreal|photorealistic|oil\s+painting|watercolor|cinematic|hyperreal|3d\s+render|isometric|low\s*poly|pixel\s*art)\b/i,
  /--ar\s+\d/i,
];

const EMAIL_HINTS = [
  /\b(write|draft|send|reply\s+to)\s+(an?\s+)?(email|message|note|follow[- ]?up)\b/i,
  /\breply\s+to\s+(this|the|my|our)?\s*(customer|client|lead|vendor|supplier)\b/i,
  /\b(subject\s*line|recipient|to\s+(my|the)\s+(client|landlord|tenant|boss|customer|vendor|lead))\b/i,
  /\bsign[- ]?off\b/i,
  /\b(thank\s+you|regards|sincerely)\b/i,
];

const CODE_HINTS = [
  /```/,
  /\b(function|class|interface|component|endpoint|api|sql|query|migration|hook|reducer|controller)\b/i,
  /\b(typescript|javascript|python|rust|go(?:lang)?|swift|kotlin|java|c\+\+|c#|ruby|php)\b/i,
  /\b(next\.?js|react|vue|svelte|tailwind|supabase|postgres|mongo|redis|node|deno|bun|express|fastapi|django|flask)\b/i,
  /\b(bug|error|stack\s*trace|exception|null\s*reference)\b/i,
];

const MARKETING_HINTS = [
  /\b(landing\s+page|hero\s+section|ad\s+copy|headline|cta|tagline|slogan|sales\s+page|conversion|funnel)\b/i,
  /\b(google\s+ads|meta\s+ads|facebook\s+ads|instagram\s+caption|tiktok|reel\s+script|short\s+script|youtube\s+title)\b/i,
  /\b(blog\s+post|seo|meta\s+description|title\s+tag)\b/i,
  /\b(brand|positioning|value\s+prop|unique\s+selling)\b/i,
];

const RESEARCH_HINTS = [
  /\b(research|compare|analyze|analysis|investigate|audit|deep\s*dive|literature|study|whitepaper)\b/i,
  /\b(citations?|sources?|references?|footnotes?)\b/i,
  /\b(market\s+size|tam|sam|som|industry\s+report)\b/i,
];

export function categorize(text) {
  if (!text || !text.trim()) return 'general';
  const t = text.trim();

  if (matchesAny(t, IMAGE_EDIT_HINTS)) return 'image-edit';
  if (matchesAny(t, IMAGE_GEN_HINTS)) return 'image-gen';
  if (matchesAny(t, EMAIL_HINTS)) return 'email';
  if (matchesAny(t, CODE_HINTS)) return 'code';
  if (matchesAny(t, MARKETING_HINTS)) return 'marketing';
  if (matchesAny(t, RESEARCH_HINTS)) return 'research';
  return 'general';
}

function matchesAny(text, regexes) {
  for (const r of regexes) if (r.test(text)) return true;
  return false;
}

export function detectTargetAi(hostname) {
  if (!hostname) return 'generic';
  if (/chatgpt\.com|openai\.com/.test(hostname)) return 'chatgpt';
  if (/claude\.ai/.test(hostname)) return 'claude';
  if (/gemini\.google\.com/.test(hostname)) return 'gemini';
  if (/perplexity\.ai/.test(hostname)) return 'perplexity';
  if (/grok\.com|x\.com/.test(hostname)) return 'grok';
  return 'generic';
}

export const CATEGORIES = ['general', 'email', 'image-gen', 'image-edit', 'code', 'marketing', 'research'];
export const TARGETS = ['generic', 'chatgpt', 'claude', 'gemini', 'perplexity', 'grok', 'midjourney'];
