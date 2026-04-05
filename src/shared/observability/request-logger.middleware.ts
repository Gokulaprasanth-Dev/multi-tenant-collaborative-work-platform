import pinoHttp from 'pino-http';
import { logger } from './logger';
import { v4 as uuidv4 } from 'uuid';

export const requestLoggerMiddleware = pinoHttp({
  logger,
  genReqId: () => uuidv4(),
  customProps: (req: any) => ({
    correlation_id: req.headers['x-correlation-id'] || uuidv4(),
    org_id: req.user?.orgId,
    user_id: req.user?.userId,
  }),
  serializers: {
    req: (req) => ({ method: req.method, url: req.url, correlation_id: req.id }),
    res: (res) => ({ status_code: res.statusCode }),
  },
});
