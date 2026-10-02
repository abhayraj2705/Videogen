"use client";

import type { FactLedger } from "@sitereel/shared";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { FactBadge } from "@/components/editor/fact-badge";
import { groundText } from "@/lib/editor/grounding";
import { ASSET_PROP_KEYS, SOURCE_PROP_KEYS } from "@/lib/editor/templates";

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

function humanize(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

/**
 * Generic editor for a template's props: every string leaf becomes a text
 * field with a fact badge, numbers become number inputs, arrays/objects
 * recurse. Asset locators (logo/screenshot URLs, cursor paths) are skipped —
 * they're resolved by the Build stage — and `sourcePageUrl` is a picker over
 * the pages the facts came from. Works for all 10 templates without a
 * per-template form, so new templates don't need UI changes.
 */
export function PropsEditor({
  props,
  onChange,
  factIds,
  facts,
  sourcePages,
  idPrefix,
}: {
  props: Record<string, unknown>;
  onChange: (next: Record<string, unknown>, path: string) => void;
  factIds: string[];
  facts: FactLedger;
  sourcePages: string[];
  idPrefix: string;
}) {
  const entries = Object.entries(props).filter(([k]) => !ASSET_PROP_KEYS.has(k));
  if (entries.length === 0) return <p className="text-xs text-muted-foreground">This template has no editable text.</p>;
  return (
    <div className="flex flex-col gap-3">
      {entries.map(([key, value]) => (
        <Field
          key={key}
          label={humanize(key)}
          path={key}
          value={value as Json}
          sourcePicker={SOURCE_PROP_KEYS.has(key)}
          sourcePages={sourcePages}
          factIds={factIds}
          facts={facts}
          idPrefix={idPrefix}
          onChange={(v) => onChange({ ...props, [key]: v }, key)}
        />
      ))}
    </div>
  );
}

function Field({
  label,
  path,
  value,
  onChange,
  sourcePicker,
  sourcePages,
  factIds,
  facts,
  idPrefix,
}: {
  label: string;
  path: string;
  value: Json;
  onChange: (v: Json) => void;
  sourcePicker?: boolean;
  sourcePages: string[];
  factIds: string[];
  facts: FactLedger;
  idPrefix: string;
}) {
  const id = `${idPrefix}-${path.replace(/[^\w-]/g, "_")}`;

  if (sourcePicker && (typeof value === "string" || value === null)) {
    const options = Array.from(new Set([...(value ? [value] : []), ...sourcePages]));
    return (
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-xs text-muted-foreground">
          {label}
        </label>
        <Select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
          {options.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </Select>
      </div>
    );
  }

  if (typeof value === "string") {
    const long = value.length > 60;
    const g = groundText(value, factIds, facts);
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={id} className="text-xs text-muted-foreground">
            {label}
          </label>
          {value.trim() && <FactBadge grounding={g} />}
        </div>
        {long ? (
          <Textarea id={id} value={value} rows={3} onChange={(e) => onChange(e.target.value)} />
        ) : (
          <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
        )}
      </div>
    );
  }

  if (typeof value === "number") {
    return (
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-xs text-muted-foreground">
          {label}
        </label>
        <Input id={id} type="number" value={value} onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))} />
      </div>
    );
  }

  if (typeof value === "boolean") {
    return (
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} /> {label}
      </label>
    );
  }

  if (Array.isArray(value)) {
    return (
      <fieldset className="flex flex-col gap-2 rounded-md border border-border p-2">
        <legend className="px-1 text-xs text-muted-foreground">{label}</legend>
        {value.map((item, i) => (
          <Field
            key={i}
            label={`${label.replace(/s$/, "")} ${i + 1}`}
            path={`${path}.${i}`}
            value={item}
            sourcePages={sourcePages}
            factIds={factIds}
            facts={facts}
            idPrefix={idPrefix}
            onChange={(v) => onChange(value.map((x, j) => (j === i ? v : x)))}
          />
        ))}
      </fieldset>
    );
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([k]) => !ASSET_PROP_KEYS.has(k));
    return (
      <div className="flex flex-col gap-2 border-l border-border pl-2">
        {entries.map(([k, v]) => (
          <Field
            key={k}
            label={`${label} · ${humanize(k)}`}
            path={`${path}.${k}`}
            value={v}
            sourcePicker={SOURCE_PROP_KEYS.has(k)}
            sourcePages={sourcePages}
            factIds={factIds}
            facts={facts}
            idPrefix={idPrefix}
            onChange={(nv) => onChange({ ...value, [k]: nv })}
          />
        ))}
      </div>
    );
  }

  return null;
}
