import { Queue, Worker, type Job } from 'bullmq';
import { config } from '../config.js';

export interface DistillationJob {
  sessionId: string;
  userId: string;
}

const connection = {
  host: new URL(config.redis.url).hostname,
  port: parseInt(new URL(config.redis.url).port || '6379', 10),
  password: new URL(config.redis.url).password || undefined,
};

export const distillationQueue = new Queue<DistillationJob>('distillation', {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 15_000 },
    removeOnComplete: { count: 100 },
    // Remove failed jobs immediately so the stale-session checker can re-queue
    // them with the same jobId after a subsequent retry window.
    removeOnFail: true,
  },
});

export async function addDistillationJob(data: DistillationJob): Promise<Job<DistillationJob>> {
  // Fixed jobId deduplicates *pending* jobs — safe because removeOnFail:true
  // clears the failed entry, allowing the stale checker to re-queue freely.
  return distillationQueue.add('distill', data, {
    delay: 5_000,
    jobId: `distill-${data.sessionId}`,
  });
}

export { Worker, connection };
