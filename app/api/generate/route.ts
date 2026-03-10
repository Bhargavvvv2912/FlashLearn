import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(req: Request) {
  try {
    const { topic, about, persona, difficulty, action, currentContent, context } = await req.json();
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // --- CASE 1: DRILL & SIMPLIFY ---
    if (action === 'drill' || action === 'simplify') {
      const refinePrompt = `
        Persona: ${persona}. Background: ${about}. Context: ${context || 'None'}
        Current Content: "${currentContent}"
        Task: ${action === 'drill' ? 'Technical deep-dive.' : 'Simplify analogy.'}
        
        STRICT LIMIT: Maximum 4-5 lines of text. Use clear bullet points if helpful.
        Return ONLY a JSON object: {"newContent": "..."}
      `;
      const result = await model.generateContent(refinePrompt);
      const text = result.response.text();
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}') + 1;
      return NextResponse.json(JSON.parse(text.substring(start, end)));
    }

    // --- CASE 2: INITIAL 7-CARD PATH ---
    const systemPrompt = `
      System: Expert adaptive tutor. Background: ${about}. Persona: ${persona}.
      Task: Break down "${topic}" into 7 cards.
      
      STRICT CONSTRAINTS FOR SCANNABILITY:
      - "content": Exactly 3 sentences. No more.
      - "simpler": One punchy, clear analogy (max 2 sentences).
      - "detailed": Maximum 5 lines of technical explanation. Use bullet points.
      - Difficulty: ${difficulty}. Context: ${context || 'None'}

      Return ONLY a raw JSON object. No markdown formatting.
      JSON Structure:
      {
        "topic_summary": "1-sentence overview",
        "cards": [
          {
            "id": 1,
            "title": "Short Header",
            "content": "Core logic here...",
            "simpler": "Analogy here...",
            "detailed": "Technical details here...",
            "visual": "ASCII/Table"
          }
        ]
      }
    `;

    const result = await model.generateContent(systemPrompt);
    const responseText = result.response.text();

    const jsonStart = responseText.indexOf('{');
    const jsonEnd = responseText.lastIndexOf('}') + 1;
    const cleanJson = responseText.substring(jsonStart, jsonEnd);

    return NextResponse.json(JSON.parse(cleanJson));
  } catch (e: any) {
    console.error("Gemini API Error:", e);
    return NextResponse.json({ error: e.message || "Failed to generate content" }, { status: 500 });
  }
}