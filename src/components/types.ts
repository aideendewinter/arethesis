/**
 * Component types.
 *
 * @module components/types
 */

import type { ObjectRef, ListView, StoredObject } from '../data/types';

export type ComponentState = 'idle' | 'loading' | 'loaded' | 'empty' | 'error';

export interface DefineComponentOptions {
  /** Custom element name (must contain a hyphen). */
  tag: string;
  /** URL of an HTML file with one or more `<template id="...">` elements. */
  template?: string;
  /** Inline HTML (same format as a template file). Takes precedence over `template`. */
  html?: string;
  /** Template id for the main state. @default 'main' */
  templateId?: string;
}

export interface ComponentMetadata extends DefineComponentOptions {
  /** Cache key used by the template loader. */
  templateKey?: string;
}

/** What a component can bind to. */
export type BindSource = ObjectRef | ListView;

/** Async function that produces data, used with `fetchData()`. */
export type DataFetcher<T> = () => Promise<T>;

export type { StoredObject };
