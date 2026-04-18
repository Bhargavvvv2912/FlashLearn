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

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders,
  });
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
    } = await req.json();

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

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
      const text = result.response.text();
      const parsed = safeJsonParse(extractJsonObject(text));

      return NextResponse.json(parsed, {
        headers: corsHeaders,
      });
    } else if (action === 'regenerate_weak') {
      const weakList = (weakCards || []).map((c: { id: number; title: string; content: string }) =>
        `Card ${c.id}: "${c.title}"\nOriginal explanation: ${c.content}`
      ).join('\n\n');

      const regenPrompt = `
The learner did NOT understand the following concepts. You must re-explain them using a COMPLETELY DIFFERENT approach.

STRICT RULES:
- DO NOT repeat any phrasing, analogies, or examples from the original explanation
- Use a brand new metaphor or real-world scenario they have never seen
- Start from a more basic entry point — assume they know nothing about this specific concept
- Be more concrete and visual
- Maximum 3 sentences for content, 2 sentences for simpler, 5 lines for detailed

Background: ${about || 'General curious learner'}. Persona: ${persona}. Context: ${context || 'None'}.

${weakList}

Return ONLY a raw JSON array:
[
  {
    "id": <same id as input>,
    "hook": "A new fascinating angle on this concept...",
    "content": "Fresh explanation from scratch...",
    "simpler": "Brand new analogy...",
    "detailed": "Different technical framing...",
    "visual": "New ASCII/table/code..."
  }
]
`;

      const result = await model.generateContent(regenPrompt);
      const text = result.response.text();
      const parsed = safeJsonParse(extractJsonArray(text));

      return NextResponse.json(
        { regenerated: parsed },
        { headers: corsHeaders }
      );
    } else if (action === 'chat') {
      const historyText = (chatHistory || [])
        .map((m: { role: string; text: string }) => `${m.role.toUpperCase()}: ${m.text}`)
        .join('\n');

      const chatPrompt = `
You are a concise tutor helping a learner understand a topic using ONLY the provided learning path.

STRICT RULES:
- Stay grounded in the topic summary and cards below
- Prefer re-explaining, connecting, simplifying, or comparing existing cards
- When connecting two cards, clearly say whether the relation is:
  1) direct part of the equation/concept,
  2) an assumption behind it, or
  3) a real-world limitation
- Do not blur assumptions with core definitions
- Do not introduce lots of new concepts unless the user explicitly asks
- Keep the answer under 120 words
- Be clear and supportive, not verbose

Learner background: ${about || 'General learner'}
Persona: ${persona}
Difficulty: ${difficulty}
Context: ${context || 'None'}

Topic: ${topic}
Topic summary: ${topicSummary}

Cards:
${JSON.stringify(cards, null, 2)}

Previous chat:
${historyText || 'None'}

User question:
${question}

Return ONLY a JSON object:
{"reply": "..."}
`;

      const result = await model.generateContent(chatPrompt);
      const text = result.response.text();
      const parsed = safeJsonParse(extractJsonObject(text));

      return NextResponse.json(parsed, {
        headers: corsHeaders,
      });
    } else {
      const hasSourceContent = pageContent && pageContent.trim().length > 200;

      let systemPrompt: string;

      if (hasSourceContent) {
        // Source-grounded generation: cards must come ONLY from the provided page content
        systemPrompt = `
System: Expert adaptive tutor. Background: ${about}. Persona: ${persona}.
You are given webpage content below. Your task is to extract and condense it into exactly 7 flashcards.
You MUST only use information present in the SOURCE CONTENT — do NOT hallucinate or add external knowledge.

SOURCE URL: ${pageUrl || 'provided webpage'}
SOURCE CONTENT:
<<<
${pageContent.slice(0, 15000)}
>>>

Task: Create 7 flashcards covering the key concepts from the above source about "${topic}".

STRICT CONSTRAINTS:
- ONLY use facts from the SOURCE CONTENT above. If something is not in the source, do not include it.
- "hook": One sentence — why this specific concept (as found in the source) is fascinating or surprising.
- "content": Explain as if to a curious friend. 3 sentences max. Source-only information.
- "simpler": One clear analogy (max 2 sentences).
- "detailed": Technical depth from the source. Bullet points, max 5 lines. Equations welcome.
- "visual": ASCII diagram, table, or code snippet based on source info (max 6 lines).
- "source_anchor": A verbatim short quote (10–20 words) copied exactly from the source text that this card is directly based on. No citation numbers like [1]. This anchors the card to the source and prevents hallucination.
- Difficulty: ${difficulty}. Context: ${context || 'None'}

IMPORTANT:
- Escape backslashes properly.
- Do not include raw LaTeX with single backslashes unless escaped for JSON.
- Return ONLY valid JSON.

{
  "topic_summary": "1-sentence overview based on the source",
  "cards": [
    {
      "id": 1,
      "title": "Short Header",
      "hook": "Why this is fascinating (from source)...",
      "content": "Explanation from source...",
      "simpler": "Analogy here...",
      "detailed": "Technical details from source...",
      "visual": "ASCII / table / code here...",
      "source_anchor": "Exact short quote from source text without citation numbers..."
    }
  ]
}
`;
      } else {
        // Standard generation from general knowledge
        systemPrompt = `
System: Expert adaptive tutor. Background: ${about}. Persona: ${persona}.
Task: Break down "${topic}" into 7 cards.

STRICT CONSTRAINTS:
- "hook": One sentence — why this topic is fascinating or surprising. Must spark curiosity.
- "content": Write as if explaining to a curious friend, NOT a textbook. 3 sentences max. No equations — save those for detailed. Start with something concrete or surprising, not a definition.
- "simpler": One punchy, clear analogy (max 2 sentences).
- "detailed": Maximum 5 lines of technical explanation. Use bullet points. Equations are welcome here.
- "visual": A simple ASCII diagram, table, or short code snippet (max 6 lines).
- If the answer cannot be supported clearly from the provided cards, say that briefly instead of guessing.
- For "connect X and Y" questions, answer in 2 parts: "Direct link" and "Caveat"s/limitations.
- Difficulty: ${difficulty}. Context: ${context || 'None'}

IMPORTANT:
- Escape backslashes properly.
- Do not include raw LaTeX with single backslashes unless escaped for JSON.
- Return ONLY valid JSON.

{
  "topic_summary": "1-sentence overview",
  "cards": [
    {
      "id": 1,
      "title": "Short Header",
      "hook": "Why this is fascinating...",
      "content": "Curious-friend explanation here...",
      "simpler": "Analogy here...",
      "detailed": "Technical details + equations here...",
      "visual": "ASCII / table / code here..."
    }
  ]
}
`;
      }

      const result = await model.generateContent(systemPrompt);
      const text = result.response.text();
      const parsed = safeJsonParse(extractJsonObject(text));

      return NextResponse.json(parsed, {
        headers: corsHeaders,
      });
    }
  } catch (e: any) {
    console.error("Gemini API Error:", e);
    return NextResponse.json(
      { error: e.message || "Failed to generate content" },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}
