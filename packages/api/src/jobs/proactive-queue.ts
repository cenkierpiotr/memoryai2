/**
 * Proactive conflict-detection queue.
 *
 * Enqueued after each distillation session to check whether
 * newly extracted memories contradict existing ones.
 */

import { Queue } from 'bullmq';
import { connection } from './distillation.queue.js';

export interface ProactiveCheckJob {
  /** IDs of memories that were just inserted by the distillation worker */
  newMemoryIds: string[];
  userId: string;
  sessionId: string;
}

export const proactiveQueue = new Queue<ProactiveCheckJob>('proactive-check', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 15_000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 100 },
  },
});

export async function addProactiveCheckJob(data: ProactiveCheckJob): Promise<void> {
  await proactiveQueue.add('conflict-check', data, {
    delay: 2_000,
    jobId: `proactive-${data.sessionId}`,
  });
}
