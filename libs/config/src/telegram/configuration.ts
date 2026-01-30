import { registerAs } from '@nestjs/config';
import { env } from 'node:process';

export default registerAs('telegram', () => ({
  token: env.TELEGRAM_BOT_TOKEN,
  // Telegram WebApp initData verification uses "WebAppData"
  hmacKey: 'WebAppData',
}));
