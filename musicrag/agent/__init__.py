"""Agentic retrieval layer for MusicRAG.

A framework-free orchestrator structured as explicit LangGraph-style nodes
(classify -> route -> retrieve -> grade -> rewrite -> assemble). It upgrades the
linear retrieve->rerank->answer pipeline with query routing over the context
graph and a self-correcting (CRAG-style) retrieval loop.

See docs/RAG2-UPGRADE.md for the design and the drop-in LangGraph translation.
"""

from musicrag.agent.intent import Intent, QueryPlan, Vocabulary, classify_intent

__all__ = ["Intent", "QueryPlan", "Vocabulary", "classify_intent"]
