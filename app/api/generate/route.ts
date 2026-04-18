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

function safeJsonParse(jsonText: string) {
  const cleaned = jsonText.trim();
  try {
    return JSON.parse(cleaned);
  } catch (firstError) {
    try {
      const sanitized = cleaned
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/,\s*([}\]])/g, '$1');
      return JSON.parse(sanitized);
    } catch {
      throw firstError;
    }
  }
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
    } = await req.json();

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    // ── REFINE ACTIONS ─────────────────────────────────────────────────────────
    if (action === 'drill' || action === 'simplify' || action === 'example') {
      let task = '';
      if (action === 'drill') task = 'Give a deeper technical explanation. Max 5 bullet points, no fluff.';
      if (action === 'simplify') task = 'Simplify with a cleaner analogy. Max 2 sentences.';
      if (action === 'example') task = 'Give ONE concrete, vivid real-world example of this concept that anyone can picture. No jargon. Max 3 sentences. Start with "For example," or "Think of it like..."';

      const refinePrompt = `
Persona: ${persona}. Background: ${about}. Context: ${context || 'None'}
Current Content: "${currentContent}"
Task: ${task}

Return ONLY a JSON object: {"newContent": "..."}
`;
      const result = await model.generateContent(refinePrompt);
      const parsed = safeJsonParse(extractJsonObject(result.response.text()));
      return NextResponse.json(parsed, { headers: corsHeaders });
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
    if (action === 'chat') {
      const historyText = (chatHistory || [])
        .map((m: { role: string; text: string }) => `${m.role.toUpperCase()}: ${m.text}`)
        .join('\n');

      const chatPrompt = `
You are a concise tutor grounded in the learner's current study session.

RULES:
- Stay grounded in the topic summary and cards below
- Keep answer under 120 words
- When connecting two cards, label the link as: core concept / assumption / limitation

Learner: ${about || 'General learner'} | Persona: ${persona} | Difficulty: ${difficulty}
Topic: ${topic} — ${topicSummary}
Cards: ${JSON.stringify(cards, null, 2)}
Chat so far: ${historyText || 'None'}
Question: ${question}

Return ONLY: {"reply": "..."}
`;
      const result = await model.generateContent(chatPrompt);
      const parsed = safeJsonParse(extractJsonObject(result.response.text()));
      return NextResponse.json(parsed, { headers: corsHeaders });
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
You are a knowledge graph builder. A learner just studied a new topic. Find genuine intellectual connections to their existing knowledge.

New topic: "${newTopic}"
New topic summary: "${newSummary}"

Learner's existing topics:
${topicList}

RULES:
- Only include real intellectual connections: shared principles, mathematical links, cause-effect, historical relationship, analogous structures.
- Skip surface-level or superficial connections.
- Rate strength 1–10. Only return connections with strength ≥ 4.
- "bridge" must be one precise sentence explaining HOW they connect.

Return ONLY valid JSON:
{
  "connections": [
    {
      "existingTopic": "exact name from the list above",
      "strength": 8,
      "bridge": "Both fluid dynamics and thermodynamics describe energy transfer through a medium using differential equations."
    }
  ]
}
`;
      const result = await model.generateContent(connectionPrompt);
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
- "content": Write as if explaining to a curious friend, NOT a textbook. 3 sentences max. No equations here. Start with something concrete or surprising.
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

  } catch (e: any) {
    console.error("Gemini API Error:", e);
    return NextResponse.json(
      { error: e.message || "Failed to generate content" },
      { status: 500, headers: corsHeaders }
    );
  }
}
