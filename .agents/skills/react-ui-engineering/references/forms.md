# Forms

**Read when:** building a form, adding fields, validating input, choosing between controlled `useState` and React Hook Form.

## When to use React Hook Form + Zod

**[HIGH]** Use RHF + Zod when **any** holds: ≥ 3 fields; cross-field validation (`confirmPassword === password`, "at least one of these three"); a multi-step flow (wizard, tabs sharing validation); dirty-tracking (disable Save until changed, warn on unsaved navigate-away); or schema reuse across submit, API parsing and edit pre-fill. Below that (a 1–2 field input, search box, inline edit), controlled `useState` is fine.

Stack: Zod defines the schema and the values type (`z.infer`), RHF owns register/state/validation/submit, `zodResolver` (`@hookform/resolvers/zod`) joins them.

## Schema and setup

**[HIGH] The schema is the source of truth; the values type is inferred.** Reuse it for the mutation input instead of redeclaring the shape. It lives in the module (`modules/<domain>/api/schemas.ts` or `types.ts`).

```ts
export const createAgentSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().max(500).optional(),
  model: z.enum(["sonnet", "opus", "haiku"]),
  systemPrompt: z.string().min(1),
  required: z.boolean().default(false),
});
export type CreateAgentValues = z.infer<typeof createAgentSchema>;
```

```tsx
const form = useForm<CreateAgentValues>({
  resolver: zodResolver(createAgentSchema),
  defaultValues: { name: "", description: "", model: "sonnet", systemPrompt: "", required: false },
  mode: "onBlur",
});
const createAgent = useCreateAgent({ onSuccess: closeDialog });
const onSubmit = form.handleSubmit((values) => createAgent.mutateAsync(values));
```

- Always set `defaultValues` explicitly; `undefined` renders uncontrolled inputs on first render and RHF warns.
- `mode: "onBlur"` is a good default: validate on leaving a field, not every keystroke.
- Submit through a mutation, never `fetch` in the handler.

## Field components

**[HIGH] Wrap common fields (text, textarea, select, checkbox) in `FormField` components** that standardize label + input + error, in `src/components/form/`:

```tsx
interface Props {
  name: string;
  label: string;
  control: Control<any>;
  rules?: Parameters<Control["register"]>[1];
  placeholder?: string;
  autoFocus?: boolean;
}
export function FormTextField({ name, label, control, rules, placeholder, autoFocus }: Props) {
  return (
    <Controller
      control={control}
      name={name}
      rules={rules}
      render={({ field, fieldState }) => (
        <div className="flex flex-col gap-1">
          <label htmlFor={name} className="text-sm font-medium">{label}</label>
          <input {...field} id={name} placeholder={placeholder} autoFocus={autoFocus}
            className={cn("input", fieldState.invalid && "input-error")} />
          {fieldState.error && <span className="text-xs text-danger">{fieldState.error.message}</span>}
        </div>
      )}
    />
  );
}

<FormTextField control={form.control} name="name" label="Name" autoFocus />
```

**[MODERATE]** `Controller` for anything but plain inputs (selects, custom components, date pickers); `register` for plain `<input>`/`<textarea>`; never both on one field.

## Validation

**[HIGH]** Data-shape validation (`min(1)`, `max(500)`, `email()`, `enum(...)`) goes in the Zod schema, which is shared with the server; UX-only validation ("can't submit while an async check is pending") goes in `rules` or component logic.

Cross-field: `.refine()` / `.superRefine()`, with `path` telling RHF which field shows the error.

```ts
export const schema = z.object({
  password: z.string().min(8),
  confirmPassword: z.string(),
}).refine((v) => v.password === v.confirmPassword, { message: "Passwords must match", path: ["confirmPassword"] });
```

Async ("is this name taken?"): a debounced TQ query keyed on the value, plus `form.trigger(fieldName)` or `form.setError`. Check on blur or submit; don't block typing.

## Dirty-tracking and reset

Use `formState.isDirty` / `dirtyFields`: `disabled={!form.formState.isDirty || createAgent.isPending}`, and intercept route changes while dirty. Never hand-roll it with refs and deep-compares. After a successful submit, close the dialog (unmounting the form) or `form.reset(newDefaults)` if staying on the page.

## Server errors

Field-level failures ("Name already exists") go onto fields via `form.setError`; global failures (500, network) are toasted by the mutation's `meta.errorToast`, never duplicated in the form.

```ts
await createAgent.mutateAsync(values, {
  onError: (err) => {
    Object.entries(extractFieldErrors(err)).forEach(([name, message]) =>
      form.setError(name as keyof CreateAgentValues, { type: "server", message }));
  },
});
```

## Anti-patterns

- A `useState` mega-form (14 fields) → RHF + Zod.
- Manual dirty-tracking with refs or initial-state copies → `formState.isDirty`.
- Fetching in the submit handler → mutation.
- Validation duplicated in Zod and the component → shape in schema, UX in component.
- Missing `defaultValues`.
- `register` and `Controller` on the same field.
- Error UI that bypasses `formState.errors`.
