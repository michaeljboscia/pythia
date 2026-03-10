# RF-02: Sparse Retrieval — BM25 and TF-IDF

**Status:** Complete
**Researched via:** Gemini Search + Synthesis
**Date:** 2026-03-10

**Domain:** Domain 1: Retrieval Fundamentals
**Type:** Foundational
**Priority:** P0
**Feeds ADR:** ADR-002

---

## Table of Contents

1. [The Probabilistic Relevance Framework](#1-the-probabilistic-relevance-framework)
2. [BM25 Algorithm Mechanics](#2-bm25-algorithm-mechanics)
3. [TF-IDF vs BM25: Why BM25 Won](#3-tf-idf-vs-bm25-why-bm25-won)
4. [Inverted Index Architecture](#4-inverted-index-architecture)
5. [When BM25 Beats Semantic Search](#5-when-bm25-beats-semantic-search)
6. [BM25 Variants](#6-bm25-variants)
7. [BM25 Failure Modes](#7-bm25-failure-modes)
8. [SPLADE and Sparse Neural Vectors](#8-splade-and-sparse-neural-vectors)
9. [Tokenization Strategies for Code](#9-tokenization-strategies-for-code)
10. [BM25 Parameter Tuning for LCS](#10-bm25-parameter-tuning-for-lcs)
11. [What It Means for LCS](#11-what-it-means-for-lcs)
12. [Decision Inputs for ADR-002](#12-decision-inputs-for-adr-002)
13. [Open Questions](#13-open-questions)

---

## 1. The Probabilistic Relevance Framework

BM25 did not emerge in isolation. It is the practical crystallization of a theoretical framework called the **Probabilistic Relevance Framework (PRF)**, developed primarily by Stephen Robertson and colleagues at City University London over roughly three decades, from the 1970s through the 2000s. The authoritative reference is Robertson & Zaragoza's 2009 paper "The Probabilistic Relevance Framework: BM25 and Beyond" (Foundations and Trends in Information Retrieval, Vol. 3).

The PRF's core question is: given a query, what is the probability that a document is relevant? The framework models this as a probabilistic inference problem, balancing two competing probability estimates:

- The probability of seeing a term in a **relevant** document
- The probability of seeing a term in a **non-relevant** document

The ratio of these two probabilities, summed across all query terms, yields a relevance score. BM25 is the practical, parameterized version of this model — "BM" stands for "Best Match" and "25" simply refers to the iteration number in the research series (earlier iterations were BM1 through BM24, most of which were intermediate experiments, never deployed).

The reason this theoretical grounding matters for LCS is that BM25 is not a heuristic — it is derived from first principles about what relevance means. This gives it predictable, interpretable behavior, which is critical when debugging a retrieval system that needs to locate specific code symbols.

---

## 2. BM25 Algorithm Mechanics

### The Full Formula

For a query Q containing terms q₁, q₂, ..., qₙ, the BM25 score for a document D is:

```
Score(D, Q) = Σᵢ IDF(qᵢ) · [ TF(qᵢ, D) · (k1 + 1) ] / [ TF(qᵢ, D) + k1 · (1 - b + b · |D| / avgdl) ]
```

Where:
- `IDF(qᵢ)` = inverse document frequency of term qᵢ
- `TF(qᵢ, D)` = number of times qᵢ appears in document D
- `|D|` = length of document D in tokens
- `avgdl` = average document length across the entire corpus
- `k1` = term frequency saturation parameter
- `b` = length normalization parameter

### The IDF Component

The IDF formula used in modern BM25 implementations (the Robertson IDF) is:

```
IDF(qᵢ) = ln( 1 + (N - n(qᵢ) + 0.5) / (n(qᵢ) + 0.5) )
```

Where:
- `N` = total number of documents in the corpus
- `n(qᵢ)` = number of documents containing the term qᵢ

The 0.5 smoothing constants prevent division by zero and ensure IDF never goes negative. The natural log ensures that the score grows slowly — doubling the rarity of a term does not double its IDF score.

The practical effect: if your corpus is 10,000 Python files and you search for `"import"`, n(qᵢ) is enormous (nearly every file imports something), yielding an IDF near zero. But if you search for `"EPHEMERAL_TOKEN_REVOKE_V3"`, n(qᵢ) might be 1, yielding a very high IDF. BM25 inherently weights specificity.

### TF Saturation and the k1 Parameter

In raw TF-IDF, term frequency scales linearly: a document mentioning a term 100 times scores 10x more than one mentioning it 10 times. This is wrong in practice. A function that says `authenticate` 5 times is clearly about authentication. A function that says it 50 times is not 10x more relevant — it may just be longer or repetitive.

BM25 solves this with a saturation curve controlled by `k1`. As raw TF increases, the BM25-normalized TF increases rapidly at first, then flattens, approaching an asymptote of `k1 + 1`.

**k1 behavioral guide:**
| k1 value | Behavior |
|----------|----------|
| 0.0 | Pure IDF — term frequency completely ignored, only presence/absence matters |
| 1.2 (Elasticsearch default) | Moderate saturation — frequency matters but plateaus quickly |
| 2.0 | Slower saturation — repeated terms continue to add score for longer |
| > 3.0 | Approaches linear TF — rarely used, implies frequency is the dominant signal |

For code corpora, lower k1 (1.0–1.5) is generally appropriate. A function name appearing twice in a file is not twice as relevant as it appearing once. The token is either in the file or it isn't.

### Field Length Normalization and the b Parameter

A 500-line module will naturally contain the term `authenticate` more times than a 10-line utility function — not because it is more relevant, but because it is longer. The `b` parameter controls how aggressively BM25 corrects for this.

The normalization computes the ratio `|D| / avgdl`. A document longer than average sees its TF penalized; one shorter than average gets a slight boost.

**b behavioral guide:**
| b value | Behavior |
|---------|----------|
| 0.0 | No length normalization — all documents treated as equal length |
| 0.75 (standard default) | Partial normalization — penalizes long docs but not fully |
| 1.0 | Full normalization — term frequency is completely normalized by length |

For code files, `b = 0.75` is a reasonable starting point for prose-like documents (markdown, docstrings, README files). For individual function-level chunks — where document length is tightly controlled during indexing — `b` can be lowered toward 0.3–0.5 because the length variation is intentionally small.

### How Parameters Interact

The two parameters are not independent. A high `b` (strong length normalization) combined with a high `k1` (slow saturation) will produce very different ranking from a low `b` / low `k1` combination. The interaction surface means parameters should be tuned together via grid search on a held-out evaluation set, not adjusted one at a time in isolation.

---

## 3. TF-IDF vs BM25: Why BM25 Won

TF-IDF, the predecessor, computes relevance as a simple product:

```
TF-IDF(t, d) = TF(t, d) · IDF(t)
```

Where TF(t, d) is typically `log(1 + count(t, d))` and IDF is `log(N / df(t))`.

BM25 supersedes TF-IDF for three reasons:

**1. Linear TF scaling.** TF-IDF's term frequency component (even with log normalization) still grows unboundedly with raw count. BM25's saturation curve bounds this correctly.

**2. No length normalization.** Standard TF-IDF has no native document length correction. Longer documents score higher simply by having more opportunities for term occurrence. BM25's `b` parameter fixes this.

**3. No calibration parameters.** TF-IDF offers no tunable knobs. BM25's `k1` and `b` allow the algorithm to be adapted to the specific statistical properties of a corpus — something critical when moving between corpora as different as Wikipedia prose and Python source code.

Apache Lucene switched BM25 as its default similarity scorer in version 6.0 (released 2016). Elasticsearch followed immediately, making BM25 the default for all `match` and `multi_match` queries. The Elasticsearch documentation for BM25 tuning explicitly states that the default `k1=1.2, b=0.75` are borrowed from Lucene's TREC experiments on web document collections — meaning the defaults were never tuned for code.

---

## 4. Inverted Index Architecture

### Structure

An inverted index is a two-part data structure:

1. **The dictionary (vocabulary):** A sorted list of all unique terms across the corpus. This is typically stored as a trie or hash map for O(log n) or O(1) term lookup.

2. **The postings lists:** For each term, a sorted list of (document ID, term frequency, position list) tuples. The document IDs are sorted in ascending order.

A minimal postings entry looks like: `authenticate → [3, 17, 42, 156, 204]`

A full postings entry with term frequency and positions: `authenticate → [(3, tf=2, pos=[14, 89]), (17, tf=1, pos=[3]), ...]`

Positions enable phrase queries (`"token authentication"`) and proximity scoring — important for code where argument order matters.

### Boolean Query Execution

Given a query `authenticate AND token`:

1. Look up the postings list for `authenticate`: `[3, 17, 42, 156]`
2. Look up the postings list for `token`: `[3, 8, 42, 199, 201]`
3. Execute a merge-intersection using two pointers: result is `[3, 42]`

The two-pointer merge is O(m + n) where m and n are the lengths of the two lists — linear time, not quadratic. This is why AND queries scale even against millions of documents.

For OR queries: merge-union, O(m + n), returns the union of both lists.
For NOT queries: merge with complement. `authenticate AND NOT token` means walk the `authenticate` list and skip any document ID that also appears in the `token` list.

### Gap Encoding and Compression

Raw postings lists cannot be stored as 32-bit integers — a term appearing in 10 million documents would require 40 MB just for that list. Two compression techniques are applied in sequence:

**Gap encoding (delta encoding):** Store the first document ID, then store only the difference (gap) between consecutive IDs.

```
Original:    [10, 25, 80, 100, 102]
Gap-encoded: [10, 15, 55,  20,   2]
```

Because frequent terms appear densely in the document space, their gaps are small. The more common a term, the smaller its gaps, and the more compressible the list.

**Integer compression:** The gap-encoded values are then compressed with integer compression algorithms optimized for small numbers:

- **Variable-Byte (VByte) encoding:** Uses 1 byte for gaps < 128, 2 bytes for < 16384, etc. A continuation bit in the high bit of each byte signals whether the next byte belongs to the same number.
- **PForDelta / Frame of Reference:** Packs 128 or 256 gap values into fixed-width blocks where the bit-width is determined by the largest value in the block. Most values use far fewer bits. This is the dominant format in Lucene's `.doc` files because modern CPUs can decompress entire blocks via SIMD instructions.

**Skip lists:** To support fast intersection without decompressing entire lists, inverted indexes embed skip pointers at regular intervals. A skip pointer says: "The next 128 values start at document ID 5000." When intersecting `authenticate` (which contains DocID 3, 42, 5001...) with `token` (which jumps from 42 to 5500), the search engine can use the skip pointer to bypass decompressing thousands of entries in the `authenticate` list between 42 and 5001.

Lucene stores `.doc` files (postings), `.pos` files (positions), and `.pay` files (payloads) separately, each compressed with PForDelta-family codecs. The net result: a 10 GB text corpus typically produces a 2–4 GB inverted index (20–40% of raw size), and query latency on a single shard is measured in milliseconds even at millions of documents.

---

## 5. When BM25 Beats Semantic Search

Semantic (dense) retrieval maps text into a continuous vector space using transformer models. Documents "near" the query vector are returned regardless of token overlap. This is powerful for paraphrase and synonym handling, but it has categorical failure modes that BM25 does not share.

### Exact-Match Tokens

**Rare terms and out-of-vocabulary tokens.** Dense models use subword tokenization (BPE, WordPiece). A novel identifier like `EPHEMERAL_TOKEN_REVOKE_V3` gets decomposed into subwords that have been seen in training, but the *specific combination* has not. The resulting embedding is poorly calibrated. BM25 treats it as an atomic token with a very high IDF, which is exactly correct behavior.

**Code identifiers.** Searching for `useAuthenticationToken` in a codebase using dense vectors will return `useLoginCredentials`, `fetchUserSession`, and `validateOAuthBearer` — all semantically equivalent. But the developer wanted the exact function. BM25 returns the exact function.

**Error codes and log tokens.** `ECONNREFUSED`, `0x80070057`, `NullPointerException` — these are tokens that appear in highly specific contexts. Dense models embed them near their semantically similar neighbors. BM25 treats each one as a unique high-IDF token.

### Named Entities

A search for a specific person (`"Sarah Chen"`), a company (`"Axiom Financial"`), or a product ID (`"SKU-99872-B"`) requires exact token matching. Semantic search may return documents about `Sarah Zhang` (similar name structure), `Axiom Analytics` (similar company type), or `SKU-99870-B` (adjacent SKU) because they occupy nearby positions in the embedding space. BM25 makes no such substitutions.

### Numbers and Version Strings

Dense models are demonstrably poor at numerical reasoning. The embedding for `Python 3.11` and `Python 3.12` will be very close — both are Python version strings, after all. For dependency resolution queries (`"which files require Python >= 3.11"`), this conflation is a retrieval error. BM25 treats `3.11` and `3.12` as distinct tokens.

Similarly: `v1.2.3` and `v1.2.4` are treated as nearly identical by embedding models but are entirely distinct by BM25. In a codebase where version pinning matters, this distinction is critical.

### The Benchmark Evidence

The BEIR benchmark (Thakur et al., 2021) — a heterogeneous benchmark across 18 retrieval datasets — shows that BM25 outperforms many dense retrieval models on datasets requiring exact match, including TREC-COVID (technical biomedical terminology), DBPedia (named entity retrieval), and Signal-1M (social media exact-match). On the NFCorpus (medical) and SciFact (scientific fact retrieval) datasets, BM25's performance is within 5 NDCG@10 points of fine-tuned dense models, despite no training.

On the CodeSearchNet benchmark (Husain et al., 2019), BM25 shows a strong advantage specifically on queries consisting of function signatures and exact identifier names versus natural language docstring-style queries, where dense retrieval dominates.

---

## 6. BM25 Variants

### BM25+ (Lower Bound on TF Contribution)

Standard BM25 can reduce the TF component to nearly zero for extremely long documents. If a term appears once in a 10,000-token document, the length normalization may penalize the TF contribution so heavily that it approaches zero — meaning the document scores almost the same whether or not the term appears.

BM25+ adds a floor constant `δ` (typically 1.0) to the normalized TF:

```
TF_bm25+(t, d) = TF_bm25(t, d) + δ
```

This guarantees that if a term appears in a document at all, it contributes at least `δ · IDF(t)` to the score. The document gets credit for containing the term, regardless of how long it is.

For LCS, BM25+ is relevant if the system indexes whole files rather than chunked excerpts — a 2,000-line module should not score the same as a 2,000-line module that doesn't contain the query term at all.

### BM25L (Adjusted Length Normalization)

Proposed in the same paper as BM25+ (Lv & Zhai, 2011), BM25L modifies the length normalization term rather than adding a floor to TF. It replaces the document length ratio `|D| / avgdl` with:

```
c(t, d) = TF_bm25(t, d) / (1 - b + b · |D| / avgdl)
adjusted_c = c(t, d) / (1 + δ)  if  c(t, d) > 1 + δ
```

The effect: BM25L smooths the curve so long documents are penalized less severely. Where BM25+ adds a floor, BM25L reshapes the normalization curve itself.

Both BM25+ and BM25L are research-grade variants — neither is available as a first-class option in Elasticsearch or Lucene. They require either custom `Similarity` implementations in Java (Lucene) or `scripted_similarity` in Elasticsearch.

### BM25F (Field-Weighted Multi-Field Search)

BM25F addresses a fundamental problem with multi-field search. If you index a code file with separate fields for `function_name`, `docstring`, and `body`, and you want to score a match in `function_name` higher than a match in `body`, the naive approach — compute BM25 for each field separately and sum — is mathematically wrong. It applies TF saturation twice and loses the non-linear properties of BM25.

BM25F takes a term-centric approach:

1. For each field f with boost weight wf, compute the weighted TF: `TF_weighted(t, f) = wf · TF(t, f)`
2. Compute the weighted document length: `|D_weighted| = Σf wf · |D_f|`
3. Combine all fields' weighted TFs into a single pseudo-term-frequency: `TF_combined = Σf TF_weighted(t, f)`
4. Apply the BM25 saturation formula *once* using TF_combined and the combined document length.

This preserves the saturation curve: finding a term twice in the title doesn't double-count the saturation penalty the way naive field summation does.

**Elasticsearch implementation:** Since version 7.13, Elasticsearch exposes BM25F through the `combined_fields` query. Field boosting uses the `^` syntax (e.g., `"function_name^3,docstring^2,body^1"`). Constraint: all queried fields must use the same analyzer.

```json
{
  "query": {
    "combined_fields": {
      "query": "authenticate token",
      "fields": ["function_name^3", "docstring^2", "body"]
    }
  }
}
```

For LCS, BM25F via `combined_fields` is the recommended approach when indexing code with structured fields. Symbol names should receive a significantly higher boost than prose body text.

### Elasticsearch's Per-Field BM25 Configuration

Elasticsearch exposes `k1` and `b` at the index mapping level, configurable per field:

```json
{
  "settings": {
    "similarity": {
      "code_bm25": {
        "type": "BM25",
        "k1": 1.2,
        "b": 0.3
      }
    }
  },
  "mappings": {
    "properties": {
      "function_name": {
        "type": "text",
        "similarity": "code_bm25"
      }
    }
  }
}
```

This allows applying different `b` values per field — which is crucial for LCS: prose fields (docstrings, comments) want `b ≈ 0.75`, while code body fields where chunks are tightly controlled want `b ≈ 0.3`.

---

## 7. BM25 Failure Modes

Understanding where BM25 fails is as important as understanding where it succeeds. These failure modes are the direct motivation for hybrid search architectures.

### Vocabulary Mismatch

The foundational failure of all lexical retrieval. If the user and the document author use different vocabulary, BM25 scores the match as zero. This is not a calibration problem — it is a structural limitation of the bag-of-words model.

Examples relevant to LCS:
- Query: `"token revocation"` — Document uses `"invalidate credentials"` → zero score
- Query: `"connection pool"` — Document uses `"database session manager"` → zero score
- Query: `"error handler"` — Document uses `"exception middleware"` → zero score

### Synonym Blindness

BM25 treats `authenticate` and `login` as completely unrelated tokens. From the model's perspective, they share no more in common than `authenticate` and `zucchini`. The model has no notion of semantic proximity — it only sees token overlap.

This is the primary driver for augmenting BM25 with synonym expansion in production search systems. Elasticsearch supports synonym filters at index time or query time. But maintaining synonym dictionaries is expensive and domain-specific. For a codebase, the synonym problem is real but bounded: there are only so many ways to say "authentication" in production code.

### Paraphrase Queries

Natural language questions almost never share exact tokens with the code that answers them. A query like `"how does the app verify that a user is logged in?"` shares no tokens with the function `validate_session_token(request: HttpRequest) -> bool`. BM25 returns a near-zero score. This is the primary domain where dense retrieval wins outright.

### Short Query Terms Without Disambiguating Context

Single-word queries like `"sort"` or `"parse"` will be common across a codebase. BM25's IDF component will give them a low weight because they appear everywhere. But the developer searching for `"sort"` may specifically want the custom sort comparator, not every file that calls `sorted()`. BM25 cannot distinguish intent without token overlap.

### Stop Word Removal and Code

Standard English analyzers apply stop word removal — eliminating tokens like "the", "is", "in", "to". For prose retrieval, this is correct behavior. For code retrieval, it is destructive. Consider:

- `in` is a Python keyword (membership test: `x in collection`)
- `is` is a Python identity operator
- `not` is a logical negation operator
- `or`, `and` are Boolean operators

An English stop word filter applied to a Python corpus will silently remove semantically meaningful tokens. The BM25 score for a query containing these terms will be zero, not because the code doesn't match, but because the analyzer discarded the evidence.

---

## 8. SPLADE and Sparse Neural Vectors

SPLADE (Sparse Lexical and Expansion model) represents the most important development in lexical retrieval since BM25 itself. The original paper (Formal et al., SIGIR 2021) introduced the idea of using a transformer encoder to produce **sparse** representations over the model's full vocabulary.

### How It Works

A SPLADE encoder takes a piece of text and produces a vector with dimensionality equal to the vocabulary size (typically 30,522 for BERT-base). Most values are zero. The non-zero values represent activated terms with associated weights. Unlike a dense 768-dimensional vector, you can inspect which terms were activated — the representation is interpretable.

For the query `"how to revoke a user token"`, SPLADE might activate:
```
revoke: 2.3, token: 2.1, invalidate: 1.8, user: 1.4, credential: 1.2,
authentication: 0.9, expire: 0.8, access: 0.6, ...
```

Notice that `invalidate` and `credential` were never in the input — SPLADE performed **learned term expansion**, injecting semantically related terms with calibrated weights.

### Why This Matters for BM25's Failure Modes

SPLADE addresses vocabulary mismatch at the model level rather than through manually maintained synonym dictionaries. Because it learned term relationships from large corpora, it knows that `revoke` and `invalidate` are related in the authentication domain. The expansion happens automatically, without domain-specific configuration.

SPLADE-encoded documents can be stored in a standard inverted index — the non-zero entries are just term weights in a sparse vector. WAND (Weak AND) and MaxScore algorithms from the BM25 retrieval literature apply directly, giving SPLADE the efficiency properties of classical inverted index search.

### SPLADE vs BM25 Benchmarks

On BEIR benchmarks, SPLADE-v2 outperforms BM25 on 14 of 18 datasets, with particularly large gains on vocabulary-mismatch-heavy datasets (Arguana: +25 NDCG@10, TREC-COVID: +18 NDCG@10). On exact-match-heavy datasets (DBPedia entity search, Robust04), gains are smaller (3–7 points) — BM25 already handles those well.

On code-specific benchmarks, SPLADE shows a more complex picture: it outperforms BM25 on natural language docstring-to-code retrieval but is roughly equivalent on identifier-level exact-match queries, where BM25's token matching is already correct.

### SPLADE vs Dense Retrieval

SPLADE is not a replacement for dense retrieval — it is a bridge. Its strengths:
- Much faster to retrieve than dense search (inverted index vs ANN search)
- Interpretable — you can explain why a document was returned
- Handles vocabulary mismatch without training a full bi-encoder
- Naturally integrates with existing BM25 infrastructure

Its weaknesses:
- Still requires a trained neural model (inference cost at index time)
- Does not capture deep semantic relationships as well as dense bi-encoders on purely conceptual queries
- Expansion quality depends on training domain alignment

For LCS, SPLADE is a candidate to consider as a step above BM25 in retrieval quality, particularly if the query distribution includes many natural language questions about code behavior.

---

## 9. Tokenization Strategies for Code

The choice of tokenizer is the most impactful single decision in a code retrieval system. Standard NLP tokenizers are designed for English prose and fail systematically on code syntax.

### Why Standard Analyzers Fail on Code

Standard English analyzers apply:
1. Lowercasing: `AuthToken → authtoken` (irreversible, loses casing signals)
2. Stop word removal: `in`, `not`, `is`, `or`, `and` — all Python keywords — removed
3. Stemming: `authenticate → authent`, `authentication → authent`, `authenticating → authent` — destroys version/tense distinctions that may matter for code context

The compound result: `useAuthenticationToken` becomes `useauthenticationtoken` (one massive token that will never match anything unless the user types it exactly), and the surrounding code loses its keywords.

### camelCase and snake_case Splitting

Production code tokenizers must split compound identifiers:
- `useAuthenticationToken → use, Authentication, Token`
- `get_user_by_email → get, user, by, email`
- `HTTPSConnectionPool → HTTPS, Connection, Pool`

This enables partial matching: a query for `authentication` finds `useAuthenticationToken`, `AuthenticationMiddleware`, and `authenticateUser` — all semantically related matches that would be missed with a naive tokenizer.

Elasticsearch implements this via the `word_delimiter_graph` token filter with `split_on_case_change: true` and `split_on_numerals: true`. The filter handles camelCase, PascalCase, ALL_CAPS_CONSTANTS, and mixed snake_case correctly.

### Symbol and Operator Handling

Standard tokenizers strip punctuation. For code, punctuation is syntax:
- `Array<string>` — angle brackets are generics syntax
- `(error, result)` — parentheses are argument destructuring
- `$scope` — the dollar sign is a valid identifier prefix in JavaScript
- `@decorator` — the at sign is Python/Java decorator syntax

A code-aware tokenizer must either preserve these symbols or tokenize them consistently. The common approach is to treat `<`, `>`, `(`, `)`, `[`, `]` as delimiter tokens rather than stripping them — so `Array<string>` becomes `[Array, string]` with the `<>` registered as field delimiters, not dropped.

### N-gram Tokenization for Substring Matching

For partial identifier matching (finding `Auth` inside `useAuthenticationToken`), edge n-grams are useful. An edge n-gram filter produces tokens for each prefix of a term:

`Authentication → A, Au, Aut, Auth, Authe, Authen, ...`

This enables prefix-search autocompletion and partial-match retrieval. The tradeoff: index size grows significantly (3–5x) because each token generates many n-gram entries.

For LCS, edge n-grams on the `function_name` field specifically would enable partial symbol search without bloating the full-document index.

### Stemming vs. No Stemming for Code

For prose fields (docstrings, comments, README content), light stemming (Porter or Snowball English) is appropriate — `connecting`, `connection`, `connected` should all match `connect`.

For code fields (function names, identifiers, variable names), **no stemming**. `sort` and `sorted` are distinct functions in Python. `open` and `opening` may refer to different code paths. Stemming would incorrectly conflate them.

This argues for separate fields with separate analyzers — one analyzer for prose, one for code identifiers.

---

## 10. BM25 Parameter Tuning for LCS

### For Code Identifier Fields (function_name, class_name, symbol)

```
k1 = 1.0 – 1.2
b  = 0.1 – 0.3
```

**Rationale:** Identifiers are short (1–5 tokens typically). Length variation is small. Setting `b` low prevents the length normalization from penalizing slightly longer names. TF saturation should kick in quickly because seeing a function name 3 times in its own file is not more relevant than seeing it once — it's just defined, called, and perhaps type-annotated.

### For Code Body Fields (function body, method body)

```
k1 = 1.2 – 1.5
b  = 0.5 – 0.75
```

**Rationale:** Code body length varies more (10-line utility vs 200-line class method). Length normalization matters more here. TF saturation should allow some repetition credit — a token appearing 5 times in a function body may genuinely signal that the function is centrally about that concept.

### For Prose Fields (docstrings, README, comments)

```
k1 = 1.2 – 2.0
b  = 0.75
```

**Rationale:** Standard prose retrieval defaults apply. These are the parameter values tuned on TREC web collections and are generally appropriate for English prose regardless of domain.

### For Markdown Documentation

```
k1 = 1.5
b  = 0.75
```

**Rationale:** Markdown documents are often short (a section or page) and authored in natural English with some technical terms. Standard defaults are appropriate, possibly with slightly higher `k1` to reward repeated emphasis.

### Calibration Approach

The above are starting points, not final values. The correct calibration process is:

1. Build a set of 50–100 representative queries with known ground-truth relevant documents (manually labeled or derived from git blame / usage patterns).
2. Grid search `k1 ∈ [0.5, 3.0]` and `b ∈ [0.0, 1.0]` at 0.25 increments.
3. Optimize for NDCG@10 (relevance-weighted rank quality) or MRR@10 (how often the best result is in the top 10).
4. Run separate calibrations for each field type.

---

## 11. What It Means for LCS

### LCS Must Have BM25 — No Exceptions

The LCS corpus contains Python source code, TypeScript source code, and markdown documentation. The queries will be a mix of:

- Natural language questions (`"how does the oracle checkpoint work"`) — dense retrieval domain
- Exact identifier searches (`"spawn_daemon"`, `"oracle_checkpoint"`, `"MAX_PRESSURE"`) — BM25 domain
- Symbol-heavy queries (`"oracle_reconstitute TypeError"`, `"DECOMMISSION_TOKEN_SECRET"`) — BM25 domain

The identifier and symbol queries are the hard ones. Dense retrieval will not reliably retrieve the exact file or function for an exact identifier query. BM25 will. This is not a nice-to-have — it is a correctness requirement.

### Inverted Index vs Sparse Vector Approximation

Vector databases like Qdrant implement sparse retrieval via **sparse vectors** stored in a sparse vector index — not a true Lucene-style inverted index with gap-encoded postings lists. The retrieval algorithm uses dot-product operations on sparse matrices, not list intersection. The result is functionally similar for ranking, but the architecture is different.

For LCS at the scale being considered (a project-level corpus, likely 1,000–100,000 chunks), the performance difference between a true inverted index and a sparse vector approximation is irrelevant. What matters is which implementation is available in the chosen vector database without requiring a separate service.

**If the chosen vector DB (ADR-002) supports sparse vectors natively:** Use sparse vectors for BM25-like lexical retrieval. Qdrant's sparse vector support is documented and production-ready.

**If the chosen vector DB does not support sparse vectors:** Maintain a separate SQLite FTS5 index (or PostgreSQL `tsvector`) for the BM25 component. SQLite FTS5 uses a BM25 scorer natively (since SQLite 3.36). The dual-index architecture adds operational overhead but is straightforward to implement.

### Tokenization Decision

LCS must use a custom code tokenizer with:
1. camelCase and snake_case splitting on all code fields
2. No stemming on identifier fields
3. Preservation of common code symbols (not stripping `$`, `@`, `_`)
4. Stop word list that excludes Python/TypeScript keywords (`in`, `is`, `not`, `or`, `and`, `as`, `for`)
5. Light English stemming on prose fields only (docstrings, README)
6. Edge n-grams (min=3, max=15) on the `symbol_name` field for partial-match queries

### Hybrid Search is the Architecture

BM25 alone misses conceptual questions. Dense retrieval alone misses exact identifiers. The LCS retrieval pipeline must be hybrid:

1. BM25 over the code corpus with code-aware tokenization
2. Dense retrieval with a code-specialized embedding model (CodeBERT, StarEncoder, or similar)
3. Reciprocal Rank Fusion (RRF) or a learned re-ranker to combine results
4. Hard filter: any query containing known identifiers (detectable by the absence of spaces and the presence of camelCase patterns) routes to BM25 first with a higher weight

### SPLADE as a Future Upgrade Path

BM25 is the right starting point — it is fast, transparent, and handles the exact-match cases that matter most for code retrieval. SPLADE is the right next step if vocabulary mismatch on natural language queries becomes a documented retrieval failure. The architectural investment is the same: both use inverted indexes, so upgrading from BM25 to SPLADE does not require an infrastructure change — only replacing the query/document encoder.

---

## 12. Decision Inputs for ADR-002

| ADR | Question Answered | Our Finding |
|-----|-------------------|-------------|
| ADR-002 | Must our vector DB support sparse retrieval natively? | Yes — or we need a parallel SQLite FTS5 / pg_tsvector index. Sparse vector support in the primary DB avoids the dual-index operational burden. |
| ADR-002 | Can we rely on dense retrieval alone? | No. Exact-match queries on identifiers, error codes, and symbols require BM25-class lexical matching. Dense retrieval alone fails this class of query categorically. |
| ADR-002 | What tokenizer does the index require? | A custom code-aware tokenizer with camelCase splitting, no stemming on identifiers, keyword-preserving stop word list, and separate analyzer configurations per field type. |
| ADR-002 | What BM25 parameters should we start with? | k1=1.2, b=0.3 for identifier fields; k1=1.5, b=0.75 for prose fields. Calibrate with held-out query set after initial corpus is indexed. |
| ADR-002 | Is SPLADE a day-one requirement? | No. BM25 + dense hybrid is the correct MVP. SPLADE is a documented upgrade path if vocabulary mismatch is observed empirically. |

---

## 13. Open Questions

1. **What is the actual identifier query fraction in LCS usage patterns?** The parameter tuning and architecture recommendations above depend on a significant fraction of queries being identifier/exact-match style. If usage is 90% natural language conceptual queries, the BM25 investment is lower priority. Need to prototype and log query patterns.

2. **Does the chosen vector DB (ADR-002) support per-field BM25 parameters?** Qdrant sparse vectors do not expose `k1`/`b` parameters — sparse vector weights are raw floats. If exact BM25 parameter control is required, a separate FTS index may be necessary regardless of primary DB choice.

3. **Should BPE tokenization be applied to code identifiers?** BPE (used by most LLM tokenizers) would split `useAuthenticationToken` into subword units, enabling partial overlap scoring. The tradeoff against camelCase splitting is non-obvious. Needs empirical evaluation.

4. **Synonym expansion scope.** For the authentication domain, a hand-authored synonym file (`authenticate ↔ login`, `token ↔ credential`, `revoke ↔ invalidate`) would significantly improve BM25 recall for the LCS oracle use case. What is the maintenance burden and how many synonym pairs are needed before SPLADE becomes more practical?

5. **FTS5 vs. Elasticsearch for the BM25 component.** If a standalone inverted index is needed, SQLite FTS5 is operationally simple (single file, no service) but limited in tuning. Elasticsearch is operationally heavy but supports BM25F, per-field parameters, synonym filters, and custom analyzers. The right choice depends on the deployment environment defined in ADR-002.

---

## Sources Consulted

| # | Source | Type | URL/Path |
|---|--------|------|----------|
| 1 | Robertson & Zaragoza, "The Probabilistic Relevance Framework: BM25 and Beyond" (2009) | Academic paper | https://dl.acm.org/doi/10.1561/1500000019 |
| 2 | Elastic.co, "Practical BM25 Part 2: The BM25 Algorithm and Its Variables" | Engineering blog | https://www.elastic.co/blog/practical-bm25-part-2-the-bm25-algorithm-and-its-variables |
| 3 | Lv & Zhai, "Lower-Bounding Term Frequency Normalization" (2011) — BM25+/BM25L paper | Academic paper | https://dl.acm.org/doi/10.1145/2063576.2063584 |
| 4 | Formal et al., "SPLADE: Sparse Lexical and Expansion Model for First Stage Ranking" (SIGIR 2021) | Academic paper | https://arxiv.org/abs/2107.05720 |
| 5 | Thakur et al., "BEIR: A Heterogeneous Benchmark for Zero-shot Evaluation of Information Retrieval Models" (2021) | Benchmark paper | https://arxiv.org/abs/2104.08663 |
| 6 | Husain et al., "CodeSearchNet Challenge" (2019) | Benchmark paper | https://arxiv.org/abs/1909.09436 |
| 7 | Apache Lucene documentation — BM25Similarity | Reference documentation | https://lucene.apache.org/core/ |
| 8 | OpenSource Connections, "BM25F and Elasticsearch combined_fields query" | Engineering blog | https://opensourceconnections.com |
| 9 | Gemini Search synthesis — BM25 mechanics, inverted index architecture, variants, failure modes, SPLADE | Live search synthesis | 2026-03-10 |
