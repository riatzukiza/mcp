import type { FastifyReply, FastifyRequest } from 'fastify';

export type FastifyCookieOptions = Readonly<{
  readonly path?: string;
  readonly domain?: string;
  readonly secure?: boolean;
  readonly httpOnly?: boolean;
  readonly sameSite?: 'strict' | 'lax' | 'none';
  readonly maxAge?: number;
}>;

declare module 'fastify' {
  interface FastifyReply {
    setCookie(name: string, value: string, options?: FastifyCookieOptions): FastifyReply;
    clearCookie(name: string, options?: FastifyCookieOptions): FastifyReply;
  }

  interface FastifyRequest {
    cookies: Record<string, string | undefined>;
  }
}
