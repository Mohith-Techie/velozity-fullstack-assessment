import type { Prisma } from '../generated/prisma/client.js';
import { prisma } from './prisma.js';

export interface TxContext {
  tx: Prisma.TransactionClient;
  /** Runs `callback` once the transaction has committed, and never if it rolls back. */
  afterCommit(callback: () => void): void;
}

/**
 * `prisma.$transaction` plus after-commit hooks, for side effects such as real-time events: clients must
 * never hear about a write that later rolled back, or refetch before it's visible.
 */
export async function inTransaction<T>(work: (ctx: TxContext) => Promise<T>): Promise<T> {
  const pending: Array<() => void> = [];
  const result = await prisma.$transaction((tx) =>
    work({ tx, afterCommit: (callback) => void pending.push(callback) }),
  );
  for (const callback of pending) {
    try {
      callback();
    } catch (error) {
      console.error('after-commit hook failed', error); // the write is committed; don't fail the request
    }
  }
  return result;
}
