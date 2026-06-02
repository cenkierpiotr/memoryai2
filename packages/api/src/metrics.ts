import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();

collectDefaultMetrics({ register: registry });

export const memoriesSavedTotal = new Counter({
  name: 'memoryai_memories_saved_total',
  help: 'Total memories saved',
  labelNames: ['category', 'tier'],
  registers: [registry],
});

export const memoriesSearchTotal = new Counter({
  name: 'memoryai_memories_search_total',
  help: 'Total memory search requests',
  registers: [registry],
});

export const searchLatency = new Histogram({
  name: 'memoryai_search_latency_seconds',
  help: 'Memory search latency in seconds',
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [registry],
});

export const contextLoadTotal = new Counter({
  name: 'memoryai_context_load_total',
  help: 'Total context load requests',
  labelNames: ['cache_hit'],
  registers: [registry],
});

export const activeMemoriesGauge = new Gauge({
  name: 'memoryai_active_memories',
  help: 'Current count of non-cold memories',
  registers: [registry],
});
