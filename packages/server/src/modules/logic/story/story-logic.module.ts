/** 故事域模块（cmd 段 story）。 */
import { Module } from '@nestjs/common';
import { StoryAction } from './story.action.js';
import { StoryLogicService } from './story.logic.service.js';

@Module({
  providers: [StoryLogicService, StoryAction],
  exports: [StoryLogicService, StoryAction],
})
export class StoryLogicModule {}
