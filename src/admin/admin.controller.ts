import {
  Controller,
  Get,
  Patch,
  Body,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import type { Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull } from 'typeorm';

import { User, Task, TaskStatus, ChatMessage, ChatSession } from '@libs/entities';

@Controller('admin')
export class AdminController {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(Task)
    private readonly tasksRepo: Repository<Task>,
    @InjectRepository(ChatMessage)
    private readonly chatMessagesRepo: Repository<ChatMessage>,
    @InjectRepository(ChatSession)
    private readonly chatSessionsRepo: Repository<ChatSession>,
  ) {}

  @Get('dashboard')
  public async getDashboard(
    @Req() req: Request & { user?: User },
  ): Promise<{
    users: {
      total: number;
      admins: number;
      withGithub: number;
      withTelegram: number;
    };
    tasks: {
      total: number;
      pending: number;
      running: number;
      completed: number;
      failed: number;
    };
    chats: {
      totalSessions: number;
      totalMessages: number;
    };
  }> {
    const user = req.user;
    if (!user || !user.isAdmin) {
      throw new ForbiddenException('Admin access required');
    }

    const [usersTotal, adminsCount, usersWithGithub, usersWithTelegram] =
      await Promise.all([
        this.usersRepo.count(),
        this.usersRepo.count({ where: { isAdmin: true } }),
        this.usersRepo.count({ where: { githubId: Not(IsNull()) } }),
        this.usersRepo.count({ where: { telegramId: Not(IsNull()) } }),
      ]);

    const [tasksTotal, tasksPending, tasksRunning, tasksCompleted, tasksFailed] =
      await Promise.all([
        this.tasksRepo.count(),
        this.tasksRepo.count({ where: { status: TaskStatus.Pending } }),
        this.tasksRepo.count({ where: { status: TaskStatus.Running } }),
        this.tasksRepo.count({ where: { status: TaskStatus.Completed } }),
        this.tasksRepo.count({ where: { status: TaskStatus.Failed } }),
      ]);

    const [chatSessionsTotal, chatMessagesTotal] = await Promise.all([
      this.chatSessionsRepo.count(),
      this.chatMessagesRepo.count(),
    ]);

    return {
      users: {
        total: usersTotal,
        admins: adminsCount,
        withGithub: usersWithGithub,
        withTelegram: usersWithTelegram,
      },
      tasks: {
        total: tasksTotal,
        pending: tasksPending,
        running: tasksRunning,
        completed: tasksCompleted,
        failed: tasksFailed,
      },
      chats: {
        totalSessions: chatSessionsTotal,
        totalMessages: chatMessagesTotal,
      },
    };
  }

  @Get('users')
  public async getUsers(
    @Req() req: Request & { user?: User },
  ): Promise<
    Array<{
      id: number;
      githubLogin: string | null;
      githubId: string | null;
      telegramUsername: string | null;
      telegramId: string | null;
      isAdmin: boolean;
      createdAt: string;
      updatedAt: string;
    }>
  > {
    const user = req.user;
    if (!user || !user.isAdmin) {
      throw new ForbiddenException('Admin access required');
    }

    const users = await this.usersRepo.find({
      order: { createdAt: 'DESC' },
      select: [
        'id',
        'githubLogin',
        'githubId',
        'telegramUsername',
        'telegramId',
        'isAdmin',
        'createdAt',
        'updatedAt',
      ],
    });

    return users.map((u) => ({
      id: u.id,
      githubLogin: u.githubLogin,
      githubId: u.githubId,
      telegramUsername: u.telegramUsername,
      telegramId: u.telegramId,
      isAdmin: u.isAdmin,
      createdAt: u.createdAt?.toISOString() ?? new Date().toISOString(),
      updatedAt: u.updatedAt?.toISOString() ?? new Date().toISOString(),
    }));
  }

  @Get('tasks')
  public async getTasks(
    @Req() req: Request & { user?: User },
  ): Promise<
    Array<{
      id: number;
      taskId: string;
      status: TaskStatus;
      startedAt: string | null;
      completedAt: string | null;
      createdAt: string;
      updatedAt: string;
    }>
  > {
    const user = req.user;
    if (!user || !user.isAdmin) {
      throw new ForbiddenException('Admin access required');
    }

    const tasks = await this.tasksRepo.find({
      order: { createdAt: 'DESC' },
      take: 1000, // Limit to recent 1000 tasks
      select: [
        'id',
        'taskId',
        'status',
        'startedAt',
        'completedAt',
        'createdAt',
        'updatedAt',
      ],
    });

    return tasks.map((t) => ({
      id: t.id,
      taskId: t.taskId,
      status: t.status,
      startedAt: t.startedAt?.toISOString() ?? null,
      completedAt: t.completedAt?.toISOString() ?? null,
      createdAt: t.createdAt?.toISOString() ?? new Date().toISOString(),
      updatedAt: t.updatedAt?.toISOString() ?? new Date().toISOString(),
    }));
  }

  @Get('chats')
  public async getChats(
    @Req() req: Request & { user?: User },
  ): Promise<
    Array<{
      id: number;
      userId: number;
      title: string | null;
      createdAt: string;
      updatedAt: string;
    }>
  > {
    const user = req.user;
    if (!user || !user.isAdmin) {
      throw new ForbiddenException('Admin access required');
    }

    const sessions = await this.chatSessionsRepo.find({
      order: { createdAt: 'DESC' },
      take: 1000, // Limit to recent 1000 sessions
      select: ['id', 'userId', 'title', 'createdAt', 'updatedAt'],
    });

    return sessions.map((s) => ({
      id: s.id,
      userId: s.userId,
      title: s.title,
      createdAt: s.createdAt?.toISOString() ?? new Date().toISOString(),
      updatedAt: s.updatedAt?.toISOString() ?? new Date().toISOString(),
    }));
  }

  @Get('settings')
  public async getSettings(
    @Req() req: Request & { user?: User },
  ): Promise<{ reasoningEffort: string | null }> {
    const user = req.user;
    if (!user || !user.isAdmin) {
      throw new ForbiddenException('Admin access required');
    }

    return { reasoningEffort: user.reasoningEffort };
  }

  @Patch('settings')
  public async updateSettings(
    @Req() req: Request & { user?: User },
    @Body() body: { reasoningEffort: string | null },
  ): Promise<{ success: boolean }> {
    const user = req.user;
    if (!user || !user.isAdmin) {
      throw new ForbiddenException('Admin access required');
    }

    // Only allow "none" or empty string
    const effort =
      body.reasoningEffort === 'none' || body.reasoningEffort === ''
        ? body.reasoningEffort
        : 'none';

    await this.usersRepo.update(user.id, { reasoningEffort: effort });
    return { success: true };
  }
}
