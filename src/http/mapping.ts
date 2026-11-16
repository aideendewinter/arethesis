/**
 * Response mapping and pagination extraction.
 *
 * @module http/mapping
 */

import type { NestedMapping, PaginationMapping, ResponseMapping } from './types';
import { getPath, isForbiddenKey, isPlainObject } from '../utils/path';

/** A batch of related objects found while mapping, to be written to the store. */
export interface NestedWrite {
  type: string;
  items: unknown[];
}

/** Extract the data at `dataPath` and apply the top-level transform. */
export function extractData(body: unknown, mapping?: ResponseMapping): unknown {
  if (!mapping) return body;
  const data = getPath(body, mapping.dataPath);
  return mapping.transform ? mapping.transform(data) : data;
}

/**
 * Map one item. Nested objects are passed to `collect` for normalization and
 * replaced with their ids (or kept inline with `as: 'keep'`).
 */
export function mapItem(
  item: unknown,
  mapping: ResponseMapping | undefined,
  collect: (write: NestedWrite) => string[],
): unknown {
  if (!mapping || (!mapping.fields && !mapping.nested)) return item;
  if (!isPlainObject(item)) return item;

  const result: Record<string, unknown> = {};
  if (!mapping.fields || mapping.keepUnmapped) {
    for (const key of Object.keys(item)) if (!isForbiddenKey(key)) result[key] = item[key];
  }

  if (mapping.fields) {
    for (const [target, source] of Object.entries(mapping.fields)) {
      if (isForbiddenKey(target)) continue;
      if (typeof source === 'string') {
        result[target] = getPath(item, source);
      } else {
        const value = getPath(item, source.path);
        result[target] = source.transform ? source.transform(value, item) : value;
      }
    }
  }

  if (mapping.nested) {
    for (const [key, nested] of Object.entries(mapping.nested)) {
      if (isForbiddenKey(key)) continue;
      result[key] = mapNested(getPath(item, nested.path ?? key), nested, collect);
    }
  }

  return result;
}

function mapNested(value: unknown, nested: NestedMapping, collect: (write: NestedWrite) => string[]): unknown {
  if (value === undefined || value === null) return value;
  const isList = Array.isArray(value);
  const items = (isList ? value : [value]).map(v => mapItem(v, nested.mapping, collect));
  const ids = collect({ type: nested.type, items });
  if (nested.as === 'keep') return isList ? items : items[0];
  return isList ? ids : ids[0];
}

export interface ExtractedPage {
  nextCursor: string | null;
  hasMore: boolean;
  totalCount?: number;
}

/** Read pagination fields from a list response. */
export function extractPage(body: unknown, pagination: PaginationMapping | undefined, itemCount: number, pageSize?: number): ExtractedPage {
  if (!pagination) {
    // Without cursor info, assume more pages exist while pages come back full.
    return { nextCursor: null, hasMore: pageSize !== undefined && itemCount >= pageSize };
  }
  const rawCursor = pagination.cursorPath ? getPath(body, pagination.cursorPath) : undefined;
  const nextCursor = rawCursor === undefined || rawCursor === null || rawCursor === '' ? null : String(rawCursor);
  const rawHasMore = pagination.hasMorePath ? getPath(body, pagination.hasMorePath) : undefined;
  const hasMore = typeof rawHasMore === 'boolean' ? rawHasMore : nextCursor !== null;
  const rawTotal = pagination.totalCountPath ? getPath(body, pagination.totalCountPath) : undefined;
  const totalCount = typeof rawTotal === 'number' ? rawTotal : rawTotal !== undefined && !isNaN(Number(rawTotal)) ? Number(rawTotal) : undefined;
  return { nextCursor, hasMore, totalCount };
}
