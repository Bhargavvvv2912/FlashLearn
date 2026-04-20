'use client';
import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import {
  ChevronRight, ChevronLeft, Zap, Info, Map as MapIcon,
  LayoutList, BrainCircuit, Sparkles, RefreshCcw, MessageSquare,
  Plus, Minus, Terminal, Lightbulb, GitBranch, ExternalLink,
  Globe, Brain, Trash2
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import {
  loadGraph, upsertNode, mergeEdges, clearGraph, topicToId,
  upsertGraphNode, upsertGraphEdge,
  getTopConnectedNodes, getIsolatedNodes,
  type KnowledgeGraph, type KnowledgeRelation,
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

type ExpansionAction = 'simplify' | 'example' | 'drill' | 'reexplain';
type ExpansionRelation = Extract<
  KnowledgeRelation,
  'simplify' | 'example' | 'reexplain' | 'drill_deeper'
>;
type GraphNodeInput = Parameters<typeof upsertGraphNode>[0];
type GraphEdgeInput = Parameters<typeof upsertGraphEdge>[0];
type ExpansionMiniCard = {
  id?: string;
  title: string;
  content: string;
};
type QuestionAnswerCard = {
  title: string;
  content: string;
};
type ExpansionPanel = {
  action: ExpansionAction;
  cards: ExpansionMiniCard[];
  activeIndex: number;
};
type ViewMode = 'cards' | 'map' | 'tree' | 'chat' | 'globe';
type TreeBranch = 'normal' | 'simpler' | 'detailed' | 'visual' | null;

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text?: string;
  cards?: QuestionAnswerCard[];
};

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
  const [expansions, setExpansions] = useState<Record<number, ExpansionPanel>>({});
  const [expansionCache, setExpansionCache] = useState<Record<string, ExpansionMiniCard[]>>({});
  const [expansionLoading, setExpansionLoading] = useState<{
    cardIndex: number;
    action: ExpansionAction;
  } | null>(null);
  const [expansionErrors, setExpansionErrors] = useState<Record<number, string>>({});
  const [showHook, setShowHook] = useState(true);

  // tree/map selection state
  const [treeFocusCardIndex, setTreeFocusCardIndex] = useState<number | null>(null);
  const [treeSelectedBranch, setTreeSelectedBranch] = useState<TreeBranch>(null);
  const [treeSelectedNodeId, setTreeSelectedNodeId] = useState<string | null>(null);
  const [mapSelectedExpansionNodeId, setMapSelectedExpansionNodeId] = useState<string | null>(null);

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
  const [currentTopicNodeId, setCurrentTopicNodeId] = useState<string | null>(null);

   // quiz state
  const [quizData, setQuizData] = useState<QuizData | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<number[]>([]);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [quizScore, setQuizScore] = useState<number | null>(null);
  const [quizAnchorIndex, setQuizAnchorIndex] = useState<number | null>(null);

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

  const relationKey = (action: ExpansionAction): ExpansionRelation => {
    const relations: Record<ExpansionAction, ExpansionRelation> = {
      simplify: 'simplify',
      example: 'example',
      reexplain: 'reexplain',
      drill: 'drill_deeper',
    };
    return relations[action];
  };

  const getTopicNodeId = () => currentTopicNodeId || topicToId(topic || 'flashlearn-topic');
  const getMainCardNodeId = (cardIndex: number) => `${getTopicNodeId()}--card-${cardIndex + 1}`;
  const getReviewGroupId = () => `${getTopicNodeId()}--review`;

  const getExpansionGroupsForCard = (cardIndex: number) => {
    const parentId = getMainCardNodeId(cardIndex);
    return knowledgeGraph.nodes.filter(
      (node) => node.type === 'expansion_group' && node.parentId === parentId,
    );
  };

  const getExpansionNodesForGroup = (groupId: string) =>
    knowledgeGraph.nodes.filter(
      (node) => node.type === 'expansion' && node.parentId === groupId,
    );

  const getReviewNodes = () =>
    knowledgeGraph.nodes.filter(
      (node) =>
        node.type === 'review' &&
        node.reviewGroupId === getReviewGroupId() &&
        node.parentId === getReviewGroupId() &&
        node.id !== getReviewGroupId(),
    );

  const persistGraphNodes = (
    nodes: Parameters<typeof upsertGraphNode>[0][],
    edges: Parameters<typeof upsertGraphEdge>[0][],
  ) => {
    nodes.forEach((node) => upsertGraphNode(node));
    edges.forEach((edge) => upsertGraphEdge(edge));
    setKnowledgeGraph({ ...loadGraph() });
  };

  const persistMainCardNodes = (
    cards: Card[],
    topicNodeId: string,
    topicName: string,
    topicSummary: string,
  ) => {
    const nodes: Parameters<typeof upsertGraphNode>[0][] = [
      {
        id: topicNodeId,
        topic: topicName,
        summary: topicSummary,
        type: 'main',
        relation: 'main',
      },
    ];
    const edges: Parameters<typeof upsertGraphEdge>[0][] = [];

    cards.slice(0, 7).forEach((card, cardIndex) => {
      const cardNodeId = `${topicNodeId}--card-${cardIndex + 1}`;
      nodes.push({
        id: cardNodeId,
        topic: `Card ${cardIndex + 1}: ${asText(card.title)}`,
        summary: asText(card.content).slice(0, 240),
        type: 'main',
        relation: 'main',
        parentId: topicNodeId,
        cardIndex,
      });
      edges.push({
        source: topicNodeId,
        target: cardNodeId,
        weight: 0.55,
        bridge: `Main learning card ${cardIndex + 1}`,
        label: 'Main Card',
        relation: 'main',
      });
    });

    persistGraphNodes(nodes, edges);
  };

  const persistExpansionNodes = (
    cardIndex: number,
    action: ExpansionAction,
    cards: ExpansionMiniCard[],
  ): ExpansionMiniCard[] => {
    if (!data) return cards;

    const parentId = getMainCardNodeId(cardIndex);
    const parentCard = data.cards[cardIndex];
    const relation: ExpansionRelation = relationKey(action);
    const label = expansionLabels[action];
    const groupId = `${parentId}--${relation}`;
    const enrichedCards = cards.map((card, miniIndex) => ({
      ...card,
      id: `${groupId}--card-${miniIndex + 1}`,
    }));

    const parentNode: GraphNodeInput = {
      id: parentId,
      topic: `Card ${cardIndex + 1}: ${asText(parentCard?.title)}`,
      summary: asText(parentCard?.content).slice(0, 240),
      type: 'main',
      relation: 'main',
      parentId: getTopicNodeId(),
      cardIndex,
    };

    const expansionNodes: GraphNodeInput[] = [parentNode];

    const groupNode: GraphNodeInput = {
      id: groupId,
      topic: label,
      summary: `${label} expansions for ${asText(parentCard?.title)}`,
      type: 'expansion_group',
      relation,
      parentId,
      cardIndex,
    };
    expansionNodes.push(groupNode);

    enrichedCards.forEach((card, miniIndex) => {
      const expansionNode: GraphNodeInput = {
        id: card.id!,
        topic: `${label} ${miniIndex + 1}: ${card.title}`,
        summary: card.content.slice(0, 240),
        type: 'expansion',
        relation,
        parentId: groupId,
        cardIndex,
      };
      expansionNodes.push(expansionNode);
    });

    const expansionEdges: GraphEdgeInput[] = [
      {
        source: parentId,
        target: groupId,
        weight: 0.8,
        bridge: `${label} refinement branch for ${asText(parentCard?.title)}`,
        label,
        relation,
      },
      ...enrichedCards.map((card, miniIndex): GraphEdgeInput => ({
        source: groupId,
        target: card.id!,
        weight: 0.8,
        bridge: `${label} card ${miniIndex + 1}`,
        label: `${label} Card`,
        relation,
      })),
    ];

    persistGraphNodes(expansionNodes, expansionEdges);

    return enrichedCards;
  };

  const persistReviewNodes = (reviewCards: Card[]) => {
    if (!reviewCards.length) return;

    const topicNodeId = getTopicNodeId();
    const reviewGroupId = getReviewGroupId();
    const nodes: Parameters<typeof upsertGraphNode>[0][] = [
      {
        id: reviewGroupId,
        topic: 'Review',
        summary: 'Separate corrective review branch generated from quiz misses.',
        type: 'review_group',
        relation: 'review',
        parentId: topicNodeId,
        reviewGroupId,
      },
    ];
    const edges: Parameters<typeof upsertGraphEdge>[0][] = [
      {
        source: topicNodeId,
        target: reviewGroupId,
        weight: 0.7,
        bridge: 'Corrective review branch for missed quiz concepts',
        label: 'Review Branch',
        relation: 'review',
      },
    ];

    reviewCards.forEach((card, reviewIndex) => {
      const nodeId = `${reviewGroupId}--card-${reviewIndex + 1}`;
      nodes.push({
        id: nodeId,
        topic: `Review ${reviewIndex + 1}: ${asText(card.title)}`,
        summary: asText(card.content).slice(0, 240),
        type: 'review',
        relation: 'review',
        parentId: reviewGroupId,
        reviewGroupId,
        cardIndex: 7 + reviewIndex,
      });
      edges.push({
        source: reviewGroupId,
        target: nodeId,
        weight: 0.8,
        bridge: `Review card for ${asText(card.title)}`,
        label: 'Review',
        relation: 'review',
      });
    });

    persistGraphNodes(nodes, edges);
  };

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
        setExpansions({});
        setExpansionCache({});
        setExpansionErrors({});
        setExpansionLoading(null);
        setCurrentTopicNodeId(null);
        setShowHook(true);
        setViewMode('cards');
        setView('normal');
        setTreeFocusCardIndex(null);
        setTreeSelectedBranch(null);
        setTreeSelectedNodeId(null);
        setMapSelectedExpansionNodeId(null);
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
        setCurrentTopicNodeId(nodeId);
        setKnowledgeGraph({ ...updatedGraph });
        persistMainCardNodes(result.cards || [], nodeId, kgTopicName, result.topic_summary || topic);

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

  const expansionLabels: Record<ExpansionAction, string> = {
    simplify: 'Simplify',
    example: 'Real Example',
    drill: 'Drill Deeper',
    reexplain: 'Re-explain',
  };

  const expansionAccent: Record<ExpansionAction, string> = {
    simplify: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    example: 'border-amber-200 bg-amber-50 text-amber-700',
    drill: 'border-indigo-200 bg-indigo-50 text-indigo-700',
    reexplain: 'border-rose-200 bg-rose-50 text-rose-700',
  };

  const handleExpansion = async (action: ExpansionAction) => {
    if (!data) return;

    const cacheKey = `${index}:${view}:${action}`;
    if (expansions[index]?.action === action) {
      setExpansions((prev) => {
        const next = { ...prev };
        delete next[index];
        return next;
      });
      setExpansionErrors((prev) => {
        const next = { ...prev };
        delete next[index];
        return next;
      });
      return;
    }

    if (expansionCache[cacheKey]) {
      const cachedCards = persistExpansionNodes(index, action, expansionCache[cacheKey]);
      setExpansions((prev) => ({
        ...prev,
        [index]: { action, cards: cachedCards, activeIndex: 0 },
      }));
      setExpansionErrors((prev) => {
        const next = { ...prev };
        delete next[index];
        return next;
      });
      return;
    }

    setExpansionLoading({ cardIndex: index, action });
    setExpansions((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
    setExpansionErrors((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
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
          action: 'expand',
          expansionAction: action,
          cardTitle: asText(data.cards[index].title),
          currentContent: currentText,
          about,
          persona: getActivePersona(),
          difficulty,
          context,
        }),
      });

      const result = await res.json();

      if (result.error) {
        setExpansionErrors((prev) => ({
          ...prev,
          [index]: `Expansion failed: ${result.error}`,
        }));
      } else {
        const cards = Array.isArray(result.cards) ? result.cards : [];
        if (cards.length !== 2) {
          setExpansionErrors((prev) => ({
            ...prev,
            [index]: 'Expansion returned an unexpected shape. Please try again.',
          }));
        } else {
          const enrichedCards = persistExpansionNodes(index, action, cards);
          setExpansions((prev) => ({
            ...prev,
            [index]: { action, cards: enrichedCards, activeIndex: 0 },
          }));
          setExpansionCache((prev) => ({
            ...prev,
            [cacheKey]: enrichedCards,
          }));
        }
      }
    } catch (e) {
      console.error(e);
      setExpansionErrors((prev) => ({
        ...prev,
        [index]: 'Expansion failed. Please try again.',
      }));
    }

    setExpansionLoading((current) =>
      current?.cardIndex === index && current.action === action ? null : current,
    );
  };

  const clearExpansionForCard = (cardIndex: number) => {
    setExpansions((prev) => {
      const next = { ...prev };
      delete next[cardIndex];
      return next;
    });
    setExpansionErrors((prev) => {
      const next = { ...prev };
      delete next[cardIndex];
      return next;
    });
    setExpansionLoading((current) =>
      current?.cardIndex === cardIndex ? null : current,
    );
  };

  const moveExpansion = (cardIndex: number, direction: -1 | 1) => {
    setExpansions((prev) => {
      const panel = prev[cardIndex];
      if (!panel) return prev;
      const nextIndex = Math.min(
        Math.max(panel.activeIndex + direction, 0),
        panel.cards.length - 1,
      );
      return {
        ...prev,
        [cardIndex]: { ...panel, activeIndex: nextIndex },
      };
    });
  };

  const resetNavigation = (
    newIndex: number,
    newView?: 'normal' | 'simpler' | 'detailed' | 'visual',
  ) => {
    setIndex(newIndex);
    setView(newView || 'normal');
    setShowHook(true);
  };

  const getTreeBranchContent = () => {
    if (treeSelectedNodeId) {
      return knowledgeGraph.nodes.find((node) => node.id === treeSelectedNodeId)?.summary || '';
    }
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
    const questionId = `question-${Date.now()}`;
    const nextHistory: ChatMessage[] = [
      ...chatMessages,
      { id: questionId, role: 'user', text: userMessage },
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
          action: 'question_cards',
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
        const answerCards = Array.isArray(result.cards) ? result.cards : [];
        if (answerCards.length === 0) {
          setError('Chat failed: answer cards were not generated. Please try again.');
        } else {
          setChatMessages((prev) => [
            ...prev,
            {
              id: `answer-${Date.now()}`,
              role: 'assistant',
              cards: answerCards,
            },
          ]);
        }
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
        const reviewCards = Array.isArray(result.cards) ? result.cards : [];
        const allReviewCards = [...data.cards.slice(7), ...reviewCards];
        setData((prev) =>
          prev
            ? {
                ...prev,
                cards: [...prev.cards, ...reviewCards],
              }
            : prev
        );
        persistReviewNodes(allReviewCards);
      }
    } catch (e) {
      console.error(e);
      setError('Remediation failed. Please try again.');
    }
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
  const shouldShowQuiz =
  quizAnchorIndex !== null
    ? index === quizAnchorIndex
    : index === CARD_COUNT - 1;
  const currentExpansion = expansions[index];
  const currentExpansionError = expansionErrors[index];
  const activeExpansionLoading =
    expansionLoading?.cardIndex === index ? expansionLoading : null;
  const mainTreeCards = data?.cards.slice(0, 7) ?? [];
  const reviewNodes = getReviewNodes();
  const topLevelTreeCount = mainTreeCards.length + (reviewNodes.length > 0 ? 1 : 0);
  const TREE_NODE_WIDTH = 160;
  const TREE_NODE_GAP = 18;
  const getSiblingRowWidth = (count: number) =>
    Math.max(TREE_NODE_WIDTH, count * TREE_NODE_WIDTH + Math.max(count - 1, 0) * TREE_NODE_GAP);
  const getGroupBranchWidth = (groupId: string) =>
    getSiblingRowWidth(Math.max(getExpansionNodesForGroup(groupId).length, 1));
  const getCardBranchWidth = (cardIndex: number) => {
    const groups = getExpansionGroupsForCard(cardIndex);
    if (groups.length === 0) return TREE_NODE_WIDTH;
    return Math.max(
      TREE_NODE_WIDTH,
      groups.reduce((sum, group) => sum + getGroupBranchWidth(group.id), 0) +
        Math.max(groups.length - 1, 0) * TREE_NODE_GAP,
    );
  };
  const reviewBranchWidth = reviewNodes.length > 0 ? getSiblingRowWidth(reviewNodes.length) : 0;
  const topLevelBranchWidths = [
    ...mainTreeCards.map((_, cardIndex) => getCardBranchWidth(cardIndex)),
    ...(reviewNodes.length > 0 ? [reviewBranchWidth] : []),
  ];
  const topLevelContentWidth =
    topLevelBranchWidths.reduce((sum, width) => sum + width, 0) +
    Math.max(topLevelBranchWidths.length - 1, 0) * TREE_NODE_GAP;
  const topLevelTreeWidth = Math.max(
    700,
    topLevelContentWidth,
  );
  const getBranchCenterX = (widths: number[], index: number) =>
    widths.slice(0, index).reduce((sum, width) => sum + width, 0) +
    index * TREE_NODE_GAP +
    widths[index] / 2;
  const getTopLevelBranchCenterX = (index: number) =>
    (topLevelTreeWidth - topLevelContentWidth) / 2 +
    getBranchCenterX(topLevelBranchWidths, index);


  // MAIN APP VIEW
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-2xl space-y-4">
        <div className="flex items-center justify-between">
          <button
            onClick={() => {
              setData(null);
              setError(null);
              setExpansions({});
              setExpansionCache({});
              setExpansionErrors({});
              setExpansionLoading(null);
              setCurrentTopicNodeId(null);
              setChatMessages([]);
              setChatInput('');
              setQuizData(null);
              setQuizAnswers([]);
              setQuizSubmitted(false);
              setQuizScore(null);
              setQuizAnchorIndex(null);
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
                setTreeSelectedNodeId(null);
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
            <button
              onClick={() => { setViewMode('globe'); setGlobeSelectedNode(null); }}
              className={`px-3 py-2 rounded-lg font-bold text-sm transition ${
                viewMode === 'globe'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-500 hover:bg-slate-100'
              }`}
              title="Knowledge Universe"
            >
              <Globe className="w-4 h-4" />
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
                      setTreeSelectedNodeId(null);
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
                      style={{ width: `${topLevelTreeWidth}px`, height: '40px' }}
                    >
                      <svg
                        width={topLevelTreeWidth}
                        height="40"
                        className="absolute inset-0"
                      >
                        {Array.from({ length: topLevelTreeCount }).map((_, i) => {
                          const centerX = getTopLevelBranchCenterX(i);
                          return (
                            <line
                              key={i}
                              x1={topLevelTreeWidth / 2}
                              y1="0"
                              x2={centerX}
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
                      className="flex justify-center gap-[18px] mb-3 items-start"
                      style={{
                        width: `${topLevelTreeWidth}px`,
                      }}
                    >
                      {mainTreeCards.map((card, i) => {
                        const expansionGroups = getExpansionGroupsForCard(i);
                        const cardBranchWidth = getCardBranchWidth(i);
                        const groupWidths = expansionGroups.map((group) => getGroupBranchWidth(group.id));
                        return (
                          <div
                            key={i}
                            className="flex flex-col items-center"
                            style={{ width: `${cardBranchWidth}px`, minWidth: `${cardBranchWidth}px` }}
                          >
                            <button
                              onClick={() => {
                                setTreeFocusCardIndex(i);
                                setTreeSelectedBranch('normal');
                                setTreeSelectedNodeId(null);
                              }}
                              className="w-[160px] p-3 rounded-xl border-2 text-left transition-all shadow-sm border-slate-300 bg-white hover:border-indigo-400 hover:shadow-md"
                            >
                              <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black mb-1.5 bg-slate-200 text-slate-600">
                                {i + 1}
                              </div>
                              <p className="text-xs font-bold text-slate-800 leading-tight line-clamp-2">
                                {asText(card.title)}
                              </p>
                            </button>

                            {expansionGroups.length > 0 && (
                              <div className="w-full flex flex-col items-center">
                                <div className="relative w-full" style={{ height: '34px' }}>
                                  <svg width={cardBranchWidth} height="34" className="absolute inset-0">
                                    {expansionGroups.map((_, groupIndex) => (
                                      <line
                                        key={groupIndex}
                                        x1={cardBranchWidth / 2}
                                        y1="0"
                                        x2={getBranchCenterX(groupWidths, groupIndex)}
                                        y2="34"
                                        stroke="#bae6fd"
                                        strokeWidth="1.5"
                                      />
                                    ))}
                                  </svg>
                                </div>
                                <div className="w-full flex justify-center gap-[18px] items-start">
                                  {expansionGroups.map((group, groupIndex) => {
                                    const groupEdge = knowledgeGraph.edges.find((e) => e.target === group.id);
                                    const childNodes = getExpansionNodesForGroup(group.id);
                                    const groupWidth = groupWidths[groupIndex];
                                    const childWidths = childNodes.map(() => TREE_NODE_WIDTH);
                                    return (
                                      <div
                                        key={group.id}
                                        className="flex flex-col items-center"
                                        style={{ width: `${groupWidth}px`, minWidth: `${groupWidth}px` }}
                                      >
                                        <button
                                          onClick={() => {
                                            setTreeFocusCardIndex(i);
                                            setTreeSelectedBranch(null);
                                            setTreeSelectedNodeId(group.id);
                                          }}
                                          className="w-[160px] p-2.5 rounded-xl border text-left transition-all shadow-sm border-sky-200 bg-sky-50 hover:border-sky-400 hover:bg-sky-100"
                                        >
                                          <p className="text-[9px] font-black text-sky-700 uppercase tracking-widest mb-1">
                                            {groupEdge?.label || group.topic}
                                          </p>
                                          <p className="text-[10px] font-bold text-sky-950 leading-tight">
                                            {group.topic}
                                          </p>
                                        </button>
                                        {childNodes.length > 0 && (
                                          <div className="w-full flex flex-col items-center">
                                            <div className="relative w-full" style={{ height: '30px' }}>
                                              <svg width={groupWidth} height="30" className="absolute inset-0">
                                                {childNodes.map((_, childIndex) => (
                                                  <line
                                                    key={childIndex}
                                                    x1={groupWidth / 2}
                                                    y1="0"
                                                    x2={getBranchCenterX(childWidths, childIndex)}
                                                    y2="30"
                                                    stroke="#bae6fd"
                                                    strokeWidth="1.5"
                                                  />
                                                ))}
                                              </svg>
                                            </div>
                                            <div className="w-full flex justify-center gap-[18px]">
                                              {childNodes.map((node, childIndex) => (
                                                <button
                                                  key={node.id}
                                                  onClick={() => {
                                                    setTreeFocusCardIndex(i);
                                                    setTreeSelectedBranch(null);
                                                    setTreeSelectedNodeId(node.id);
                                                  }}
                                                  className="w-[160px] p-2 rounded-lg border text-left transition-all border-cyan-200 bg-white hover:border-cyan-400 hover:bg-cyan-50"
                                                >
                                                  <p className="text-[9px] font-black text-cyan-700 uppercase tracking-widest mb-1">
                                                    Card {childIndex + 1}
                                                  </p>
                                                  <p className="text-[10px] font-bold text-cyan-950 leading-tight line-clamp-2">
                                                    {node.topic.replace(/^[^:]+:\s*/, '')}
                                                  </p>
                                                </button>
                                              ))}
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {reviewNodes.length > 0 && (
                        <div
                          className="flex flex-col items-center"
                          style={{ width: `${reviewBranchWidth}px`, minWidth: `${reviewBranchWidth}px` }}
                        >
                          <div className="w-[160px] p-3 rounded-xl border-2 text-left transition-all shadow-sm border-teal-300 bg-teal-50">
                            <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black mb-1.5 bg-teal-200 text-teal-800">
                              R
                            </div>
                            <p className="text-xs font-black text-teal-950 leading-tight">
                              Review
                            </p>
                            <p className="text-[10px] text-teal-700 mt-1">
                              Reinforcement branch
                            </p>
                          </div>

                          <div className="w-full flex flex-col items-center">
                            <div className="relative w-full" style={{ height: '34px' }}>
                              <svg width={reviewBranchWidth} height="34" className="absolute inset-0">
                                {reviewNodes.map((_, reviewIndex) => (
                                  <line
                                    key={reviewIndex}
                                    x1={reviewBranchWidth / 2}
                                    y1="0"
                                    x2={getBranchCenterX(reviewNodes.map(() => TREE_NODE_WIDTH), reviewIndex)}
                                    y2="34"
                                    stroke="#99f6e4"
                                    strokeWidth="1.5"
                                  />
                                ))}
                              </svg>
                            </div>
                            <div className="w-full flex justify-center gap-[18px]">
                              {reviewNodes.map((node, reviewIndex) => (
                                <button
                                  key={node.id}
                                  onClick={() => {
                                    const cardIndex = node.cardIndex ?? 7 + reviewIndex;
                                    resetNavigation(Math.min(cardIndex, CARD_COUNT - 1));
                                    setViewMode('cards');
                                  }}
                                  className="w-[160px] p-2.5 rounded-xl border text-left transition-all shadow-sm border-teal-200 bg-white hover:border-teal-400 hover:bg-teal-50"
                                >
                                  <p className="text-[9px] font-black text-teal-700 uppercase tracking-widest mb-1">
                                    Review {reviewIndex + 1}
                                  </p>
                                  <p className="text-[10px] font-bold text-teal-950 leading-tight line-clamp-2">
                                    {node.topic.replace(/^Review \d+:\s*/, '')}
                                  </p>
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    <p className="text-center text-xs text-slate-400 mt-6">
                      Generated refinement branches fan out under their parent cards
                    </p>

                  </div>
                </div>
              ) : (
                // FOCUSED CARD TREE
                <div className="w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-8 items-start">
                  <div className="min-w-0">
                    <div className="flex justify-center mb-4">
                      <button
                        onClick={() => {
                          setTreeSelectedBranch('normal');
                          setTreeSelectedNodeId(null);
                        }}
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
                        onClick={() => {
                          setTreeSelectedBranch('simpler');
                          setTreeSelectedNodeId(null);
                        }}
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
                        onClick={() => {
                          setTreeSelectedBranch('detailed');
                          setTreeSelectedNodeId(null);
                        }}
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
                        onClick={() => {
                          setTreeSelectedBranch('visual');
                          setTreeSelectedNodeId(null);
                        }}
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

                    {getExpansionGroupsForCard(treeFocusCardIndex ?? 0).length > 0 && (
                      <div className="mt-8">
                        <p className="text-center text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">
                          Generated Refinement Branches
                        </p>
                        <div className="flex justify-center gap-3 flex-wrap">
                          {getExpansionGroupsForCard(treeFocusCardIndex ?? 0).map((group) => {
                            const edge = knowledgeGraph.edges.find((e) => e.target === group.id);
                            const childCount = getExpansionNodesForGroup(group.id).length;
                            return (
                              <button
                                key={group.id}
                                onClick={() => {
                                  setTreeSelectedNodeId(group.id);
                                  setTreeSelectedBranch(null);
                                }}
                                className={`w-40 p-3 rounded-xl border text-center transition-all ${
                                  treeSelectedNodeId === group.id
                                    ? 'bg-sky-100 border-sky-500 shadow-sm'
                                    : 'bg-sky-50 border-sky-200 hover:border-sky-400'
                                }`}
                              >
                                <p className="text-[10px] font-black text-sky-700 uppercase tracking-wide">
                                  {edge?.label || group.topic}
                                </p>
                                <p className="text-[10px] text-sky-800 mt-1">
                                  {childCount} card{childCount !== 1 ? 's' : ''}
                                </p>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Inline content panel */}
                  <div className="min-w-0 bg-white rounded-3xl shadow-xl border border-slate-200 p-6 sticky top-6">
                    <div className="mb-4">
                      <p className="text-xs font-black text-slate-400 uppercase tracking-widest">
                        {treeSelectedBranch === 'normal'
                          ? 'Core'
                          : treeSelectedNodeId
                          ? knowledgeGraph.nodes.find((node) => node.id === treeSelectedNodeId)?.type === 'review'
                            ? 'Review'
                            : knowledgeGraph.nodes.find((node) => node.id === treeSelectedNodeId)?.type === 'expansion_group'
                            ? 'Refinement Branch'
                            : 'Expansion'
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
                          treeSelectedNodeId
                            ? knowledgeGraph.nodes.find((node) => node.id === treeSelectedNodeId)?.topic
                            : data?.cards[treeFocusCardIndex]?.title,
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
            {mainTreeCards.map((card, i) => {
              const expansionGroups = getExpansionGroupsForCard(i);
              return (
                <div
                  key={i}
                  className={`p-6 bg-white rounded-2xl border-2 transition-all text-left ${
                    index === i
                      ? 'border-indigo-600 shadow-lg'
                      : 'border-slate-100 hover:border-indigo-200'
                  }`}
                >
                  <button
                    onClick={() => {
                      resetNavigation(i);
                      setViewMode('cards');
                    }}
                    className="w-full flex items-start gap-4 text-left cursor-pointer"
                  >
                    <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center text-xs font-black shrink-0">
                      {i + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">
                        Step {i + 1}
                      </p>
                      <p className="font-bold text-slate-800">
                        {asText(card.title)}
                      </p>
                    </div>
                  </button>

                  {expansionGroups.length > 0 && (
                    <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
                      {expansionGroups.map((group) => {
                        const edge = knowledgeGraph.edges.find((e) => e.target === group.id);
                        const childNodes = getExpansionNodesForGroup(group.id);
                        return (
                          <div key={group.id} className="space-y-2">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-black uppercase tracking-widest text-sky-700">
                                {edge?.label || group.topic}
                              </span>
                              <span className="rounded-md bg-sky-50 px-1.5 py-0.5 text-[10px] font-black text-sky-500">
                                {childNodes.length}
                              </span>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {childNodes.map((node, childIndex) => {
                                const isSelected = mapSelectedExpansionNodeId === node.id;
                                return (
                                  <button
                                    key={node.id}
                                    type="button"
                                    onClick={() =>
                                      setMapSelectedExpansionNodeId((current) =>
                                        current === node.id ? null : node.id,
                                      )
                                    }
                                    className={`cursor-pointer rounded-xl border px-3 py-2.5 text-left transition-all ${
                                      isSelected
                                        ? 'border-sky-500 bg-sky-50 shadow-sm ring-2 ring-sky-100'
                                        : 'border-slate-200 bg-slate-50 hover:border-sky-300 hover:bg-white hover:shadow-sm'
                                    }`}
                                    aria-pressed={isSelected}
                                  >
                                    <p className={`text-[9px] font-black uppercase tracking-widest ${
                                      isSelected ? 'text-sky-700' : 'text-slate-400'
                                    }`}>
                                      Sub-card {childIndex + 1}
                                    </p>
                                    <p className="mt-1 text-xs font-bold text-slate-700 leading-snug">
                                      {node.topic.replace(/^[^:]+:\s*/, '')}
                                    </p>
                                  </button>
                                );
                              })}
                            </div>

                            {childNodes.map((node) =>
                              mapSelectedExpansionNodeId === node.id ? (
                                <div
                                  key={`${node.id}-preview`}
                                  className="rounded-xl border border-sky-100 bg-white px-3 py-3 text-sm text-slate-600 shadow-sm"
                                >
                                  <p className="text-[10px] font-black uppercase tracking-widest text-sky-600 mb-1">
                                    Selected Expansion
                                  </p>
                                  <p className="leading-relaxed">
                                    {node.summary}
                                  </p>
                                </div>
                              ) : null,
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {reviewNodes.length > 0 && (
              <div className="mt-2 space-y-3">
                <div className="px-2">
                  <p className="text-xs font-black text-teal-600 uppercase tracking-widest">
                    Review
                  </p>
                  <p className="text-sm font-bold text-slate-500">
                    Reinforcement cards generated from quiz misses
                  </p>
                </div>

                {reviewNodes.map((node, reviewIndex) => (
                  <button
                    key={node.id}
                    onClick={() => {
                      resetNavigation(Math.min(node.cardIndex ?? 7 + reviewIndex, CARD_COUNT - 1));
                      setViewMode('cards');
                    }}
                    className="w-full p-6 bg-teal-50 rounded-2xl border-2 border-teal-100 cursor-pointer transition-all text-left hover:border-teal-300 hover:bg-white"
                  >
                    <div className="flex items-start gap-4">
                      <div className="w-8 h-8 rounded-lg bg-teal-100 text-teal-700 flex items-center justify-center text-xs font-black shrink-0">
                        R{reviewIndex + 1}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-black text-teal-600 uppercase tracking-widest mb-1">
                          Review {reviewIndex + 1}
                        </p>
                        <p className="font-bold text-teal-950">
                          {node.topic.replace(/^Review \d+:\s*/, '')}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
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

                {chatMessages.map((msg, i) =>
                  msg.role === 'user' ? (
                    <div
                      key={msg.id || i}
                      className="max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ml-auto bg-indigo-600 text-white"
                    >
                      {msg.text}
                    </div>
                  ) : (
                    <div
                      key={msg.id || i}
                      className="max-w-full rounded-3xl border border-indigo-100 bg-white shadow-sm overflow-hidden"
                    >
                      <div className="px-4 py-3 border-b border-indigo-50 bg-indigo-50">
                        <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600 flex items-center gap-1">
                          <Sparkles className="w-3 h-3" />
                          Answer Cards
                        </p>
                      </div>

                      {Array.isArray(msg.cards) && msg.cards.length > 0 ? (
                        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                          {msg.cards.map((card, cardIndex) => (
                            <div
                              key={`${msg.id}-card-${cardIndex}`}
                              className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                            >
                              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
                                Card {cardIndex + 1} / {msg.cards?.length}
                              </p>
                              <h4 className="text-sm font-black text-slate-800 mb-2">
                                {card.title || `Answer ${cardIndex + 1}`}
                              </h4>
                              <div className="prose prose-sm text-slate-700 max-w-none">
                                <ReactMarkdown
                                  remarkPlugins={[remarkMath]}
                                  rehypePlugins={[rehypeKatex]}
                                >
                                  {card.content || 'No answer content was generated for this card.'}
                                </ReactMarkdown>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="px-4 py-3 text-sm text-slate-600">
                          {msg.text || 'No answer cards were generated.'}
                        </div>
                      )}
                    </div>
                  ),
                )}

                {chatLoading && (
                  <div className="bg-white border border-slate-200 text-slate-700 max-w-[85%] rounded-2xl px-4 py-3 text-sm">
                    Building answer cards...
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
              </div>

              <div className="space-y-3">
                  <div className="flex items-center gap-4 flex-wrap">
                    <button
                      onClick={() => handleExpansion('simplify')}
                      disabled={!!activeExpansionLoading}
                      className={`flex items-center gap-1.5 text-[11px] font-black uppercase transition-colors disabled:opacity-40 ${
                        currentExpansion?.action === 'simplify'
                          ? 'text-emerald-600'
                          : 'text-slate-400 hover:text-emerald-600'
                      }`}
                    >
                      <MessageSquare className="w-3 h-3" /> Simplify
                    </button>
                    <button
                      onClick={() => handleExpansion('example')}
                      disabled={!!activeExpansionLoading}
                      className={`flex items-center gap-1.5 text-[11px] font-black uppercase transition-colors disabled:opacity-40 ${
                        currentExpansion?.action === 'example'
                          ? 'text-amber-500'
                          : 'text-slate-400 hover:text-amber-500'
                      }`}
                    >
                      <Lightbulb className="w-3 h-3" /> Real Example
                    </button>
                    <button
                      onClick={() => handleExpansion('drill')}
                      disabled={!!activeExpansionLoading}
                      className={`flex items-center gap-1.5 text-[11px] font-black uppercase transition-colors disabled:opacity-40 ${
                        currentExpansion?.action === 'drill'
                          ? 'text-indigo-600'
                          : 'text-slate-400 hover:text-indigo-600'
                      }`}
                    >
                      <BrainCircuit className="w-3 h-3" /> Drill Deeper
                    </button>
                    <div className="ml-auto">
                      <button
                        onClick={() => handleExpansion('reexplain')}
                        disabled={!!activeExpansionLoading}
                        className={`flex items-center gap-1.5 text-[11px] font-black uppercase transition-colors disabled:opacity-40 ${
                          currentExpansion?.action === 'reexplain'
                            ? 'text-rose-600'
                            : 'text-slate-300 hover:text-rose-500'
                        }`}
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

              {activeExpansionLoading && (
                <div className="border border-slate-200 bg-slate-50 rounded-2xl p-4 flex items-center gap-3">
                  <div className="w-4 h-4 border-2 border-slate-200 border-t-indigo-500 rounded-full animate-spin" />
                  <p className="text-sm font-bold text-slate-600">
                    Building {expansionLabels[activeExpansionLoading.action]} expansion cards...
                  </p>
                </div>
              )}

              {currentExpansionError && !activeExpansionLoading && (
                <div className="border border-red-200 bg-red-50 rounded-2xl p-4 flex items-start justify-between gap-3">
                  <p className="text-sm font-bold text-red-700">{currentExpansionError}</p>
                  <button
                    onClick={() => clearExpansionForCard(index)}
                    className="text-xs font-black uppercase text-red-500 hover:text-red-700"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {currentExpansion && !activeExpansionLoading && (
                <div className="bg-white rounded-3xl shadow-xl overflow-hidden border border-slate-200">
                  <div className={`px-6 py-4 border-b ${expansionAccent[currentExpansion.action]}`}>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[10px] font-black uppercase tracking-widest flex items-center gap-1">
                        <Sparkles className="w-3 h-3" />
                        Expansion - {expansionLabels[currentExpansion.action]}
                      </p>
                      <button
                        onClick={() => clearExpansionForCard(index)}
                        className="text-[10px] font-black uppercase opacity-70 hover:opacity-100"
                      >
                        Collapse
                      </button>
                    </div>

                  </div>

                  {currentExpansion.cards.length === 0 ? (
                    <div className="p-6">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-bold text-slate-500">
                        No expansion content came back. Try the action again.
                      </div>
                    </div>
                  ) : (() => {
                    const miniIndex = currentExpansion.activeIndex;
                    const miniCard = currentExpansion.cards[miniIndex];
                    return (
                      <>
                        <div className="p-6 space-y-4 min-h-[180px]">
                          <div>
                            <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">
                              SUB-CARD {miniIndex + 1} / {currentExpansion.cards.length}
                            </p>
                            <h3 className="text-xl font-black text-slate-800">
                              {miniCard.title || `${expansionLabels[currentExpansion.action]} ${miniIndex + 1}`}
                            </h3>
                          </div>
                          <div className="prose prose-sm text-slate-700">
                            <ReactMarkdown
                              remarkPlugins={[remarkMath]}
                              rehypePlugins={[rehypeKatex]}
                            >
                              {miniCard.content || 'No detail was generated for this mini-card.'}
                            </ReactMarkdown>
                          </div>
                        </div>

                        <div className="border-t border-slate-100 p-4 flex items-center gap-4">
                          <button
                            onClick={() => moveExpansion(index, -1)}
                            disabled={miniIndex === 0}
                            className="w-12 h-12 flex items-center justify-center rounded-full hover:bg-slate-100 disabled:opacity-10 text-black transition-colors"
                          >
                            <ChevronLeft className="w-5 h-5" />
                          </button>
                          <div className="flex-1 flex justify-center gap-2">
                            {currentExpansion.cards.map((_, dotIndex) => (
                              <button
                                key={dotIndex}
                                onClick={() =>
                                  setExpansions((prev) => ({
                                    ...prev,
                                    [index]: {
                                      ...currentExpansion,
                                      activeIndex: dotIndex,
                                    },
                                  }))
                                }
                                className={`h-2 rounded-full transition-all bg-indigo-400 ${
                                  dotIndex === miniIndex
                                    ? 'w-4 opacity-100'
                                    : 'w-2 opacity-30 hover:opacity-70'
                                }`}
                              />
                            ))}
                          </div>
                          <button
                            onClick={() => moveExpansion(index, 1)}
                            disabled={miniIndex === currentExpansion.cards.length - 1}
                            className="w-12 h-12 flex items-center justify-center rounded-full hover:bg-slate-100 disabled:opacity-10 text-black transition-colors"
                          >
                            <ChevronRight className="w-5 h-5" />
                          </button>
                        </div>
                      </>
                    );
                  })()}
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
              <div className="flex gap-1.5">
                {(['simpler', 'normal', 'detailed', 'visual'] as const).map(
                  (v) => (
                    <button
                      key={v}
                      onClick={() => {
                        setView(v);
                        clearExpansionForCard(index);
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
                      <span className="text-slate-500 text-[10px]">— {desc}</span>
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
                            <span className="text-indigo-400 font-bold">{other?.topic}</span> — {e.bridge}
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
