import { registerAs } from '@nestjs/config';
import { env } from 'node:process';

export default registerAs('postmark', () => ({
  serverToken: env.POSTMARK_SERVER_TOKEN,
  fromEmail: env.POSTMARK_FROM_EMAIL,
  messageStream: env.POSTMARK_MESSAGE_STREAM || 'outbound',
  confirmUrl: env.POSTMARK_CONFIRM_URL,
}));
