'use client';
import { useState, useEffect } from 'react';
import {
  ChevronRight, ChevronLeft, Zap, Info, Map as MapIcon,
  LayoutList, BrainCircuit, Sparkles, RefreshCcw, MessageSquare,
  Plus, Minus, Terminal, Lightbulb, GitBranch, ExternalLink
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

interface Card {
  id: number;
  title: string;
  hook: string;
  content: string | string[];
  simpler: string | string[];
  detailed: string | string[];
  visual: string | string[];
  source_anchor?: string;
}

interface FlashData {
  topic_summary: string;
  cards: Card[];
}

type ViewMode = 'cards' | 'map' | 'tree' | 'chat';
type TreeBranch = 'normal' | 'simpler' | 'detailed' | 'visual' | null;

type ChatMessage = { role: 'user' | 'assistant'; text: string };

const PERSONA_CHIPS = [
  { label: '👶 Simple', value: 'Explain like I am 12 years old with no technical background', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  { label: '🎓 Student', value: 'Student', color: 'bg-purple-50 text-purple-700 border-purple-200' },
  { label: '🔬 Expert', value: 'Researcher', color: 'bg-green-50 text-green-700 border-green-200' },
  { label: '🧑‍💼 Pro', value: 'Industry Expert', color: 'bg-orange-50 text-orange-700 border-orange-200' },
];

export default function Home() {
  const [topic, setTopic] = useState('');
  const [about, setAbout] = useState(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem('flashlearn_about') || '';
  });
  const [persona, setPersona] = useState(() => {
    if (typeof window === 'undefined') return 'Student';
    return localStorage.getItem('flashlearn_persona') || 'Student';
  });
  const [customPersona, setCustomPersona] = useState(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem('flashlearn_customPersona') || '';
  });
  const [difficulty, setDifficulty] = useState(() => {
    if (typeof window === 'undefined') return 'Medium';
    return localStorage.getItem('flashlearn_difficulty') || 'Medium';
  });
  const [context, setContext] = useState(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem('flashlearn_context') || '';
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [useCustomPersona, setUseCustomPersona] = useState(false);

  const [data, setData] = useState<FlashData | null>(null);
  const [index, setIndex] = useState(0);
  const [view, setView] = useState<'normal' | 'simpler' | 'detailed' | 'visual'>('normal');
  const [viewMode, setViewMode] = useState<ViewMode>('cards');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refinement, setRefinement] = useState<string | null>(null);
  const [isRefining, setIsRefining] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [showHook, setShowHook] = useState(true);
  const [refinementCache, setRefinementCache] = useState<Record<string, string>>({});

  // tree state
  const [treeFocusCardIndex, setTreeFocusCardIndex] = useState<number | null>(null);
  const [treeSelectedBranch, setTreeSelectedBranch] = useState<TreeBranch>(null);

  // chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  // source page context (injected by extension via postMessage)
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceTitle, setSourceTitle] = useState('');
  const [pageContent, setPageContent] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('flashlearn_about', about);
    localStorage.setItem('flashlearn_persona', persona);
    localStorage.setItem('flashlearn_customPersona', customPersona);
    localStorage.setItem('flashlearn_difficulty', difficulty);
    localStorage.setItem('flashlearn_context', context);
  }, [about, persona, customPersona, difficulty, context]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const selected = params.get('selectedText');
    if (selected && !topic) {
      setTopic(selected.slice(0, 300));
    }
  }, [topic]);

  // Receive page context from the extension side panel via postMessage
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'FLASHLEARN_CONTEXT') {
        if (event.data.pageContent) setPageContent(event.data.pageContent);
        if (event.data.pageUrl) setSourceUrl(event.data.pageUrl);
        if (event.data.pageTitle) setSourceTitle(event.data.pageTitle);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const getActivePersona = () => (useCustomPersona ? customPersona : persona);
  const CARD_COUNT = data?.cards?.length ?? 7;
  const currentCard = data?.cards?.[index] || null;

  const asText = (value: unknown) =>
    Array.isArray(value) ? value.join('\n') : String(value ?? '');

  const ErrorBanner = () =>
    error ? (
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
        <Info className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-red-700">Something went wrong</p>
          <p className="text-sm text-red-600 mt-0.5">{error}</p>
        </div>
        <button
          onClick={() => setError(null)}
          className="text-red-400 hover:text-red-600 text-xs font-bold shrink-0"
        >
          ✕
        </button>
      </div>
    ) : null;

  const generateCards = async () => {
    if (!topic.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          about,
          persona: getActivePersona(),
          difficulty,
          context,
          pageContent: pageContent || undefined,
          pageUrl: sourceUrl || undefined,
        }),
      });
      const result = await res.json();
      if (result.error) {
        setError(`AI Error: ${result.error}`);
      } else {
        setData(result);
        setIndex(0);
        setRefinement(null);
        setRefinementCache({});
        setShowHook(true);
        setViewMode('cards');
        setView('normal');
        setTreeFocusCardIndex(null);
        setTreeSelectedBranch(null);
        // reset chat for new learning path
        setChatMessages([]);
        setChatInput('');
      }
    } catch (e) {
      console.error(e);
      setError(
        'Failed to connect to AI. Please check your connection and try again.',
      );
    }
    setLoading(false);
  };

  const handleRefine = async (action: 'drill' | 'simplify' | 'example') => {
    if (!data) return;

    const cacheKey = `${index}:${action}`;
    if (refinementCache[cacheKey]) {
      setRefinement(refinementCache[cacheKey]);
      return;
    }

    setIsRefining(true);
    setError(null);

    const currentText =
      view === 'normal'
        ? asText(data.cards[index].content)
        : view === 'simpler'
        ? asText(data.cards[index].simpler)
        : view === 'detailed'
        ? asText(data.cards[index].detailed)
        : asText(data.cards[index].visual);

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          currentContent: currentText,
          about,
          persona: getActivePersona(),
          context,
        }),
      });

      const result = await res.json();

      if (result.error) {
        setError(`Refinement failed: ${result.error}`);
      } else {
        setRefinement(result.newContent);
        setRefinementCache((prev) => ({
          ...prev,
          [cacheKey]: result.newContent,
        }));
      }
    } catch (e) {
      console.error(e);
      setError('Refinement failed. Please try again.');
    }

    setIsRefining(false);
  };

  const handleRegenerateCard = async () => {
    if (!data) return;
    setIsRegenerating(true);
    setError(null);

    const card = data.cards[index];

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'regenerate_weak',
          weakCards: [
            {
              id: card.id,
              title: asText(card.title),
              content: asText(card.content),
            },
          ],
          about,
          persona: getActivePersona(),
          context,
        }),
      });

      const result = await res.json();

      if (result.error) {
        setError(`Regeneration failed: ${result.error}`);
      } else {
        const regen = result.regenerated?.[0];
        if (regen) {
          const updatedCards = data.cards.map((c, i) =>
            i === index ? { ...c, ...regen } : c,
          );
          setData({ ...data, cards: updatedCards });
          setRefinement(null);
          setShowHook(true);

          setRefinementCache((prev) => {
            const next = { ...prev };
            delete next[`${index}:simplify`];
            delete next[`${index}:example`];
            delete next[`${index}:drill`];
            return next;
          });
        }
      }
    } catch (e) {
      console.error(e);
      setError('Regeneration failed. Please try again.');
    }

    setIsRegenerating(false);
  };

  const resetNavigation = (
    newIndex: number,
    newView?: 'normal' | 'simpler' | 'detailed' | 'visual',
  ) => {
    setIndex(newIndex);
    setRefinement(null);
    setView(newView || 'normal');
    setShowHook(true);
  };

  const getTreeBranchContent = () => {
    if (!data || treeFocusCardIndex === null || treeSelectedBranch === null)
      return '';
    const card = data.cards[treeFocusCardIndex];
    if (treeSelectedBranch === 'normal') return asText(card.content);
    if (treeSelectedBranch === 'simpler') return asText(card.simpler);
    if (treeSelectedBranch === 'detailed') return asText(card.detailed);
    if (treeSelectedBranch === 'visual') return asText(card.visual);
    return '';
  };

  const handleChat = async () => {
    if (!data || !chatInput.trim()) return;

    const userMessage = chatInput.trim();
    const nextHistory: ChatMessage[] = [
      ...chatMessages,
      { role: 'user', text: userMessage },
    ];

    setChatMessages(nextHistory);
    setChatInput('');
    setChatLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'chat',
          topic,
          about,
          persona: getActivePersona(),
          difficulty,
          context,
          topicSummary: data.topic_summary,
          cards: data.cards,
          question: userMessage,
          chatHistory: nextHistory,
        }),
      });

      const result = await res.json();

      if (result.error) {
        setError(`Chat failed: ${result.error}`);
      } else {
        setChatMessages((prev) => [
          ...prev,
          { role: 'assistant', text: result.reply },
        ]);
      }
    } catch (e) {
      console.error(e);
      setError('Chat failed. Please try again.');
    }

    setChatLoading(false);
  };

  // SETUP VIEW
  if (!data && !loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-2xl bg-white rounded-3xl shadow-xl p-8 space-y-6">
          <div className="text-center">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Zap className="w-6 h-6 text-indigo-600" />
              <h1 className="text-2xl font-black text-slate-800">
                FlashLearnHAI
              </h1>
            </div>
            <p className="text-slate-500 text-sm">
              Understand any topic — without the information overload
            </p>
          </div>

          <ErrorBanner />

          <div>
            <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2">
              What are you curious about?
            </label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) =>
                e.key === 'Enter' && topic.trim() && generateCards()
              }
              placeholder="e.g. Fluid dynamics, Quantum entanglement, Black holes..."
              className="w-full p-3 rounded-xl border border-slate-200 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>

          <div>
            <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2">
              Explain it like I am a...
            </label>
            <div className="flex flex-wrap gap-2">
              {PERSONA_CHIPS.map((chip) => (
                <button
                  key={chip.value}
                  onClick={() => {
                    setPersona(chip.value);
                    setUseCustomPersona(false);
                  }}
                  className={`px-3 py-1.5 rounded-full border text-xs font-bold transition-all ${
                    persona === chip.value && !useCustomPersona
                      ? 'ring-2 ring-indigo-500 ring-offset-1 ' + chip.color
                      : chip.color + ' opacity-60 hover:opacity-100'
                  }`}
                >
                  {chip.label}
                </button>
              ))}
              <button
                onClick={() => setUseCustomPersona(true)}
                className={`px-3 py-1.5 rounded-full border text-xs font-bold transition-all bg-slate-50 text-slate-600 border-slate-200 ${
                  useCustomPersona
                    ? 'ring-2 ring-indigo-500 ring-offset-1 opacity-100'
                    : 'opacity-60 hover:opacity-100'
                }`}
              >
                ✏️ Custom
              </button>
            </div>
            {useCustomPersona && (
              <input
                type="text"
                value={customPersona}
                onChange={(e) => setCustomPersona(e.target.value)}
                placeholder="e.g. A nurse learning ML for healthcare"
                className="mt-2 w-full p-3 rounded-xl border border-slate-200 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            )}
          </div>

          <div>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 text-xs font-black text-indigo-600 uppercase tracking-widest hover:text-indigo-800 transition-colors"
            >
              {showAdvanced ? (
                <Minus className="w-3 h-3" />
              ) : (
                <Plus className="w-3 h-3" />
              )}
              {showAdvanced ? 'Hide Advanced Settings' : 'Advanced Settings'}
            </button>

            {showAdvanced && (
              <div className="mt-4 space-y-4">
                <div>
                  <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2">
                    Your Background (Optional)
                  </label>
                  <textarea
                    value={about}
                    onChange={(e) => setAbout(e.target.value)}
                    placeholder="e.g. CS undergrad familiar with Python..."
                    className="w-full h-20 p-3 rounded-xl border border-slate-200 text-sm text-slate-700 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2">
                      Complexity
                    </label>
                    <select
                      value={difficulty}
                      onChange={(e) => setDifficulty(e.target.value)}
                      className="w-full p-3 rounded-xl border border-slate-200 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    >
                      <option>Beginner</option>
                      <option>Medium</option>
                      <option>Expert</option>
                      <option>Post-Doc</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2">
                      Persona (Manual)
                    </label>
                    <select
                      value={persona}
                      onChange={(e) => {
                        setPersona(e.target.value);
                        setUseCustomPersona(false);
                      }}
                      className="w-full p-3 rounded-xl border border-slate-200 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    >
                      <option>Student</option>
                      <option>Feymann (Simple Analogies)</option>
                      <option>Professor</option>
                      <option>Researcher</option>
                      <option>Industry Expert</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2">
                    Additional Context
                  </label>
                  <textarea
                    value={context}
                    onChange={(e) => setContext(e.target.value)}
                    placeholder="e.g. Focus on real-world applications, avoid heavy math"
                    className="w-full h-20 p-3 rounded-xl border border-slate-200 text-sm text-slate-700 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
              </div>
            )}
          </div>

          {sourceUrl && (
            <div className="flex items-start gap-3 bg-teal-50 border border-teal-200 rounded-xl p-3">
              <ExternalLink className="w-4 h-4 text-teal-600 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-black text-teal-600 uppercase tracking-widest mb-0.5">
                  Generating from webpage
                </p>
                <p className="text-xs font-bold text-teal-800 truncate">
                  {sourceTitle || sourceUrl}
                </p>
                <p className="text-[10px] text-teal-500 truncate mt-0.5">{sourceUrl}</p>
              </div>
            </div>
          )}

          <button
            onClick={generateCards}
            disabled={!topic.trim()}
            className="w-full py-4 bg-indigo-600 text-white font-black text-sm uppercase tracking-widest rounded-2xl hover:bg-indigo-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Generate Learning Path →
          </button>
        </div>
      </div>
    );
  }

  // LOADING VIEW
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mx-auto" />
          <p className="text-slate-500 font-bold text-sm uppercase tracking-widest">
            Constructing Learning Pathway...
          </p>
        </div>
      </div>
    );
  }

  // MAIN APP VIEW
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-2xl space-y-4">
        <div className="flex items-center justify-between">
          <button
            onClick={() => {
              setData(null);
              setError(null);
              setChatMessages([]);
              setChatInput('');
            }}
            className="text-slate-500 hover:text-indigo-600 font-bold flex items-center gap-2 transition-colors text-sm"
          >
            <ChevronLeft className="w-4 h-4" /> New Topic
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => setViewMode('cards')}
              className={`px-3 py-2 rounded-lg font-bold text-sm transition ${
                viewMode === 'cards'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              <LayoutList className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('map')}
              className={`px-3 py-2 rounded-lg font-bold text-sm transition ${
                viewMode === 'map'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              <MapIcon className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                setViewMode('tree');
                setTreeFocusCardIndex(null);
                setTreeSelectedBranch(null);
              }}
              className={`px-3 py-2 rounded-lg font-bold text-sm transition ${
                viewMode === 'tree'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-500 hover:bg-slate-100'
              }`}
              title="Knowledge Tree"
            >
              <GitBranch className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('chat')}
              className={`px-3 py-2 rounded-lg font-bold text-sm transition ${
                viewMode === 'chat'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-500 hover:bg-slate-100'
              }`}
              title="Chat"
            >
              <MessageSquare className="w-4 h-4" />
            </button>
          </div>
        </div>

        <ErrorBanner />

        {/* TREE MODE */}
        {viewMode === 'tree' && (
          <div className="fixed inset-0 z-50 bg-slate-50 flex flex-col">
            <div className="shrink-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm">
              <div>
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest">
                  Knowledge Tree
                </p>
                <p className="text-sm font-bold text-slate-700">
                  {treeFocusCardIndex === null
                    ? asText(data?.topic_summary)
                    : `Focused: ${asText(
                        data?.cards[treeFocusCardIndex]?.title,
                      )}`}
                </p>
              </div>
              <div className="flex gap-2">
                {treeFocusCardIndex !== null && (
                  <button
                    onClick={() => {
                      setTreeFocusCardIndex(null);
                      setTreeSelectedBranch(null);
                    }}
                    className="px-4 py-2 rounded-xl bg-slate-200 text-slate-700 text-xs font-black uppercase tracking-widest hover:bg-slate-300 transition-colors"
                  >
                    Back to Topic Tree
                  </button>
                )}
                <button
                  onClick={() => setViewMode('cards')}
                  className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-black uppercase tracking-widest hover:bg-indigo-700 transition-colors"
                >
                  Back to Cards
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-8">
              {treeFocusCardIndex === null ? (
                // TOPIC TREE
                <div className="min-w-max min-h-full flex items-start justify-center">
                  <div className="w-max">
                    <div className="flex justify-center mb-3">
                      <div className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-black shadow-lg max-w-md text-center">
                        {asText(data?.topic_summary)}
                      </div>
                    </div>

                    <div
                      className="relative flex justify-center mb-3"
                      style={{ height: '40px' }}
                    >
                      <svg
                        width="100%"
                        height="40"
                        className="absolute inset-0"
                        style={{
                          minWidth: `${
                            Math.max((data?.cards.length || 1) * 180, 700)
                          }px`,
                        }}
                      >
                        {data?.cards.map((_, i) => {
                          const total = data.cards.length || 1;
                          const cardWidth = 100 / total;
                          const centerX = cardWidth * i + cardWidth / 2;
                          return (
                            <line
                              key={i}
                              x1="50%"
                              y1="0"
                              x2={`${centerX}%`}
                              y2="40"
                              stroke="#cbd5e1"
                              strokeWidth="1.5"
                            />
                          );
                        })}
                        <circle cx="50%" cy="0" r="3" fill="#6366f1" />
                      </svg>
                    </div>

                    <div
                      className="flex gap-4 justify-center mb-3"
                      style={{
                        minWidth: `${
                          Math.max((data?.cards.length || 1) * 180, 700)
                        }px`,
                      }}
                    >
                      {data?.cards.map((card, i) => (
                        <button
                          key={i}
                          onClick={() => {
                            setTreeFocusCardIndex(i);
                            setTreeSelectedBranch('normal');
                          }}
                          className="w-[160px] min-w-[160px] p-3 rounded-xl border-2 text-left transition-all shadow-sm border-slate-300 bg-white hover:border-indigo-400 hover:shadow-md"
                        >
                          <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black mb-1.5 bg-slate-200 text-slate-600">
                            {i + 1}
                          </div>
                          <p className="text-xs font-bold text-slate-800 leading-tight line-clamp-2">
                            {asText(card.title)}
                          </p>
                        </button>
                      ))}
                    </div>

                    <p className="text-center text-xs text-slate-400 mt-6">
                      Click a flashcard node to expand its explanation tree
                    </p>
                  </div>
                </div>
              ) : (
                // FOCUSED CARD TREE
                <div className="w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-8 items-start">
                  <div className="min-w-0">
                    <div className="flex justify-center mb-4">
                      <button
                        onClick={() => setTreeSelectedBranch('normal')}
                        className={`px-6 py-4 rounded-2xl border-2 text-left shadow-md max-w-md w-full transition-all ${
                          treeSelectedBranch === 'normal'
                            ? 'border-indigo-600 bg-indigo-50'
                            : 'border-slate-300 bg-white hover:border-indigo-400'
                        }`}
                      >
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                          Root Flashcard
                        </p>
                        <p className="text-sm font-black text-slate-800 mt-1">
                          {asText(
                            data?.cards[treeFocusCardIndex]?.title,
                          )}
                        </p>
                      </button>
                    </div>

                    <div
                      className="relative flex justify-center mb-4"
                      style={{ height: '56px' }}
                    >
                      <svg width="420" height="56" className="absolute">
                        <line
                          x1="210"
                          y1="0"
                          x2="70"
                          y2="56"
                          stroke="#d1fae5"
                          strokeWidth="1.5"
                        />
                        <line
                          x1="210"
                          y1="0"
                          x2="210"
                          y2="56"
                          stroke="#e0e7ff"
                          strokeWidth="1.5"
                        />
                        <line
                          x1="210"
                          y1="0"
                          x2="350"
                          y2="56"
                          stroke="#fef3c7"
                          strokeWidth="1.5"
                        />
                        <circle cx="210" cy="0" r="3" fill="#6366f1" />
                      </svg>
                    </div>

                    <div className="flex justify-center gap-3 flex-wrap">
                      <button
                        onClick={() => setTreeSelectedBranch('simpler')}
                        className={`w-32 p-3 rounded-xl border text-center transition-all ${
                          treeSelectedBranch === 'simpler'
                            ? 'bg-emerald-100 border-emerald-500 shadow-sm'
                            : 'bg-emerald-50 border-emerald-200 hover:border-emerald-400'
                        }`}
                      >
                        <p className="text-[10px] font-black text-emerald-600 uppercase tracking-wide">
                          Simplify
                        </p>
                        <p className="text-[10px] text-emerald-700 mt-1 line-clamp-2">
                          {asText(
                            data?.cards[treeFocusCardIndex]?.simpler,
                          ).substring(0, 55)}
                          ...
                        </p>
                      </button>

                      <button
                        onClick={() => setTreeSelectedBranch('detailed')}
                        className={`w-32 p-3 rounded-xl border text-center transition-all ${
                          treeSelectedBranch === 'detailed'
                            ? 'bg-indigo-100 border-indigo-500 shadow-sm'
                            : 'bg-indigo-50 border-indigo-200 hover:border-indigo-400'
                        }`}
                      >
                        <p className="text-[10px] font-black text-indigo-600 uppercase tracking-wide">
                          Deeper
                        </p>
                        <p className="text-[10px] text-indigo-700 mt-1 line-clamp-2">
                          {asText(
                            data?.cards[treeFocusCardIndex]?.detailed,
                          ).substring(0, 55)}
                          ...
                        </p>
                      </button>

                      <button
                        onClick={() => setTreeSelectedBranch('visual')}
                        className={`w-32 p-3 rounded-xl border text-center transition-all ${
                          treeSelectedBranch === 'visual'
                            ? 'bg-amber-100 border-amber-500 shadow-sm'
                            : 'bg-amber-50 border-amber-200 hover:border-amber-400'
                        }`}
                      >
                        <p className="text-[10px] font-black text-amber-600 uppercase tracking-wide">
                          Visual
                        </p>
                        <p className="text-[10px] text-amber-700 mt-1 line-clamp-2">
                          {asText(
                            data?.cards[treeFocusCardIndex]?.visual,
                          ).substring(0, 55)}
                          ...
                        </p>
                      </button>
                    </div>
                  </div>

                  {/* Inline content panel */}
                  <div className="min-w-0 bg-white rounded-3xl shadow-xl border border-slate-200 p-6 sticky top-6">
                    <div className="mb-4">
                      <p className="text-xs font-black text-slate-400 uppercase tracking-widest">
                        {treeSelectedBranch === 'normal'
                          ? 'Core'
                          : treeSelectedBranch === 'simpler'
                          ? 'Simplify'
                          : treeSelectedBranch === 'detailed'
                          ? 'Deeper'
                          : treeSelectedBranch === 'visual'
                          ? 'Visual'
                          : 'Content'}
                      </p>
                      <h3 className="text-lg font-black text-slate-800 mt-1">
                        {asText(
                          data?.cards[treeFocusCardIndex]?.title,
                        )}
                      </h3>
                    </div>

                    {treeSelectedBranch === 'visual' ? (
                      <pre className="bg-slate-50 border border-slate-100 rounded-xl p-4 text-xs text-slate-700 font-mono overflow-x-auto whitespace-pre leading-relaxed">
                        {getTreeBranchContent().trim() ||
                          'No visual available.'}
                      </pre>
                    ) : (
                      <div className="prose prose-sm text-slate-700 max-w-none">
                        <ReactMarkdown
                          remarkPlugins={[remarkMath]}
                          rehypePlugins={[rehypeKatex]}
                        >
                          {getTreeBranchContent()}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* MAP VIEW */}
        {viewMode === 'map' && (
          <div className="grid grid-cols-1 gap-3">
            {data?.cards.map((card, i) => (
              <button
                key={i}
                onClick={() => {
                  resetNavigation(i);
                  setViewMode('cards');
                }}
                className={`p-6 bg-white rounded-2xl border-2 cursor-pointer transition-all text-left ${
                  index === i
                    ? 'border-indigo-600 shadow-lg'
                    : 'border-slate-100 hover:border-indigo-200'
                }`}
              >
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">
                  Step {i + 1}
                </p>
                <p className="font-bold text-slate-800">
                  {asText(card.title)}
                </p>
              </button>
            ))}
          </div>
        )}

        {/* CHAT VIEW */}
        {viewMode === 'chat' && data && (
          <div className="bg-white rounded-3xl shadow-xl overflow-hidden">
            <div className="bg-indigo-600 px-6 py-4">
              <p className="text-indigo-200 text-xs font-black uppercase tracking-widest">
                Ask about this learning path
              </p>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">
                  Grounding
                </p>
                <p className="text-sm text-slate-700 mt-1">
                  Answers stay focused on the current topic and generated
                  flashcards.
                </p>
              </div>

              <div className="h-[360px] overflow-y-auto border border-slate-200 rounded-2xl p-4 space-y-3 bg-slate-50">
                {chatMessages.length === 0 && (
                  <p className="text-sm text-slate-500">
                    Ask a follow-up like “Can you connect card 2 and card 4?”
                    or “Give me a simpler intuition.”
                  </p>
                )}

                {chatMessages.map((msg, i) => (
                  <div
                    key={i}
                    className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'ml-auto bg-indigo-600 text-white'
                        : 'bg-white border border-slate-200 text-slate-700'
                    }`}
                  >
                    {msg.text}
                  </div>
                ))}

                {chatLoading && (
                  <div className="bg-white border border-slate-200 text-slate-700 max-w-[85%] rounded-2xl px-4 py-3 text-sm">
                    Thinking...
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleChat()}
                  placeholder="Ask a follow-up question..."
                  className="flex-1 p-3 rounded-xl border border-slate-200 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <button
                  onClick={handleChat}
                  disabled={!chatInput.trim() || chatLoading}
                  className="px-4 py-3 bg-indigo-600 text-white rounded-xl font-black text-sm hover:bg-indigo-700 disabled:opacity-30"
                >
                  Ask
                </button>
              </div>
            </div>
          </div>
        )}

        {/* CARD VIEW */}
        {viewMode === 'cards' && currentCard && (
          <div className="bg-white rounded-3xl shadow-xl overflow-hidden">
            <div className="bg-indigo-600 px-6 py-4">
              <p className="text-indigo-200 text-xs font-black uppercase tracking-widest">
                {asText(data?.topic_summary)}
              </p>
            </div>

            <div className="p-6 space-y-5">
              <div>
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">
                  CARD {index + 1} / {CARD_COUNT}
                </p>
                <h2 className="text-xl font-black text-slate-800">
                  {asText(currentCard.title)}
                </h2>
              </div>

              {showHook && asText(currentCard.hook) && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
                  <Lightbulb className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-0.5">
                      Why This Matters
                    </p>
                    <p className="text-sm text-amber-800 leading-snug">
                      {asText(currentCard.hook)}
                    </p>
                  </div>
                  <button
                    onClick={() => setShowHook(false)}
                    className="text-amber-400 hover:text-amber-600 text-xs font-bold shrink-0"
                  >
                    ✕
                  </button>
                </div>
              )}

              <div className="min-h-[140px]">
                {isRefining || isRegenerating ? (
                  <div className="flex items-center gap-3 text-indigo-500 py-4">
                    <div className="w-4 h-4 border-2 border-indigo-200 border-t-indigo-500 rounded-full animate-spin" />
                    <p className="text-sm font-bold">
                      {isRegenerating
                        ? 'Generating fresh explanation...'
                        : 'AI is tailoring content...'}
                    </p>
                  </div>
                ) : refinement ? (
                  <div className="space-y-3">
                    <p className="text-xs font-black text-indigo-600 uppercase tracking-widest flex items-center gap-1">
                      <Sparkles className="w-3 h-3" /> AI Refinement
                    </p>
                    <div className="prose prose-sm text-slate-700">
                      <ReactMarkdown
                        remarkPlugins={[remarkMath]}
                        rehypePlugins={[rehypeKatex]}
                      >
                        {refinement}
                      </ReactMarkdown>
                    </div>
                    <button
                      onClick={() => setRefinement(null)}
                      className="mt-2 text-xs font-bold text-indigo-600 hover:underline flex items-center gap-1"
                    >
                      <RefreshCcw className="w-3 h-3" /> Back to original
                    </button>
                  </div>
                ) : (
                  <>
                    {view === 'normal' && (
                      <div className="prose prose-sm text-slate-700">
                        <ReactMarkdown
                          remarkPlugins={[remarkMath]}
                          rehypePlugins={[rehypeKatex]}
                        >
                          {asText(currentCard.content)}
                        </ReactMarkdown>
                      </div>
                    )}
                    {view === 'simpler' && (
                      <div className="space-y-2">
                        <p className="text-xs font-black text-emerald-600 uppercase tracking-widest">
                          Analogy
                        </p>
                        <p className="text-slate-600 italic text-base leading-relaxed">
                          &ldquo;{asText(currentCard.simpler)}&rdquo;
                        </p>
                      </div>
                    )}
                    {view === 'detailed' && (
                      <div className="space-y-2">
                        <p className="text-xs font-black text-indigo-600 uppercase tracking-widest">
                          Deeper Explanation
                        </p>
                        <div className="prose prose-sm text-slate-700">
                          <ReactMarkdown
                            remarkPlugins={[remarkMath]}
                            rehypePlugins={[rehypeKatex]}
                          >
                            {asText(currentCard.detailed)}
                          </ReactMarkdown>
                        </div>
                      </div>
                    )}
                    {view === 'visual' && (
                      <div className="space-y-2">
                        <p className="text-xs font-black text-amber-600 uppercase tracking-widest flex items-center gap-1">
                          <Terminal className="w-3 h-3" /> Visual / Diagram
                        </p>
                        <pre className="bg-slate-50 border border-slate-100 rounded-xl p-4 text-xs text-slate-700 font-mono overflow-x-auto whitespace-pre leading-relaxed">
                          {asText(currentCard.visual).trim() ||
                            'No visual available for this card.'}
                        </pre>
                      </div>
                    )}
                  </>
                )}
              </div>

              {!refinement && !isRefining && !isRegenerating && (
                <div className="space-y-3">
                  <div className="flex items-center gap-4 flex-wrap">
                    <button
                      onClick={() => handleRefine('simplify')}
                      className="flex items-center gap-1.5 text-[11px] font-black uppercase text-slate-400 hover:text-emerald-600 transition-colors"
                    >
                      <MessageSquare className="w-3 h-3" /> Simplify
                    </button>
                    <button
                      onClick={() => handleRefine('example')}
                      className="flex items-center gap-1.5 text-[11px] font-black uppercase text-slate-400 hover:text-amber-500 transition-colors"
                    >
                      <Lightbulb className="w-3 h-3" /> Real Example
                    </button>
                    <button
                      onClick={() => handleRefine('drill')}
                      className="flex items-center gap-1.5 text-[11px] font-black uppercase text-slate-400 hover:text-indigo-600 transition-colors"
                    >
                      <BrainCircuit className="w-3 h-3" /> Drill Deeper
                    </button>
                    <div className="ml-auto">
                      <button
                        onClick={handleRegenerateCard}
                        className="flex items-center gap-1.5 text-[11px] font-black uppercase text-slate-300 hover:text-red-500 transition-colors"
                        title="Re-explain this card with a completely different approach"
                      >
                        <RefreshCcw className="w-3 h-3" /> Re-explain
                      </button>
                    </div>
                  </div>

                  {sourceUrl && currentCard?.source_anchor && (
                    <button
                      onClick={() => {
                        window.parent.postMessage(
                          { type: 'FLASHLEARN_GOTO_SOURCE', anchor: currentCard.source_anchor },
                          '*'
                        );
                      }}
                      className="flex items-center gap-1.5 text-[11px] font-black uppercase text-teal-500 hover:text-teal-700 transition-colors border border-teal-200 bg-teal-50 rounded-lg px-2.5 py-1.5"
                      title={`Source: "${currentCard.source_anchor}"`}
                    >
                      <ExternalLink className="w-3 h-3" /> Back to Source
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="border-t border-slate-100 p-4 space-y-4">
              <div className="flex gap-1.5">
                {(['simpler', 'normal', 'detailed', 'visual'] as const).map(
                  (v) => (
                    <button
                      key={v}
                      onClick={() => {
                        setView(v);
                        setRefinement(null);
                      }}
                      className={`flex-1 py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${
                        view === v
                          ? 'bg-indigo-600 text-white shadow-md'
                          : 'bg-slate-100 text-slate-500 hover:bg-indigo-50 hover:text-indigo-700'
                      }`}
                    >
                      {v === 'simpler'
                        ? 'Analogy'
                        : v === 'normal'
                        ? 'Core'
                        : v === 'detailed'
                        ? 'Deeper'
                        : 'Visual'}
                    </button>
                  ),
                )}
              </div>

              <div className="flex items-center gap-4">
                <button
                  onClick={() => resetNavigation(Math.max(0, index - 1))}
                  disabled={index === 0}
                  className="w-12 h-12 flex items-center justify-center rounded-full hover:bg-slate-100 disabled:opacity-10 text-black transition-colors"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <div className="flex-1 flex justify-center gap-2">
                  {data?.cards.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => resetNavigation(i)}
                      className={`h-2 rounded-full transition-all bg-indigo-400 ${
                        i === index
                          ? 'w-4 opacity-100'
                          : 'w-2 opacity-30 hover:opacity-70'
                      }`}
                    />
                  ))}
                </div>
                <button
                  onClick={() =>
                    resetNavigation(Math.min(CARD_COUNT - 1, index + 1))
                  }
                  disabled={index === CARD_COUNT - 1}
                  className="w-12 h-12 flex items-center justify-center rounded-full hover:bg-slate-100 disabled:opacity-10 text-black transition-colors"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}