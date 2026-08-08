import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

import { errorHandler } from './middlewares/error.middleware';
import { requestContext } from './middlewares/requestContext.middleware';
import systemRoutes from './routes/system.routes';
import routes from './routes';

const app = express();

// Trust proxy for Render deployment (fixes rate limit warnings)
app.set('trust proxy', 1);

// First in the chain: everything after this — including the error handler —
// can correlate its output by requestId.
app.use(requestContext);

// Security Middlewares
app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
  })
);

/**
 * Operational health, mounted BEFORE the rate limiter.
 *
 * Not an optimisation — a correctness fix. A probe polling every 10 seconds is
 * 90 requests per 15 minutes against a 100-request budget shared with every
 * other call from that IP, so behind the limiter the health check would start
 * returning 429 under exactly the load it exists to report on, and an
 * orchestrator would cycle a healthy instance.
 */
app.use('/api/system', systemRoutes);

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: { success: false, message: 'Too many requests, please try again later.' },
});
app.use('/api', limiter);

// Logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

// Performance Middlewares
app.use(compression());
app.use(express.json({ limit: '10kb' })); // Body parser limit to prevent large payload attacks

// API Routes
app.use('/api', routes);

// Health Check Route
app.get('/api/health', (req: Request, res: Response) => {
  res.status(200).json({ 
    success: true, 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Legacy root health check just in case
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ 
    success: true, 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Global Error Handler
app.use(errorHandler);

export default app;
