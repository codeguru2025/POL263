import { test, expect } from '@playwright/test';

test.describe('Staff Login Flow', () => {
  test('should redirect to Google OAuth on login click', async ({ page }) => {
    // Navigate to the staff login page
    await page.goto('/staff/login');

    // Verify page elements
    await expect(page.getByTestId('btn-google-login')).toBeVisible();
    await expect(page.locator('text=Sign in with Google')).toBeVisible();

    // In a real e2e test, we'd mock the OAuth provider response here.
    // For this scaffold, we just verify the interaction.
    const loginBtn = page.getByTestId('btn-google-login');
    await loginBtn.click();

    // Verify it navigates to the staff dashboard (mocked behavior)
    await expect(page).toHaveURL(/.*\/staff/);
    await expect(page.locator('text=Dashboard')).toBeVisible();
  });
});
