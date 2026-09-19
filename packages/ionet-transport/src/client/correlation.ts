/**
 * 请求 ↔ 响应关联策略（PROTOCOL.md §4.1）。
 *
 * - `'reqId'`（**默认**）：每个请求生成唯一 `reqId`，服务端原样回显 + `kind='response'`，
 *   由 `@nbb-ionet/client-protocol` 的 `RequestResponseAssociator` **精确配对**，
 *   因此同连接可并发多请求、乱序回包也不会错配。
 * - `'serial'`（兜底/调试）：请求不带 `reqId`，响应逐字节不变（无 `reqId`/`kind`，PROTOCOL §12.1），
 *   由 client 强制「同一时刻仅 1 个在途请求」，关联器退化为最早在途 FIFO。
 *
 * 配对算法**不在此重造**：直接复用 client-protocol。
 */
import {
  RequestResponseAssociator,
  type AssociateMiss,
  type AssociateOk,
  type PendingRequest,
  type WireFrame,
} from '@nbb-ionet/client-protocol';

export type CorrelationStrategy = 'reqId' | 'serial';

export interface CorrelationBeginResult {
  /** 本次请求要写入信封的 reqId（`serial` 策略下为 undefined）。 */
  reqId: string | undefined;
  pending: PendingRequest;
}

let fallbackSeq = 0;

/** 默认 reqId 生成器：优先 `crypto.randomUUID`，否则时间戳 + 单调序号。 */
export function defaultReqIdGenerator(): () => string {
  return () => {
    const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (cryptoObj && typeof cryptoObj.randomUUID === 'function') return cryptoObj.randomUUID();
    fallbackSeq += 1;
    return `r-${Date.now().toString(36)}-${fallbackSeq}`;
  };
}

/** 关联器门面：把「策略」与 client-protocol 的配对算法解耦。 */
export class Correlation {
  private readonly associator = new RequestResponseAssociator();
  private readonly genReqId: () => string;

  constructor(
    readonly strategy: CorrelationStrategy = 'reqId',
    genReqId: () => string = defaultReqIdGenerator(),
  ) {
    this.genReqId = genReqId;
  }

  /** 本策略下请求是否携带 reqId。 */
  get usesReqId(): boolean {
    return this.strategy === 'reqId';
  }

  begin(): CorrelationBeginResult {
    const reqId = this.usesReqId ? this.genReqId() : undefined;
    const pending = this.associator.begin(reqId === undefined ? {} : { reqId });
    return { reqId, pending };
  }

  associate(frame: WireFrame): AssociateOk | AssociateMiss {
    return this.associator.associate(frame);
  }

  get pendingCount(): number {
    return this.associator.pendingCount;
  }

  /** 连接断开：清空全部在途（调用方据此做失败回调）。 */
  drain(): PendingRequest[] {
    return this.associator.drain();
  }
}
