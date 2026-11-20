/**
 * `<a-dialog>` and `confirm()`. Importing this module defines the element.
 *
 * @module components/dialog
 */

import { Dialog, defineDialog, confirm } from '../dialog';

defineDialog();

export { Dialog, confirm };
export type { ConfirmOptions } from '../dialog';
