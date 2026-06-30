# MusicRAG Eval v2 (baseline / reranked / agent)

- Questions: 40
- Baseline: Recall@10 0.887 · MRR@10 0.863 · nDCG@10 0.863
- Reranked: Recall@10 0.925 · MRR@10 0.950 · nDCG@10 0.931
- Agent: Recall@10 0.963 · MRR@10 0.955 · nDCG@10 0.947

## By intent

| Intent | n | Variant | Recall@10 | MRR@10 | nDCG@10 |
|---|---|---|---|---|---|
| entity_lookup | 18 | baseline | 0.806 | 0.778 | 0.771 |
| entity_lookup | 18 | reranked | 0.833 | 0.889 | 0.846 |
| entity_lookup | 18 | agent | 0.917 | 0.944 | 0.916 |
| thematic | 22 | baseline | 0.955 | 0.932 | 0.938 |
| thematic | 22 | reranked | 1.000 | 1.000 | 1.000 |
| thematic | 22 | agent | 1.000 | 0.964 | 0.972 |
