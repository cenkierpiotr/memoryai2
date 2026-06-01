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
    attempts: 3,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});

distillationQueue.add = async function (data: DistillationJob) {
  return Queue.prototype.add.call(this, 'distill', data, {
    delay: 5_000,
    jobId: `distill:${data.sessionId}`,
  });
};

export { Worker, connection };
