'use client';
import { useState } from 'react';
import { ChevronRight, ChevronLeft, Zap, Info, HelpCircle, GraduationCap, User, Settings2, Map as MapIcon, LayoutList, BrainCircuit, Activity, Sparkles, RefreshCcw, MessageSquare, Plus, Minus } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { motion, AnimatePresence } from 'framer-motion';

export default function Home() {
  // --- FORM STATE ---
  const [topic, setTopic] = useState('');
  const [about, setAbout] = useState('');
  const [persona, setPersona] = useState('Student');
  const [customPersona, setCustomPersona] = useState('');
  const [difficulty, setDifficulty] = useState('Medium');
  const [context, setContext] = useState('');
  
  // UI Toggles
  const [showAdvanced, setShowAdvanced] = useState(false);

  // --- APP STATE ---
  const [data, setData] = useState<{topic_summary: string, cards: any[]} | null>(null);
  const [index, setIndex] = useState(0);
  const [view, setView] = useState<'normal' | 'simpler' | 'detailed'>('normal');
  const [isMapView, setIsMapView] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refinement, setRefinement] = useState<string | null>(null);
  const [isRefining, setIsRefining] = useState(false);

  // Logic to determine which persona string to send to the API
  const getActivePersona = () => (persona === 'Custom Instruction' ? customPersona : persona);

  const generateCards = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          topic, 
          about, 
          persona: getActivePersona(), 
          difficulty, 
          context 
        }),
      });
      const result = await res.json();
      if (result.error) alert("AI Error: " + result.error);
      else { setData(result); setIndex(0); setRefinement(null); }
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const handleRefine = async (action: 'drill' | 'simplify') => {
    if (!data) return;
    setIsRefining(true);
    const currentText = view === 'normal' ? data.cards[index].content : 
                        view === 'simpler' ? data.cards[index].simpler : 
                        data.cards[index].detailed;
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action, 
          currentContent: currentText, 
          about, 
          persona: getActivePersona(),
          context
        }),
      });
      const result = await res.json();
      setRefinement(result.newContent);
    } catch (e) { console.error(e); }
    setIsRefining(false);
  };

  const resetNavigation = (newIndex: number) => {
    setIndex(newIndex);
    setRefinement(null);
    setView('normal');
  };

  // --- DEFINE CURRENT CARD EARLY TO AVOID REFERENCE ERROR ---
  const currentCard = data?.cards?.[index] || null;

  // --- INITIAL SETUP VIEW ---
  if (!data && !loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 text-slate-900">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl w-full bg-white p-10 rounded-3xl shadow-xl border border-slate-200">
          <div className="flex items-center gap-3 mb-8">
            <div className="bg-indigo-600 p-2 rounded-lg"><Zap className="text-white" /></div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">FlashLearn Pro</h1>
          </div>
          
          <div className="space-y-6">
            {/* Background / Resume Field */}
            <div>
              <label className="flex items-center gap-2 font-bold text-xs text-slate-500 mb-2 uppercase tracking-widest">
                <User size={14}/> Your Background (Or Paste Resume)
              </label>
              <textarea 
                className="w-full p-4 border-2 border-slate-100 rounded-2xl min-h-[150px] text-black font-medium focus:border-indigo-500 outline-none transition-all scrollbar-thin"
                placeholder="Paste your CV, LinkedIn bio, or specific technical background here..."
                value={about} onChange={(e) => setAbout(e.target.value)}
              />
            </div>

            {/* Topic Field */}
            <div>
              <label className="flex items-center gap-2 font-bold text-xs text-slate-500 mb-2 uppercase tracking-widest">Topic to Master</label>
              <input 
                className="w-full p-4 border-2 border-slate-100 rounded-2xl text-black font-medium focus:border-indigo-500 outline-none transition-all"
                placeholder="e.g. Backpropagation, Fluid Dynamics..."
                value={topic} onChange={(e) => setTopic(e.target.value)}
              />
            </div>

            {/* Main Selection Grid */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="font-bold text-xs text-slate-500 mb-2 uppercase block tracking-widest">Complexity</label>
                <select className="w-full p-4 border-2 border-slate-100 rounded-2xl bg-white text-black font-medium focus:border-indigo-500 outline-none" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                  <option>Beginner</option>
                  <option>Medium</option>
                  <option>Expert</option>
                  <option>Post-Doc</option>
                </select>
              </div>
              <div>
                <label className="font-bold text-xs text-slate-500 mb-2 uppercase block tracking-widest">Persona</label>
                <select className="w-full p-4 border-2 border-slate-100 rounded-2xl bg-white text-black font-medium focus:border-indigo-500 outline-none" value={persona} onChange={(e) => setPersona(e.target.value)}>
                  <option>Student</option>
                  <option>Feymann (Simple Analogies)</option>
                  <option>Professor</option>
                  <option>Researcher</option>
                  <option>Industry Expert</option>
                  <option>Custom Instruction</option>
                </select>
              </div>
            </div>

            {/* Advanced Toggle Section */}
            <div className="pt-2">
              <button 
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-2 text-xs font-black text-indigo-600 uppercase tracking-widest hover:text-indigo-800 transition-colors"
              >
                {showAdvanced ? <Minus size={14}/> : <Plus size={14}/>} 
                {showAdvanced ? "Hide Optional Settings" : "Add Custom Persona & Context"}
              </button>

              <AnimatePresence>
                {showAdvanced && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }} 
                    animate={{ height: 'auto', opacity: 1 }} 
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden space-y-4 mt-4"
                  >
                    {persona === 'Custom Instruction' && (
                      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }}>
                        <label className="flex items-center gap-2 font-bold text-xs text-slate-500 mb-2 uppercase tracking-widest">
                          <Sparkles size={14}/> Custom Instruction
                        </label>
                        <input 
                          className="w-full p-4 border-2 border-indigo-100 rounded-2xl text-black font-medium focus:border-indigo-500 outline-none shadow-sm shadow-indigo-50"
                          placeholder="e.g. Explain like a pirate, or use only soccer metaphors..."
                          value={customPersona} onChange={(e) => setCustomPersona(e.target.value)}
                        />
                      </motion.div>
                    )}
                    <div>
                      <label className="flex items-center gap-2 font-bold text-xs text-slate-500 mb-2 uppercase tracking-widest">
                        <MessageSquare size={14}/> Additional Context
                      </label>
                      <textarea 
                        className="w-full p-4 border-2 border-slate-100 rounded-2xl h-24 text-black font-medium focus:border-indigo-500 outline-none shadow-inner"
                        placeholder="e.g. Relate everything to my current project on Sparse Autoencoders..."
                        value={context} onChange={(e) => setContext(e.target.value)}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <button 
              onClick={generateCards}
              className="w-full bg-indigo-600 text-white py-5 rounded-2xl font-black text-lg hover:bg-indigo-700 shadow-lg transition-transform hover:-translate-y-1"
            >
              Initialize Learning Path
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  // --- LOADING VIEW ---
  if (loading) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 gap-4">
      <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-indigo-600"></div>
      <p className="font-bold text-slate-900 animate-pulse text-xl tracking-tight text-center">Constructing Learning Pathway...</p>
    </div>
  );

  // --- FINAL APP VIEW ---
  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 text-slate-900">
      <div className="max-w-4xl mx-auto">
        {/* Header Navigation */}
        <div className="flex justify-between items-center mb-8">
          <button onClick={() => setData(null)} className="text-slate-500 hover:text-indigo-600 font-bold flex items-center gap-2 transition-colors">
            <ChevronLeft size={20}/> New Topic
          </button>
          <div className="flex bg-white p-1 rounded-xl shadow-sm border border-slate-200">
            <button onClick={() => setIsMapView(false)} className={`px-4 py-2 rounded-lg font-bold text-sm transition ${!isMapView ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
              <LayoutList size={16}/>
            </button>
            <button onClick={() => setIsMapView(true)} className={`px-4 py-2 rounded-lg font-bold text-sm transition ${isMapView ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
              <MapIcon size={16}/>
            </button>
          </div>
        </div>

        {isMapView ? (
          /* CONCEPT MAP VIEW */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {data?.cards.map((card, i) => (
              <div key={i} onClick={() => {resetNavigation(i); setIsMapView(false);}} className={`p-6 bg-white rounded-2xl border-2 cursor-pointer transition-all ${index === i ? 'border-indigo-600 shadow-lg' : 'border-slate-100 hover:border-indigo-200'}`}>
                <span className="text-xs font-black text-indigo-500 uppercase">Step {i + 1}</span>
                <h3 className="font-bold text-slate-900 mt-2">{card.title}</h3>
              </div>
            ))}
          </div>
        ) : (
          /* INDIVIDUAL CARD VIEW */
          <div className="flex flex-col items-center">
            <h2 className="text-3xl font-black mb-8 text-center text-slate-950">{data?.topic_summary}</h2>
            
            <AnimatePresence mode="wait">
              <motion.div key={index + view + (refinement ? 'ref' : 'orig')} initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }}
                className="bg-white rounded-[2.5rem] shadow-2xl p-8 md:p-12 w-full max-w-2xl border border-slate-100 min-h-[620px] flex flex-col justify-between"
              >
                <div>
                  <div className="flex justify-between items-start mb-8">
                    <span className="bg-indigo-50 text-indigo-700 px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-widest">CARD {index + 1} / 7</span>
                    <BrainCircuit className="text-indigo-100" size={40} />
                  </div>

                  <h3 className="text-3xl font-bold text-slate-900 mb-6 leading-tight">{currentCard?.title}</h3>

                  <div className="text-lg leading-relaxed text-slate-800 space-y-4 font-medium">
                    {isRefining ? (
                       <div className="flex flex-col items-center justify-center py-20 gap-4">
                          <RefreshCcw className="animate-spin text-indigo-400" size={32} />
                          <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">AI is tailoring content...</p>
                       </div>
                    ) : refinement ? (
                      <div className="bg-slate-50 p-8 rounded-3xl border-2 border-dashed border-indigo-200 relative">
                        <div className="absolute -top-3 left-6 bg-indigo-600 text-white text-[10px] font-black px-3 py-1 rounded-full flex items-center gap-1 shadow-md uppercase tracking-widest">
                          <Sparkles size={10}/> AI Refinement
                        </div>
                        <div className="prose prose-sm max-w-none text-slate-900">
                          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{refinement}</ReactMarkdown>
                        </div>
                        <button onClick={() => setRefinement(null)} className="mt-6 text-xs font-bold text-indigo-600 hover:underline flex items-center gap-1">
                           <ChevronLeft size={14}/> Back to original
                        </button>
                      </div>
                    ) : (
                      <>
                        {view === 'normal' && <p>{currentCard?.content}</p>}
                        {view === 'simpler' && (
                          <div className="bg-emerald-50 p-6 rounded-3xl border-2 border-emerald-100">
                            <p className="font-black text-emerald-700 text-xs mb-3 flex items-center gap-2 uppercase tracking-wide"><HelpCircle size={16}/> Analogy</p>
                            <p className="text-emerald-900 italic font-semibold text-xl">"{currentCard?.simpler}"</p>
                          </div>
                        )}
                        {view === 'detailed' && (
                          <div className="bg-indigo-50 p-8 rounded-3xl text-slate-900 shadow-sm overflow-x-auto border border-indigo-100">
                            <p className="font-black text-indigo-700 text-xs mb-4 uppercase tracking-widest flex items-center gap-2"><Info size={16}/> Technical Deep-Dive</p>
                            <div className="prose prose-sm max-w-none leading-relaxed text-slate-950">
                              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{currentCard?.detailed}</ReactMarkdown>
                            </div>
                          </div>
                        )}

                        <div className="flex gap-4 pt-6 mt-4 border-t border-slate-50">
                           <button onClick={() => handleRefine('simplify')} className="flex items-center gap-1.5 text-[11px] font-black uppercase text-slate-400 hover:text-emerald-600 transition-colors">
                              <HelpCircle size={14}/> Simplify
                           </button>
                           <button onClick={() => handleRefine('drill')} className="flex items-center gap-1.5 text-[11px] font-black uppercase text-slate-400 hover:text-indigo-600 transition-colors">
                              <Activity size={14}/> Drill Deeper
                           </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Footer Controls */}
                <div className="mt-12">
                  <div className="flex gap-2 mb-8">
                    {['simpler', 'normal', 'detailed'].map((v) => (
                      <button key={v} onClick={() => {setView(v as any); setRefinement(null);}} className={`flex-1 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${view === v ? 'bg-indigo-600 text-white shadow-lg' : 'bg-slate-100 text-slate-500 hover:bg-indigo-50 hover:text-indigo-700'}`}>
                        {v === 'simpler' ? 'Analogy' : v === 'normal' ? 'Core' : 'Technical'}
                      </button>
                    ))}
                  </div>

                  <div className="flex justify-between items-center px-2">
                    <button onClick={() => resetNavigation(Math.max(0, index - 1))} disabled={index === 0} className="w-12 h-12 flex items-center justify-center rounded-full hover:bg-slate-100 disabled:opacity-10 text-black transition-colors"><ChevronLeft size={28} /></button>
                    <div className="flex gap-2">
                      {[...Array(7)].map((_, i) => (
                        <div key={i} className={`h-1.5 rounded-full transition-all ${i === index ? 'w-8 bg-indigo-600' : 'w-2 bg-slate-200'}`} />
                      ))}
                    </div>
                    <button onClick={() => resetNavigation(Math.min(6, index + 1))} disabled={index === 6} className="w-12 h-12 flex items-center justify-center rounded-full hover:bg-slate-100 disabled:opacity-10 text-black transition-colors"><ChevronRight size={28} /></button>
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}