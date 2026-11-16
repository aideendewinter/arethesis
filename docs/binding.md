# Binding and validation

`DataBinder` connects data to DOM elements. Components use it automatically; you can also use it directly:

```ts
const handle = app.binder.bind(element, person, {
  fields: {
    name: {},                                                  // [data-bind="name"]
    salary: { displayType: 'currency', currency: 'EUR' },
    joined: { displayType: 'date', format: 'D MMM YYYY' },
    site: { displayType: 'link', linkText: 'Website' },
    email: { displayType: 'link', href: v => `mailto:${v}` },
    avatar: { selector: '.avatar', attribute: 'src' },
    bio: { displayType: 'html' },                              // sanitized
    role: { displayType: 'badge' },                            // <span class="badge" data-value="…">
  },
});
handle.update(nextPerson); // only changed fields touch the DOM
handle.unbind();
```

## Display types

`text` · `html` · `date` · `datetime` · `time` · `relative` ("3 minutes ago") · `currency` · `number` · `percent` · `boolean` · `image` · `link` · `tag` · `badge` · `tags`

Options: `format` (a function, or a date pattern with `YYYY YY MM M DD D HH H hh h mm ss A` and `[literal text]`), `locale`, `currency`, `intl`, `emptyText`, `booleanLabels`, `visible: (value, data) => boolean`, `attribute`, `href`, `linkText`.

`relative` times stay current on their own: "now" becomes "1 minute ago", then "2 minutes ago", and so on.
- **Timing:** one shared timer serves every field on the page. It refreshes every few seconds for recent times, and only hourly once a time reads in days.
- **Background tabs:** a tab that was hidden catches up as soon as it's shown again.
- **Cleanup:** elements are forgotten once they leave the page.
- **Markup:** on a `<time>` element, the `datetime` attribute is set too. The exact date and time is shown as a hover `title`, unless your template sets its own.
- **Opting out:** set `live: false` on a field to stop it updating.

URLs written to `href`/`src` (directly or through `attribute`) are sanitized: `javascript:` and similar schemes are dropped. `html` is sanitized with an allowlist unless you set `trusted: true`.

## Two-way binding

Inputs are filled from data. With `twoWay: true`, valid edits are passed to `onChange` (components write them back to the store and emit `data-change`):

```ts
app.binder.bind(form, person, {
  fields: {
    name: { twoWay: true },
    birthday: { twoWay: true },                       // <input type="date"> handled in local time
    tags: { inputType: 'tags', twoWay: true },        // "a, b" ⇄ ['a', 'b']
    bio: { inputType: 'rich-text', twoWay: true },    // contenteditable, sanitized
  },
  onChange: (field, value) => save(field, value),
});
```

A focused input is never overwritten by incoming updates while the user is typing.

## Validation

```ts
fields: {
  email: { validation: { label: 'Email', rules: [{ type: 'required' }, { type: 'email' }] } },
  password: { validation: { rules: [{ type: 'minLength', params: { min: 8 } }] } },
  confirm: { validation: { rules: [{ type: 'equals', params: { field: 'password' }, message: 'Passwords don’t match' }] } },
},
validateOn: ['blur', 'change'],   // default; fields also revalidate on input once they've shown an error
showErrorSummary: true,           // renders into [data-error-summary] (created if missing)
onValidationError: errors => {},
```

Errors are linked to their inputs with `aria-invalid` and `aria-describedby`. Put an element with `data-error-for="field"` anywhere in the form to control where a message appears. `await handle.validate()` validates everything and returns `{ valid, errors }`.

### Built-in validators

`required` · `email` · `url` · `phone` · `minLength {min}` · `maxLength {max}` · `numeric` · `integer` · `min {min}` · `max {max}` · `between {min,max}` · `pattern {pattern, flags}` · `oneOf {values}` · `equals {field}` · `date` · `custom {fn}`

Rules accept `params`, `message` (with `{param}` and `{label}` placeholders) and `when: data => boolean`.

### Your own validators

```ts
app.validation.registerValidator('companyEmail',
  value => !value || String(value).endsWith('@example.org'),
  { message: 'Use your company address' });

app.validation.registerValidator('available', async (value, params, { signal }) => {
  const res = await fetch(`/api/check?u=${value}`, { signal });
  return (await res.json()).available || 'That one is taken';
});
```

Validators return `true`/`false`, an error message, or `{ valid, message }`, synchronously or asynchronously. Stale async results are discarded: `signal` aborts when a newer value is being checked.

Translate the built-in messages with `init({ validation: { messages: { required: 'Obligatoire' } } })` or `app.validation.setMessage()`.
