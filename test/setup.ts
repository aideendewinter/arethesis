import 'fake-indexeddb/auto';
import { afterEach } from 'vitest';

afterEach(() => {
  document.body.innerHTML = '';
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    /* storage unavailable */
  }
});
