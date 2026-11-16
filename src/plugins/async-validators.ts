/**
 * `async-validators` plugin: validators that ask the server.
 *
 * Requests go through the app's HttpClient (so `baseUrl` and auth apply), are
 * debounced per field, and are cancelled when a newer value is being checked.
 * If the check itself fails (offline, 5xx), the value is accepted unless
 * `failOpen: false`, so a flaky endpoint never blocks your form.
 *
 * Validators:
 * - `usernameAvailable {endpoint='/check-username', param='username', minLength=3}` → expects `{ available }`
 * - `uniqueField {endpoint, field, excludeId?}` → expects `{ exists }`
 * - `validEmailDomain {allowed?, blocked?, checkMx?, mxEndpoint='/check-mx'}` → MX check expects `{ valid }`
 * - `remote {endpoint, param='value', validPath='valid', messagePath='message'}`: generic
 *
 * @module plugins/async-validators
 */

import type { ArethesisPlugin } from './types';
import { VERSION } from '../version';
import type { ValidatorContext, ValidatorResult } from '../binding/types';
import type { Arethesis } from '../core/arethesis';
import { getPath } from '../utils/path';
import { sleep } from '../utils/backoff';

export interface AsyncValidatorsOptions {
  /** Debounce in ms. @default 300 */
  debounce?: number;
  /** Accept the value when the check can't be completed. @default true */
  failOpen?: boolean;
}

export function asyncValidatorsPlugin(): ArethesisPlugin<AsyncValidatorsOptions> {
  let app: Arethesis | null = null;
  let opts: Required<AsyncValidatorsOptions> = { debounce: 300, failOpen: true };
  const latest = new Map<string, AbortController>();

  /**
   * Debounce per field+validator. A superseded check resolves `true` quietly;
   * its result is ignored by the binder anyway.
   */
  async function check(
    ctx: ValidatorContext,
    debounce: number | undefined,
    run: (signal: AbortSignal) => Promise<ValidatorResult>,
    unavailable: string,
  ): Promise<ValidatorResult> {
    const key = `${ctx.field}:${ctx.rule.type}`;
    latest.get(key)?.abort();
    const controller = new AbortController();
    latest.set(key, controller);
    ctx.signal?.addEventListener('abort', () => controller.abort(), { once: true });
    try {
      await sleep(debounce ?? opts.debounce, controller.signal);
      return await run(controller.signal);
    } catch (err) {
      if (controller.signal.aborted) return true;
      void err;
      return opts.failOpen ? true : unavailable;
    } finally {
      if (latest.get(key) === controller) latest.delete(key);
    }
  }

  async function get(endpoint: string, params: Record<string, string>, signal: AbortSignal): Promise<unknown> {
    if (!app) throw new Error('async-validators: plugin not installed');
    return app.http.request({ url: endpoint, params, signal, retry: false, dedupe: false });
  }

  return {
    name: 'async-validators',
    version: VERSION,
    install(instance, options) {
      app = instance;
      opts = { ...opts, ...options };
    },
    validators: {
      usernameAvailable: {
        message: 'That username is taken',
        fn: (value, params, ctx) => {
          const str = String(value ?? '');
          if (str.length < Number(params.minLength ?? 3)) return true;
          return check(ctx, params.debounce as number | undefined, async signal => {
            const body = await get(String(params.endpoint ?? '/check-username'), { [String(params.param ?? 'username')]: str }, signal);
            return Boolean(getPath(body, String(params.path ?? 'available')));
          }, 'Could not check availability');
        },
      },
      uniqueField: {
        message: 'This {field} is already in use',
        fn: (value, params, ctx) => {
          if (value === null || value === undefined || value === '') return true;
          if (!params.endpoint || !params.field) {
            console.warn('uniqueField needs params.endpoint and params.field');
            return true;
          }
          return check(ctx, params.debounce as number | undefined, async signal => {
            const query: Record<string, string> = { field: String(params.field), value: String(value) };
            if (params.excludeId !== undefined) query.excludeId = String(params.excludeId);
            const body = await get(String(params.endpoint), query, signal);
            return !getPath(body, 'exists');
          }, 'Could not check uniqueness');
        },
      },
      validEmailDomain: {
        message: 'This email domain is not accepted',
        fn: (value, params, ctx) => {
          const email = String(value ?? '');
          const at = email.lastIndexOf('@');
          if (at < 1) return true;
          const domain = email.slice(at + 1).toLowerCase();
          const allowed = params.allowed as string[] | undefined;
          const blocked = params.blocked as string[] | undefined;
          if (allowed && !allowed.map(d => d.toLowerCase()).includes(domain)) return `Use an address at ${allowed.join(', ')}`;
          if (blocked?.map(d => d.toLowerCase()).includes(domain)) return false;
          if (!params.checkMx) return true;
          return check(ctx, params.debounce as number | undefined, async signal => {
            const body = await get(String(params.mxEndpoint ?? '/check-mx'), { domain }, signal);
            return getPath(body, 'valid') ? true : 'This domain does not accept email';
          }, 'Could not verify the email domain');
        },
      },
      remote: {
        message: 'Invalid value',
        fn: (value, params, ctx) => {
          if (!params.endpoint) return true;
          return check(ctx, params.debounce as number | undefined, async signal => {
            const body = await get(String(params.endpoint), { [String(params.param ?? 'value')]: String(value ?? '') }, signal);
            const valid = Boolean(getPath(body, String(params.validPath ?? 'valid')));
            const message = getPath(body, String(params.messagePath ?? 'message'));
            return valid ? true : typeof message === 'string' ? message : false;
          }, 'Could not validate');
        },
      },
    },
  };
}
