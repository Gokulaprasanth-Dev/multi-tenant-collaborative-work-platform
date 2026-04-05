import { hashPassword, verifyPassword } from '../../../src/modules/auth/utils/password';

describe('password utilities', () => {
  it('hashPassword produces a bcrypt hash', async () => {
    const hash = await hashPassword('secret123');
    expect(hash).toMatch(/^\$2[aby]\$/);
  });

  it('verifyPassword returns true for correct password', async () => {
    const hash = await hashPassword('correct-horse');
    expect(await verifyPassword('correct-horse', hash)).toBe(true);
  });

  it('verifyPassword returns false for wrong password', async () => {
    const hash = await hashPassword('correct-horse');
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });
});
