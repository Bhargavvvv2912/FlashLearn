#!/usr/bin/env python3
"""
FlashLearn Evaluation Suite
============================
Compares FlashLearn's structured card format against a standard LLM explanation
(Gemini in "textbook mode" as the baseline, analogous to a ChatGPT-style response).

Three FlashLearn scenarios are evaluated on the same generated cards, so no extra
API calls are needed — latency for stripped scenarios is estimated by token scaling.

Scenarios
---------
  full         : All card fields (title + hook + content + simpler + detailed + visual)
  core         : Essential layers only (title + hook + content)
  content_only : Bare concept text (content field only)

Metrics per scenario
--------------------
  Token count (output)     Words     Sentences     Avg sentence length
  Reading time @200 wpm    Reading time @250 wpm
  Flesch Reading Ease      Flesch Grade Level       Lexical Diversity (TTR)
  Estimated latency        Token compression vs baseline
  Concept coverage %       Information retention score (LLM-as-judge)

Usage
-----
  # Start FlashLearn dev server first, then:
  python eval/evaluate.py
  python eval/evaluate.py --topics "CRISPR" "Nash equilibrium" "Gradient descent"
  python eval/evaluate.py --api-url https://your-app.vercel.app/api/generate
  python eval/evaluate.py --output eval/results/my_run.json
"""

import argparse
import json
import math
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path

import requests

try:
    import google.generativeai as genai
except ImportError:
    print("ERROR: google-generativeai not installed. Run: pip install -r eval/requirements.txt")
    sys.exit(1)

# ── Constants ──────────────────────────────────────────────────────────────────
MODEL_NAME        = "gemini-2.5-flash-lite"
AVG_READING_WPM   = 200
FAST_READING_WPM  = 250
TTFT_ESTIMATE_S   = 0.8   # Gemini flash-lite time-to-first-token estimate (seconds)
RESULTS_DIR       = Path(__file__).parent / "results"

# Defines which card fields each scenario flattens into text.
# The same cards are reused — no extra API calls.
SCENARIOS = {
    "full": {
        "label": "Full (all fields)",
        "fields": ["title", "hook", "content", "simpler", "detailed", "visual"],
        "description": "All card layers — as currently generated and shown in the app",
    },
    "core": {
        "label": "Core (hook + content)",
        "fields": ["title", "hook", "content"],
        "description": "Essential explanation only — drop analogy, technical depth, and visual",
    },
    "content_only": {
        "label": "Content only",
        "fields": ["content"],
        "description": "Bare concept text — minimum viable card",
    },
}

DEFAULT_TOPICS = [
    "Transformer attention mechanism in deep learning",
    "Gradient descent and backpropagation",
    "CAP theorem in distributed systems",
    "CRISPR-Cas9 gene editing mechanism",
    "Game theory and Nash equilibrium",
]

BASELINE_PROMPT_TEMPLATE = """Explain "{topic}" comprehensively, the way a knowledgeable tutor or Wikipedia article would.

Cover all of the following:
- A clear definition
- The core mechanism or underlying principle
- Key components or sub-concepts
- Real-world applications or examples
- A worked example or case study where relevant

Write in clear, flowing prose. Do not use bullet points or markdown headers. \
Aim for 3–5 well-developed paragraphs that a curious university student could follow. \
Be thorough — this is meant to be a complete reference explanation."""

JUDGE_PROMPT_TEMPLATE = """You are an expert evaluator assessing how well a structured flashcard set \
preserves the information from a comprehensive explanation.

TOPIC: "{topic}"

────────────────────────────────
BASELINE EXPLANATION (ground truth):
{baseline}
────────────────────────────────
FLASHLEARN CARDS (system output):
{flashlearn}
────────────────────────────────

TASK:
1. Extract exactly 10 key concepts or factual claims from the BASELINE EXPLANATION. \
   Choose the most important, non-trivial ones.
2. For each, determine if it is:
   - COVERED   : clearly and accurately present in the FlashLearn cards
   - PARTIAL   : present but incomplete, oversimplified, or slightly inaccurate
   - MISSING   : absent or significantly distorted in the FlashLearn cards
3. Assign an overall information_retention score from 0 to 100:
   - 100 = all key facts preserved with full accuracy
   -  75 = most facts present, minor omissions
   -  50 = roughly half the key information present
   -  25 = only surface level preserved, major gaps
   -   0 = essentially no factual overlap
4. List the 3 most significant pieces of information that are MISSING or DISTORTED.

Return ONLY valid JSON — no markdown, no extra text:
{{
  "concepts": [
    {{"concept": "...", "status": "COVERED|PARTIAL|MISSING", "note": "one-line justification"}}
  ],
  "covered": <int>,
  "partial": <int>,
  "missing": <int>,
  "information_retention": <int 0-100>,
  "information_loss_summary": "One sentence summarizing the nature of information loss.",
  "missing_key_info": ["specific missing fact 1", "specific missing fact 2", "specific missing fact 3"]
}}"""


# ── Text Analysis ──────────────────────────────────────────────────────────────

def count_syllables(word: str) -> int:
    word = re.sub(r"[^a-z]", "", word.lower())
    if not word:
        return 0
    count = len(re.findall(r"[aeiouy]+", word))
    if word.endswith("e") and not word.endswith("le") and count > 1:
        count -= 1
    if word.endswith(("es", "ed")) and count > 1:
        count -= 1
    return max(1, count)


def count_sentences(text: str) -> int:
    parts = re.split(r"[.!?]+", text.strip())
    return max(1, sum(1 for p in parts if p.strip()))


def flesch_kincaid(text: str) -> dict:
    """
    Flesch Reading Ease and Flesch-Kincaid Grade Level (1975).
    Ease: 90-100=very easy, 60-70=standard, 30-50=difficult, 0-30=very hard.
    """
    words = text.split()
    if len(words) < 5:
        return {"reading_ease": 0.0, "grade_level": 0.0}
    n_w = len(words)
    n_s = count_sentences(text)
    n_sy = sum(count_syllables(w) for w in words)
    ease  = 206.835 - 1.015 * (n_w / n_s) - 84.6  * (n_sy / n_w)
    grade =   0.39  * (n_w / n_s) + 11.8  * (n_sy / n_w) - 15.59
    return {
        "reading_ease": round(min(100.0, max(0.0, ease)), 2),
        "grade_level":  round(max(0.0, grade), 2),
    }


def type_token_ratio(text: str) -> float:
    tokens = re.findall(r"\b[a-z]+\b", text.lower())
    if not tokens:
        return 0.0
    return round(len(set(tokens)) / len(tokens), 4)


def avg_sentence_length(text: str) -> float:
    return round(len(text.split()) / count_sentences(text), 2)


def reading_time_min(text: str, wpm: int) -> float:
    return round(len(text.split()) / wpm, 2)


def word_count(text: str) -> int:
    return len(text.split())


def text_for_scenario(cards: list, fields: list) -> str:
    """Flatten specified card fields into a single text blob."""
    parts = []
    for card in cards:
        card_parts = [card.get(f, "").strip() for f in fields if card.get(f, "").strip()]
        if card_parts:
            parts.append("\n".join(card_parts))
    return "\n\n".join(parts)


# ── Latency Estimation ─────────────────────────────────────────────────────────

def estimate_latency(actual_latency_s: float, actual_tokens: int, scenario_tokens: int) -> float:
    """
    Model: latency = TTFT + (output_tokens / throughput)
    TTFT is fixed (input processing). Generation time scales linearly with output tokens.

    actual_latency  = TTFT + actual_tokens   / throughput
    scenario_latency = TTFT + scenario_tokens / throughput

    Solving for throughput from the actual measurement, then projecting.
    """
    generation_time = max(0.01, actual_latency_s - TTFT_ESTIMATE_S)
    throughput = actual_tokens / generation_time          # tokens/sec
    estimated = TTFT_ESTIMATE_S + scenario_tokens / throughput
    return round(max(TTFT_ESTIMATE_S, estimated), 3)


# ── API Calls ──────────────────────────────────────────────────────────────────

def generate_baseline(model, topic: str) -> dict:
    prompt = BASELINE_PROMPT_TEMPLATE.format(topic=topic)
    t0 = time.perf_counter()
    response = model.generate_content(prompt)
    latency = round(time.perf_counter() - t0, 3)
    usage = response.usage_metadata
    return {
        "text":          response.text.strip(),
        "input_tokens":  usage.prompt_token_count,
        "output_tokens": usage.candidates_token_count,
        "total_tokens":  usage.total_token_count,
        "latency_s":     latency,
    }


def generate_flashlearn_cards(api_url: str, topic: str) -> dict:
    t0 = time.perf_counter()
    resp = requests.post(
        api_url,
        json={"topic": topic},
        timeout=90,
        headers={"Content-Type": "application/json"},
    )
    resp.raise_for_status()
    latency = round(time.perf_counter() - t0, 3)
    data = resp.json()
    cards = data.get("cards", [])
    return {
        "cards":         cards,
        "topic_summary": data.get("topic_summary", ""),
        "card_count":    len(cards),
        "latency_s":     latency,
    }


def count_tokens_for_text(model, text: str) -> int:
    return model.count_tokens(text).total_tokens


def run_judge(model, topic: str, baseline_text: str, flashlearn_text: str) -> dict:
    prompt = JUDGE_PROMPT_TEMPLATE.format(
        topic=topic,
        baseline=baseline_text[:4000],
        flashlearn=flashlearn_text[:4000],
    )
    response = model.generate_content(prompt)
    raw = response.text.strip()
    start, end = raw.find("{"), raw.rfind("}") + 1
    if start == -1 or end == 0:
        return {"error": "judge_parse_failed"}
    try:
        return json.loads(raw[start:end])
    except json.JSONDecodeError as e:
        return {"error": f"json_error: {e}"}


# ── Scenario Computation ───────────────────────────────────────────────────────

def compute_scenario_stats(
    model,
    scenario_key: str,
    cards: list,
    actual_latency_s: float,
    full_output_tokens: int,
) -> dict:
    """Compute all metrics for one scenario variant using already-generated cards."""
    fields = SCENARIOS[scenario_key]["fields"]
    text = text_for_scenario(cards, fields)
    if not text.strip():
        return {"error": "empty_text"}

    tokens = count_tokens_for_text(model, text)
    fk = flesch_kincaid(text)
    est_latency = estimate_latency(actual_latency_s, full_output_tokens, tokens)

    return {
        "scenario":              scenario_key,
        "label":                 SCENARIOS[scenario_key]["label"],
        "description":           SCENARIOS[scenario_key]["description"],
        "fields_included":       fields,
        "text":                  text,
        "output_tokens":         tokens,
        "word_count":            word_count(text),
        "sentence_count":        count_sentences(text),
        "avg_sentence_length":   avg_sentence_length(text),
        "reading_time_200wpm":   reading_time_min(text, AVG_READING_WPM),
        "reading_time_250wpm":   reading_time_min(text, FAST_READING_WPM),
        "flesch_reading_ease":   fk["reading_ease"],
        "flesch_grade_level":    fk["grade_level"],
        "lexical_diversity_ttr": type_token_ratio(text),
        "estimated_latency_s":   est_latency,
    }


# ── Per-Topic Evaluation ───────────────────────────────────────────────────────

def evaluate_topic(model, api_url: str, topic: str) -> dict:

    print(f"    [1/4] Generating baseline explanation...")
    baseline = generate_baseline(model, topic)

    print(f"    [2/4] Generating FlashLearn cards...")
    fl_raw = generate_flashlearn_cards(api_url, topic)

    # Full-scenario token count is the reference for latency scaling
    print(f"    [3/4] Computing scenario metrics (full, core, content-only)...")
    full_text = text_for_scenario(fl_raw["cards"], SCENARIOS["full"]["fields"])
    full_tokens = count_tokens_for_text(model, full_text)

    scenarios = {}
    for key in SCENARIOS:
        scenarios[key] = compute_scenario_stats(
            model, key,
            fl_raw["cards"],
            fl_raw["latency_s"],
            full_tokens,
        )

    print(f"    [4/4] Running LLM-as-judge on full scenario...")
    judge = run_judge(model, topic, baseline["text"], full_text)

    concepts    = judge.get("concepts", [])
    n_covered   = judge.get("covered",  sum(1 for c in concepts if c.get("status") == "COVERED"))
    n_partial   = judge.get("partial",  sum(1 for c in concepts if c.get("status") == "PARTIAL"))
    n_missing   = judge.get("missing",  sum(1 for c in concepts if c.get("status") == "MISSING"))
    n_total     = max(1, n_covered + n_partial + n_missing)
    coverage    = round((n_covered + 0.5 * n_partial) / n_total * 100, 1)
    retention   = judge.get("information_retention", -1)

    b_fk = flesch_kincaid(baseline["text"])

    baseline_stats = {
        "text":                  baseline["text"],
        "input_tokens":          baseline["input_tokens"],
        "output_tokens":         baseline["output_tokens"],
        "total_tokens":          baseline["total_tokens"],
        "word_count":            word_count(baseline["text"]),
        "sentence_count":        count_sentences(baseline["text"]),
        "avg_sentence_length":   avg_sentence_length(baseline["text"]),
        "reading_time_200wpm":   reading_time_min(baseline["text"], AVG_READING_WPM),
        "reading_time_250wpm":   reading_time_min(baseline["text"], FAST_READING_WPM),
        "flesch_reading_ease":   b_fk["reading_ease"],
        "flesch_grade_level":    b_fk["grade_level"],
        "lexical_diversity_ttr": type_token_ratio(baseline["text"]),
        "latency_s":             baseline["latency_s"],
    }

    # Attach comparison deltas per scenario
    for key, sc in scenarios.items():
        if "error" in sc:
            continue
        b_out = baseline["output_tokens"]
        sc["vs_baseline"] = {
            "token_reduction_pct":    round((1 - sc["output_tokens"] / max(1, b_out)) * 100, 1),
            "token_compression_ratio":round(sc["output_tokens"] / max(1, b_out), 4),
            "word_reduction_pct":     round((1 - sc["word_count"] / max(1, baseline_stats["word_count"])) * 100, 1),
            "rt_saved_pct":           round((1 - sc["reading_time_200wpm"] / max(0.01, baseline_stats["reading_time_200wpm"])) * 100, 1),
            "rt_saved_min":           round(baseline_stats["reading_time_200wpm"] - sc["reading_time_200wpm"], 2),
            "readability_gain_pts":   round(sc["flesch_reading_ease"] - baseline_stats["flesch_reading_ease"], 2),
            "grade_level_reduction":  round(baseline_stats["flesch_grade_level"] - sc["flesch_grade_level"], 2),
            "latency_saved_s":        round(baseline["latency_s"] - sc["estimated_latency_s"], 3),
        }
        # Full-scenario relative reductions (for core and content_only)
        sc["vs_full"] = {}
        if key != "full":
            full_sc = scenarios["full"]
            sc["vs_full"] = {
                "token_reduction_pct": round((1 - sc["output_tokens"] / max(1, full_sc["output_tokens"])) * 100, 1),
                "word_reduction_pct":  round((1 - sc["word_count"]   / max(1, full_sc["word_count"]))   * 100, 1),
                "latency_saved_s":     round(full_sc["estimated_latency_s"] - sc["estimated_latency_s"], 3),
                "rt_saved_pct":        round((1 - sc["reading_time_200wpm"] / max(0.01, full_sc["reading_time_200wpm"])) * 100, 1),
            }

    # Attach judge data to full scenario
    scenarios["full"]["concept_coverage_pct"]       = coverage
    scenarios["full"]["information_retention_score"] = retention
    scenarios["full"]["coverage_breakdown"]          = {"covered": n_covered, "partial": n_partial, "missing": n_missing, "total": n_total}
    scenarios["full"]["missing_key_info"]            = judge.get("missing_key_info", [])
    scenarios["full"]["information_loss_summary"]    = judge.get("information_loss_summary", "")

    return {
        "topic":    topic,
        "baseline": baseline_stats,
        "scenarios": scenarios,
        "judge":    judge,
    }


# ── Reporting ──────────────────────────────────────────────────────────────────

def _c(val, w): return str(val).ljust(w)

COLS = [38, 22, 22, 22, 22]  # label + baseline + full + core + content-only

def _header_row(cells):
    return "  " + "".join(_c(v, w) for v, w in zip(cells, COLS))

def _row(cells):
    return "  " + "".join(_c(v, w) for v, w in zip(cells, COLS))

def _sep(char="─"):
    return "  " + char * sum(COLS)


def print_topic_report(result: dict):
    b  = result["baseline"]
    sc = result["scenarios"]
    fl = sc.get("full", {})
    co = sc.get("core", {})
    cx = sc.get("content_only", {})

    def v(d, key, default="—"):
        return d.get(key, default) if d else default

    def pct_delta(val, prefix="−"):
        return f"{prefix}{val}%" if val != "—" else "—"

    print()
    print(_sep("═"))
    print(f"  TOPIC: {result['topic']}")
    print(_sep("═"))

    # ── Header ──
    print(_header_row(["METRIC", "BASELINE (std LLM)", "FL: Full", "FL: Core", "FL: Content only"]))
    print(_sep())

    # ── Section: Tokens ──
    print(_row(["── Tokens & Words ──", "", "", "", ""]))
    print(_row(["Output tokens",
        f"{b['output_tokens']:,}",
        f"{v(fl,'output_tokens'):,}" if isinstance(v(fl,'output_tokens'), int) else "—",
        f"{v(co,'output_tokens'):,}" if isinstance(v(co,'output_tokens'), int) else "—",
        f"{v(cx,'output_tokens'):,}" if isinstance(v(cx,'output_tokens'), int) else "—",
    ]))
    print(_row(["  ↳ vs baseline",
        "—",
        f"−{v(fl.get('vs_baseline',{}),'token_reduction_pct')}%",
        f"−{v(co.get('vs_baseline',{}),'token_reduction_pct')}%",
        f"−{v(cx.get('vs_baseline',{}),'token_reduction_pct')}%",
    ]))
    print(_row(["  ↳ vs full FL",
        "—", "—",
        f"−{v(co.get('vs_full',{}),'token_reduction_pct')}%",
        f"−{v(cx.get('vs_full',{}),'token_reduction_pct')}%",
    ]))
    print(_row(["Word count",
        f"{b['word_count']:,}",
        f"{v(fl,'word_count'):,}" if isinstance(v(fl,'word_count'), int) else "—",
        f"{v(co,'word_count'):,}" if isinstance(v(co,'word_count'), int) else "—",
        f"{v(cx,'word_count'):,}" if isinstance(v(cx,'word_count'), int) else "—",
    ]))
    print(_row(["  ↳ vs baseline",
        "—",
        f"−{v(fl.get('vs_baseline',{}),'word_reduction_pct')}%",
        f"−{v(co.get('vs_baseline',{}),'word_reduction_pct')}%",
        f"−{v(cx.get('vs_baseline',{}),'word_reduction_pct')}%",
    ]))
    print(_row(["Sentences",
        str(b['sentence_count']),
        str(v(fl,'sentence_count')), str(v(co,'sentence_count')), str(v(cx,'sentence_count')),
    ]))
    print(_row(["Avg sentence length (words)",
        str(b['avg_sentence_length']),
        str(v(fl,'avg_sentence_length')), str(v(co,'avg_sentence_length')), str(v(cx,'avg_sentence_length')),
    ]))

    # ── Section: Reading time ──
    print(_sep("·"))
    print(_row(["── Reading Time ──", "", "", "", ""]))
    print(_row(["@200 wpm (min)",
        str(b['reading_time_200wpm']),
        str(v(fl,'reading_time_200wpm')), str(v(co,'reading_time_200wpm')), str(v(cx,'reading_time_200wpm')),
    ]))
    print(_row(["  ↳ saved vs baseline (min)",
        "—",
        str(v(fl.get('vs_baseline',{}),'rt_saved_min')),
        str(v(co.get('vs_baseline',{}),'rt_saved_min')),
        str(v(cx.get('vs_baseline',{}),'rt_saved_min')),
    ]))
    print(_row(["  ↳ saved vs baseline (%)",
        "—",
        f"−{v(fl.get('vs_baseline',{}),'rt_saved_pct')}%",
        f"−{v(co.get('vs_baseline',{}),'rt_saved_pct')}%",
        f"−{v(cx.get('vs_baseline',{}),'rt_saved_pct')}%",
    ]))
    print(_row(["@250 wpm (min)",
        str(b['reading_time_250wpm']),
        str(v(fl,'reading_time_250wpm')), str(v(co,'reading_time_250wpm')), str(v(cx,'reading_time_250wpm')),
    ]))

    # ── Section: Readability ──
    print(_sep("·"))
    print(_row(["── Readability (Flesch-Kincaid) ──", "", "", "", ""]))
    print(_row(["Reading Ease  (↑ easier, 0-100)",
        str(b['flesch_reading_ease']),
        str(v(fl,'flesch_reading_ease')), str(v(co,'flesch_reading_ease')), str(v(cx,'flesch_reading_ease')),
    ]))
    print(_row(["  ↳ gain vs baseline (pts)",
        "—",
        f"+{v(fl.get('vs_baseline',{}),'readability_gain_pts')}",
        f"+{v(co.get('vs_baseline',{}),'readability_gain_pts')}",
        f"+{v(cx.get('vs_baseline',{}),'readability_gain_pts')}",
    ]))
    print(_row(["Grade Level   (↓ simpler)",
        str(b['flesch_grade_level']),
        str(v(fl,'flesch_grade_level')), str(v(co,'flesch_grade_level')), str(v(cx,'flesch_grade_level')),
    ]))
    print(_row(["  ↳ reduction vs baseline",
        "—",
        f"−{v(fl.get('vs_baseline',{}),'grade_level_reduction')}",
        f"−{v(co.get('vs_baseline',{}),'grade_level_reduction')}",
        f"−{v(cx.get('vs_baseline',{}),'grade_level_reduction')}",
    ]))
    print(_row(["Lexical Diversity (TTR)",
        str(b['lexical_diversity_ttr']),
        str(v(fl,'lexical_diversity_ttr')), str(v(co,'lexical_diversity_ttr')), str(v(cx,'lexical_diversity_ttr')),
    ]))

    # ── Section: Latency ──
    print(_sep("·"))
    print(_row(["── Latency ──", "", "", "", ""]))
    print(_row(["Actual / estimated (s)",
        str(b['latency_s']),
        str(v(fl,'estimated_latency_s')),
        str(v(co,'estimated_latency_s')),
        str(v(cx,'estimated_latency_s')),
    ]))
    print(_row(["  ↳ saved vs baseline (s)",
        "—",
        str(v(fl.get('vs_baseline',{}),'latency_saved_s')),
        str(v(co.get('vs_baseline',{}),'latency_saved_s')),
        str(v(cx.get('vs_baseline',{}),'latency_saved_s')),
    ]))
    print(_row(["  ↳ saved vs full FL (s)",
        "—", "—",
        str(v(co.get('vs_full',{}),'latency_saved_s')),
        str(v(cx.get('vs_full',{}),'latency_saved_s')),
    ]))

    # ── Section: Information quality ──
    print(_sep("·"))
    print(_row(["── Information Quality (LLM-as-judge, on Full) ──", "", "", "", ""]))
    print(_row(["Concept coverage %",
        "—",
        f"{v(fl,'concept_coverage_pct')}%", "—", "—",
    ]))
    print(_row(["Information retention (/100)",
        "—",
        f"{v(fl,'information_retention_score')}/100", "—", "—",
    ]))
    cbd = fl.get("coverage_breakdown", {})
    print(_row(["  ↳ Covered / Partial / Missing",
        "—",
        f"{cbd.get('covered','?')} / {cbd.get('partial','?')} / {cbd.get('missing','?')}",
        "—", "—",
    ]))

    print(_sep())

    if fl.get("missing_key_info"):
        print(f"\n  Key omissions (from LLM judge):")
        for item in fl["missing_key_info"]:
            print(f"    • {item}")
    if fl.get("information_loss_summary"):
        print(f"\n  Loss summary: {fl['information_loss_summary']}")


def print_aggregate_report(results: list):
    valid = [r for r in results if "error" not in r]
    if not valid:
        return

    def mean(lst):
        return round(sum(lst) / len(lst), 2) if lst else 0.0

    def std(lst, m):
        return round(math.sqrt(sum((x - m) ** 2 for x in lst) / len(lst)), 2) if lst else 0.0

    def ms(values):
        m = mean(values)
        s = std(values, m)
        return f"{m} ± {s}"

    def gather(key_path):
        """Collect a value from each result along a dotted key path like 'scenarios.full.vs_baseline.token_reduction_pct'."""
        parts = key_path.split(".")
        out = []
        for r in valid:
            node = r
            for p in parts:
                if isinstance(node, dict):
                    node = node.get(p)
                else:
                    node = None
                    break
            if node is not None and isinstance(node, (int, float)):
                out.append(node)
        return out

    print()
    print("  " + "═" * sum(COLS))
    print(f"  AGGREGATE STATISTICS  (n = {len(valid)} topics)   —   reported as mean ± std")
    print("  " + "═" * sum(COLS))
    print(_header_row(["METRIC", "BASELINE", "FL: Full", "FL: Core", "FL: Content only"]))
    print(_sep())

    def agg_row(label, b_vals, fl_vals, co_vals, cx_vals):
        print(_row([label,
            ms(b_vals)  if b_vals  else "—",
            ms(fl_vals) if fl_vals else "—",
            ms(co_vals) if co_vals else "—",
            ms(cx_vals) if cx_vals else "—",
        ]))

    print(_row(["── Tokens & Words ──", "", "", "", ""]))
    agg_row("Output tokens",
        gather("baseline.output_tokens"),
        gather("scenarios.full.output_tokens"),
        gather("scenarios.core.output_tokens"),
        gather("scenarios.content_only.output_tokens"),
    )
    agg_row("  ↳ reduction vs baseline (%)",
        [], gather("scenarios.full.vs_baseline.token_reduction_pct"),
        gather("scenarios.core.vs_baseline.token_reduction_pct"),
        gather("scenarios.content_only.vs_baseline.token_reduction_pct"),
    )
    agg_row("  ↳ reduction vs full FL (%)",
        [], [],
        gather("scenarios.core.vs_full.token_reduction_pct"),
        gather("scenarios.content_only.vs_full.token_reduction_pct"),
    )
    agg_row("Word count",
        gather("baseline.word_count"),
        gather("scenarios.full.word_count"),
        gather("scenarios.core.word_count"),
        gather("scenarios.content_only.word_count"),
    )

    print(_sep("·"))
    print(_row(["── Reading Time @200 wpm (min) ──", "", "", "", ""]))
    agg_row("Reading time (min)",
        gather("baseline.reading_time_200wpm"),
        gather("scenarios.full.reading_time_200wpm"),
        gather("scenarios.core.reading_time_200wpm"),
        gather("scenarios.content_only.reading_time_200wpm"),
    )
    agg_row("  ↳ saved vs baseline (min)",
        [], gather("scenarios.full.vs_baseline.rt_saved_min"),
        gather("scenarios.core.vs_baseline.rt_saved_min"),
        gather("scenarios.content_only.vs_baseline.rt_saved_min"),
    )
    agg_row("  ↳ saved vs baseline (%)",
        [], gather("scenarios.full.vs_baseline.rt_saved_pct"),
        gather("scenarios.core.vs_baseline.rt_saved_pct"),
        gather("scenarios.content_only.vs_baseline.rt_saved_pct"),
    )

    print(_sep("·"))
    print(_row(["── Readability (Flesch-Kincaid) ──", "", "", "", ""]))
    agg_row("Reading Ease (0-100, ↑ easier)",
        gather("baseline.flesch_reading_ease"),
        gather("scenarios.full.flesch_reading_ease"),
        gather("scenarios.core.flesch_reading_ease"),
        gather("scenarios.content_only.flesch_reading_ease"),
    )
    agg_row("  ↳ gain vs baseline (pts)",
        [], gather("scenarios.full.vs_baseline.readability_gain_pts"),
        gather("scenarios.core.vs_baseline.readability_gain_pts"),
        gather("scenarios.content_only.vs_baseline.readability_gain_pts"),
    )
    agg_row("Grade Level (↓ simpler)",
        gather("baseline.flesch_grade_level"),
        gather("scenarios.full.flesch_grade_level"),
        gather("scenarios.core.flesch_grade_level"),
        gather("scenarios.content_only.flesch_grade_level"),
    )
    agg_row("  ↳ reduction vs baseline",
        [], gather("scenarios.full.vs_baseline.grade_level_reduction"),
        gather("scenarios.core.vs_baseline.grade_level_reduction"),
        gather("scenarios.content_only.vs_baseline.grade_level_reduction"),
    )
    agg_row("Lexical Diversity TTR",
        gather("baseline.lexical_diversity_ttr"),
        gather("scenarios.full.lexical_diversity_ttr"),
        gather("scenarios.core.lexical_diversity_ttr"),
        gather("scenarios.content_only.lexical_diversity_ttr"),
    )

    print(_sep("·"))
    print(_row(["── Latency ──", "", "", "", ""]))
    agg_row("Actual / estimated (s)",
        gather("baseline.latency_s"),
        gather("scenarios.full.estimated_latency_s"),
        gather("scenarios.core.estimated_latency_s"),
        gather("scenarios.content_only.estimated_latency_s"),
    )
    agg_row("  ↳ saved vs baseline (s)",
        [], gather("scenarios.full.vs_baseline.latency_saved_s"),
        gather("scenarios.core.vs_baseline.latency_saved_s"),
        gather("scenarios.content_only.vs_baseline.latency_saved_s"),
    )
    agg_row("  ↳ saved vs full FL (s)",
        [], [],
        gather("scenarios.core.vs_full.latency_saved_s"),
        gather("scenarios.content_only.vs_full.latency_saved_s"),
    )

    print(_sep("·"))
    print(_row(["── Information Quality (FL Full only) ──", "", "", "", ""]))
    retention = gather("scenarios.full.information_retention_score")
    coverage  = gather("scenarios.full.concept_coverage_pct")
    if retention:
        agg_row("Information retention (/100)", [], retention, [], [])
    if coverage:
        agg_row("Concept coverage (%)", [], coverage, [], [])

    print(_sep())
    print(f"\n  Interpretation:")
    print(f"    Baseline       : Gemini in textbook/explanation mode (ChatGPT-style, same model — format is the IV)")
    print(f"    FL Full        : All 5 card layers as currently generated (hook+content+simpler+detailed+visual)")
    print(f"    FL Core        : hook + content only — drops analogy, technical depth, visual")
    print(f"    FL Content only: Bare concept text — minimum viable card, highest efficiency")
    print(f"    Latency        : Baseline/Full = measured; Core/Content = estimated via TTFT+linear token model")
    print(f"    Info quality   : Judge runs only on Full (same cards, judge can't distinguish stripped scenarios)")
    print("  " + "═" * sum(COLS))


# ── Main ───────────────────────────────────────────────────────────────────────

def load_api_key() -> str:
    key = os.environ.get("GEMINI_API_KEY")
    if key:
        return key
    env_path = Path(__file__).parent.parent / ".env.local"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("GEMINI_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise EnvironmentError(
        "GEMINI_API_KEY not found.\n"
        "Set it as an environment variable or add it to .env.local:\n"
        "  GEMINI_API_KEY=your_key_here"
    )


def main():
    parser = argparse.ArgumentParser(
        description="FlashLearn Evaluation Suite",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--topics", nargs="+", help="Topics to evaluate")
    parser.add_argument("--api-url", default="http://localhost:3000/api/generate")
    parser.add_argument("--output", help="Output JSON path")
    args = parser.parse_args()

    topics  = args.topics or DEFAULT_TOPICS
    api_url = args.api_url

    api_key = load_api_key()
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel(MODEL_NAME)
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    print("╔══════════════════════════════════════════════════════════════════╗")
    print("║              FlashLearn Evaluation Suite                        ║")
    print("╚══════════════════════════════════════════════════════════════════╝")
    print(f"  Model    : {MODEL_NAME}")
    print(f"  Scenarios: Full | Core (hook+content) | Content only")
    print(f"  Topics   : {len(topics)}")
    print(f"  API      : {api_url}")
    print(f"  Date     : {datetime.now().strftime('%Y-%m-%d %H:%M')}")

    results = []
    for i, topic in enumerate(topics, 1):
        print(f"\n[{i}/{len(topics)}] {topic}")
        try:
            result = evaluate_topic(model, api_url, topic)
            results.append(result)
            print_topic_report(result)
        except requests.exceptions.ConnectionError:
            print(f"  ERROR: Cannot reach FlashLearn API at {api_url}")
            print(f"         Make sure the Next.js dev server is running (npm run dev)")
            results.append({"topic": topic, "error": "connection_refused"})
        except Exception as e:
            print(f"  ERROR: {type(e).__name__}: {e}")
            results.append({"topic": topic, "error": str(e)})

    print_aggregate_report([r for r in results if "error" not in r])

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_path  = Path(args.output) if args.output else RESULTS_DIR / f"eval_{timestamp}.json"

    report = {
        "metadata": {
            "timestamp":          timestamp,
            "model":              MODEL_NAME,
            "flashlearn_api":     api_url,
            "topics_requested":   len(topics),
            "topics_succeeded":   sum(1 for r in results if "error" not in r),
            "ttft_estimate_s":    TTFT_ESTIMATE_S,
            "avg_reading_wpm":    AVG_READING_WPM,
            "fast_reading_wpm":   FAST_READING_WPM,
            "scenarios":          {k: v["description"] for k, v in SCENARIOS.items()},
            "methodology": {
                "baseline":           "Gemini textbook-mode prompt — same model, format is the independent variable",
                "token_counting":     "Gemini count_tokens API (output tokens for fairness)",
                "latency_model":      f"Measured for baseline and full FL; estimated for core/content via TTFT({TTFT_ESTIMATE_S}s)+linear token scaling",
                "readability":        "Flesch-Kincaid (1975), rule-based syllable counter (Young 1989)",
                "lexical_diversity":  "Type-Token Ratio = unique_words / total_words",
                "info_fidelity":      "LLM-as-judge: 10-concept recall + 0-100 retention score (evaluated on Full scenario only)",
                "concept_coverage":   "Weighted recall: COVERED=1.0, PARTIAL=0.5, MISSING=0.0",
            },
        },
        "results": results,
    }

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    print(f"\n  Full results saved → {out_path}")


if __name__ == "__main__":
    main()
