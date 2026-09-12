import cors from 'cors';
import cookieParser from 'cookie-parser';
import express from 'express';
import { errorHandler } from './middleware/errorHandler.js';
import { authRouter, dashboardRouter, feedRouter, notificationRouter, projectRouter, taskRouter } from './routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({
    origin: process.env.FRONTEND_URL || 'https://velozity-fullstack-assessment.vercel.app',
    credentials: true,
  }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use('/api/auth', authRouter);
  app.use('/api/projects', projectRouter);
  app.use('/api/tasks', taskRouter);
  app.use('/api/feed', feedRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/notifications', notificationRouter);

  app.use((req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } });
  });
  app.use(errorHandler);
  return app;
}
