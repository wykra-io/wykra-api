import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
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
   * Lists chat sessions for the authenticated user.
   */
  @Get('sessions')
  public async getSessions(@Req() req: Request & { user?: User }): Promise<
    Array<{
      id: number;
      title: string | null;
      createdAt: Date;
      updatedAt: Date;
    }>
  > {
    const user = req.user;
    if (!user) {
      throw new Error('User not found');
    }
    const sessions = await this.chatService.getSessions(user.id);
    return sessions.map((s) => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
  }

  /**
   * Creates a new chat session for the authenticated user.
   */
  @Post('sessions')
  public async createSession(
    @Req() req: Request & { user?: User },
    @Body() body?: { title?: string },
  ): Promise<{ id: number; title: string | null }> {
    const user = req.user;
    if (!user) {
      throw new Error('User not found');
    }
    const session = await this.chatService.createSession(
      user.id,
      body?.title ?? null,
    );
    return { id: session.id, title: session.title };
  }

  /**
   * Updates chat session title for the authenticated user.
   */
  @Patch('sessions/:id')
  public async updateSessionTitle(
    @Req() req: Request & { user?: User },
    @Param('id') id: string,
    @Body() body?: { title?: string | null },
  ): Promise<{ id: number; title: string | null }> {
    const user = req.user;
    if (!user) {
      throw new Error('User not found');
    }
    const numericId = Number(id);
    if (Number.isNaN(numericId)) {
      throw new Error('Invalid session id');
    }
    return await this.chatService.updateSessionTitle(
      user.id,
      numericId,
      body?.title ?? null,
    );
  }

  /**
   * Deletes a chat session (and its messages) for the authenticated user.
   */
  @Delete('sessions/:id')
  public async deleteSession(
    @Req() req: Request & { user?: User },
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    const user = req.user;
    if (!user) {
      throw new Error('User not found');
    }
    const numericId = Number(id);
    if (Number.isNaN(numericId)) {
      throw new Error('Invalid session id');
    }
    await this.chatService.deleteSession(user.id, numericId);
    return { ok: true };
  }

  /**
   * Gets chat history for the authenticated user.
   *
   * @returns {Promise<ChatMessage[]>} Array of chat messages.
   */
  @Get('history')
  public async getHistory(
    @Req() req: Request & { user?: User },
    @Query('sessionId') sessionId?: string,
  ): Promise<
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
    console.log(`ChatController.getHistory: userId=${user.id}, sessionId=${sessionId}`);
    const numericSessionId =
      typeof sessionId === 'string' && sessionId.trim().length > 0
        ? Number(sessionId)
        : undefined;

    const safeSessionId =
      numericSessionId != null &&
      !Number.isNaN(numericSessionId) &&
      Number.isInteger(numericSessionId) &&
      numericSessionId >= -2147483648 &&
      numericSessionId <= 2147483647 &&
      numericSessionId > 0
        ? numericSessionId
        : undefined;

    const messages = await this.chatService.getHistory(user.id, safeSessionId);
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
    console.log(`ChatController.chat: userId=${user.id}, query="${dto.query.substring(0, 50)}..."`);
    return this.chatService.chat(dto, user.id);
  }
}
