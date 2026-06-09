import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const logsDir = join(__dirname, '..', 'logs');

mkdirSync(logsDir, { recursive: true });

const timestampFormat = winston.format.timestamp({
  format: 'YYYY-MM-DD HH:mm:ss',
});

const lineFormat = winston.format.printf(({ timestamp, level, message, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
  return `${timestamp} [${level.toUpperCase()}] ${message}${metaStr}`;
});

const fileTransport = new DailyRotateFile({
  dirname: logsDir,
  filename: 'chatbot-project-%DATE%.log',
  symlinkName: 'chatbot-project.log',
  createSymlink: true,
  datePattern: 'YYYY-MM-DD',
  frequency: '24h',
  maxFiles: '30d',
  format: winston.format.combine(timestampFormat, lineFormat),
});

const consoleTransport = new winston.transports.Console({
  format: winston.format.combine(
    timestampFormat,
    winston.format.colorize({ level: true }),
    lineFormat,
  ),
});

export const logger = winston.createLogger({
  level: 'info',
  transports: [consoleTransport, fileTransport],
});
