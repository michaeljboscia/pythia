# Distributed Tracing and OpenTelemetry Patterns for Multi-Process AI Systems

**Source:** Gemini Deep Research
**Research ID:** `v1_ChdScVd2YVlXU0U2bTUtc0FQdnBIdS1RdxIXUnFXdmFZV1NFNm01LXNBUHZwSHUtUXc`
**Duration:** ~10m
**Date:** 2026-03-10
**Full JSON:** `/Users/mikeboscia/.config/gemini-mcp/output/70b111f4e884af1f/deep-research-2026-03-10T05-12-11-680Z.json`

---

## Key Points

- **W3C Trace Context** defines two HTTP headers (`traceparent` and `tracestate`) for cross-process trace correlation — `traceparent` format: `version-trace_id-parent_id-trace_flags` (e.g., `00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01`)
- **OpenTelemetry GenAI semantic conventions** are experimental — opt-in via `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental`; covers Anthropic, OpenAI, AWS Bedrock, Azure, and MCP
- **Baggage propagation** carries domain-specific metadata (oracle.id, corpus.version) across service boundaries — separate from span attributes, must be explicitly read and attached
- **Log-trace correlation** via `trace_id`/`span_id` injection into JSONL audit logs enables pivot from tracing UI to exact prompt/response payloads
- **GenAI metrics:** `gen_ai.client.token.usage` (cost tracking), `gen_ai.client.operation.duration` (latency), `gen_ai.server.time_per_output_token` (streaming speed), `gen_ai.server.time_to_first_token` (prompt processing)

---

## 1. OpenTelemetry Conceptual Model

### 1.1 Traces and Spans
- **Trace** = complete lifecycle of a single operation across a distributed system (DAG of spans)
- **Span** = single unit of work with start/end time, unique ID, contextual attributes
- AI workflow trace: `chat_request` → `vector_search` → `prompt_assembly` → `llm_inference` → `response_parsing`

### 1.2 Context Propagation
- Mechanism for transmitting trace identifiers across process boundaries (HTTP, gRPC, message queues)
- Orchestrator injects context into outgoing request → receiving service extracts and creates child spans

---

## 2. W3C Trace Context Standard

### 2.1 traceparent Header
- **Format:** `version-trace_id-parent_id-trace_flags` (4 dash-delimited fields)
  - `version`: 1 byte (2 hex chars), currently `00`
  - `trace_id`: 16 bytes (32 hex chars) — uniquely identifies entire distributed trace
  - `parent_id`: 8 bytes (16 hex chars) — identifies specific caller span
  - `trace_flags`: 1 byte (2 hex chars) — LSB = `sampled` flag
- All zeros for trace_id or parent_id = invalid
- Must be sent lowercase, accepted in any case

### 2.2 tracestate Header
- Comma-separated list of up to 32 key-value pairs for vendor-specific trace data
- Keys: up to 256 chars, can use multi-tenant format (`tenant-id@system-id`)
- Values: up to 256 printable ASCII chars
- Propagate at least 512 chars combined; truncate whole entries if needed

### 2.3 Propagation Architecture

```
[ Client ] → traceparent: 00-{trace_id}-{span_a}-01
    ↓
[ Orchestrator ] extracts trace_id, creates child span_b
    ↓ traceparent: 00-{trace_id}-{span_b}-01
[ LLM Gateway ] extracts trace_id, creates child span_c
```

---

## 3. Span Instrumentation for LLM Operations

### 3.1 GenAI Semantic Conventions
- Under active development — opt-in: `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental`
- Technology-specific conventions for: Anthropic, Azure AI, AWS Bedrock, OpenAI, MCP
- Covers: inputs, outputs, operations, model spans, agent spans

### 3.2 Key Span Attributes

| Phase | Attributes |
|-------|-----------|
| **Prompt Construction** | `gen_ai.system`, `gen_ai.request.model`, `gen_ai.prompt` (truncated/hashed) |
| **Model Inference** | Temperature, top-p, max_tokens; span open until final streaming chunk |
| **Response Parsing** | Isolates app-side parsing latency from model provider latency |

---

## 4. GenAI Metrics

### 4.1 Client Metrics
- **`gen_ai.client.token.usage`** — aggregate input/output token counts (cost allocation, quota management)
- **`gen_ai.client.operation.duration`** — overall duration from client perspective (required)

### 4.2 Server Metrics (for self-hosted models)
- **`gen_ai.server.request.duration`** — model server latency per request
- **`gen_ai.server.time_per_output_token`** — latency per token after first token (perceived streaming speed)
- **`gen_ai.server.time_to_first_token`** — time to generate first token (prompt processing time)

### 4.3 Error Rate Monitoring
- Tag counters with operation type (`vector_search`, `chat_completion`, `embedding_generation`) + model version
- Enables targeted alerts (e.g., spike in 429s specifically for embedding operations)

---

## 5. Baggage Propagation

### 5.1 The Baggage API
- Key-value store for propagating domain-specific metadata across services
- **Separate from span attributes** — not automatically associated with telemetry signals
- Must explicitly read Baggage and append to span/metric/log attributes
- Best for data available at request start: User ID, Account ID, Product ID, origin IP

### 5.2 AI-Specific Baggage Fields
- **Oracle ID:** Routing rules / prompt generation logic identifier
- **Generation Number:** Conversation depth (turn 1, turn 2, ...)
- **Corpus Version:** Version hash of vector database index

### 5.3 Baggage Span Processors
- Automatically extract Baggage key-value pairs → attach as span attributes on span creation
- Available in multiple language SDKs
- Deep backend systems log `corpus.version` without explicit instrumentation

---

## 6. Log-Trace Correlation

### 6.1 JSONL Audit Logs
- Every log line = standalone parsable JSON object
- Capture: timestamp, severity, raw prompt, model config, raw output

### 6.2 Correlation Architecture
1. Application initiates trace → OTel generates `trace_id`
2. Custom log formatter intercepts logging calls
3. Formatter queries `opentelemetry.context.active()` for current span context
4. `trace_id` and `span_id` appended to JSON payload
5. JSONL written to stdout
6. Log aggregator (FluentBit/Vector) ingests → forwards to indexer (OpenSearch)
7. Analyst views slow span → pivots to OpenSearch filtering `trace_id: <ID>` → sees exact prompt

### 6.3 Recommended JSONL Structure

```json
{
  "timestamp": "2023-10-27T14:32:01.123Z",
  "level": "INFO",
  "service": "ai-orchestrator",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7",
  "baggage": {
    "oracle.id": "route-v2",
    "corpus.version": "v2.4.1"
  },
  "ai_payload": {
    "operation": "chat_completion",
    "model": "gpt-4-turbo",
    "parameters": { "temperature": 0.7, "max_tokens": 1500 },
    "input_prompt_hash": "a1b2c3d4e5f6...",
    "completion_text": "The observable universe is...",
    "token_usage": { "input": 14, "output": 128 }
  }
}
```

---

## 7. JSONL Schema Design Rules

1. **Immutability:** Append-only. Never update a written record. If response flagged post-generation, write new event referencing original `span_id`
2. **Context Injection:** Every record must contain `trace_id` and `span_id` at top level
3. **Data Segregation:** Separate operational metadata from AI payload (nested `ai_payload` object)
4. **Redaction Pipeline:** Implement at logger level before stringify — don't rely on downstream scrubbing

---

## 8. Observability Backends Comparison

| Feature | Jaeger | Zipkin | Cloud-Native (Datadog, Honeycomb, GCP) |
|---------|--------|--------|----------------------------------------|
| **Architecture** | Go, Cassandra/ES | Java, Cassandra/ES | Managed SaaS |
| **Log/Metric Correlation** | Limited | None native | Deep native correlation |
| **Query Capabilities** | DAG viz, basic tags | Basic dependency mapping | High-cardinality, anomaly detection |
| **Ops Overhead** | High (manage storage + collectors) | Medium | Low (but high ingest costs) |
| **AI Suitability** | Good for architecture bottlenecks | Basic routing visibility | Excellent for token metrics + latency |

---

## 9. TypeScript SDK Implementation

### 9.1 Initialization

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { Resource } from '@opentelemetry/resources';

process.env.OTEL_SEMCONV_STABILITY_OPT_IN = 'gen_ai_latest_experimental';

const sdk = new NodeSDK({
  resource: new Resource({
    'service.name': 'ai-orchestrator-service',
    'service.version': '1.0.0',
  }),
  traceExporter: new OTLPTraceExporter({ url: 'http://localhost:4318/v1/traces' }),
});
sdk.start();
```

### 9.2 Baggage + LLM Instrumentation

```typescript
import { trace, context, propagation, SpanStatusCode, metrics } from '@opentelemetry/api';

const tracer = trace.getTracer('ai-orchestrator-tracer');
const meter = metrics.getMeter('ai-orchestrator-meter');

const tokenUsage = meter.createCounter('gen_ai.client.token.usage');
const opDuration = meter.createHistogram('gen_ai.client.operation.duration', { unit: 'ms' });

async function executeLLMChain(prompt: string, oracleId: string) {
  // Set baggage
  const baggage = propagation.createBaggage({
    'oracle.id': { value: oracleId },
    'corpus.version': { value: 'v2.4.1' }
  });
  const ctx = propagation.setBaggage(context.active(), baggage);

  return tracer.startActiveSpan('orchestrate_interaction', {}, ctx, async (rootSpan) => {
    const start = Date.now();
    try {
      const result = await tracer.startActiveSpan('llm_inference', async (span) => {
        span.setAttribute('gen_ai.system', 'openai');
        span.setAttribute('gen_ai.request.model', 'gpt-4');
        span.setAttribute('oracle.id', oracleId);

        const response = await callLLM(prompt);
        tokenUsage.add(response.usage.input, { 'gen_ai.token.type': 'input' });
        tokenUsage.add(response.usage.output, { 'gen_ai.token.type': 'output' });
        span.end();
        return response;
      });
      opDuration.record(Date.now() - start, { 'gen_ai.system': 'openai' });
      return result;
    } finally {
      rootSpan.end();
    }
  });
}
```

---

## Recommendations for Pythia

1. **Pythia's JSONL interaction log should include `trace_id` and `span_id` fields** — even without a full OTel deployment, generating a unique trace_id per oracle query creates correlation keys for debugging multi-step reasoning chains
2. **Baggage propagation maps directly to Pythia's oracle metadata** — `oracle.id`, `generation` (v1/v2/v3), and `corpus_hash` should be propagated through the MCP tool chain so checkpoint extraction can trace back to the exact corpus state
3. **`gen_ai.client.token.usage` is the right metric for pressure monitoring** — Pythia already tracks `tokens_used` / `tokens_remaining`; formalizing this as an OTel counter enables standard dashboards
4. **Start with structured JSONL + trace_id injection** (zero infrastructure) before deploying full OTel SDK — Pythia's existing JSONL format needs only 2 additional fields to become trace-correlated
5. **GenAI semantic conventions for MCP** are defined but experimental — when Pythia's MCP tools emit telemetry, use the MCP-specific conventions for tool invocation spans
6. **Jaeger is the right backend for single-host Pythia** — lightweight Go binary, Badger storage (no external DB), sufficient for debugging LLM pipeline bottlenecks without cloud cost
