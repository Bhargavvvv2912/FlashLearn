# ⚡ FlashLearnHAI

**FlashLearnHAI** is a Human-AI Interaction (HAI) course project that reimagines how people consume information online. Instead of reading long, unstructured AI-generated responses, users receive concise, persona-aware flashcard learning paths — reducing information overload while preserving depth of understanding.

> Built with Next.js, Gemini 2.5 Flash, and deployed as both a web app and a Chrome browser extension.

---

## 🎯 Project Motivation

Standard AI chatbots (e.g., ChatGPT) often produce verbose responses that require the user to read hundreds of words to extract a few key ideas. FlashLearnHAI addresses this by:

- Breaking any topic into **7 structured flashcards**
- Offering **4 explanation modes** per card: Core, Analogy, Deeper, Visual
- Enabling **persona-aware generation** calibrated to the user's background
- Providing **on-demand refinements** (Simplify, Real Example, Drill Deeper, Re-explain)
- Allowing **follow-up chat** grounded only in the generated learning path

The result: users learn the same topic with significantly fewer words consumed.

---

## ✨ Features

### Core Learning
- 🃏 **7-Card Learning Path** — every topic broken into digestible, sequentially structured cards
- 🧠 **4 Explanation Modes** — Analogy, Core, Deeper, Visual per card
- 💡 **Hook Banner** — "Why this matters" curiosity spark on every card
- 🔁 **On-Demand Refinements** — Simplify, Real Example, Drill Deeper, Re-explain (with caching)

### Persona System
- 👶 Simple (ELI12) / 🎓 Student / 🔬 Expert / 🧑‍💼 Pro presets
- ✏️ Custom persona input
- 🎯 Difficulty levels: Beginner / Medium / Expert / Post-Doc
- 📝 Background and additional context fields

### Navigation Modes
- 📋 **Card View** — one card at a time with navigation dots
- 🗺️ **Map View** — see all cards at a glance, jump to any
- 🌳 **Knowledge Tree** — radial tree visualization of the full learning path
- 💬 **Chat Mode** — multi-turn Q&A grounded in the generated cards

### Session Persistence
- Persona, background, difficulty, and context saved to `localStorage`
- Auto-restored on next visit or new Wikipedia selection
- Chat resets automatically on each new topic

### Browser Extension
- Chrome side panel extension
- Highlight text on any webpage → generate a learning path instantly
- Persona settings persist across multiple selections on the same page


text

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- A [Google Gemini API key](https://aistudio.google.com/app/apikey)

### Installation

```bash
git clone https://github.com/Bhargavvvv2912/FlashLearn.git
cd FlashLearn
npm install
```

### Environment Setup

Create a `.env.local` file in the root:

```env
GEMINI_API_KEY=your_gemini_api_key_here
```

### Run Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## 🧩 Chrome Extension Setup

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `flashlearn-extension/` folder
5. Open any webpage (e.g., Wikipedia)
6. Highlight text → click the FlashLearn extension icon → learning path opens in the side panel

> The extension passes the selected text to the deployed Vercel app via URL parameter.

---

## 🌐 Deployment

The web app is deployed on Vercel:

**[flash-learn-three.vercel.app](https://flash-learn-three.vercel.app)**

To deploy your own instance:

```bash
npm run build
vercel deploy
```

---

## 🔌 API Reference

### `POST /api/generate`

All AI interactions go through a single route. The `action` field determines the behavior.

| Action | Description |
|---|---|
| *(none)* | Generate a full 7-card learning path for a topic |
| `simplify` | Simplify the current card content with an analogy |
| `example` | Give a real-world example for the current card |
| `drill` | Provide a deeper technical explanation |
| `regenerate_weak` | Regenerate a card with a completely different approach |
| `chat` | Answer a follow-up question grounded in the learning path |

#### Generate cards (default)
```json
{
  "topic": "Fluid Dynamics",
  "about": "CS undergrad",
  "persona": "Student",
  "difficulty": "Medium",
  "context": "Focus on real-world applications"
}
```

#### Chat
```json
{
  "action": "chat",
  "topic": "Fluid Dynamics",
  "topicSummary": "...",
  "cards": [...],
  "question": "Can you connect card 2 and card 4?",
  "chatHistory": [
    { "role": "user", "text": "..." },
    { "role": "assistant", "text": "..." }
  ],
  "persona": "Student",
  "difficulty": "Medium",
  "about": "CS undergrad",
  "context": ""
}
```

---

## 🏗️ Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| AI Model | Google Gemini 2.5 Flash |
| Styling | Tailwind CSS |
| Math Rendering | KaTeX + remark-math + rehype-katex |
| Markdown | react-markdown |
| Icons | Lucide React |
| Deployment | Vercel |
| Extension | Chrome MV3 (Side Panel API) |




## 👤 Author

**Bhargav Keralapur Srinidhi**,
**Haripreeth Avarur**,
**Mohammed Almakrami**,
Human-AI Interaction Course Project
University of Michigan, Ann Arbor
