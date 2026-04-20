'use client';
import { useState, useEffect, useRef, useMemo } from 'react';
import dynamic from 'next/dynamic';
import {
  ChevronRight, ChevronLeft, Zap, Info, Map as MapIcon,
  LayoutList, BrainCircuit, Sparkles, RefreshCcw, MessageSquare,
  Plus, Minus, Terminal, Lightbulb, GitBranch, ExternalLink,
  Globe, Brain, Trash2, Mic, MicOff, Shield, BookOpen, Network, Volume2, VolumeX
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import {
  loadGraph, upsertNode, mergeEdges, clearGraph,
  getTopConnectedNodes, getIsolatedNodes,
  type KnowledgeGraph,
} from './lib/knowledgeGraph';
import type { GlobeNode } from './components/KnowledgeGlobe';

const KnowledgeGlobe = dynamic(
  () => import('./components/KnowledgeGlobe'),
  { ssr: false, loading: () => (
    <div className="flex-1 flex items-center justify-center text-slate-500 text-sm font-bold">
      Loading 3D visualization...
    </div>
  )}
);

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
interface QuizQuestion {
  id: number;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  concept: string;
}

interface QuizData {
  questions: QuizQuestion[];
}

type ViewMode = 'cards' | 'map' | 'tree' | 'chat' | 'globe';
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

  // v2: knowledge graph & memory
  const [knowledgeGraph, setKnowledgeGraph] = useState<KnowledgeGraph>({ nodes: [], edges: [] });
  const [useMemory, setUseMemory] = useState(false);
  const [globeSelectedNode, setGlobeSelectedNode] = useState<GlobeNode | null>(null);
  const [connectionsFound, setConnectionsFound] = useState(0);
  const [showConnectionsToast, setShowConnectionsToast] = useState(false);

   // quiz state
  const [quizData, setQuizData] = useState<QuizData | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<number[]>([]);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [quizScore, setQuizScore] = useState<number | null>(null);
  const [quizAnchorIndex, setQuizAnchorIndex] = useState<number | null>(null);

  // splash / onboarding
  const [showSplash, setShowSplash] = useState(() => {
    if (typeof window === 'undefined') return false;
    return !localStorage.getItem('flashlearn_seen_splash');
  });

  // voice input
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  // text-to-speech
  const [isReading, setIsReading] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // HAI transparency panel
  const [showHAIPanel, setShowHAIPanel] = useState(false);

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

  // Load knowledge graph from localStorage on mount
  useEffect(() => {
    setKnowledgeGraph(loadGraph());
  }, []);

  // Cancel TTS when card or view changes
  useEffect(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis?.speaking) {
      window.speechSynthesis.cancel();
      setIsReading(false);
    }
  }, [index, view]);

  // Keyboard shortcuts for card navigation
  useEffect(() => {
    if (!data) return;
    const cardCount = data.cards?.length ?? 7;
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowRight' && viewMode === 'cards') {
        setIndex((i) => Math.min(cardCount - 1, i + 1));
        setRefinement(null);
        setView('normal');
        setShowHook(true);
      } else if (e.key === 'ArrowLeft' && viewMode === 'cards') {
        setIndex((i) => Math.max(0, i - 1));
        setRefinement(null);
        setView('normal');
        setShowHook(true);
      } else if (e.key === 'c' && viewMode !== 'chat') {
        setViewMode('chat');
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [data, viewMode]);

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

  const startRecognition = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setError('Voice input requires Chrome or Edge.');
      return;
    }
    const recognition = new SR();
    recognitionRef.current = recognition;
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onresult = (event: any) => {
      setChatInput(event.results[0][0].transcript);
    };
    recognition.onerror = (event: any) => {
      setIsListening(false);
      if (event.error === 'not-allowed') {
        setError('Microphone blocked. Click the lock icon in your browser address bar and allow microphone for this site, then try again.');
      } else if (event.error !== 'no-speech') {
        setError(`Voice error: ${event.error}`);
      }
    };
    recognition.start();
  };

  const handleVoiceInput = () => {
    if (isListening) { recognitionRef.current?.stop(); return; }
    // Pre-warm mic permission so Chrome shows the permission dialog if needed
    if (navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then(() => startRecognition())
        .catch(() => setError('Microphone access denied. Allow microphone access in your browser for this site, then try again.'));
    } else {
      startRecognition();
    }
  };

  const handleReadAloud = () => {
    if (!currentCard || typeof window === 'undefined' || !window.speechSynthesis) return;
    if (isReading || window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      setIsReading(false);
      return;
    }
    const cardText = [
      `Card ${index + 1}: ${asText(currentCard.title)}.`,
      asText(currentCard.hook),
      view === 'simpler' ? asText(currentCard.simpler) :
      view === 'detailed' ? asText(currentCard.detailed) :
      view === 'visual' ? 'Visual diagram available on screen.' :
      asText(currentCard.content),
    ].filter(Boolean).join(' ');

    const utterance = new SpeechSynthesisUtterance(cardText);
    utteranceRef.current = utterance;
    utterance.rate = 0.9;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    utterance.onstart = () => setIsReading(true);
    utterance.onend = () => setIsReading(false);
    utterance.onerror = () => setIsReading(false);
    window.speechSynthesis.speak(utterance);
  };

  const currentCard = data?.cards?.[index] || null;

  const asText = (value: unknown) =>
    Array.isArray(value) ? value.join('\n') : String(value ?? '');

  const suggestedQuestions = useMemo(() => {
    if (!currentCard) return [];
    const title = Array.isArray(currentCard.title) ? currentCard.title.join('\n') : String(currentCard.title ?? '');
    return [
      `Can you give a real-world example of "${title}"?`,
      `How does "${title}" connect to the other concepts here?`,
      `What's the most common misconception about "${title}"?`,
    ];
  }, [currentCard]);

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
      // Build memory context from top connected nodes if memory mode is on
      const memoryContext =
        useMemory && knowledgeGraph.nodes.length > 0
          ? getTopConnectedNodes(knowledgeGraph, 5).map((n) => ({
              topic: n.topic,
              summary: n.summary,
              connections: n.connCount,
            }))
          : undefined;

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
          memoryContext,
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
        setChatMessages([]);
        setChatInput('');
        setQuizData(null);
        setQuizAnswers([]);
        setQuizSubmitted(false);
        setQuizScore(null);
        setQuizAnchorIndex(null);

        // Use a clean short name for the knowledge graph node
        // Prefer the page title (e.g. "Semiconductors" from "Semiconductors - Wikipedia")
        // over the raw selected text which can be an entire paragraph
        const kgTopicName = sourceTitle
          ? sourceTitle.replace(/\s*[-–|]\s*(Wikipedia|wiki|article).*$/i, '').trim() || topic.slice(0, 80)
          : topic.length > 80
          ? topic.slice(0, 77).trim() + '…'
          : topic;

        // Save topic to knowledge graph
        const { graph: updatedGraph, nodeId } = upsertNode(kgTopicName, result.topic_summary || topic);
        setKnowledgeGraph({ ...updatedGraph });

        // Fire-and-forget: find connections to existing topics
        const otherNodes = updatedGraph.nodes.filter((n) => n.id !== nodeId).slice(0, 15);
        if (otherNodes.length > 0) {
          fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'find_connections',
              newTopic: kgTopicName,
              newSummary: result.topic_summary || topic,
              existingTopics: otherNodes,
            }),
          })
            .then((r) => r.json())
            .then((connResult) => {
              if (connResult.connections?.length > 0) {
                const finalGraph = mergeEdges(nodeId, connResult.connections);
                setKnowledgeGraph({ ...finalGraph });
                setConnectionsFound(connResult.connections.length);
                setShowConnectionsToast(true);
                setTimeout(() => setShowConnectionsToast(false), 5000);
              }
            })
            .catch(console.error);
        }
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
  // quiz generation
  const handleGenerateQuiz = async () => {
    if (!data) return;

    setQuizLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'quiz',
          topic,
          about,
          persona: getActivePersona(),
          difficulty,
          cards: data.cards,
        }),
      });

      const result = await res.json();

      if (result.error) {
        setError(`Quiz failed: ${result.error}`);
      } else {
        setQuizData(result);
        setQuizAnswers(new Array(result.questions.length).fill(-1));
        setQuizSubmitted(false);
        setQuizScore(null);
        setQuizAnchorIndex(index);
      }
    } catch (e) {
      console.error(e);
      setError('Quiz generation failed. Please try again.');
    }

    setQuizLoading(false);
  };
    // quiz submission
    const handleSubmitQuiz = async () => {
    if (!quizData || !data) return;

    if (quizAnswers.some((a) => a === -1)) {
      setError('Please answer all quiz questions before submitting.');
      return;
    }

    setError(null);

    const questions = quizData.questions;
    const correctCount = questions.filter(
      (q, i) => quizAnswers[i] === q.correctIndex
    ).length;

    setQuizScore(correctCount);
    setQuizSubmitted(true);

    const mistakes = questions
      .map((q, i) => ({
        concept: q.concept,
        question: q.question,
        selected: quizAnswers[i],
        correct: q.correctIndex,
        userAnswer: q.options[quizAnswers[i]],
        correctAnswer: q.options[q.correctIndex],
      }))
      .filter((m) => m.selected !== m.correct);

    if (mistakes.length === 0) return;

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'remediate',
          topic,
          about,
          persona: getActivePersona(),
          difficulty,
          mistakes,
        }),
      });

      const result = await res.json();

      if (result.error) {
        setError(`Remediation failed: ${result.error}`);
      } else {
        setData((prev) =>
          prev
            ? {
                ...prev,
                cards: [...prev.cards, ...result.cards],
              }
            : prev
        );
      }
    } catch (e) {
      console.error(e);
      setError('Remediation failed. Please try again.');
    }
  };

  // SPLASH / LANDING VIEW
  if (showSplash) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-2xl space-y-8 text-center">
          {/* Hero */}
          <div className="space-y-4">
            <div className="flex items-center justify-center gap-3">
              <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg">
                <Zap className="w-8 h-8 text-white" />
              </div>
              <h1 className="text-4xl font-black text-slate-900 tracking-tight">FlashLearn</h1>
            </div>
            <p className="text-xl text-slate-600 max-w-lg mx-auto leading-relaxed">
              Learn anything, your way: AI-powered flashcards that adapt to <em>how you think</em>
            </p>
            <p className="text-xs font-black uppercase tracking-widest text-indigo-500">
              Built for Human-AI Interaction · University of Michigan
            </p>
          </div>

          {/* Feature grid */}
          <div className="grid grid-cols-3 gap-4 text-left">
            {[
              { icon: BrainCircuit, color: 'text-indigo-600', bg: 'bg-indigo-50', title: 'You Control the AI', desc: 'Set your persona, level, and background. The AI adapts its explanation to exactly how you learn.' },
              { icon: MessageSquare, color: 'text-emerald-600', bg: 'bg-emerald-50', title: 'Ask Anything', desc: 'Multi-turn AI chat grounded in your cards. Get answers, not links. Try voice input too.' },
              { icon: Network, color: 'text-purple-600', bg: 'bg-purple-50', title: 'Knowledge Map', desc: 'Watch topics form a 3D knowledge graph as you learn. See how ideas connect across sessions.' },
            ].map(({ icon: Icon, color, bg, title, desc }) => (
              <div key={title} className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 hover:shadow-md transition-shadow">
                <div className={`w-8 h-8 ${bg} rounded-xl flex items-center justify-center mb-3`}>
                  <Icon className={`w-4 h-4 ${color}`} />
                </div>
                <p className="font-black text-slate-800 text-sm mb-1">{title}</p>
                <p className="text-xs text-slate-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>

          {/* HAI principle note */}
          <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 text-left flex gap-3 items-start">
            <Shield className="w-5 h-5 text-indigo-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-black text-indigo-800">Human in the Loop: Always</p>
              <p className="text-xs text-indigo-600 mt-0.5 leading-relaxed">
                FlashLearn never generates silently. You choose the persona, difficulty, and context before every explanation. The AI follows your lead, not the other way around.
              </p>
            </div>
          </div>

          {/* Also works as Chrome extension */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-center gap-3 text-left">
            <BookOpen className="w-4 h-4 text-slate-400 shrink-0" />
            <p className="text-xs text-slate-500 leading-relaxed">
              <span className="font-black text-slate-700">Chrome Extension available.</span>{' '}
              Highlight any text on any webpage and generate flashcards from that source, with Back-to-Source linking.
            </p>
          </div>

          <button
            onClick={() => {
              localStorage.setItem('flashlearn_seen_splash', '1');
              setShowSplash(false);
            }}
            className="w-full py-4 bg-indigo-600 text-white font-black text-base uppercase tracking-widest rounded-2xl hover:bg-indigo-700 transition-colors shadow-lg focus:outline-none focus:ring-4 focus:ring-indigo-300"
            autoFocus
            aria-label="Get started with FlashLearn"
          >
            Start Learning →
          </button>
          <p className="text-xs text-slate-400">Free · Works on any topic · No account required</p>
        </div>
      </div>
    );
  }

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
              Understand any topic, without the information overload
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

          {/* HAI Transparency Badge */}
          <div
            className="flex items-start gap-3 bg-indigo-50 border border-indigo-100 rounded-xl p-3 cursor-pointer hover:border-indigo-300 transition-colors"
            onClick={() => setShowHAIPanel(v => !v)}
            role="button"
            tabIndex={0}
            aria-expanded={showHAIPanel}
            aria-label="AI transparency: see how the AI is configured"
            onKeyDown={(e) => e.key === 'Enter' && setShowHAIPanel(v => !v)}
          >
            <Shield className="w-4 h-4 text-indigo-500 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-black text-indigo-700 uppercase tracking-widest">
                AI Mode: {useCustomPersona ? (customPersona || 'Custom') : persona} · {difficulty}
              </p>
              <p className="text-[10px] text-indigo-500 mt-0.5">
                {showHAIPanel ? 'Hide' : 'See'} how the AI will explain this topic to you →
              </p>
              {showHAIPanel && (
                <div className="mt-2 space-y-1.5 text-[11px] text-indigo-700">
                  <p><span className="font-black">Persona:</span> {useCustomPersona ? (customPersona || 'Not set') : persona}</p>
                  <p><span className="font-black">Difficulty:</span> {difficulty}: AI calibrates vocabulary and depth to this level</p>
                  {about && <p><span className="font-black">Your background:</span> {about.slice(0, 120)}{about.length > 120 ? '…' : ''}</p>}
                  <p className="text-indigo-400 pt-1 border-t border-indigo-100">
                    The AI only uses the persona and settings <em>you</em> choose. You can change them anytime before generating.
                  </p>
                </div>
              )}
            </div>
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

          {/* Memory mode toggle */}
          {knowledgeGraph.nodes.length > 0 && (
            <button
              onClick={() => setUseMemory((v) => !v)}
              className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
                useMemory
                  ? 'bg-indigo-50 border-indigo-300 text-indigo-800'
                  : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300'
              }`}
            >
              <Brain className={`w-4 h-4 shrink-0 ${useMemory ? 'text-indigo-600' : 'text-slate-400'}`} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-black uppercase tracking-widest">
                  Use Knowledge Memory {useMemory ? '(ON)' : '(OFF)'}
                </p>
                <p className="text-[10px] mt-0.5 opacity-70">
                  Bridge this topic to your {knowledgeGraph.nodes.length} previous topics
                </p>
              </div>
              <div className={`w-8 h-4 rounded-full transition-colors shrink-0 ${useMemory ? 'bg-indigo-500' : 'bg-slate-300'}`}>
                <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform ${useMemory ? 'translate-x-4' : 'translate-x-0'}`} />
              </div>
            </button>
          )}

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
            aria-label={topic.trim() ? `Generate flashcards for ${topic}` : 'Enter a topic to generate flashcards'}
            className="w-full py-4 bg-indigo-600 text-white font-black text-sm uppercase tracking-widest rounded-2xl hover:bg-indigo-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-4 focus:ring-indigo-300"
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
  const shouldShowQuiz =
  quizAnchorIndex !== null
    ? index === quizAnchorIndex
    : index === CARD_COUNT - 1;


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
              setQuizData(null);
              setQuizAnswers([]);
              setQuizSubmitted(false);
              setQuizScore(null);
              setQuizAnchorIndex(null);
            }}
            className="text-slate-500 hover:text-indigo-600 font-bold flex items-center gap-2 transition-colors text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 rounded-lg px-1"
            aria-label="Go back to topic selection"
          >
            <ChevronLeft className="w-4 h-4" /> New Topic
          </button>
          {/* AI Mode badge */}
          <div
            title={`AI persona: ${getActivePersona()} · Difficulty: ${difficulty}`}
            className="hidden sm:flex items-center gap-1.5 text-[10px] bg-indigo-50 text-indigo-600 rounded-full px-2.5 py-1 font-black border border-indigo-100 cursor-default"
            aria-label={`AI configured for ${getActivePersona()} at ${difficulty} level`}
          >
            <Shield className="w-3 h-3" />
            {(useCustomPersona ? customPersona : persona).split(' ').slice(0, 2).join(' ')} · {difficulty}
          </div>
          <nav className="flex gap-2" aria-label="View modes" role="navigation">
            <button
              onClick={() => setViewMode('cards')}
              aria-label="Card view"
              aria-pressed={viewMode === 'cards'}
              title="Card View"
              className={`px-3 py-2 rounded-lg font-bold text-sm transition focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
                viewMode === 'cards'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              <LayoutList className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('map')}
              aria-label="Map view — all cards at a glance"
              aria-pressed={viewMode === 'map'}
              title="Map View"
              className={`px-3 py-2 rounded-lg font-bold text-sm transition focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
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
              aria-label="Knowledge tree view"
              aria-pressed={viewMode === 'tree'}
              title="Knowledge Tree"
              className={`px-3 py-2 rounded-lg font-bold text-sm transition focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
                viewMode === 'tree'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              <GitBranch className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('chat')}
              aria-label="AI chat view"
              aria-pressed={viewMode === 'chat'}
              title="AI Chat"
              className={`px-3 py-2 rounded-lg font-bold text-sm transition focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
                viewMode === 'chat'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              <MessageSquare className="w-4 h-4" />
            </button>
            <button
              onClick={() => { setViewMode('globe'); setGlobeSelectedNode(null); }}
              aria-label="Knowledge universe — 3D graph"
              aria-pressed={viewMode === 'globe'}
              title="Knowledge Universe"
              className={`px-3 py-2 rounded-lg font-bold text-sm transition focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
                viewMode === 'globe'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              <Globe className="w-4 h-4" />
            </button>
          </nav>
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

              <div className="h-[360px] overflow-y-auto border border-slate-200 rounded-2xl p-4 space-y-3 bg-slate-50" role="log" aria-live="polite" aria-label="Chat messages">
                {chatMessages.length === 0 && (
                  <div className="space-y-3">
                    <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Suggested questions</p>
                    {suggestedQuestions.map((q, i) => (
                      <button
                        key={i}
                        onClick={() => { setChatInput(q); }}
                        className="w-full text-left px-3 py-2.5 rounded-xl border border-indigo-100 bg-white text-sm text-slate-700 hover:border-indigo-400 hover:bg-indigo-50 transition-colors"
                      >
                        {q}
                      </button>
                    ))}
                    <p className="text-xs text-slate-400 mt-2">Or type your own question below.</p>
                  </div>
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
                  aria-label="Chat question input"
                  className="flex-1 p-3 rounded-xl border border-slate-200 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <button
                  onClick={handleVoiceInput}
                  aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
                  title={isListening ? 'Listening… click to stop' : 'Voice input'}
                  className={`px-3 py-3 rounded-xl font-black text-sm transition focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
                    isListening
                      ? 'bg-red-100 text-red-600 animate-pulse'
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}
                >
                  {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>
                <button
                  onClick={handleChat}
                  disabled={!chatInput.trim() || chatLoading}
                  aria-label="Send chat message"
                  className="px-4 py-3 bg-indigo-600 text-white rounded-xl font-black text-sm hover:bg-indigo-700 disabled:opacity-30 focus:outline-none focus:ring-2 focus:ring-indigo-400"
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
                    <button
                      onClick={handleReadAloud}
                      aria-label={isReading ? 'Stop reading aloud' : 'Read card aloud'}
                      title={isReading ? 'Stop' : 'Listen to this card'}
                      className={`flex items-center gap-1.5 text-[11px] font-black uppercase transition-colors ${
                        isReading ? 'text-emerald-600 animate-pulse' : 'text-slate-400 hover:text-emerald-500'
                      }`}
                    >
                      {isReading ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
                      {isReading ? 'Stop' : 'Listen'}
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

                  {sourceUrl && (
                    <button
                      onClick={() => {
                        const anchor = currentCard?.source_anchor;
                        if (anchor && window.parent !== window) {
                          // Inside extension iframe — ask sidepanel to scroll the source tab
                          window.parent.postMessage(
                            { type: 'FLASHLEARN_GOTO_SOURCE', anchor },
                            '*'
                          );
                        } else {
                          // No anchor (LeetCode mode) or standalone — open source page
                          window.open(sourceUrl, '_blank');
                        }
                      }}
                      className="flex items-center gap-1.5 text-[11px] font-black uppercase text-teal-500 hover:text-teal-700 transition-colors border border-teal-200 bg-teal-50 rounded-lg px-2.5 py-1.5"
                      title={currentCard?.source_anchor ? `Back to: "${currentCard.source_anchor}"` : `Open source: ${sourceUrl}`}
                    >
                      <ExternalLink className="w-3 h-3" /> Back to Source
                    </button>
                  )}
                </div>
              )}
            </div>

                        {shouldShowQuiz && (
              <div className="px-6 pb-2 space-y-4">
                {!quizData && (
                  <button
                    onClick={handleGenerateQuiz}
                    disabled={quizLoading}
                    className="w-full py-3 bg-emerald-600 text-white font-black text-sm uppercase tracking-widest rounded-2xl hover:bg-emerald-700 disabled:opacity-40 transition-colors"
                  >
                    {quizLoading ? 'Generating Quiz...' : 'Test Your Knowledge'}
                  </button>
                )}

                {quizData && (
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-5">
                    <div>
                      <p className="text-xs font-black text-slate-400 uppercase tracking-widest">
                        Quick Check
                      </p>
                      <h3 className="text-lg font-black text-slate-800 mt-1">
                        End-of-Path Quiz
                      </h3>
                    </div>

                    {quizData.questions.map((q, qi) => (
                      <div key={q.id} className="space-y-3">
                        <p className="text-sm font-bold text-slate-800">
                          {qi + 1}. {q.question}
                        </p>

                        <div className="grid gap-2">
                          {q.options.map((option, oi) => {
                            const selected = quizAnswers[qi] === oi;
                            const isCorrect = oi === q.correctIndex;
                            const showReview = quizSubmitted;

                            return (
                              <button
                                key={oi}
                                onClick={() => {
                                  if (quizSubmitted) return;
                                  setQuizAnswers((prev) => {
                                    const next = [...prev];
                                    next[qi] = oi;
                                    return next;
                                  });
                                }}
                                className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition ${
                                  showReview
                                    ? isCorrect
                                      ? 'border-green-500 bg-green-50 text-green-800'
                                      : selected
                                      ? 'border-red-400 bg-red-50 text-red-700'
                                      : 'border-slate-200 bg-white text-slate-600'
                                    : selected
                                    ? 'border-indigo-500 bg-indigo-50 text-indigo-800'
                                    : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-300'
                                }`}
                              >
                                {option}
                              </button>
                            );
                          })}
                        </div>

                        {quizSubmitted && (
                          <div className="bg-white border border-slate-200 rounded-xl p-3">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
                              Explanation
                            </p>
                            <p className="text-sm text-slate-700">{q.explanation}</p>
                          </div>
                        )}
                      </div>
                    ))}

                    {!quizSubmitted ? (
                      <button
                        onClick={handleSubmitQuiz}
                        className="w-full py-3 bg-indigo-600 text-white font-black text-sm uppercase tracking-widest rounded-2xl hover:bg-indigo-700 transition-colors"
                      >
                        Submit Quiz
                      </button>
                    ) : (
                      <div className="bg-white border border-slate-200 rounded-2xl p-4">
                        <p className="text-xs font-black text-slate-400 uppercase tracking-widest">
                          Score
                        </p>
                        <p className="text-lg font-black text-slate-800 mt-1">
                          {quizScore} / {quizData.questions.length}
                        </p>
                        <p className="text-sm text-slate-600 mt-1">
                          {quizScore === quizData.questions.length
                            ? 'Perfect score! Great job mastering this topic.'
                            : 'New review cards were added after this card. Click Next → to continue.'}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="border-t border-slate-100 p-4 space-y-4">
              <div className="flex gap-1.5" role="tablist" aria-label="Explanation mode">
                {(['simpler', 'normal', 'detailed', 'visual'] as const).map(
                  (v) => {
                    const label = v === 'simpler' ? 'Analogy' : v === 'normal' ? 'Core' : v === 'detailed' ? 'Deeper' : 'Visual';
                    return (
                      <button
                        key={v}
                        role="tab"
                        aria-selected={view === v}
                        aria-label={`${label} explanation`}
                        onClick={() => {
                          setView(v);
                          setRefinement(null);
                        }}
                        className={`flex-1 py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
                          view === v
                            ? 'bg-indigo-600 text-white shadow-md'
                            : 'bg-slate-100 text-slate-500 hover:bg-indigo-50 hover:text-indigo-700'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  },
                )}
              </div>

              <div className="flex items-center gap-4" role="navigation" aria-label="Card navigation">
                <button
                  onClick={() => resetNavigation(Math.max(0, index - 1))}
                  disabled={index === 0}
                  aria-label="Previous card"
                  className="w-12 h-12 flex items-center justify-center rounded-full hover:bg-slate-100 disabled:opacity-10 text-black transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <div className="flex-1 flex justify-center gap-2" role="tablist" aria-label="Cards">
                  {data?.cards.map((card, i) => (
                    <button
                      key={i}
                      onClick={() => resetNavigation(i)}
                      role="tab"
                      aria-selected={i === index}
                      aria-label={`Card ${i + 1}: ${asText(card.title)}`}
                      className={`h-2 rounded-full transition-all bg-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
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
                  aria-label="Next card"
                  className="w-12 h-12 flex items-center justify-center rounded-full hover:bg-slate-100 disabled:opacity-10 text-black transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* GLOBE VIEW — Knowledge Universe */}
        {viewMode === 'globe' && (
          <div className="fixed inset-0 z-50 bg-slate-900 flex">
            {/* 3D Globe */}
            <div className="flex-1 overflow-hidden">
              {knowledgeGraph.nodes.length === 0 ? (
                <div className="w-full h-full flex flex-col items-center justify-center text-center p-8 space-y-4">
                  <Globe className="w-16 h-16 text-slate-600" />
                  <p className="text-slate-400 font-bold text-lg">Your Knowledge Universe is Empty</p>
                  <p className="text-slate-500 text-sm max-w-xs">
                    Generate your first learning path and come back here to watch your knowledge graph grow.
                  </p>
                  <button
                    onClick={() => setViewMode('cards')}
                    className="mt-4 px-6 py-3 bg-indigo-600 text-white font-black text-sm rounded-2xl hover:bg-indigo-700 transition-colors"
                  >
                    Start Learning →
                  </button>
                </div>
              ) : (
                <KnowledgeGlobe
                  nodes={knowledgeGraph.nodes}
                  edges={knowledgeGraph.edges}
                  onNodeClick={(node) => setGlobeSelectedNode(node)}
                />
              )}
            </div>

            {/* Stats Sidebar */}
            <div className="w-72 bg-slate-800 border-l border-slate-700 flex flex-col overflow-hidden">
              <div className="p-5 border-b border-slate-700">
                <button
                  onClick={() => setViewMode('cards')}
                  className="text-slate-400 hover:text-white text-xs font-black uppercase tracking-widest flex items-center gap-1 mb-3 transition-colors"
                >
                  <ChevronLeft className="w-3 h-3" /> Back to Cards
                </button>
                <h2 className="text-white font-black text-base">Knowledge Universe</h2>
                <p className="text-slate-400 text-xs mt-1">
                  {knowledgeGraph.nodes.length} topics · {knowledgeGraph.edges.length} connections
                </p>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-5">
                {/* Colour legend */}
                <div className="space-y-1.5">
                  <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">Node Legend</p>
                  {[
                    { color: '#f59e0b', label: 'Mastered', desc: '3+ studies or 4+ connections' },
                    { color: '#818cf8', label: 'Connected', desc: '2+ connections' },
                    { color: '#22d3ee', label: 'Learning', desc: 'New, few connections' },
                    { color: '#475569', label: 'Isolated', desc: 'No connections yet' },
                  ].map(({ color, label, desc }) => (
                    <div key={label} className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
                      <span className="text-slate-300 text-xs font-bold">{label}</span>
                      <span className="text-slate-500 text-[10px]">: {desc}</span>
                    </div>
                  ))}
                </div>

                {/* Selected node detail */}
                {globeSelectedNode && (
                  <div className="bg-slate-700 rounded-2xl p-4 space-y-2">
                    <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Selected Topic</p>
                    <p className="text-white font-black text-sm">{globeSelectedNode.topic}</p>
                    <p className="text-slate-400 text-xs leading-relaxed">{globeSelectedNode.summary}</p>
                    <div className="flex gap-3 pt-1">
                      <span className="text-xs text-slate-300">
                        <span className="font-black text-white">{globeSelectedNode.connections}</span> connections
                      </span>
                      <span className="text-xs text-slate-300">
                        Studied <span className="font-black text-white">{globeSelectedNode.timesStudied}×</span>
                      </span>
                    </div>
                    {/* Show edges from this node */}
                    {knowledgeGraph.edges
                      .filter((e) => e.source === globeSelectedNode.id || e.target === globeSelectedNode.id)
                      .slice(0, 3)
                      .map((e, i) => {
                        const otherId = e.source === globeSelectedNode.id ? e.target : e.source;
                        const other = knowledgeGraph.nodes.find((n) => n.id === otherId);
                        return (
                          <div key={i} className="text-[10px] text-slate-400 border-t border-slate-600 pt-2 leading-relaxed">
                            <span className="text-indigo-400 font-bold">{other?.topic}</span>: {e.bridge}
                          </div>
                        );
                      })}
                  </div>
                )}

                {/* Strongest connections */}
                {knowledgeGraph.edges.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">Strongest Connections</p>
                    {[...knowledgeGraph.edges]
                      .sort((a, b) => b.weight - a.weight)
                      .slice(0, 4)
                      .map((e, i) => {
                        const src = knowledgeGraph.nodes.find((n) => n.id === e.source);
                        const tgt = knowledgeGraph.nodes.find((n) => n.id === e.target);
                        return (
                          <div key={i} className="bg-slate-700/60 rounded-xl p-3 space-y-1">
                            <div className="flex items-center gap-1.5">
                              <div className="h-1 rounded-full bg-amber-400" style={{ width: `${Math.round(e.weight * 100)}%`, minWidth: '20%' }} />
                              <span className="text-[10px] text-slate-400">{Math.round(e.weight * 100)}%</span>
                            </div>
                            <p className="text-xs text-slate-300 font-bold line-clamp-2">
                              {src?.topic.slice(0, 60)}{(src?.topic.length ?? 0) > 60 ? '…' : ''}{' '}
                              <span className="text-slate-500">↔</span>{' '}
                              {tgt?.topic.slice(0, 60)}{(tgt?.topic.length ?? 0) > 60 ? '…' : ''}
                            </p>
                            <p className="text-[10px] text-slate-500 leading-snug">{e.bridge}</p>
                          </div>
                        );
                      })}
                  </div>
                )}

                {/* Knowledge gaps */}
                {getIsolatedNodes(knowledgeGraph).length > 0 && (
                  <div className="space-y-2">
                    <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">Knowledge Gaps</p>
                    <p className="text-slate-500 text-[10px]">These topics have no connections yet. Try learning something related.</p>
                    {getIsolatedNodes(knowledgeGraph).map((n) => (
                      <div key={n.id} className="flex items-center gap-2 px-3 py-2 bg-slate-700/40 rounded-xl">
                        <div className="w-2 h-2 rounded-full bg-slate-500 shrink-0" />
                        <span className="text-slate-300 text-xs font-bold truncate">{n.topic}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Clear graph */}
              <div className="p-4 border-t border-slate-700">
                <button
                  onClick={() => {
                    if (confirm('Clear your entire knowledge graph? This cannot be undone.')) {
                      clearGraph();
                      setKnowledgeGraph({ nodes: [], edges: [] });
                    }
                  }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-slate-500 hover:text-red-400 hover:bg-slate-700 transition-colors text-xs font-black uppercase tracking-widest"
                >
                  <Trash2 className="w-3 h-3" /> Clear Graph
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Floating chat button — visible when not already in chat/globe/tree */}
      {data && viewMode !== 'chat' && viewMode !== 'globe' && viewMode !== 'tree' && (
        <button
          onClick={() => setViewMode('chat')}
          aria-label="Open AI chat assistant"
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 bg-indigo-600 text-white rounded-2xl shadow-2xl px-4 py-3 hover:bg-indigo-700 active:scale-95 transition-all font-black text-sm focus:outline-none focus:ring-4 focus:ring-indigo-300"
        >
          <MessageSquare className="w-5 h-5" />
          Ask AI
        </button>
      )}

      {/* Connections discovered toast */}
      {showConnectionsToast && connectionsFound > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-indigo-600 text-white px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-3">
          <Sparkles className="w-4 h-4 shrink-0" />
          <span className="text-sm font-bold">
            {connectionsFound} knowledge connection{connectionsFound > 1 ? 's' : ''} discovered!
          </span>
          <button
            onClick={() => { setViewMode('globe'); setShowConnectionsToast(false); }}
            className="text-indigo-200 hover:text-white text-xs font-black underline underline-offset-2 shrink-0"
          >
            View graph →
          </button>
        </div>
      )}
    </div>
  );
}