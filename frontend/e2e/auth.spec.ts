// frontend/e2e/auth.spec.ts
import { test, expect } from '@playwright/test';

// These tests require the backend running on http://localhost:3000
// and a seeded test user: email=test@example.com password=Password123!

const TEST_EMAIL    = process.env['E2E_EMAIL']    ?? 'test@example.com';
const TEST_PASSWORD = process.env['E2E_PASSWORD'] ?? 'Password123!';

test.describe('Auth flows', () => {

  test('unauthenticated access to /app redirects to /auth/login', async ({ page }) => {
    await page.goto('/app');
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test('login page renders with email + password fields and SSO buttons', async ({ page }) => {
    await page.goto('/auth/login');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button:has-text("Google")')).toBeVisible();
    await expect(page.locator('button:has-text("SSO")')).toBeVisible();
  });

  test('shows error on invalid credentials', async ({ page }) => {
    await page.goto('/auth/login');
    await page.fill('input[type="email"]', 'wrong@example.com');
    await page.fill('input[type="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');
    await expect(page.locator('.auth-error')).toBeVisible({ timeout: 5000 });
  });

  test('successful login redirects to /app', async ({ page }) => {
    await page.goto('/auth/login');
    await page.fill('input[type="email"]', TEST_EMAIL);
    await page.fill('input[type="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/app/, { timeout: 10_000 });
  });

  test('register page shows success state after form submit', async ({ page }) => {
    await page.goto('/auth/register');
    await page.fill('input[type="text"]', 'Test User');
    await page.fill('input[type="email"]', `e2e-${Date.now()}@example.com`);
    const pwFields = page.locator('input[type="password"]');
    await pwFields.nth(0).fill('Password123!');
    await pwFields.nth(1).fill('Password123!');
    await page.click('button[type="submit"]');
    await expect(page.locator('.auth-success')).toBeVisible({ timeout: 5000 });
  });

  test('SSO callback with missing token redirects to /auth/login', async ({ page }) => {
    await page.goto('/auth/callback');
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test('forgot password shows confirmation after email submit', async ({ page }) => {
    await page.goto('/auth/forgot');
    await page.fill('input[type="email"]', TEST_EMAIL);
    await page.click('button[type="submit"]');
    await expect(page.locator('.auth-success')).toBeVisible({ timeout: 5000 });
  });

});
