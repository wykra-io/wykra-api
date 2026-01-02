import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { useContainer } from 'class-validator';
import { createProxyMiddleware } from 'http-proxy-middleware';

import { AppConfigService } from '@libs/config';
import { TransformInterceptor } from '@libs/interceptors';

import { AppModule } from './app';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(AppConfigService);

  // Proxy Grafana requests to Grafana service
  const grafanaUrl = process.env.GRAFANA_INTERNAL_URL || 'http://grafana:3000';
  app.use(
    '/grafana',
    createProxyMiddleware({
      target: grafanaUrl,
      changeOrigin: true,
      pathRewrite: {
        '^/grafana': '', // Remove /grafana prefix when forwarding to Grafana
      },
      onProxyReq: (proxyReq, req) => {
        // Set X-Forwarded headers for Grafana
        proxyReq.setHeader('X-Forwarded-Host', req.headers.host || '');
        proxyReq.setHeader(
          'X-Forwarded-Proto',
          req.headers['x-forwarded-proto'] || 'http',
        );
        proxyReq.setHeader('X-Forwarded-Prefix', '/grafana');
      },
    }),
  );

  app.setGlobalPrefix(config.globalPrefix, {
    exclude: ['/metrics', '/grafana'],
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
