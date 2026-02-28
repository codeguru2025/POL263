import { QueryClient, QueryFunction } from "@tanstack/react-query";

/** Base URL for API requests. Set VITE_API_BASE when building for mobile (e.g. https://api.yourdomain.com). Leave unset for same-origin web. */
export function getApiBase(): string {
  return (import.meta.env.VITE_API_BASE as string) || "";
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const fullUrl = url.startsWith("http") ? url : getApiBase() + url;
  const res = await fetch(fullUrl, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
  /** When true, 403 is also treated as "unauthenticated" and returns null instead of throwing (for auth/me and client-auth/me). */
  on403ReturnNull?: boolean;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior, on403ReturnNull = true }) =>
  async ({ queryKey }) => {
    const path = queryKey.join("/") as string;
    const fullUrl = path.startsWith("http") ? path : getApiBase() + path;
    const res = await fetch(fullUrl, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }
    if (on403ReturnNull && res.status === 403) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "returnNull", on403ReturnNull: true }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: 1,
      retryDelay: 1000,
    },
    mutations: {
      retry: false,
    },
  },
});
