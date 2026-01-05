import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { useContainer } from 'class-validator';

import { AppConfigService } from '@libs/config';
import { TransformInterceptor } from '@libs/interceptors';

import { AppModule } from './app';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(AppConfigService);

  app.setGlobalPrefix(config.globalPrefix, {
    exclude: ['/metrics'],
  });

  app.useGlobalInterceptors(new TransformInterceptor());

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidUnknownValues: true,
      stopAtFirstError: true,
    }),
  );

  // CORS configuration: allow web app origin and common dev origins
  const allowedOrigins: string[] = [
    'https://app.wykra.io',
    'http://localhost:5173',
    'http://localhost:4173',
    'http://localhost:3000',
  ];
  const corsOrigin = process.env.CORS_ORIGIN;
  if (corsOrigin) {
    allowedOrigins.push(...corsOrigin.split(',').map((s: string) => s.trim()));
  }

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Allow requests with no origin (like mobile apps, Postman, curl)
      if (!origin) {
        callback(null, true);
        return;
      }
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      // In development, allow all origins
      if (config.isDev) {
        callback(null, true);
        return;
      }
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'Origin',
    ],
  });
  app.enableShutdownHooks();

  useContainer(app.select(AppModule), { fallbackOnErrors: true });

  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : config.port;
  await app.listen(PORT, '0.0.0.0');

  Logger.log(
    `Listening at http://0.0.0.0:${PORT}/${config.globalPrefix}`,
    'WykraAPI',
  );
}

bootstrap().catch(console.log);
