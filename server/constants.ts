/**
 * Platform-level constants. The platform superuser (this email) always has
 * create:tenant and delete:tenant and can assign them to roles.
 * Configurable via SUPERUSER_EMAIL env var; defaults to ausiziba@gmail.com.
 */
export const PLATFORM_SUPERUSER_EMAIL = process.env.SUPERUSER_EMAIL || "ausiziba@gmail.com";
