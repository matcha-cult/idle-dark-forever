/**
 * 全局异常过滤器：把**未捕获异常**统一成项目约定的 `ActionResult` 失败体。
 *
 * 为什么需要：NestJS 默认把未捕获异常渲染成 `{"statusCode":500,"message":"Internal server error"}`，
 * 这既丢掉了机器可读的错误码，也与工程硬约束（AGENTS.md §5.1）不一致 ——
 * 业务失败必须是 `{success:false, message, data:{code}}`。
 *
 * 典型场景：数据库不可达时 `AuthService.login` 抛出 `ECONNREFUSED`。
 * 前端 `RestClient` 对 `!response.ok` 会抛 `RestError`（所以**不会**被误判为成功），
 * 但它拿到的文案是通用的 "Internal server error"，排障价值为零。
 * 本过滤器让响应带上 `code: 'INTERNAL'` 与 `detail.reason`，前端可展示可读文案。
 *
 * 状态码映射（保留 NestJS 语义，不把一切压成 200）：
 * - `HttpException` → 用其自身 status；400→`INVALID_PARAM`、401→`UNAUTHORIZED`、
 *   404→`NOT_FOUND`、429→`RATE_LIMITED`、其余≥500→`INTERNAL`
 * - 其他异常 → 500 + `INTERNAL`
 *
 * 安全：**只回显 `Error.message`，不回显堆栈**；生产环境（`NODE_ENV=production`）
 * 下额外的 detail 仍然保留 `reason`（它来自 Error.message，属于可公开的运维信息），
 * 但不写请求体等可能含敏感字段的内容。
 */
import { ArgumentsHost, Catch, HttpException, type ExceptionFilter, type LoggerService } from '@nestjs/common';
import { BusinessErrorCode, type ActionResult, type BusinessErrorPayload } from '@idle-dark/protocol';

interface HttpResponseLike {
  status(code: number): { json(body: unknown): void };
}

@Catch()
export class ActionResultExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger?: Pick<LoggerService, 'error'>) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<HttpResponseLike>();
    const { status, code } = classify(exception);
    const reason = describe(exception);

    this.logger?.error(`[unhandled] status=${status} code=${code} reason=${reason}`);
    if (this.logger === undefined) {
      console.error(`[idle-dark] 未捕获异常 status=${status} code=${code} reason=${reason}`);
    }

    const payload: BusinessErrorPayload = { code, detail: { reason } };
    const body: ActionResult<never> = {
      success: false,
      message: messageFor(status, code, reason),
      data: payload,
    };
    response.status(status).json(body);
  }
}

/** 异常 → (HTTP 状态码, 业务错误码)。 */
export function classify(exception: unknown): { status: number; code: string } {
  if (exception instanceof HttpException) {
    const status = normalizeStatus(exception.getStatus());
    if (status === 400) return { status, code: BusinessErrorCode.INVALID_PARAM };
    if (status === 401 || status === 403) return { status, code: BusinessErrorCode.UNAUTHORIZED };
    if (status === 404) return { status, code: BusinessErrorCode.NOT_FOUND };
    if (status === 429) return { status, code: BusinessErrorCode.RATE_LIMITED };
    return { status, code: BusinessErrorCode.INTERNAL };
  }
  return { status: 500, code: BusinessErrorCode.INTERNAL };
}

/** 只取可公开的简短原因，绝不回显堆栈。 */
export function describe(exception: unknown): string {
  if (exception instanceof HttpException) {
    const payload = exception.getResponse();
    if (typeof payload === 'string') return payload.slice(0, 300);
    if (payload !== null && typeof payload === 'object') {
      const message = (payload as { message?: unknown }).message;
      if (typeof message === 'string') return message.slice(0, 300);
      if (Array.isArray(message) && typeof message[0] === 'string') return message[0].slice(0, 300);
    }
    return exception.message.slice(0, 300);
  }
  if (exception instanceof Error) return exception.message.slice(0, 300);
  return typeof exception === 'string' ? exception.slice(0, 300) : '未知错误';
}

function messageFor(status: number, code: string, reason: string): string {
  if (status < 500) return reason;
  return '服务器开小差了，请稍后再试';
}

function normalizeStatus(status: number): number {
  if (!Number.isInteger(status) || status < 100 || status > 599) return 500;
  return status;
}
