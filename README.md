# FlashLearn

FlashLearn is an AI-powered flashcard generator built as a graduate project for the Human-AI Interaction course at the University of Michigan. You enter any topic, highlight text on a webpage, or pull from a coding problem, and FlashLearn generates structured, adaptive flashcards — with full control over how the AI explains things to you.

---

## Features

### Flashcard Generation

Enter any topic and FlashLearn generates seven structured flashcards using Google Gemini. Each card includes:

| Field | Description |
|---|---|
| `title` | Short concept header |
| `hook` | One sentence explaining why this concept matters |
| `content` | Plain-language explanation, written like a conversation |
| `simpler` | A short analogy for non-technical audiences |
| `detailed` | Technical depth with bullet points and equations |
| `visual` | ASCII diagram, table, or code snippet |

Three generation modes activate automatically based on context:

- **Standard** — any open-ended topic or question
- **LeetCode / Coding** — detected from keywords; structures cards around problem breakdown, test cases, brute force, optimal approach, complexity, and common pitfalls
- **Source-grounded** — activated by the Chrome extension; generates cards exclusively from the current webpage and includes a verbatim quote per card for back-linking

### Human-in-the-Loop Controls

Before every generation, you configure how the AI should respond:

| Setting | Options |
|---|---|
| Persona | Simple, Student, Expert, Industry Pro, or fully custom |
| Difficulty | Beginner, Medium, Expert, Post-Doc |
| Your Background | Free-text field (e.g., "CS undergrad familiar with Python") |
| Additional Context | Free-text field (e.g., "Focus on real-world applications, avoid heavy math") |

An AI Transparency badge displays the active persona and difficulty before every generation so you always know what instructions are being sent to the model.

### View Modes

| Mode | Description |
|---|---|
| Cards | Standard flashcard deck with keyboard navigation (arrow keys) |
| Map | Overview of all cards for quick navigation |
| Tree | Expand any card into its four explanation branches |
| Chat | Multi-turn conversation grounded in the current topic and generated cards |
| Globe | 3D interactive knowledge graph of all topics studied across sessions |

### In-Card Refinement

For any card, one-click actions trigger a targeted follow-up from Gemini:

- **Simplify** — rewrite as a cleaner analogy in two sentences
- **Real Example** — one vivid, concrete real-world example
- **Drill Deeper** — five-bullet technical expansion
- **Re-explain** — regenerates the card with a completely different approach and analogy

Refinements are cached per card per session to avoid redundant API calls.

### Quiz and Remediation

After finishing a learning path, a three-question multiple-choice quiz is generated from the card content. On submission, incorrect concepts automatically trigger remediation cards that are appended to the deck with a different explanation strategy.

### Knowledge Graph

Every topic you study is saved to a persistent knowledge graph stored in `localStorage`. The Globe view renders this as an interactive 3D force-directed graph using Three.js, with:

- Nodes colored by mastery tier (new, connected, mastered)
- Edges weighted by conceptual connection strength (0 to 1), detected by Gemini
- Animated particles on strong connections
- One-sentence AI-generated bridge labels explaining how two topics connect

Enabling **Knowledge Memory** before generating lets the AI read your existing graph and actively connect the new topic to things you have already studied.

### Voice Input and Text-to-Speech

- **Voice input** — speak a question in the Chat view using the Web Speech API (Chrome or Edge, microphone permission required)
- **Read aloud** — the current card is read using the browser's speech synthesis

---

## Chrome Extension

The extension adds FlashLearn as a side panel in Chrome so you can generate flashcards directly from any webpage without leaving the tab.

### How it works

1. Highlight any text on a webpage. A small FlashLearn button appears above the selection.
2. Click the button, or right-click and choose "Generate Flashcards from selection" in the context menu.
3. The side panel opens, loads the FlashLearn app in an iframe, and passes the selected text, page URL, page title, and extracted page content over to the app.
4. Source-grounded mode activates automatically and generates cards using only the content from that page.
5. Each card's "Back to Source" button scrolls the original tab to the relevant quote.

### Installing the extension locally

1. Go to `chrome://extensions` in Chrome.
2. Enable **Developer mode** using the toggle in the top right.
3. Click **Load unpacked** and select the `extension/` folder.
4. Pin the FlashLearn extension and navigate to any webpage to try it.

The extension points to the deployed Vercel app by default. To point it at a local build, update the `APP_URL` constant in `sidepanel.js`.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| AI Model | Google Gemini 2.5 Flash Lite |
| 3D Visualization | Three.js + react-force-graph-3d |
| Math Rendering | KaTeX via react-markdown, remark-math, rehype-katex |
| Icons | Lucide React |
| Persistence | localStorage (knowledge graph) |
| Extension | Chrome Manifest V3 |

---

## Getting Started

### Prerequisites

- Node.js 18 or higher
- A Gemini API key from [Google AI Studio](https://aistudio.google.com)

### Installation

```bash
git clone <repo-url>
cd flashlearn
npm install
```

### Environment Setup

Create a `.env.local` file in the project root:
GEMINI_API_KEY=your_gemini_api_key_here

text

### Running Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## API Reference

All AI interactions go through a single endpoint: `POST /api/generate`

| `action` value | Description |
|---|---|
| (omitted) | Generate a new 7-card learning path |
| `drill` / `simplify` / `example` | Refine the current card |
| `regenerateweak` | Re-explain a card with a completely new approach |
| `chat` | Multi-turn conversation grounded in current cards |
| `findconnections` | Detect knowledge graph edges between a new topic and existing nodes |
| `quiz` | Generate a 3-question multiple-choice quiz from current cards |
| `remediate` | Generate targeted review cards for quiz mistakes |

---

## HAI Design Principles

This project was built for the Human-AI Interaction course with the following principles guiding the design:

1. **Human in the loop, always.** The AI never generates silently. Every generation is explicitly configured and initiated by the user.
2. **Transparent AI configuration.** The transparency badge shows the active persona and difficulty before every call so users know what instructions are being sent.
3. **User-controlled adaptation.** Instead of the AI automatically deciding how to explain something, users choose their explanation level and can change it at any time.
4. **Grounded responses.** The Chat view is explicitly grounded in the current session's cards. The model is instructed not to go beyond what was generated.
5. **Feedback-driven remediation.** Quiz mistakes drive targeted re-explanation, closing the loop between AI output and learner understanding.

---

## Team

Built as a graduate course project at the University of Michigan — Human-AI Interaction.
