# MusicRAG Eval v2 (baseline / reranked / agent)

- Questions: 34
- Baseline: Recall@10 0.882 · MRR@10 0.868 · nDCG@10 0.872
- Reranked: Recall@10 0.926 · MRR@10 0.941 · nDCG@10 0.930
- Agent: Recall@10 0.956 · MRR@10 0.971 · nDCG@10 0.959

## By intent

| Intent | n | Variant | Recall@10 | MRR@10 | nDCG@10 |
|---|---|---|---|---|---|
| entity_lookup | 20 | baseline | 0.800 | 0.800 | 0.800 |
| entity_lookup | 20 | reranked | 0.875 | 0.900 | 0.881 |
| entity_lookup | 20 | agent | 0.925 | 0.950 | 0.931 |
| thematic | 14 | baseline | 1.000 | 0.964 | 0.974 |
| thematic | 14 | reranked | 1.000 | 1.000 | 1.000 |
| thematic | 14 | agent | 1.000 | 1.000 | 1.000 |
