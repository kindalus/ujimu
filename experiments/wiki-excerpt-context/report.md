# Wiki excerpt context — evidence

Run: 2026-11-09, isolated sandbox. No production data, credentials or questions were used; the sandbox credential was deleted after the run.

## Question

Does putting the top semantic-search excerpts of the specialist wiki into the chat prompt keep answer quality while cutting time and tokens?

## Setup

- Wiki: a copy of the `legislacao-laboral-angolana` specialist wiki.
- Questions: 5 intents × 6 phrasings = 30 questions (weekly hours, overtime pay, annual leave, maternity leave, termination notice).
- Arms, same Pi chat model and settings:
  - **A**: current prompt (llm-wiki Query workflow from `wiki/index.md`, retrieval hints).
  - **D**: the excerpts replace the hints, and the prompt tells the agent to answer from them unless they are insufficient, ambiguous or conflicting. Answers that list cases (e.g. every situation that requires notice) treat the excerpts as incomplete and fall back to the standard workflow.
- Index: `llm-wiki` `scripts/wiki_index.py` (schema 1, chunker 1), `Xenova/multilingual-e5-small` INT8, ONNX SHA-256 `4d24e2bc01a447951524466ef533e52944bf48509e6552810bcee1a2711cb02c`, `query:`/`passage:` prefixes, 384 dimensions.
- Search: top 6 sections, excluding `sources/` and `laws/`, formatted like the skill's text output with the resolved `sourceTitle`/`sourceFile` list. Median context 3.0 KB, maximum 3.7 KB.

## Node and Python equivalence

- Node (`@huggingface/transformers`) re-embedded every indexed section: cosine with the Python vectors ≥ 0.9995.
- Ranking the stored vectors in Node returned the same 6 sections as the Python search for 30 of 30 questions.
- Node query time: about 2 ms after warm-up, versus about 0.4 s for a Python process per query.

## Results (30 paired questions)

| Measure | A | D |
| --- | ---: | ---: |
| Median time | 69.2 s | 35.3 s |
| Median tokens per answer | 56,287 | 20,459 |
| Total tokens | 1,910,331 | 1,512,135 |
| Tool calls (total) | 246 | 139 |
| Wiki page reads (total) | 101 | 51 |
| Expected facts present | 30/30 | 30/30 |
| Expected article present | 30/30 | 30/30 |
| Citation with the correct `sourceFile` | 11/30 | 30/30 |

Paired sign tests (D < A): time 25/30 (p = 0.0003), tokens 24/30 (p = 0.0014), tool calls 26/30 (p = 0.0001).

Per intent, median time A → D: weekly hours 46.4 → 29.7 s; overtime pay 66.8 → 33.7 s; annual leave 57.0 → 26.9 s; maternity leave 106.7 → 74.4 s; termination notice 92.8 → 116.4 s. Termination notice is the list-of-cases intent: D takes the fallback and becomes slower than A.

## Blind judge

An independent judge scored the anonymised A/D pairs (exactness, completeness, citations, clarity; 0–2 each per answer).

| | A | D |
| --- | ---: | ---: |
| Points | 215 | 210 |
| Exactness | 58 | 57 |
| Completeness | 59 | 60 |
| Citations | 48 | 40 |
| Clarity | 50 | 53 |
| Wins (12 ties) | 10 | 8 |
| Material errors | 0 | 0 |

- D lost points mainly on citations: it copied article ranges ("Artigos 28.º a 35.º") from wiki pages instead of the exact article. This comes from the derived pages, not from retrieval.
- Both arms had three answers judged internally inconsistent. In D, these were fixed-term contracts that "expire without notice" while also citing a 30-day notice (Art. 17.º, n.º 3).
- Both arms leaked internal reasoning ("Now let me apply the unslop skill…") in about 12 answers in total, unrelated to retrieval.

## Conclusion

D keeps quality level with A (no material errors, same facts and articles), halves median time, cuts median tokens by 64% and always cites the correct source file. Citation ranges and reasoning leaks are separate follow-ups.
