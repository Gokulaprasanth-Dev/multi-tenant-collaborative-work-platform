import supertest from 'supertest';
import { app } from '../../src/app';

export function createTestClient(jwt?: string, orgId?: string): supertest.SuperTest<supertest.Test> {
  const client = supertest(app);
  if (jwt || orgId) {
    return new Proxy(client, {
      get(target, prop) {
        const method = (target as Record<string, unknown>)[prop as string];
        if (typeof method === 'function' && ['get', 'post', 'put', 'patch', 'delete'].includes(prop as string)) {
          return (...args: unknown[]) => {
            let req = (method as Function).apply(target, args) as supertest.Test;
            if (jwt) req = req.set('Authorization', `Bearer ${jwt}`);
            if (orgId) req = req.set('X-Org-ID', orgId);
            return req;
          };
        }
        return method;
      },
    }) as unknown as supertest.SuperTest<supertest.Test>;
  }
  return client;
}
