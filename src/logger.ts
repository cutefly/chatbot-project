import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const logsDir = join(__dirname, '..', 'logs');

const TIMESTAMP = 'YYYY-MM-DD HH:mm:ss';

const lineFormat = winston.format.combine(
  winston.format.timestamp({ format: TIMESTAMP }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    return `${timestamp} [${level.toUpperCase()}] ${message}${metaStr}`;
  }),
);

const isTest = process.env.NODE_ENV === 'test';

const transports: winston.transport[] = [];

if (!isTest) {
  mkdirSync(logsDir, { recursive: true });

  transports.push(
    new winston.transports.Console({ format: lineFormat }),
    new DailyRotateFile({
      dirname: logsDir,
      filename: 'chatbot-project-%DATE%.log',
      symlinkName: 'chatbot-project.log',
      createSymlink: true,
      datePattern: 'YYYY-MM-DD',
      frequency: '24h',
      maxFiles: '30d',
      format: lineFormat,
    }),
  );
}

export const logger = winston.createLogger({
  level: 'info',
  transports,
  silent: isTest,
});
