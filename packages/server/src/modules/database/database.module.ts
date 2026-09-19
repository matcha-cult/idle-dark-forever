/**
 * 数据库模块（@Global）
 *
 * 提供 `DatabaseService`（pg.Pool + query + connect）。设为全局是因为
 * auth / character 等 HTTP 模块与后续游戏域都需要它，而它不依赖任何业务域。
 */
import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service.js';

@Global()
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
