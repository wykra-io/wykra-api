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

  app.enableCors();
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
