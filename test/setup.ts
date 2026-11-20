import 'fake-indexeddb/auto';
// Tests use the full defaults (mixins and plugins by name, app.collab), as `import 'arethesis'` does.
import '../src/defaults';
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
