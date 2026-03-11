# Observability for production RAG systems

**Production RAG pipelines demand the same monitoring rigor as any critical distributed system—but with additional quality dimensions unique to AI.** A retrieval-augmented generation system can fail silently: latency stays low, HTTP status codes read 200, yet the system returns confident hallucinations because an embedding index went stale overnight. Effective RAG observability spans three layers—retrieval quality, generation faithfulness, and infrastructure health—stitched together through distributed tracing and guarded by intelligent alerting. This document provides concrete metrics, OpenTelemetry instrumentation patterns, and SLO-based alerting configurations drawn from production deployments at DoorDash, Elastic, and Deutsche Telekom, along with framework-specific guidance from RAGAS, Arize Phoenix, Datadog, and Grafana.

## Essential metrics across the retrieval-generation pipeline

Monitoring a RAG system requires metrics at three distinct layers. The [Google SRE handbook](https://sre.google/sre-book/monitoring-distributed-systems/) establishes four golden signals—latency, traffic, errors, saturation—as the foundation. For RAG, each golden signal manifests differently at the retrieval and generation stages, and a fifth dimension—**answer quality**—has no analog in traditional web services.

### Retrieval layer metrics

The retrieval subsystem transforms a user query into an embedding, searches a vector store, and returns ranked document chunks. Three categories of metrics matter here.

**Latency percentiles** (`rag_retrieval_latency_seconds`) should be tracked at p50, p95, and p99 using a [Prometheus histogram](https://prometheus.io/docs/practices/histograms/). Most production RAG applications target **sub-2-second end-to-end latency**, which means the retrieval step—embedding computation plus vector search plus optional re-ranking—typically must complete under 500ms. The p99 is the first metric to spike when the system approaches capacity ceilings, making it the key constraint detector. A [practical Prometheus instrumentation pattern](https://app.ailog.fr/en/blog/guides/rag-monitoring) uses buckets of `[0.1, 0.5, 1, 2, 5]` seconds:

```python
from prometheus_client import Counter, Histogram, Gauge
query_counter = Counter('rag_queries_total', 'Total RAG queries')
latency_histogram = Histogram('rag_latency_seconds', 'RAG latency',
    ['pipeline_stage'], buckets=[0.1, 0.5, 1, 2, 5])
error_counter = Counter('rag_errors_total', 'Total RAG errors', ['error_type'])
```

**Recall proxy and precision** are harder to instrument in real-time because they require ground-truth labels. In production, teams approximate these through **hit rate** (did at least one relevant document appear in the top-k results?) and **context precision** (signal-to-noise ratio of retrieved chunks). The [RAGAS framework](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_precision/) defines `LLMContextPrecisionWithoutReference`, which uses an LLM judge to assess each chunk's relevance without a labeled reference set—making it viable for continuous monitoring. Target **recall@5 ≥ 0.75** and **precision@k ≥ 0.8** for well-tuned systems.

**Empty result rate** (`rag_empty_results_total`) is a binary counter that should remain near zero. Spikes indicate knowledge base coverage gaps, broken vector database connections, or embedding model failures. Track this as a [Prometheus counter](https://app.ailog.fr/en/blog/guides/rag-monitoring) partitioned by query category if your system supports it.

### Generation layer metrics

The generation stage takes retrieved context and a user query, assembles a prompt, and produces an LLM response. Quality metrics here are fundamentally different from traditional service metrics because correctness is semantic, not syntactic.

**Faithfulness** is the single most important generation metric. [RAGAS defines faithfulness](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/faithfulness/) as the ratio of claims in the generated response that are supported by the retrieved context: `faithfulness = supported_claims / total_claims`. The computation involves breaking the response into individual assertions, then verifying each against the provided context. Scores **≥ 0.8 indicate strong performance**; below 0.75 warrants investigation. For cost-sensitive production deployments, RAGAS supports using [Vectara's HHEM-2.1-Open](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/faithfulness/) (a T5 classifier) instead of an LLM for the verification step—described as "free, small, and open-source, making it very efficient in production use cases."

**Answer relevancy** measures whether the generated response actually addresses the user's question. [RAGAS computes this](https://docs.ragas.io/en/stable/concepts/metrics/overview/) by generating synthetic questions from the response and measuring cosine similarity with the original query. **Hallucination rate** is effectively the inverse proxy of faithfulness—the percentage of responses containing unsupported claims. [Datadog's LLM Observability](https://www.datadoghq.com/blog/llm-observability-hallucination-detection/) distinguishes between **contradictions** (claims that directly conflict with context) and **unsupported claims** (claims not grounded in any provided context), which is a useful operational distinction for triage.

**Citation accuracy** validates that references in the response correctly point to supporting source documents. [Arize Phoenix provides a dedicated evaluator](https://arize.com/docs/phoenix/evaluation/pre-built-metrics/faithfulness) for this, and [RAGAS lists it as an end-to-end metric](https://docs.ragas.io/en/stable/concepts/metrics/overview/) in its framework.

### Infrastructure and data health metrics

Infrastructure metrics form the silent backbone of RAG reliability.

**Index freshness** is the elapsed time since the last knowledge base update. For dynamic content, alert if index age exceeds a domain-appropriate threshold (e.g., 24 hours for support documentation, 1 hour for news-based systems). This metric has no standard Prometheus exporter—instrument it as a gauge (`rag_index_last_updated_timestamp`) and compute staleness with `time() - rag_index_last_updated_timestamp`.

**Embedding API latency** (`rag_embedding_latency_seconds`) should stay under **100ms at p95** for external embedding APIs like OpenAI's `text-embedding-3-small`. Track this separately from vector search latency, as [Galileo's analysis of RAG latency budgets](https://galileo.ai/blog/top-metrics-to-monitor-and-improve-rag-performance) shows embedding computation and vector search contribute distinct, independently degrading components.

**Embedding drift** is a subtle failure mode. [Production experience shows](https://dev.to/dowhatmatters/embedding-drift-the-quiet-killer-of-retrieval-quality-in-rag-systems-4l5m) that mixing embeddings from different model versions silently degrades retrieval quality. [Evidently AI](https://www.evidentlyai.com/llm-guide/rag-evaluation) provides embedding drift detection using 20+ statistical tests (PSI, KS test) that compare embedding distributions across time windows. Pin your embedding model version, never mix versions in a single index, and re-embed the entire corpus on model updates.

**Token usage and cost** (`rag_cost_usd` partitioned by component) connect system behavior to financial impact. Track input and output tokens separately for both embedding and LLM calls. [Helicone reports](https://www.helicone.ai/) that proxy-based cost tracking with built-in caching yields **20–30% cost reductions** from cache hits alone.

## Tracing the full pipeline with OpenTelemetry

OpenTelemetry provides the scaffolding to stitch every RAG pipeline stage—from query embedding through LLM generation—into a single distributed trace. The [OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/) (currently in Development status) define four span types purpose-built for AI workloads: `chat`, `embeddings`, `retrieval`, and `execute_tool`.

### GenAI semantic conventions and span attributes

The [GenAI attribute registry](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/) establishes a standardized vocabulary. Key attributes include `gen_ai.operation.name` (required, identifies the span type), `gen_ai.provider.name` (replacing the deprecated `gen_ai.system`), `gen_ai.request.model`, and token usage counters `gen_ai.usage.input_tokens` / `gen_ai.usage.output_tokens` (replacing the deprecated `prompt_tokens`/`completion_tokens`).

The **retrieval span** is particularly relevant to RAG. Setting `gen_ai.operation.name = "retrieval"` activates attributes like `gen_ai.data_source.id` (identifies the vector store), `gen_ai.request.top_k`, and opt-in sensitive fields `gen_ai.retrieval.query.text` and `gen_ai.retrieval.documents` (a JSON array of `{id, score}` pairs). The **embeddings span** adds `gen_ai.embeddings.dimension.count` and `gen_ai.request.encoding_formats`.

For pipeline stages without official conventions—re-ranking and context assembly—use custom attributes under a `rag.*` namespace prefix, following the [pattern established in production deployments](https://oneuptime.com/blog/post/2026-02-06-rag-pipeline-tracing-opentelemetry/view).

### Span hierarchy for a RAG trace

A well-structured RAG trace forms a tree with five to six child spans beneath a root:

```
rag.query (INTERNAL, root)
├── embeddings text-embedding-3-small (CLIENT)
├── retrieval my-pinecone-index (CLIENT)
├── rag.rerank (INTERNAL)
├── rag.context_assembly (INTERNAL)
└── chat gpt-4 (CLIENT)
```

Each CLIENT span follows the OTel GenAI conventions. Each INTERNAL span uses custom `rag.*` attributes. The [Node.js SDK](https://opentelemetry.io/docs/languages/js/instrumentation/) makes parent-child relationships automatic when using `startActiveSpan`—child spans created within the callback inherit the active context:

```javascript
import { trace, SpanStatusCode, SpanKind } from '@opentelemetry/api';
const tracer = trace.getTracer('rag.pipeline', '1.0.0');

async function ragPipeline(userQuery, topK = 5) {
  return tracer.startActiveSpan('rag.query',
    { kind: SpanKind.INTERNAL }, async (rootSpan) => {
    rootSpan.setAttribute('rag.query.text', userQuery.substring(0, 200));

    // Embedding — auto-parented to rootSpan
    const embedding = await tracer.startActiveSpan(
      'embeddings text-embedding-3-small',
      { kind: SpanKind.CLIENT }, async (span) => {
        span.setAttribute('gen_ai.operation.name', 'embeddings');
        span.setAttribute('gen_ai.provider.name', 'openai');
        span.setAttribute('gen_ai.request.model', 'text-embedding-3-small');
        const result = await openai.embeddings.create({
          model: 'text-embedding-3-small', input: userQuery });
        span.setAttribute('gen_ai.usage.input_tokens',
          result.usage.total_tokens);
        span.setAttribute('gen_ai.embeddings.dimension.count',
          result.data[0].embedding.length);
        span.end();
        return result.data[0].embedding;
    });

    // Vector search
    const results = await tracer.startActiveSpan(
      'retrieval my-index',
      { kind: SpanKind.CLIENT }, async (span) => {
        span.setAttribute('gen_ai.operation.name', 'retrieval');
        span.setAttribute('gen_ai.data_source.id', 'my-pinecone-index');
        span.setAttribute('gen_ai.request.top_k', topK);
        const matches = await vectorDB.query({
          vector: embedding, topK });
        span.setAttribute('gen_ai.retrieval.documents',
          JSON.stringify(matches.map(m => ({ id: m.id, score: m.score }))));
        span.end();
        return matches;
    });

    // LLM generation
    const answer = await tracer.startActiveSpan('chat gpt-4',
      { kind: SpanKind.CLIENT }, async (span) => {
        span.setAttribute('gen_ai.operation.name', 'chat');
        span.setAttribute('gen_ai.request.model', 'gpt-4');
        span.setAttribute('gen_ai.request.temperature', 0.1);
        const completion = await openai.chat.completions.create({ /*...*/ });
        span.setAttribute('gen_ai.usage.input_tokens',
          completion.usage.prompt_tokens);
        span.setAttribute('gen_ai.usage.output_tokens',
          completion.usage.completion_tokens);
        span.setAttribute('gen_ai.response.finish_reasons',
          JSON.stringify([completion.choices[0].finish_reason]));
        span.end();
        return completion.choices[0].message.content;
    });

    rootSpan.end();
    return answer;
  });
}
```

The [Node.js SDK setup](https://opentelemetry.io/docs/languages/js/getting-started/nodejs/) requires initializing the SDK before application code loads, using `node --import ./instrumentation.mjs app.js` with a `BatchSpanProcessor` and OTLP exporter.

### Auto-instrumentation libraries

Manual instrumentation provides maximum control, but three open-source libraries offer zero-code tracing for common frameworks. [OpenLLMetry by Traceloop](https://github.com/traceloop/openllmetry) auto-instruments OpenAI, Anthropic, Pinecone, Chroma, LangChain, and LlamaIndex, emitting standard OTLP traces. It offers both [Python](https://github.com/traceloop/openllmetry) and [TypeScript](https://github.com/traceloop/openllmetry-js) SDKs. [OpenLIT](https://github.com/openlit/openlit) covers 44+ LLM providers with a one-line init (`openlit.init()`) and was [featured on the OpenTelemetry blog](https://opentelemetry.io/blog/2024/llm-observability/) as an exemplary integration. [OpenInference by Arize](https://github.com/Arize-ai/phoenix) provides framework-specific instrumentors like `LlamaIndexInstrumentor` that capture all RAG pipeline operations as OTel spans.

[LlamaIndex natively supports OpenTelemetry](https://developers.llamaindex.ai/python/framework/module_guides/observability/), describing it as tracing "all the events produced by pieces of LlamaIndex code, including LLMs, Agents, RAG pipeline components and many more." [LangSmith now accepts OTel ingestion](https://blog.langchain.com/opentelemetry-langsmith/) via `LANGSMITH_OTEL_ENABLED=true`, allowing teams to send traces to both LangSmith for qualitative debugging and Prometheus/Grafana for quantitative monitoring.

### Where traces flow: backend options

Traces generated by OpenTelemetry can be consumed by multiple backends simultaneously. [Arize Phoenix](https://arize.com/docs/phoenix) is purpose-built for LLM trace analysis, offering UMAP embedding visualizations and pre-built RAG evaluators that run directly on ingested traces. [Datadog LLM Observability](https://docs.datadoghq.com/llm_observability/) correlates LLM traces with APM and infrastructure metrics, and supports [native RAGAS evaluation](https://docs.datadoghq.com/llm_observability/evaluations/ragas_evaluations/) configured via environment variable: `DD_LLMOBS_EVALUATORS="ragas_faithfulness,ragas_context_precision,ragas_answer_relevancy"`. For open-source stacks, [Grafana Cloud recommends](https://grafana.com/blog/2024/07/18/a-complete-guide-to-llm-observability-with-opentelemetry-and-grafana-cloud/) using OpenLIT to emit OTel traces and metrics into Grafana's Tempo (traces) and Mimir (metrics) backends.

## Alerting that catches degradation without causing fatigue

The [Google SRE book](https://sre.google/sre-book/monitoring-distributed-systems/) is blunt about alert quality: "When pages occur too frequently, employees second-guess, skim, or even ignore incoming alerts." For RAG systems, where degradation is often gradual and multi-dimensional, poorly designed alerting produces constant noise from metric fluctuations that don't represent real problems.

### SLO-based alerting with burn rates

The [Google SRE Workbook](https://sre.google/workbook/alerting-on-slos/) recommends **multi-window, multi-burn-rate alerts** as the optimal approach. A burn rate measures how fast a service consumes its error budget relative to the SLO window. For a 99.9% availability SLO over 30 days, a burn rate of 1 means the budget is consumed exactly at the end of the window; a burn rate of 10 exhausts it in 3 days; a burn rate of 1000 (total outage) exhausts it in **43 minutes**.

The recommended configuration uses three alert tiers with both fast and slow windows:

| Budget consumed | Time window | Burn rate | Action |
|---|---|---|---|
| 2% | 1 hour | 14.4× | **Page** |
| 5% | 6 hours | 6× | **Page** |
| 10% | 3 days | 1× | **Ticket** |

Expressed as a [Prometheus alerting rule](https://sre.google/workbook/alerting-on-slos/):

```yaml
# Page-worthy: fast burn
- alert: RAGHighBurnRate
  expr: |
    (
      job:slo_errors_per_request:ratio_rate1h{job="rag-api"} > (14.4 * 0.001)
    or
      job:slo_errors_per_request:ratio_rate6h{job="rag-api"} > (6 * 0.001)
    )
  labels:
    severity: page
  annotations:
    summary: "RAG error budget burning fast — SLO at risk"

# Ticket-worthy: slow burn
- alert: RAGSlowBurnRate
  expr: job:slo_errors_per_request:ratio_rate3d{job="rag-api"} > 0.001
  labels:
    severity: ticket
```

[Grafana Cloud auto-generates similar rules](https://grafana.com/docs/grafana-cloud/alerting-and-irm/slo/create/) with slightly different windows: a fast-burn alert at **14.4× over 5min AND 1h**, and a slow-burn alert at **3× over 2h AND 24h**. The dual-window requirement (short window AND long window) prevents firing on brief transient spikes—the short window detects onset, and the long window confirms persistence.

For RAG-specific SLOs, define targets across multiple dimensions:

- **Availability**: 99.5%–99.9% of queries return non-error responses
- **Latency**: 99% of queries complete under 3 seconds end-to-end
- **Retrieval quality**: Context precision ≥ 0.7 on sampled queries (measured via [RAGAS evaluators](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_precision/))
- **Faithfulness**: Groundedness score ≥ 0.65 on sampled queries

### Anomaly detection for gradual degradation

Burn-rate alerts catch acute failures but miss slow quality drift. [Z-score-based anomaly detection in PromQL](https://omarghader.github.io/prometheus-anomaly-detection-z-score-in-promql/) fills this gap. The formula `(current - mean) / stddev` flags values beyond a configurable threshold (typically 3σ for alerts, 2σ for warnings). [GitLab's production implementation](https://about.gitlab.com/blog/anomaly-detection-using-prometheus/) uses a **1-week baseline** with recording rules:

```yaml
# Recording rules for baseline statistics
- record: rag:faithfulness:avg_over_time_1w
  expr: avg_over_time(rag_faithfulness_score[1w])
- record: rag:faithfulness:stddev_over_time_1w
  expr: stddev_over_time(rag_faithfulness_score[1w])

# Alert on anomalous faithfulness drop
- alert: RAGFaithfulnessAnomaly
  expr: |
    (
      rag_faithfulness_score - rag:faithfulness:avg_over_time_1w
    ) / rag:faithfulness:stddev_over_time_1w
    < -3
  for: 15m
  labels:
    severity: warning
  annotations:
    summary: "RAG faithfulness score dropped >3σ below weekly baseline"
```

[Grafana Labs' anomaly detection framework](https://grafana.com/blog/2024/10/03/how-to-use-prometheus-to-efficiently-detect-anomalies-at-scale/) recommends a **1-hour window** as the sweet spot for short-term detection, with reusable recording rules tagged by `anomaly_name` and `anomaly_type` labels.

### Canary queries as a proactive health check

Canary (synthetic) queries are the RAG equivalent of health check endpoints—they verify the full pipeline against known-good answers on a schedule. The approach works as follows.

Maintain a **canonical set of 50–100 domain-specific queries** with expected document IDs and reference answers. Run canaries every **1–5 minutes** for critical systems. For each canary, validate that the correct documents appear in retrieved results, that the generated answer achieves faithfulness ≥ 0.7 against the expected answer, and that end-to-end latency stays under threshold. [Synthetic QA pairs can be generated](https://aws.amazon.com/blogs/machine-learning/generate-synthetic-data-for-evaluating-rag-systems-using-amazon-bedrock/) from your actual knowledge base at roughly **$2.80 per 1,000 pairs** using small models.

```yaml
- alert: RAGCanaryMissing
  expr: absent(rate(rag_canary_queries_total[5m]))
  for: 10m
  labels:
    severity: critical
  annotations:
    summary: "RAG canary metrics missing — pipeline may be broken"

- alert: RAGCanaryLowFaithfulness
  expr: rag_canary_faithfulness_score < 0.7
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Canary faithfulness below 0.7 — generation quality degraded"
```

A critical feedback loop: [production experience at DoorDash](https://www.zenml.io/llmops-database/building-a-high-quality-rag-based-support-system-with-llm-guardrails-and-quality-monitoring) showed that adding **5 real user failure cases per week** to the canary test suite drives continuous improvement. Their two-tiered guardrail system—a low-cost semantic similarity check (threshold 0.9) followed by deeper LLM-powered grounding review—achieved a **90% reduction in hallucinations** and 99% decrease in severe compliance issues across thousands of daily support requests.

### Preventing alert fatigue with tiered routing

[Prometheus Alertmanager](https://www.netdata.cloud/academy/prometheus-alert-manager/) provides three noise-reduction mechanisms that map directly to RAG monitoring needs. **Grouping** consolidates related alerts—a vector database outage triggering failures across all retrieval queries becomes a single grouped notification rather than hundreds. **Inhibition** suppresses downstream alerts when a root cause is already firing—if `VectorDBUnreachable` is active, suppress all `RetrievalLatencyHigh` and `EmptyResultRate` warnings. **Silences** provide time-bounded muting during planned maintenance like index rebuilds.

The [Google SRE tiered model](https://sre.google/sre-book/monitoring-distributed-systems/) assigns alerts to three destinations: **page** (burn rate > 6×, canary failures), **ticket** (slow burn, quality drift beyond 2σ), and **dashboard** (everything else). [Prometheus documentation](https://prometheus.io/docs/practices/alerting/) reinforces this: "alert on high latency and error rates as high up in the stack as possible" and "allow for slack in alerting to accommodate small blips."

## Dashboard design for RAG operations

A well-designed dashboard tells the on-call engineer within 10 seconds whether the system is healthy, and within 60 seconds where to look if it isn't. Based on [production dashboard patterns](https://apxml.com/courses/optimizing-rag-for-production/chapter-6-advanced-rag-evaluation-monitoring/rag-system-health-dashboards) and the [Grafana + Prometheus + LangSmith integration pattern](https://activewizards.com/blog/llm-observability-a-guide-to-monitoring-with-langsmith), organize panels in five rows of descending urgency.

**Row 1 — System health**: Request volume time series (`rate(rag_queries_total[5m])`), overall error rate gauge, p90 end-to-end latency time series. These panels answer "is the system alive and performing?"

**Row 2 — Retrieval performance**: Retrieval latency breakdown (embedding vs. vector search vs. re-ranking as stacked bars), hit rate gauge targeting ≥ 0.95, empty result rate counter. These panels answer "is the retrieval layer finding relevant documents?"

**Row 3 — Generation quality**: Faithfulness score weekly rolling average (bar chart), hallucination rate indicator (gauge with color coding: green < 5%, yellow 5–15%, red > 15%), answer relevancy trend line. Quality panels should use [RAGAS batch evaluation](https://langfuse.com/guides/cookbook/evaluation_of_rag_with_ragas) results pushed to Prometheus via a pushgateway.

**Row 4 — Cost and tokens**: Token consumption over time (input vs. output, stacked area), cost per query trend, model usage frequency breakdown. [Helicone](https://www.helicone.ai/) and [LangSmith](https://www.langchain.com/langsmith/observability) both compute per-trace costs automatically.

**Row 5 — Data health and drift**: Index freshness gauge (`time() - rag_index_last_updated_timestamp`), embedding drift indicator from [Evidently AI](https://www.evidentlyai.com/llm-guide/rag-evaluation) (ROC AUC > 0.55 signals distribution shift), ingestion pipeline error rate.

## Continuous evaluation in production

Running quality evaluations on every production request is cost-prohibitive. The practical approach, documented across [RAGAS](https://docs.ragas.io/en/v0.1.21/getstarted/monitoring.html), [Langfuse](https://langfuse.com/guides/cookbook/evaluation_of_rag_with_ragas), and [Datadog](https://docs.datadoghq.com/llm_observability/evaluations/ragas_evaluations/), is to **sample 10–20% of production traffic** for automated evaluation. Two strategies coexist: per-trace scoring (higher cost, granular insight) and batch scoring on periodic samples (lower cost, statistical trends).

[Arize Phoenix](https://arize.com/blog/mastering-production-rag-with-google-adk-and-arize-ax-for-enterprise-knowledge-systems/) offers **automatic online evaluation** where evaluators run on ingested traces at production volume, with monitors that fire notifications to Slack, PagerDuty, or OpsGenie when quality metrics degrade. [Datadog's RAGAS integration](https://docs.datadoghq.com/llm_observability/guide/ragas_quickstart/) enables sampling-based evaluation with a single environment variable and supports continuous float scores tagged with metadata for fine-grained analysis.

For self-hosted stacks, [Evidently AI](https://www.evidentlyai.com/blog/open-source-rag-evaluation-tool) (25M+ downloads, Apache 2.0) provides 100+ built-in evaluations including LLM-as-judge faithfulness, per-chunk relevance scoring, and text drift detection. Its test suite model supports CI/CD integration via [GitHub Actions](https://www.evidentlyai.com/rag-testing), enabling automated quality gates before deployment.

## Conclusion

Three architectural patterns emerge from production RAG monitoring. First, **instrument with OpenTelemetry semantic conventions** from day one—the `retrieval`, `embeddings`, and `chat` span types provide a standardized vocabulary that avoids vendor lock-in while enabling traces to flow to Phoenix, Datadog, Grafana, or LangSmith simultaneously. Second, **define SLOs across both operational and quality dimensions**, then use multi-window burn-rate alerts to convert those SLOs into actionable pages and tickets rather than threshold-based noise. Third, **layer canary queries on top of passive monitoring**—synthetic probes with known-good answers catch silent failures that no amount of latency tracking will reveal, and the DoorDash case study demonstrates that a feedback loop from real failures into the canary suite compounds improvement over time. The organizations achieving the best outcomes combine a specialized LLM tracing tool for qualitative debugging, Prometheus for quantitative metrics, and automated RAGAS evaluation on sampled traffic to close the quality loop.

## Bibliography

- **Google SRE Book, Chapter 6: Monitoring Distributed Systems** — https://sre.google/sre-book/monitoring-distributed-systems/ — Defines the four golden signals framework and alert design philosophy for production services.
- **Google SRE Workbook, Chapter 5: Alerting on SLOs** — https://sre.google/workbook/alerting-on-slos/ — Provides multi-window, multi-burn-rate alerting configurations and error budget calculations.
- **OpenTelemetry GenAI Semantic Conventions (Spans)** — https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/ — Defines standardized span types and attributes for LLM, embedding, retrieval, and tool operations.
- **OpenTelemetry GenAI Attribute Registry** — https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/ — Complete list of `gen_ai.*` attributes for instrumentation.
- **OpenTelemetry Node.js SDK Getting Started** — https://opentelemetry.io/docs/languages/js/getting-started/nodejs/ — Setup guide for the Node.js SDK with BatchSpanProcessor and OTLP exporter.
- **OpenTelemetry Node.js Instrumentation Guide** — https://opentelemetry.io/docs/languages/js/instrumentation/ — Manual span creation, context propagation, and attribute patterns.
- **RAGAS Faithfulness Metric** — https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/faithfulness/ — Defines the claims-based faithfulness formula and HHEM-2.1-Open alternative.
- **RAGAS Context Precision Metric** — https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_precision/ — LLM and non-LLM variants for measuring retrieval signal-to-noise ratio.
- **RAGAS Metrics Overview** — https://docs.ragas.io/en/stable/concepts/metrics/overview/ — Complete taxonomy of retrieval, generation, and end-to-end metrics.
- **RAGAS Production Monitoring Guide** — https://docs.ragas.io/en/v0.1.21/getstarted/monitoring.html — Architecture for continuous monitoring and cost-effective evaluation strategies.
- **Datadog LLM Observability Documentation** — https://docs.datadoghq.com/llm_observability/ — Platform capabilities for LLM tracing, evaluation, and anomaly detection.
- **Datadog RAGAS Evaluations** — https://docs.datadoghq.com/llm_observability/evaluations/ragas_evaluations/ — Native RAGAS integration with sampling support and environment variable configuration.
- **Datadog Hallucination Detection** — https://www.datadoghq.com/blog/llm-observability-hallucination-detection/ — Distinguishes contradictions from unsupported claims in LLM outputs.
- **Arize Phoenix Documentation** — https://arize.com/docs/phoenix — OTel-native LLM observability with pre-built RAG evaluators and embedding analysis.
- **Arize Production RAG with Google ADK** — https://arize.com/blog/mastering-production-rag-with-google-adk-and-arize-ax-for-enterprise-knowledge-systems/ — Automatic online evaluation, custom monitors, and Slack/PagerDuty integration.
- **Evidently AI RAG Evaluation Guide** — https://www.evidentlyai.com/llm-guide/rag-evaluation — Comprehensive guide covering precision@k, recall@k, drift detection, and LLM-as-judge evaluations.
- **Evidently AI RAG Testing** — https://www.evidentlyai.com/rag-testing — CI/CD integration and test suite model for RAG quality gates.
- **LangSmith Observability** — https://www.langchain.com/langsmith/observability — Tracing, monitoring dashboards, and OpenTelemetry ingestion support.
- **LangSmith OpenTelemetry Support** — https://blog.langchain.com/opentelemetry-langsmith/ — OTel trace ingestion for framework-agnostic LLM monitoring.
- **Grafana LLM Observability Guide** — https://grafana.com/blog/2024/07/18/a-complete-guide-to-llm-observability-with-opentelemetry-and-grafana-cloud/ — OpenLIT + Grafana Cloud integration pattern for LLM dashboards.
- **Grafana SLO Burn Rate Alerts** — https://grafana.com/docs/grafana-cloud/alerting-and-irm/slo/create/ — Default fast-burn and slow-burn alert configurations.
- **Grafana Anomaly Detection Framework** — https://grafana.com/blog/2024/10/03/how-to-use-prometheus-to-efficiently-detect-anomalies-at-scale/ — Reusable recording rule framework for Prometheus-based anomaly detection.
- **OpenLLMetry by Traceloop** — https://github.com/traceloop/openllmetry — Auto-instrumentation for OpenAI, Anthropic, Pinecone, LangChain via OpenTelemetry.
- **OpenLIT** — https://github.com/openlit/openlit — One-line LLM observability supporting 44+ providers with OTel GenAI conventions.
- **OpenTelemetry Blog: LLM Observability** — https://opentelemetry.io/blog/2024/llm-observability/ — Overview of the LLM observability ecosystem and OpenLIT integration.
- **Prometheus Alerting Best Practices** — https://prometheus.io/docs/practices/alerting/ — Alert on symptoms, allow slack for blips, avoid pages with no action.
- **Z-Score Anomaly Detection in PromQL** — https://omarghader.github.io/prometheus-anomaly-detection-z-score-in-promql/ — Implementation of statistical anomaly detection using native PromQL.
- **GitLab Anomaly Detection with Prometheus** — https://about.gitlab.com/blog/anomaly-detection-using-prometheus/ — Production 1-week baseline Z-score pattern with recording rules.
- **Prometheus Alertmanager Noise Reduction** — https://www.netdata.cloud/academy/prometheus-alert-manager/ — Grouping, inhibition, and silence mechanisms for alert fatigue prevention.
- **DoorDash RAG Support System Case Study** — https://www.zenml.io/llmops-database/building-a-high-quality-rag-based-support-system-with-llm-guardrails-and-quality-monitoring — Two-tiered guardrail achieving 90% hallucination reduction in production.
- **Embedding Drift in RAG Systems** — https://dev.to/dowhatmatters/embedding-drift-the-quiet-killer-of-retrieval-quality-in-rag-systems-4l5m — Silent failure mode from mixing embedding model versions.
- **RAG Monitoring with Prometheus** — https://app.ailog.fr/en/blog/guides/rag-monitoring — Practical Prometheus counter/histogram/gauge patterns for RAG pipelines.
- **RAG Health Dashboards** — https://apxml.com/courses/optimizing-rag-for-production/chapter-6-advanced-rag-evaluation-monitoring/rag-system-health-dashboards — Dashboard panel recommendations and metric instrumentation patterns.
- **Helicone LLM Observability** — https://www.helicone.ai/ — Proxy-based monitoring with built-in caching and cost tracking.
- **RAGAS + Langfuse Cookbook** — https://langfuse.com/guides/cookbook/evaluation_of_rag_with_ragas — Batch and per-trace evaluation strategies for production RAGAS monitoring.
- **LlamaIndex Observability** — https://developers.llamaindex.ai/python/framework/module_guides/observability/ — Native OpenTelemetry support for all RAG pipeline components.
- **Galileo RAG Performance Metrics** — https://galileo.ai/blog/top-metrics-to-monitor-and-improve-rag-performance — Latency budget breakdown by RAG pipeline component.
- **LLM Monitoring with Prometheus and Grafana** — https://www.glukhov.org/observability/monitoring-llm-inference-prometheus-grafana/ — PromQL patterns for LLM inference metrics including KV cache and inter-token latency.
- **LangSmith + Prometheus + Grafana Integration** — https://activewizards.com/blog/llm-observability-a-guide-to-monitoring-with-langsmith — The "golden triad" approach combining qualitative and quantitative monitoring.