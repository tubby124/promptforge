// System-prompt builder for PromptForge.
//
// Two modes:
//   - sharpen (default): light pass. Voice-preserving, ~same length as input.
//     Cleans grammar, clarifies ambiguity, adds minimal structure, bakes in
//     persona briefly. AI-readable, not 600 words of XML.
//   - deep (opt-in): full Lyra-4D heavyweight optimization. Structured
//     sections, role assignment, output spec, target-AI tuning, technique hints.
//
// Image-gen ALWAYS uses deep regardless of caller intent — structured tokens
// are the whole point of image-gen optimization.

const CATEGORY_GUIDANCE = {
  email:
    `OUTPUT FORMAT: a complete, send-ready email. Include subject line on first line as "Subject: ...", then a blank line, then the body. Match the user's voice. End with the user's signature block if present in their profile. Do NOT add commentary, headers, or markdown fences.`,
  'image-gen':
    `OUTPUT FORMAT: a single dense image-generation prompt, ready to paste into Midjourney / DALL-E / Sora / Stable Diffusion. Layer these dimensions explicitly: subject, composition, camera/lens, lighting, color palette, mood, style anchor, quality boosters. No prose, no explanations, no "here is your prompt" — only the prompt itself. If the user named a style, pull the structured tokens from the style pack and weave them in. If the target is Midjourney, end with appropriate --ar and --style/--v flags.`,
  code:
    `OUTPUT FORMAT: a precise technical request. Include: stack/language/version, what exists already, what to build, constraints (perf, deps allowed/forbidden), expected interface (signatures and types), examples of input/output, and a clear "deliverable" line stating what good looks like. For non-trivial work, ask the AI to think through approach before coding.`,
  marketing:
    `OUTPUT FORMAT: a marketing-asset prompt. Include: audience (specific, not "everyone"), channel, primary outcome, voice, must-include hooks, must-avoid words, length, CTA. Add 1–2 reference patterns or competitors if relevant. State the proof element required (stat, testimonial, demo, screenshot).`,
  research:
    `OUTPUT FORMAT: a research-grade prompt. Specify: scope, time horizon, sources to prefer/avoid, depth, what counts as evidence, how to handle uncertainty, and exact output structure (sections, tables, bullets). Demand citations with URLs where applicable. State what counts as a complete answer.`,
  general:
    `OUTPUT FORMAT: a fully structured prompt using [ROLE] [CONTEXT] [TASK] [CONSTRAINTS] [OUTPUT FORMAT] sections. Keep it self-contained.`,
};

const TARGET_AI_TUNING = {
  claude:
    `Target: Claude. Use XML-style tags (<role>, <context>, <task>, <constraints>, <output_format>) and a calm, collaborative tone. Claude responds well to long context and explicit reasoning instructions. End with a "Think before answering. Begin." line for non-trivial tasks.`,
  chatgpt:
    `Target: ChatGPT/GPT. Use clearly labeled sections (ROLE, CONTEXT, TASK, CONSTRAINTS, OUTPUT) and direct instructions. Front-load the most important constraints. Add "Take your time and think through this step by step." for non-trivial tasks.`,
  gemini:
    `Target: Gemini. Emphasize creative framing and comparative reasoning. Sectioned format works; explicit output schema helps. Gemini benefits from "consider multiple perspectives before answering."`,
  grok:
    `Target: Grok. Be direct, allow slight informality, but lock down the output spec. Grok responds well to challenges and contrarian framing — use sparingly when appropriate.`,
  perplexity:
    `Target: Perplexity. Emphasize source preferences, recency, and require inline citations [1] [2] style in the output. State the time horizon for sources explicitly.`,
  midjourney:
    `Target: Midjourney. Single-line dense prompt with tokens separated by commas. Front-load the subject. End with --ar <ratio> and --v 6.1 or --style raw as appropriate. Do not include explanations, only the prompt line.`,
  'image-gen':
    `Target: generic image generator. Single dense prompt, no prose. Layer subject + composition + camera + lighting + style + quality.`,
  generic:
    `Target: generic LLM. Use universal sectioned structure.`,
};

const TARGET_AI_SHARPEN_HINT = {
  claude: 'Claude reads structured prose well — short labeled sections OK.',
  chatgpt: 'GPT responds to direct, front-loaded asks. Brief.',
  gemini: 'Gemini wants the goal stated plainly.',
  grok: 'Grok prefers direct, slightly informal phrasing.',
  perplexity: 'Perplexity needs citation-readiness — name the time horizon.',
  midjourney: 'Dense comma-separated tokens, no prose.',
  'image-gen': 'Dense comma-separated tokens, no prose.',
  generic: 'Plain, clear, no XML.',
};

// Resolve the effective mode. Image-gen always forces deep.
export function resolveMode({ mode, category }) {
  if (category === 'image-gen') return 'deep';
  return mode === 'deep' ? 'deep' : 'sharpen';
}

export function buildSystemPrompt({ profile, category, pack, targetAi, mode }) {
  const cat = (category && CATEGORY_GUIDANCE[category]) ? category : 'general';
  const tgt = (targetAi && TARGET_AI_TUNING[targetAi]) ? targetAi : 'generic';
  const effectiveMode = resolveMode({ mode, category: cat });

  if (effectiveMode === 'sharpen') {
    return buildSharpenSystemPrompt({ profile, category: cat, pack, targetAi: tgt });
  }
  return buildDeepSystemPrompt({ profile, category: cat, pack, targetAi: tgt });
}

function buildSharpenSystemPrompt({ profile, category, pack, targetAi }) {
  const personaLine = profile ? renderProfileInline(profile) : 'no persona configured';
  const profileAddendum = (profile?.customSystemPrompt || '').trim();
  const targetHint = TARGET_AI_SHARPEN_HINT[targetAi] || TARGET_AI_SHARPEN_HINT.generic;
  const catLine = category === 'email'
    ? 'Email: open with "Subject: ..." line, then blank line, then body. End with the persona signature if present.'
    : category === 'code'
      ? 'Code: keep the technical specifics. Add stack/version only if obvious from context.'
      : category === 'marketing'
        ? 'Marketing: keep the audience specific and the CTA explicit. Do not add corporate jargon.'
        : category === 'research'
          ? 'Research: name the time horizon and required source quality if relevant.'
          : '';

  return `You are a prompt sharpener. Your one job: take the user's raw input and return a tightened, clearer version of the SAME request, preserving their intent, voice, and approximate length.

Output ONLY the sharpened prompt. No preamble. No labels. No XML. No markdown sections. No "here is your..." opener.

Persona to bake in subtly (one short sentence is enough — do NOT turn this into a section header):
${personaLine}
${profileAddendum ? `\nAdditional persona instructions: ${profileAddendum}\n` : ''}
Target AI: ${targetAi} — ${targetHint}
${catLine ? `Category note: ${catLine}\n` : ''}
Rules:
- Match the user's voice and tone. Casual stays casual. Formal stays formal.
- Length must be similar to input. Never balloon a one-sentence ask into a multi-paragraph spec.
- Fix grammar. Clarify ambiguity. Strengthen verbs. Cut filler.
- Keep every specific name, person, situation, or fact the user mentioned.
- Add at most one tiny anchor for the target AI if it helps (e.g. "(reply directly, no preamble)") — never a full structured section.
- Never include the user's input verbatim — rewrite it.
- Never say "I hope this helps" / "Certainly!" / emoji unless the persona's voice specifically calls for them.
- If the input is already clear and tight, return a near-identical version — do not add structure for its own sake.`;
}

function buildDeepSystemPrompt({ profile, category, pack, targetAi }) {
  const profileBlock = profile ? renderProfile(profile) : 'No persona configured — write the prompt for a generic professional user.';
  const packBlock = pack ? renderPackHints(pack, category) : '';
  const catGuidance = CATEGORY_GUIDANCE[category];
  const targetGuidance = TARGET_AI_TUNING[targetAi];
  const profileAddendum = (profile?.customSystemPrompt || '').trim();

  return `You are Lyra, a master prompt optimizer using the 4-D methodology (Deconstruct → Diagnose → Develop → Deliver).

Your one job: rewrite the user's raw request into a precision-crafted prompt that will get a far better response from the target AI than the raw version. Output ONLY the optimized prompt — no preamble, no explanation, no "here's your optimized prompt:" line. Just the prompt itself, ready to copy and paste.

# Persona context (bake this into the prompt — make the AI write FOR this person)
${profileBlock}
${profileAddendum ? `\n# Additional persona instructions (must follow)\n${profileAddendum}\n` : ''}
# Category
This request is categorized as: ${category.toUpperCase()}
${catGuidance}

# Target AI tuning
${targetGuidance}

# Style + technique hints (apply where relevant)
${packBlock}

# Hard rules
- Output the optimized prompt only. No meta-commentary. No "here is your..." opener.
- Do not invent facts about the persona that weren't given.
- Do not water down what the user asked for — make it sharper, not safer.
- If the user's input is already excellent, return a tightened version, not a longer one. Length is not quality.
- For image-gen: dense single-prompt format, no sections, no XML, no markdown. Comma-separated tokens.
- For everything else: structured prompt with clearly labeled sections.
- Never include phrases like "I hope this helps", "Certainly!", or emoji unless the persona's voice specifically calls for them.
- Never include the user's raw input verbatim — rewrite it.
`;
}

function renderProfile(p) {
  const lines = [];
  if (p.name) lines.push(`- Name: ${p.name}`);
  if (p.role) lines.push(`- Role / title: ${p.role}`);
  if (p.business) lines.push(`- Business / domain: ${p.business}`);
  if (p.audience) lines.push(`- Primary audience: ${p.audience}`);
  if (p.voice) lines.push(`- Voice / tone: ${p.voice}`);
  if (p.mustInclude) lines.push(`- Must include in outputs: ${p.mustInclude}`);
  if (p.mustAvoid) lines.push(`- Must avoid in outputs: ${p.mustAvoid}`);
  if (p.signature) lines.push(`- Sign-off / signature: ${p.signature}`);
  if (p.notes) lines.push(`- Additional context: ${p.notes}`);
  return lines.length ? lines.join('\n') : 'No persona fields filled in — use neutral professional voice.';
}

function renderProfileInline(p) {
  // Compact one-line persona for Sharpen mode. Skip empty fields.
  const bits = [];
  if (p.role) bits.push(p.role);
  if (p.business) bits.push(`(${p.business})`);
  if (p.voice) bits.push(`voice: ${p.voice}`);
  if (p.audience) bits.push(`audience: ${p.audience}`);
  if (p.mustAvoid) bits.push(`avoid: ${p.mustAvoid}`);
  if (!bits.length) return 'neutral professional, no specific voice';
  return bits.join(' · ');
}

function renderPackHints(pack, category) {
  if (!pack) return '';
  const out = [];

  if (pack.universal_techniques?.length) {
    out.push(`Universal techniques to consider: ${pack.universal_techniques.join(', ')}.`);
  }

  if (category === 'image-gen' && pack.image_styles) {
    out.push('Image style packs (each style is a curated set of tokens — pull whichever style the user implied and weave its tokens into the prompt):');
    const entries = Object.entries(pack.image_styles).slice(0, 80);
    for (const [name, val] of entries) {
      if (typeof val === 'string') {
        out.push(`  - ${name}: ${val}`);
      } else if (val && typeof val === 'object') {
        const parts = [];
        for (const k of ['composition', 'camera', 'lighting', 'color', 'mood', 'style', 'quality']) {
          if (val[k]) parts.push(`${k}=${val[k]}`);
        }
        out.push(`  - ${name}: ${parts.join(' | ')}`);
      }
    }
    if (pack.image_quality_boosters?.length) {
      out.push(`Universal quality boosters to layer: ${pack.image_quality_boosters.join(', ')}.`);
    }
    if (pack.image_negative_defaults?.length) {
      out.push(`Default negatives (include in --no for Midjourney, in negative prompt for SD): ${pack.image_negative_defaults.join(', ')}.`);
    }
    out.push('Always layer: subject + composition + camera/lens + lighting + color/mood + style anchor + quality boosters. Never just style words alone.');
  }

  if (category === 'email' && pack.email_patterns) {
    out.push(`Email patterns to prefer: ${pack.email_patterns.join('; ')}.`);
  }
  if (category === 'code' && pack.code_patterns) {
    out.push(`Code-request patterns to apply: ${pack.code_patterns.join('; ')}.`);
  }
  if (category === 'marketing' && pack.marketing_patterns) {
    out.push(`Marketing patterns: ${pack.marketing_patterns.join('; ')}.`);
  }
  if (category === 'research' && pack.research_patterns) {
    out.push(`Research patterns: ${pack.research_patterns.join('; ')}.`);
  }

  if (pack.role_library && Object.keys(pack.role_library).length) {
    const roles = Object.entries(pack.role_library).slice(0, 20)
      .map(([k, v]) => `${k} (${(v || '').slice(0, 80)}…)`).join('; ');
    out.push(`Role library hints — use when assigning the [ROLE]: ${roles}.`);
  }

  return out.join('\n');
}
