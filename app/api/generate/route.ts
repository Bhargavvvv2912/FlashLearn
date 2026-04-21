import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function extractJsonObject(text: string) {
  const cleaned = text.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}') + 1;
  if (start === -1 || end === 0) throw new Error('No JSON object found in model output');
  return cleaned.substring(start, end);
}

function extractJsonArray(text: string) {
  const cleaned = text.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']') + 1;
  if (start === -1 || end === 0) throw new Error('No JSON array found in model output');
  return cleaned.substring(start, end);
}

function escapeControlCharsInStrings(text: string): string {
  let result = '';
  let inString = false;
  let escaped = false;
  const escMap: Record<string, string> = { '\n': '\\n', '\r': '\\r', '\t': '\\t', '\b': '\\b', '\f': '\\f' };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (escaped) { result += c; escaped = false; continue; }
    if (c === '\\' && inString) { result += c; escaped = true; continue; }
    if (c === '"') { inString = !inString; result += c; continue; }
    if (inString && c.charCodeAt(0) < 0x20) {
      result += escMap[c] ?? `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`;
      continue;
    }
    result += c;
  }
  return result;
}

function safeJsonParse(jsonText: string) {
  const cleaned = jsonText.trim();
  try {
    return JSON.parse(cleaned);
  } catch (firstError) {
    try {
      const sanitized = escapeControlCharsInStrings(
        cleaned
          .replace(/[\u201C\u201D]/g, '"')
          .replace(/[\u2018\u2019]/g, "'")
          .replace(/,\s*([}\]])/g, '$1')
      );
      return JSON.parse(sanitized);
    } catch {
      throw firstError;
    }
  }
}

type ExpansionAction = 'simplify' | 'example' | 'drill' | 'reexplain';
type ExpansionMiniCard = {
  title: string;
  content: string;
};

const expansionActions = ['simplify', 'example', 'drill', 'reexplain'] as const;

function isExpansionAction(value: unknown): value is ExpansionAction {
  return (
    typeof value === 'string' &&
    (expansionActions as readonly string[]).includes(value)
  );
}

type QuestionAnswerCard = {
  title: string;
  content: string;
};

function normalizeExpansionCards(parsed: unknown): ExpansionMiniCard[] {
  const candidate =
    Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object'
      ? (parsed as { cards?: unknown; expansionCards?: unknown }).cards ??
        (parsed as { expansionCards?: unknown }).expansionCards
      : null;

  if (!Array.isArray(candidate)) {
    throw new Error('Expansion response did not include a cards array');
  }

  const cards = candidate
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const raw = item as { title?: unknown; content?: unknown };
      const title =
        typeof raw.title === 'string' && raw.title.trim()
          ? raw.title.trim()
          : `Expansion ${index + 1}`;
      const content = typeof raw.content === 'string' ? raw.content.trim() : '';
      if (!content) return null;
      return { title, content };
    })
    .filter((card): card is ExpansionMiniCard => Boolean(card));

  if (cards.length < 2) {
    throw new Error('Expansion response must contain at least 2 usable mini-cards');
  }

  return cards.slice(0, 2);
}

function normalizeQuestionAnswerCards(parsed: unknown): QuestionAnswerCard[] {
  const candidate =
    Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object'
      ? (parsed as { cards?: unknown; answerCards?: unknown }).cards ??
        (parsed as { answerCards?: unknown }).answerCards
      : null;

  if (!Array.isArray(candidate)) {
    throw new Error('Question answer response did not include a cards array');
  }

  const cards = candidate
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const raw = item as { title?: unknown; content?: unknown };
      const title =
        typeof raw.title === 'string' && raw.title.trim()
          ? raw.title.trim()
          : `Answer ${index + 1}`;
      const content = typeof raw.content === 'string' ? raw.content.trim() : '';
      if (!content) return null;
      return { title, content };
    })
    .filter((card): card is QuestionAnswerCard => Boolean(card));

  if (cards.length < 2) {
    throw new Error('Question answer response must include at least 2 usable cards');
  }

  return cards.slice(0, 5);
}

/** Detect if the topic looks like a LeetCode / algorithm problem */
function isCodeProblem(topic: string): boolean {
  const patterns = [
    /\bleetcode\b/i,
    /\balgorithm\b/i,
    /\bdata structure\b/i,
    /\bbinary (search|tree)\b/i,
    /\bdynamic programming\b/i,
    /\bbacktracking\b/i,
    /\b(bfs|dfs|graph traversal)\b/i,
    /\blinked list\b/i,
    /\bhash\s*(map|table|set)\b/i,
    /\btwo pointer\b/i,
    /\bsliding window\b/i,
    /\btime complexity\b/i,
    /o\s*\(\s*n/i,
    /#\s*\d+/,
  ];
  return patterns.some((p) => p.test(topic));
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

export async function POST(req: Request) {
  try {
    const {
      topic,
      about,
      persona,
      difficulty,
      action,
      expansionAction,
      cardTitle,
      currentContent,
      context,
      weakCards,
      cards,
      topicSummary,
      question,
      chatHistory,
      pageContent,
      pageUrl,
      memoryContext,   // Array<{topic, summary, connections}> when "Use Memory" is on
      newTopic,        // for find_connections action
      newSummary,      // for find_connections action
      existingTopics,  // for find_connections action
      mistakes         // for remediation action
    } = await req.json();

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

    if (action === 'expand') {
      const requestedExpansionAction: unknown = expansionAction;
      if (!isExpansionAction(requestedExpansionAction)) {
        return NextResponse.json(
          { error: 'Invalid expansion action' },
          { status: 400, headers: corsHeaders }
        );
      }
      const typedExpansionAction: ExpansionAction = requestedExpansionAction;

      const actionInstructions: Record<ExpansionAction, string> = {
        simplify:
          'Create an easier explanation in exactly 2 mini-cards. Chunk 1 should restate the idea simply. Chunk 2 should make it feel intuitive with one plain-language analogy.',
        drill:
          'Create a deeper, more technical explanation in exactly 2 mini-cards. Chunk 1 should explain the mechanism or principle. Chunk 2 should explain implications, edge cases, or why it matters.',
        example:
          'Create exactly 2 concrete example-based mini-cards. Each mini-card should use a different vivid example that directly continues the parent card.',
        reexplain:
          'Create exactly 2 alternative explanation mini-cards. Each mini-card should use a different framing from the original content without changing the meaning.',
      };

      const expandPrompt = `
You are extending one FlashLearn card with temporary local Expansion Cards.

Rules:
- Generate exactly 2 mini-cards for the selected action.
- These are not standalone lessons. They must feel attached to the parent card.
- Do not change the main learning path, card numbering, quiz, or remediation flow.
- Keep each mini-card focused: title under 8 words, content 2-4 concise sentences or short markdown bullets.
- Match the learner profile and avoid adding unsupported claims.

Selected action: ${typedExpansionAction}
Task: ${actionInstructions[typedExpansionAction]}

Learner: ${about || 'General learner'}
Persona: ${persona || 'Student'}
Difficulty: ${difficulty || 'Medium'}
Context: ${context || 'None'}
Parent card title: ${cardTitle || 'Current card'}
Parent card content:
"""
${currentContent || ''}
"""

Return ONLY valid JSON in this exact shape:
{
  "cards": [
    { "title": "...", "content": "..." },
    { "title": "...", "content": "..." }
  ]
}
`;

      const result = await model.generateContent(expandPrompt);
      const parsed = safeJsonParse(extractJsonObject(result.response.text()));
      const expansionCards = normalizeExpansionCards(parsed);
      return NextResponse.json({ cards: expansionCards }, { headers: corsHeaders });
    }

    // ── REFINE ACTIONS ─────────────────────────────────────────────────────────
    if (action === 'drill' || action === 'simplify' || action === 'example') {
      const legacyAction = action as ExpansionAction;
      const task: Record<ExpansionAction, string> = {
        simplify:
          'Create an easier explanation in exactly 2 mini-cards: first a simple restatement, then a plain analogy.',
        drill:
          'Create a deeper explanation in exactly 2 mini-cards: first the mechanism, then implications or edge cases.',
        example:
          'Create exactly 2 concrete example-based mini-cards using two different vivid examples.',
        reexplain:
          'Create exactly 2 alternative explanation mini-cards using different framing from the original.',
      };

      const refinePrompt = `
Persona: ${persona}. Background: ${about}. Context: ${context || 'None'}
Current Content:
"""
${currentContent || ''}
"""
Task: ${task[legacyAction]}

Return ONLY valid JSON:
{
  "cards": [
    { "title": "...", "content": "..." },
    { "title": "...", "content": "..." }
  ]
}
`;
      const result = await model.generateContent(refinePrompt);
      const parsed = safeJsonParse(extractJsonObject(result.response.text()));
      return NextResponse.json(
        { cards: normalizeExpansionCards(parsed) },
        { headers: corsHeaders }
      );
    }

    // ── REGENERATE WEAK ────────────────────────────────────────────────────────
    if (action === 'regenerate_weak') {
      const weakList = (weakCards || [])
        .map((c: { id: number; title: string; content: string }) =>
          `Card ${c.id}: "${c.title}"\nOriginal explanation: ${c.content}`
        )
        .join('\n\n');

      const regenPrompt = `
The learner did NOT understand the following concepts. Re-explain them using a COMPLETELY DIFFERENT approach.

STRICT RULES:
- DO NOT repeat any phrasing, analogies, or examples from the original
- Use a brand new metaphor or real-world scenario
- Start from a more basic entry point
- Be more concrete and visual
- Max 3 sentences for content, 2 for simpler, 5 lines for detailed

Background: ${about || 'General curious learner'}. Persona: ${persona}. Context: ${context || 'None'}.

${weakList}

Return ONLY a raw JSON array:
[
  {
    "id": <same id as input>,
    "hook": "...", "content": "...", "simpler": "...", "detailed": "...", "visual": "..."
  }
]
`;
      const result = await model.generateContent(regenPrompt);
      const parsed = safeJsonParse(extractJsonArray(result.response.text()));
      return NextResponse.json({ regenerated: parsed }, { headers: corsHeaders });
    }

    // ── CHAT ───────────────────────────────────────────────────────────────────
    if (action === 'question_cards' || action === 'chat') {
      const historyText = (chatHistory || [])
        .map((m: { role: string; text?: string; cards?: QuestionAnswerCard[] }) => {
          if (m.text) return `${m.role.toUpperCase()}: ${m.text}`;
          if (Array.isArray(m.cards)) {
            const cardSummary = m.cards.map((card) => `${card.title}: ${card.content}`).join(' | ');
            return `${m.role.toUpperCase()}: ${cardSummary}`;
          }
          return null;
        })
        .filter(Boolean)
        .join('\n');

      const chatPrompt = `
You are creating FlashLearn answer cards for a learner's question.

RULES:
- Stay grounded in the topic summary and cards below
- Return 2 to 5 cards depending on answer complexity
- Each card must contain one clear chunk of the answer
- Order the cards logically as a mini learning flow
- Keep each card concise and scannable: title under 8 words, content 1-3 short sentences or short markdown bullets
- Do not write one long paragraph
- When connecting two cards, label the link as: core concept / assumption / limitation
- If the answer is simple, use 2 cards

Learner: ${about || 'General learner'} | Persona: ${persona} | Difficulty: ${difficulty}
Topic: ${topic} — ${topicSummary}
Cards: ${JSON.stringify(cards, null, 2)}
Chat so far: ${historyText || 'None'}
Question: ${question}

Return ONLY valid JSON:
{
  "cards": [
    { "title": "...", "content": "..." },
    { "title": "...", "content": "..." }
  ]
}
`;
      const result = await model.generateContent(chatPrompt);
      const parsed = safeJsonParse(extractJsonObject(result.response.text()));
      return NextResponse.json(
        { cards: normalizeQuestionAnswerCards(parsed) },
        { headers: corsHeaders }
      );
    }

    // ── FIND CONNECTIONS (Knowledge Graph) ────────────────────────────────────
    if (action === 'find_connections') {
      if (!existingTopics || existingTopics.length === 0) {
        return NextResponse.json({ connections: [] }, { headers: corsHeaders });
      }

      const topicList = (existingTopics as Array<{ topic: string; summary: string }>)
        .map((t, i) => `${i + 1}. ${t.topic} — ${t.summary}`)
        .join('\n');

      const connectionPrompt = `
You are a knowledge graph builder. A learner just studied a new topic. Find only the strongest, most intellectually substantive connections to their existing knowledge.

New topic: "${newTopic}"
New topic summary: "${newSummary}"

Learner's existing topics:
${topicList}

RULES:
- Include connections where topics share underlying principles, prerequisites, overlapping concepts, or related domains.
- Rate connection strength 1–10. A score of 5 means "meaningfully related", 8–10 means "deeply intertwined".
- Only return connections with strength ≥ 3. Return an empty array only if topics are genuinely from completely unrelated domains.
- "bridge" should briefly explain the shared concept or relationship in plain language (1–2 sentences max).
- Prefer more connections over fewer — a learner discovering unexpected links is the whole point of this feature.

Return ONLY valid JSON:
{
  "connections": [
    {
      "existingTopic": "exact name from the list above",
      "strength": 8,
      "bridge": "Both fluid dynamics and thermodynamics describe energy transfer through a medium using the same class of partial differential equations (conservation laws)."
    }
  ]
}
`;
      const result = await model.generateContent(connectionPrompt);
      const parsed = safeJsonParse(extractJsonObject(result.response.text()));
      return NextResponse.json(parsed, { headers: corsHeaders });
    }
    // ── QUIZ ───────────────────────────────────────────────────────────────────
    if (action === 'quiz') {
      const quizPrompt = `
  You are creating a short multiple-choice quiz based ONLY on the learner's current FlashLearn cards.

  RULES:
  - Generate exactly 3 questions
  - Each question must test a different key concept from the cards
  - 4 answer options each
  - Exactly 1 correct answer
  - Keep wording concise and clear
  - Include a short explanation for why the correct answer is right
  - Include a "concept" field naming the concept being tested
  - Do NOT use knowledge outside the cards

  Learner: ${about || 'General learner'} | Persona: ${persona} | Difficulty: ${difficulty}
  Topic: ${topic}
  Cards:
  ${JSON.stringify(cards, null, 2)}

  Return ONLY valid JSON:
  {
  "questions": [
    {
      "id": 1,
      "question": "....",
      "options": ["....", "....", "....", "...."],
      "correctIndex": 0,
      "explanation": "....",
      "concept": "...."
    }
  ]
}
`;

      const result = await model.generateContent(quizPrompt);
      const parsed = safeJsonParse(extractJsonObject(result.response.text()));
      return NextResponse.json(parsed, { headers: corsHeaders });
    }
        // ── REMEDIATION ────────────────────────────────────────────────────────────
    if (action === 'remediate') {
      const remediationPrompt = `
  You are helping a learner review concepts they got wrong in a quiz.

  RULES:
  - Create 1 remediation card per mistaken concept
  - Each card must correct the misunderstanding, not just repeat the original explanation
  - Make the explanation clearer and more concrete
  - Use simple wording first, then one example
  - Keep content concise
  - If multiple mistakes are about the same concept, merge them into one card

  Learner: ${about || 'General learner'} | Persona: ${persona} | Difficulty: ${difficulty}
  Topic: ${topic}
  Mistakes:
  ${JSON.stringify(mistakes, null, 2)}

  Return ONLY valid JSON:
  {
    "topic_summary": "Targeted review of weak concepts",
    "cards": [
      {
        "id": 1,
        "title": "....",
        "hook": "....",
        "content": "....",
        "simpler": "....",
        "detailed": "....",
        "visual": "...."
      }
    ]
  }
  `;

      const result = await model.generateContent(remediationPrompt);
      const parsed = safeJsonParse(extractJsonObject(result.response.text()));
      return NextResponse.json(parsed, { headers: corsHeaders });
    }
    // ── GENERATE CARDS (main action) ──────────────────────────────────────────
    const hasSourceContent = pageContent && pageContent.trim().length > 200;
    const isCode = isCodeProblem(topic || '');

    // Memory prefix: bridge new topic to what the learner already knows
    const memoryPrefix =
      memoryContext && memoryContext.length > 0
        ? `LEARNER MEMORY — use this to bridge concepts naturally:
${(memoryContext as Array<{ topic: string; summary: string; connections: number }>)
  .map((m) => `• ${m.topic} (${m.connections} connections): ${m.summary}`)
  .join('\n')}
When teaching this topic, actively connect it to the above. Say things like "Just like you learned with [past topic]..." or "This builds on your knowledge of [past topic]..."\n\n`
        : '';

    let systemPrompt: string;

    if (isCode) {
      // ── LeetCode / Algorithm mode ──────────────────────────────────────────
      systemPrompt = `
${memoryPrefix}System: Elite software engineer and coding interview coach. Background: ${about}. Persona: ${persona}.
Task: Break this coding problem/concept into exactly 7 structured cards: "${topic}"

MANDATORY CARD ORDER:
Card 1 — "Problem Breakdown": Restate clearly. Inputs, outputs, constraints. What makes this hard?
Card 2 — "Test Cases": 3 examples including at least 2 edge cases (empty, single, max size, negatives, duplicates).
Card 3 — "Brute Force": The naive approach. Time/space complexity. When would you actually use it?
Card 4 — "Optimal Approach": Best algorithm + data structure. Why is it better? Key insight that unlocks it.
Card 5 — "Functions to Build": Exact function signatures the developer must implement. Pseudocode stubs.
Card 6 — "Step-by-Step Solution": Annotated code (Python or language-agnostic pseudocode) for the optimal approach.
Card 7 — "Pitfalls & Debugging": Top 3 mistakes developers make. Off-by-one errors, edge cases missed, wrong complexity claim.

CONSTRAINTS per card:
- "hook": Why this problem/pattern matters in real production systems (not just interviews). One sentence.
- "content": Human-language explanation of the key idea. 3 sentences max.
- "simpler": Everyday analogy for the algorithm or data structure. Max 2 sentences.
- "detailed": Time complexity, space complexity, when to use this pattern. Bullet points.
- "visual": ASCII diagram of the data structure, recursion tree, or sliding window — max 6 lines.
- Difficulty: ${difficulty}. Context: ${context || 'None'}

Return ONLY valid JSON with the standard card schema.

{
  "topic_summary": "One-sentence problem statement",
  "cards": [
    {
      "id": 1,
      "title": "Short Header",
      "hook": "...", "content": "...", "simpler": "...", "detailed": "...", "visual": "..."
    }
  ]
}
`;
    } else if (hasSourceContent) {
      // ── Source-grounded mode (extension on a webpage) ──────────────────────
      systemPrompt = `
${memoryPrefix}System: Expert adaptive tutor. Background: ${about}. Persona: ${persona}.
You are given webpage content. Create exactly 7 flashcards using ONLY information from the SOURCE CONTENT — do NOT add external knowledge.

SOURCE URL: ${pageUrl || 'provided webpage'}
SOURCE CONTENT:
<<<
${pageContent.slice(0, 15000)}
>>>

Task: 7 flashcards covering key concepts from the above source about "${topic}".

STRICT CONSTRAINTS:
- ONLY use facts from the SOURCE CONTENT. If something is not in the source, do not include it.
- "hook": One sentence — why this specific concept (as found in the source) is fascinating.
- "content": Explain as if to a curious friend. 3 sentences max. Source-only.
- "simpler": One clear analogy. Max 2 sentences.
- "detailed": Technical depth from the source. Bullet points, max 5 lines.
- "visual": ASCII diagram or table from source information. Max 6 lines.
- "source_anchor": A verbatim short quote (10–20 words) copied exactly from the source text this card is based on. No citation numbers.
- Difficulty: ${difficulty}. Context: ${context || 'None'}

Return ONLY valid JSON:

{
  "topic_summary": "1-sentence overview based on the source",
  "cards": [
    {
      "id": 1, "title": "...", "hook": "...", "content": "...",
      "simpler": "...", "detailed": "...", "visual": "...",
      "source_anchor": "Exact short quote from source..."
    }
  ]
}
`;
    } else {
      // ── Standard mode ──────────────────────────────────────────────────────
      systemPrompt = `
${memoryPrefix}System: Expert adaptive tutor. Background: ${about}. Persona: ${persona}.
Task: Break down "${topic}" into 7 cards.

STRICT CONSTRAINTS:
- "hook": One sentence — why this topic is fascinating or surprising. Must spark curiosity.
- "content": Write as if explaining to a curious friend, NOT a textbook. 4 to 5 sentences max. No equations here. Start with something concrete or surprising.
- "simpler": One punchy, clear analogy (max 2 sentences).
- "detailed": Maximum 5 lines of technical explanation. Bullet points. Equations welcome.
- "visual": ASCII diagram, table, or short code snippet (max 6 lines).
- Difficulty: ${difficulty}. Context: ${context || 'None'}

IMPORTANT: Escape backslashes properly. Return ONLY valid JSON.

{
  "topic_summary": "1-sentence overview",
  "cards": [
    {
      "id": 1, "title": "Short Header",
      "hook": "...", "content": "...", "simpler": "...", "detailed": "...", "visual": "..."
    }
  ]
}
`;
    }

    const result = await model.generateContent(systemPrompt);
    const parsed = safeJsonParse(extractJsonObject(result.response.text()));
    return NextResponse.json(parsed, { headers: corsHeaders });

  } catch (e: unknown) {
    console.error("Gemini API Error:", e);
    const message = e instanceof Error ? e.message : "Failed to generate content";
    return NextResponse.json(
      { error: message },
      { status: 500, headers: corsHeaders }
    );
  }
}
