/**
 * `<a-toast>`, `toast()` and `connectToasts()`. Importing this module defines the element.
 *
 * @module components/toast
 */

import { Toaster, defineToaster, toast, connectToasts } from '../toast';

defineToaster();

export { Toaster, toast, connectToasts };
export type { ToastOptions, ToastHandle, ToastKind, ConnectToastsOptions } from '../toast';
