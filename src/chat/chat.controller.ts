import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';

import { User } from '@libs/entities';
import { ChatDTO } from './dto';
import { ChatResponse } from './interfaces';
import { ChatService } from './chat.service';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /**
   * Gets chat history for the authenticated user.
   *
   * @returns {Promise<ChatMessage[]>} Array of chat messages.
   */
  @Get('history')
  public async getHistory(@Req() req: Request & { user?: User }): Promise<
    Array<{
      id: number;
      role: string;
      content: string;
      detectedEndpoint: string | null;
      createdAt: Date;
    }>
  > {
    const user = req.user;
    if (!user) {
      throw new Error('User not found');
    }
    const messages = await this.chatService.getHistory(user.id);
    return messages.map((msg) => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      detectedEndpoint: msg.detectedEndpoint,
      createdAt: msg.createdAt,
    }));
  }

  /**
   * Handles user chat queries as an AI assistant.
   * Detects requests to Instagram and TikTok endpoints.
   *
   * @param {ChatDTO} dto - The chat query from the user.
   *
   * @returns {Promise<ChatResponse>} The AI assistant response and detected endpoints.
   */
  @Throttle({ default: { limit: 10, ttl: 60 * 60 * 1000 } })
  @Post()
  public async chat(
    @Body() dto: ChatDTO,
    @Req() req: Request & { user?: User },
  ): Promise<ChatResponse> {
    const user = req.user;
    if (!user) {
      throw new Error('User not found');
    }
    return this.chatService.chat(dto, user.id);
  }
}
