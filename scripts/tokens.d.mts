// Types for scripts/tokens.mjs (used by the examples' Vite config and the tests).
export interface Loaded {
  resolver: Record<string, unknown>;
  files: Map<string, Record<string, unknown>>;
}
export interface ResolvedToken {
  type: string;
  value: unknown;
  description?: string;
}
export const TOKENS_DIR: string;
export const RESOLVER_FILE: string;
export const RESOLVER_VERSION: string;
export const CONTEXTS: string[];
export const THEME_STORAGE_KEY: string;
export const CONTRAST_STORAGE_KEY: string;
export const CSS_START: string;
export const CSS_END: string;
export const THEME_RULES: Array<{ context: string; scheme: string; media?: string; selector: string }>;
export function colorProblems(value: unknown): string[];
export function validateTokens(doc: unknown, file?: string): string[];
export function validateResolver(doc: unknown, exists?: (file: string) => boolean): string[];
export function loadTokens(dir?: string): Loaded;
export function flatten(doc: Record<string, unknown>, into?: Map<string, ResolvedToken>): Map<string, ResolvedToken>;
export function resolveTokens(loaded: Loaded, input?: Record<string, string>): Map<string, ResolvedToken>;
export function cssVariable(path: string): string;
export function srgbToHex(components: number[]): string;
export function colorToCss(value: unknown): string;
export function tokenToCss(token: ResolvedToken): string;
export function themeCss(loaded?: Loaded): string;
export function withThemeCss(css: string, loaded?: Loaded): string;
export function criticalCss(loaded?: Loaded): string;
export function bootScript(options?: { themeKey?: string; contrastKey?: string }): string;
export function bootFile(loaded?: Loaded): string;
