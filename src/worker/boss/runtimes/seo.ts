/**
 * The SEO/GEO runtime — canon §37, §38.
 *
 * It produces evidence, never a claim. Every check states what it read and what
 * it found, and the score is the sum of checks that passed rather than a
 * prediction about anybody's ranking. This build has no network access, so
 * everything that would need one — indexation, backlinks, competitor pages,
 * actual search results — is reported as deferred rather than estimated.
 *
 * The GEO half asks the only question a generative engine really asks of a
 * page: if someone asks this, is the answer actually here, and is it
 * attributable to something?
 */

import { NO_NETWORK } from "./run";

export interface SeoCheck {
  key: string;
  label: string;
  observed: string;
  pass: boolean;
  evidence: string;
}

export interface SeoFinding {
  severity: "high" | "medium" | "low";
  text: string;
  fix: string;
}

export interface GeoProbe {
  question: string;
  answered: boolean;
  excerpt: string | null;
  attributable: boolean;
  note: string;
}

/** Checks that would need a live fetch. Named, and not attempted. */
export const DEFERRED_CHECKS = [
  { key: "indexation", label: "Is the page indexed?", status: NO_NETWORK },
  { key: "backlinks", label: "What links to it?", status: NO_NETWORK },
  { key: "serp_position", label: "Where does it rank?", status: NO_NETWORK },
  { key: "competitor_coverage", label: "What do competing pages cover?", status: NO_NETWORK },
  { key: "core_web_vitals", label: "How fast does it load for real users?", status: NO_NETWORK },
  { key: "ai_engine_citation", label: "Do generative engines cite it?", status: NO_NETWORK },
] as const;

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean);
const sentences = (text: string) => text.split(/[.!?]+\s/).map((s) => s.trim()).filter(Boolean);

/**
 * The static checks. Each reads the text and reports what it saw — the number,
 * the heading, the line — so a failing check can be argued with.
 */
export function runChecks(text: string, target: { title?: string | null }): { checks: SeoCheck[]; findings: SeoFinding[] } {
  const lines = text.split("\n");
  const headings = lines.filter((l) => /^#{1,6}\s/.test(l.trim()));
  const h1 = headings.filter((l) => /^#\s/.test(l.trim()));
  const wordCount = words(text).length;
  const sentenceList = sentences(text);
  const longSentences = sentenceList.filter((s) => words(s).length > 30);
  const links = [...text.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)];
  const numbers = [...text.matchAll(/\b\d[\d,.]*\b/g)];
  const sourced = [...text.matchAll(/\((?:source|per|according to)[^)]*\)|\[[^\]]+\]\([^)]+\)/gi)];
  const questions = lines.filter((l) => l.trim().endsWith("?"));
  const firstParagraph = lines.find((l) => l.trim() && !l.trim().startsWith("#")) ?? "";

  const checks: SeoCheck[] = [
    {
      key: "single_h1",
      label: "Exactly one top-level heading",
      observed: `${h1.length} level-one heading(s)`,
      pass: h1.length === 1,
      evidence: h1[0]?.trim() ?? "none found",
    },
    {
      key: "heading_structure",
      label: "The document is sectioned",
      observed: `${headings.length} heading(s)`,
      pass: headings.length >= 2,
      evidence: headings.slice(0, 5).map((h) => h.trim()).join(" | ") || "none found",
    },
    {
      key: "answer_first",
      label: "The first paragraph answers rather than introduces",
      observed: `${words(firstParagraph).length} words before the first heading`,
      pass: firstParagraph.trim().length > 0 && words(firstParagraph).length <= 80,
      evidence: firstParagraph.slice(0, 160) || "the document opens with a heading",
    },
    {
      key: "substance",
      label: "There is enough here to be useful",
      observed: `${wordCount} words`,
      pass: wordCount >= 150,
      evidence: `${sentenceList.length} sentence(s)`,
    },
    {
      key: "sentence_length",
      label: "Sentences are readable",
      observed: `${longSentences.length} sentence(s) over 30 words`,
      pass: longSentences.length === 0,
      evidence: longSentences[0]?.slice(0, 120) ?? "none over the limit",
    },
    {
      key: "specificity",
      label: "It contains specifics, not only claims",
      observed: `${numbers.length} number(s)`,
      pass: numbers.length >= 2,
      evidence: numbers.slice(0, 5).map((n) => n[0]).join(", ") || "no figures found",
    },
    {
      key: "attribution",
      label: "Claims carry a source",
      observed: `${sourced.length} attributed claim(s)`,
      pass: sourced.length >= 1,
      evidence: sourced[0]?.[0]?.slice(0, 100) ?? "no sources or links found",
    },
    {
      key: "internal_links",
      label: "It points somewhere",
      observed: `${links.length} link(s)`,
      pass: links.length >= 1,
      evidence: links.slice(0, 3).map((l) => l[2]).join(", ") || "no links found",
    },
    {
      key: "question_headings",
      label: "It asks the questions a reader would",
      observed: `${questions.length} question(s) in the text`,
      pass: questions.length >= 1,
      evidence: questions[0]?.trim() ?? "no questions found",
    },
    {
      key: "title_present",
      label: "The subject is named up front",
      observed: target.title ? `title: ${target.title}` : "no title supplied",
      pass: Boolean(target.title) || h1.length === 1,
      evidence: target.title ?? h1[0]?.trim() ?? "nothing to identify the subject",
    },
  ];

  const findings: SeoFinding[] = [];
  for (const check of checks) {
    if (check.pass) continue;
    const severity: SeoFinding["severity"] =
      ["single_h1", "answer_first", "attribution"].includes(check.key) ? "high"
        : ["substance", "specificity", "title_present"].includes(check.key) ? "medium"
          : "low";
    findings.push({
      severity,
      text: `${check.label}: ${check.observed}.`,
      fix:
        check.key === "single_h1" ? "Give it exactly one level-one heading naming the subject."
          : check.key === "answer_first" ? "Answer the question in the first eighty words, then explain."
            : check.key === "attribution" ? "Attach a source or a link to at least the load-bearing claims."
              : check.key === "substance" ? "Say more, or say it somewhere shorter than a page."
                : check.key === "specificity" ? "Put the actual numbers in."
                  : check.key === "sentence_length" ? "Split the sentences over thirty words."
                    : check.key === "internal_links" ? "Link to the thing you are referring to."
                      : check.key === "question_headings" ? "Use the reader's own question as a heading."
                        : "Name the subject where a reader and a machine will both find it.",
    });
  }

  return { checks, findings };
}

/**
 * Generative-engine readiness: for each question, is the answer present in the
 * text, and is the sentence carrying it attributable?
 */
export function probe(text: string, questions: string[]): GeoProbe[] {
  const sentenceList = sentences(text);
  const stop = new Set([
    "what", "when", "where", "which", "who", "why", "how", "is", "are", "the", "a", "an",
    "of", "to", "in", "for", "on", "do", "does", "did", "can", "will", "would", "should", "it", "this", "that",
  ]);

  return questions.map((question) => {
    const terms = words(question.toLowerCase().replace(/[^\w\s]/g, "")).filter((w) => !stop.has(w) && w.length > 2);
    if (terms.length === 0) {
      return { question, answered: false, excerpt: null, attributable: false, note: "The question carries no searchable terms." };
    }

    let best: { sentence: string; hits: number } | null = null;
    for (const sentence of sentenceList) {
      const lowered = sentence.toLowerCase();
      const hits = terms.filter((t) => lowered.includes(t)).length;
      if (!best || hits > best.hits) best = { sentence, hits };
    }

    const answered = Boolean(best && best.hits >= Math.ceil(terms.length / 2));
    const attributable = answered ? /\[[^\]]+\]\([^)]+\)|\((?:source|per|according to)[^)]*\)|\b\d/.test(best!.sentence) : false;

    return {
      question,
      answered,
      excerpt: answered ? best!.sentence.slice(0, 240) : null,
      attributable,
      note: answered
        ? attributable
          ? "Answered, and the sentence carries a figure or a source."
          : "Answered, but nothing in the sentence lets a reader check it."
        : `Not answered. ${terms.length} key term(s) from the question: ${terms.join(", ")}.`,
    };
  });
}

export function scoreAudit(checks: SeoCheck[], probes: GeoProbe[]): { score: number; max: number } {
  const checkPoints = checks.filter((c) => c.pass).length * 5;
  const probePoints = probes.reduce((sum, p) => sum + (p.answered ? 3 : 0) + (p.attributable ? 2 : 0), 0);
  return {
    score: checkPoints + probePoints,
    max: checks.length * 5 + probes.length * 5,
  };
}
