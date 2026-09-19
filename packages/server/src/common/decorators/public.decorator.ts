import { SetMetadata } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../guards/jwt-auth.guard.js';

/** 标记接口 / 控制器为公开，不经过全局 JWT Guard。 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
