import type { APIRequestContext, BrowserContext, Page } from 'playwright';

const POSHMARK_URL = 'https://poshmark.com';

type InitialState = {
  auth?: {
    isUserLoggedIn?: boolean;
    identity?: {
      id?: string;
      user_id?: string;
      username?: string;
    } | string | null;
  };
  csrftoken?: string;
  ui?: {
    uid?: string;
    dh?: string;
  };
};

export interface PoshmarkSessionInfo {
  csrfToken: string;
  userId: string;
  username?: string;
}

export interface PoshmarkRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
}

export class PoshmarkApiClient {
  constructor(
    private readonly request: APIRequestContext,
    private readonly session: PoshmarkSessionInfo,
  ) {}

  static async fromPage(page: Page): Promise<PoshmarkApiClient> {
    const session = await getSessionInfoFromPage(page);
    return new PoshmarkApiClient(page.context().request, session);
  }

  static async fromContext(context: BrowserContext, page: Page): Promise<PoshmarkApiClient> {
    const session = await getSessionInfoFromPage(page);
    return new PoshmarkApiClient(context.request, session);
  }

  getSessionInfo(): PoshmarkSessionInfo {
    return this.session;
  }

  async requestJson(path: string, options?: PoshmarkRequestOptions): Promise<unknown> {
    const method = options?.method ?? 'GET';
    const headers: Record<string, string> = {
      accept: 'application/json, text/plain, */*',
      'x-csrf-token': this.session.csrfToken,
      'x-requested-with': 'XMLHttpRequest',
      ...(options?.headers ?? {}),
    };

    const body = options?.body;
    const response = await this.request.fetch(`${POSHMARK_URL}${path}`, {
      method,
      headers,
      data: body,
      failOnStatusCode: false,
    });

    const text = await response.text();
    if (!response.ok()) {
      throw new Error(`Poshmark API ${method} ${path} failed (${response.status()}): ${text.slice(0, 400)}`);
    }

    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  async postSuggestions(payload: Record<string, unknown>): Promise<unknown> {
    return this.requestJson('/post_attributes/suggested', { method: 'POST', body: payload });
  }

  async createDraft(payload: Record<string, unknown>, options?: { quickList?: boolean }): Promise<unknown> {
    const quickList = options?.quickList ? 'true' : 'false';
    return this.requestJson(`/users/${this.session.userId}/posts?quick_list=${quickList}`, { method: 'POST', body: payload });
  }

  async listScratchMedia(postId: string): Promise<unknown> {
    return this.requestJson(`/posts/${postId}/media/scratch`, { method: 'GET' });
  }

  async publishPost(postId: string): Promise<unknown> {
    return this.requestJson(`/posts/${postId}/status/published`, { method: 'POST', body: {} });
  }

  async saveDraft(postId: string): Promise<unknown> {
    return this.requestJson(`/posts/${postId}/status/user_draft`, { method: 'POST', body: {} });
  }
}

export async function getSessionInfoFromPage(page: Page): Promise<PoshmarkSessionInfo> {
  const state = await page.evaluate(() => {
    const current = globalThis as { __INITIAL_STATE__?: unknown };
    return current.__INITIAL_STATE__ ?? null;
  }) as InitialState | null;

  const csrfFromCookie = await page.context().cookies().then((cookies) => {
    return cookies.find((cookie) => cookie.name === 'csrftoken')?.value ?? '';
  });

  const csrfToken = state?.csrftoken ?? csrfFromCookie;
  const identity = state?.auth?.identity ?? null;
  const userId = typeof identity === 'string'
    ? identity
    : identity?.user_id ?? identity?.id ?? state?.ui?.uid ?? '';
  const username = typeof identity === 'string'
    ? state?.ui?.dh
    : identity?.username ?? state?.ui?.dh;

  if (!csrfToken) throw new Error('Could not determine Poshmark CSRF token from page state/cookies');
  if (!userId) throw new Error('Could not determine Poshmark user id from page state');

  return {
    csrfToken,
    userId,
    username,
  };
}
