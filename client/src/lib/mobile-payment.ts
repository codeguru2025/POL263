/**
 * Mobile payment: open payment in system browser (iOS/Android) so the transaction
 * completes on the web and we avoid in-app purchase / store fees. After payment,
 * the return URL redirects to the app via deep link.
 */

const APP_SCHEME = "pol263";

export function isNativeMobile(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
  if (!cap?.getPlatform) return false;
  const platform = cap.getPlatform();
  return platform === "ios" || platform === "android";
}

/** Deep link URL that opens the app (e.g. pol263://client/payments?returned=1). */
export function getAppDeepLink(path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${APP_SCHEME}://${clean.replace(/^\//, "")}`;
}

/**
 * Open the payment URL in the system browser (not in-app WebView).
 * On iOS/Android this avoids IAP; user returns to the app via deep link after payment.
 */
export async function openPaymentInSystemBrowser(url: string): Promise<void> {
  if (!isNativeMobile()) {
    window.location.href = url;
    return;
  }
  const { Browser } = await import("@capacitor/browser");
  await Browser.open({ url, windowName: "_blank" });
}

/**
 * When the payment return page loads in the system browser on mobile,
 * redirect to the app so the user lands back in the app.
 */
export function redirectToAppIfMobileReturn(pathWithQuery: string): void {
  if (typeof window === "undefined") return;
  const ua = navigator.userAgent.toLowerCase();
  const mobile = /android|iphone|ipad|ipod|mobile/i.test(ua);
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  const inApp = cap?.isNativePlatform?.() === true;
  if (mobile && !inApp) {
    window.location.href = getAppDeepLink(pathWithQuery);
  }
}
