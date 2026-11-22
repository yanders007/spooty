import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as fs from 'fs';
import { resolve } from 'path';
import { exec } from 'child_process';
import { EnvironmentEnum } from './environmentEnum';

async function bootstrap() {
  // Validate DOWNLOADS_PATH before starting
  if (!process.env[EnvironmentEnum.DOWNLOADS_PATH]) {
    throw new Error('DOWNLOADS_PATH environment variable is missing');
  }

  // Create downloads folder if missing
  const folderName = resolve(
    __dirname,
    process.env[EnvironmentEnum.DOWNLOADS_PATH],
  );
  if (!fs.existsSync(folderName)) {
    fs.mkdirSync(folderName, { recursive: true });
  }

  // Start Redis if explicitly enabled (only "true" triggers it)
  try {
    const redisRun = process.env[EnvironmentEnum.REDIS_RUN];
    if (redisRun === 'true' || redisRun === '1') {
      exec(`redis-server --port ${process.env[EnvironmentEnum.REDIS_PORT]}`);
    }
  } catch (e) {
    console.error('Unable to run redis server from app:', e);
  }

  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors();
  await app.listen(process.env.PORT || 3000);
}
bootstrap();
