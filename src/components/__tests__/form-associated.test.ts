import { beforeEach, describe, expect, it } from 'vitest';
import { getArethesis } from '../../core/arethesis';
import { defineComponent } from '../decorators';
import { FormAssociatedComponent } from '../form-associated';
import { DataBinder } from '../../binding/data-binder';
import { flush } from '../../../test/helpers';

class TestRating extends FormAssociatedComponent<number> {
  protected get focusTarget(): HTMLElement {
    return this.querySelector('button')!;
  }
  protected serialize(value: number): string | null {
    return value ? String(value) : null;
  }
  protected parse(state: string): number {
    return Number(state);
  }
  protected emptyValue(): number {
    return 0;
  }
  protected override validate(value: number): string {
    return value > 5 ? 'At most 5' : '';
  }
  override onConnected(): void {
    if (!this.querySelector('button')) this.append(document.createElement('button'));
  }
  pick(value: number): void {
    this.commitValue(value);
  }
}
defineComponent({ tag: 'test-rating' })(TestRating);

const mount = async (html: string) => {
  document.body.innerHTML = html;
  await flush();
  return document.querySelector<TestRating>('test-rating')!;
};

describe('FormAssociatedComponent', () => {
  beforeEach(() => void getArethesis());

  it('is a form control with a name, value and change events', async () => {
    const el = await mount('<form><test-rating name="stars"></test-rating></form>');
    expect(TestRating.formAssociated).toBe(true);
    expect(el.name).toBe('stars');
    expect(el.value).toBe(0);
    const events: string[] = [];
    el.addEventListener('input', () => events.push('input'));
    el.addEventListener('change', () => events.push('change'));
    el.pick(4);
    expect(el.value).toBe(4);
    expect(events).toEqual(['input', 'change']);
    el.value = 2; // set by code: no events
    expect(events).toHaveLength(2);
    expect(el.form).toBe(document.querySelector('form'));
  });

  it('validates required, custom rules and custom errors', async () => {
    const el = await mount('<form><test-rating name="stars" required></test-rating></form>');
    expect(el.checkValidity()).toBe(false);
    expect(el.validationMessage).toMatch(/fill in/);
    el.pick(3);
    expect(el.checkValidity()).toBe(true);
    el.pick(9);
    expect(el.validationMessage).toBe('At most 5');
    el.pick(1);
    el.setCustomValidity('Taken');
    expect(el.checkValidity()).toBe(false);
    expect(el.reportValidity()).toBe(false);
    el.setCustomValidity('');
    expect(el.checkValidity()).toBe(true);
    el.required = false;
    expect(el.required).toBe(false);
  });

  it('resets to its first value and restores saved state', async () => {
    const el = await mount('<test-rating name="stars"></test-rating>');
    el.value = 3;
    el.pick(5);
    el.formResetCallback();
    expect(el.value).toBe(3);
    el.formStateRestoreCallback('4');
    expect(el.value).toBe(4);
    el.formDisabledCallback(true);
    expect(el.hasAttribute('data-form-disabled')).toBe(true);
    el.disabled = true;
    expect(el.disabled).toBe(true);
  });

  it('forwards focus and labels to its focus target', async () => {
    const el = await mount('<label for="r">Rating</label><test-rating id="r" name="stars"></test-rating>');
    await el.ready;
    await flush();
    const button = el.querySelector('button')!;
    el.focus();
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-labelledby')).toBe(document.querySelector('label')!.id);
  });

  it('is read and written by DataBinder like an input', async () => {
    const el = await mount('<div id="root"><test-rating data-bind="stars"></test-rating></div>');
    const binder = new DataBinder();
    const changes: unknown[] = [];
    const root = document.getElementById('root')!;
    binder.bind(root, { stars: 2 }, { fields: { stars: { twoWay: true, parse: Number } }, onChange: (_p, v) => changes.push(v) });
    expect(String(el.value)).toBe('2');
    el.pick(5);
    expect(changes).toContain(5);
  });
});
