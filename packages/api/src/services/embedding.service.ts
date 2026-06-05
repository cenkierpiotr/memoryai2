import { config } from '../config.js';

interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

class OllamaEmbeddingProvider implements EmbeddingProvider {
  private baseUrl: string;
  private model: string;

  constructor() {
    this.baseUrl = config.embedding.ollamaBaseUrl;
    this.model = config.embedding.ollamaModel;
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: text }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Ollama embed failed: ${res.status} ${await res.text()}`);
    const data = await res.json() as { embeddings: number[][] };
    return data.embeddings[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: texts }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Ollama batch embed failed: ${res.status} ${await res.text()}`);
    const data = await res.json() as { embeddings: number[][] };
    return data.embeddings;
  }
}

class GeminiEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string;
  private model: string;

  constructor() {
    this.apiKey = config.embedding.geminiApiKey;
    this.model = config.embedding.geminiModel;
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:embedContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify({ content: { parts: [{ text }] } }),
        signal: AbortSignal.timeout(30_000),
      }
    );
    if (!res.ok) throw new Error(`Gemini embed failed: ${res.status} ${await res.text()}`);
    const data = await res.json() as { embedding: { values: number[] } };
    return data.embedding.values;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(t => this.embed(t)));
  }
}

class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string;
  private model: string;

  constructor() {
    this.apiKey = config.embedding.openaiApiKey;
    this.model = config.embedding.openaiModel;
  }

  async embed(text: string): Promise<number[]> {
    const [result] = await this.embedBatch([text]);
    return result;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: texts }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`OpenAI embed failed: ${res.status} ${await res.text()}`);
    const data = await res.json() as { data: Array<{ embedding: number[] }> };
    return data.data.map(d => d.embedding);
  }
}

function createProvider(): EmbeddingProvider {
  switch (config.embedding.provider) {
    case 'gemini': return new GeminiEmbeddingProvider();
    case 'openai': return new OpenAIEmbeddingProvider();
    default: return new OllamaEmbeddingProvider();
  }
}

const provider = createProvider();

// Asymmetric retrieval prefixes — documents stored plain, queries use prefix
// mxbai: https://huggingface.co/mixedbread-ai/mxbai-embed-large-v1
// qwen3: https://huggingface.co/Qwen/Qwen3-Embedding
const MXBAI_QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';
const QWEN3_QUERY_PREFIX = 'Instruct: Given a query, retrieve relevant passages that answer the query\nQuery: ';

function applyQueryPrefix(text: string): string {
  const model = config.embedding.ollamaModel;
  if (config.embedding.provider !== 'ollama') return text;
  if (model.includes('mxbai')) return `${MXBAI_QUERY_PREFIX}${text}`;
  if (model.includes('qwen3-embedding')) return `${QWEN3_QUERY_PREFIX}${text}`;
  return text;
}

export const embeddingService = {
  embed: (text: string) => provider.embed(text),
  embedBatch: (texts: string[]) => provider.embedBatch(texts),

  // Use asymmetric query prefix for search (improves recall by ~15-20% for mxbai)
  embedQuery: (query: string) => provider.embed(applyQueryPrefix(query)),

  // Format embedding array as pgvector literal
  toVectorLiteral: (embedding: number[]): string => `[${embedding.join(',')}]`,
};
