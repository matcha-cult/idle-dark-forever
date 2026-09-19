/**
 * `/testing` 子路径：假适配器 + mock 服务端（供本包单测与 `packages/web` 测试复用）。
 * 生产代码不应 import 本入口。
 */
export {
  FakeSocketAdapter,
  FakeSocketAdapterFactory,
  type FakeSocketOptions,
  type MockSocketDriver,
} from './fake-socket-adapter.js';
export {
  MemoryIonetServer,
  businessFail,
  businessOk,
  createFakePair,
  type MemoryIonetServerOptions,
  type MockHandler,
  type MockReply,
  type MockRequest,
} from './memory-ionet-server.js';
