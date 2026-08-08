import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { logger, type Logger } from '../utils/logger';

/**
 * Gives every request an id and a logger bound to it.
 *
 * Without this, correlating "the instructor says grading failed at 14:32" to
 * actual log lines means guessing from timestamps. With it, the id is returned
 * in a response header, so a support ticket can carry the exact string that
 * finds every line the request produced — including the ones the email queue
 * writes minutes later, because the id travels into the job.
 *
 * An inbound `X-Request-Id` is honoured so a trace started at a proxy or by the
 * frontend survives into these logs rather than being renamed halfway.
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      log: Logger;
    }
  }
}

/** Only accept an inbound id that is safe to put in a header and a log line. */
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.header('x-request-id');
  req.requestId = inbound && SAFE_ID.test(inbound) ? inbound : crypto.randomUUID();

  res.setHeader('X-Request-Id', req.requestId);

  // `req.user` is populated later by `authenticate`, so the bound userId would
  // be stale if captured now. A getter keeps it correct for lines written after
  // authentication without re-binding the logger.
  // Getters, not values: the spread inside the logger evaluates them at LOG
  // time, so a line written after `authenticate` carries the userId even though
  // this binding happened before it.
  req.log = logger.child({
    get requestId() {
      return req.requestId;
    },
    get userId() {
      return req.user?.id;
    },
  });

  next();
}
