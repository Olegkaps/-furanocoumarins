import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FileCode, TrashBin } from "@gravity-ui/icons";
import { ABOUT_ICON_CHOICES, type AboutSubpage } from "./aboutSubpageTypes";
import { AboutIcon } from "./aboutSubpages";

function newID() {
  return `page-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

export function AboutSubpageManager({
  pages,
  onSave,
  onEdit,
}: {
  pages: AboutSubpage[];
  onSave: (pages: AboutSubpage[]) => Promise<void>;
  onEdit: (id: string) => void;
}) {
  const [draft, setDraft] = useState(pages);
  const [saving, setSaving] = useState(false);
  const [iconPicker, setIconPicker] = useState<string | null>(null);
  const [iconPickerPosition, setIconPickerPosition] = useState<{ left: number; top: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const iconPickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => setDraft(pages), [pages]);
  useLayoutEffect(() => {
    if (!iconPicker || !iconPickerRef.current) return;
    const placePicker = () => {
      const picker = iconPickerRef.current;
      const trigger = picker?.querySelector<HTMLButtonElement>(".about-subpage-manager__icon-picker");
      const palette = picker?.querySelector<HTMLDivElement>(".about-subpage-manager__icons");
      if (!trigger || !palette) return;
      const triggerRect = trigger.getBoundingClientRect();
      const paletteRect = palette.getBoundingClientRect();
      const margin = 8;
      const below = window.innerHeight - triggerRect.bottom - margin;
      const above = triggerRect.top - margin;
      const top = below >= paletteRect.height || below >= above
        ? Math.max(margin, Math.min(window.innerHeight - paletteRect.height - margin, triggerRect.bottom + 4))
        : Math.max(margin, triggerRect.top - paletteRect.height - 4);
      const left = Math.max(margin, Math.min(triggerRect.left, window.innerWidth - paletteRect.width - margin));
      setIconPickerPosition({ left, top });
    };
    placePicker();
    window.addEventListener("resize", placePicker);
    window.addEventListener("scroll", placePicker, true);
    return () => {
      window.removeEventListener("resize", placePicker);
      window.removeEventListener("scroll", placePicker, true);
    };
  }, [iconPicker]);
  useEffect(() => {
    if (!iconPicker) return;
    const closePicker = (event: PointerEvent) => {
      if (event.target instanceof Node && !iconPickerRef.current?.contains(event.target)) setIconPicker(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIconPicker(null);
        iconPickerRef.current?.querySelector<HTMLButtonElement>(".about-subpage-manager__icon-picker")?.focus();
      }
    };
    document.addEventListener("pointerdown", closePicker);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closePicker);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [iconPicker]);
  const replace = (index: number, patch: Partial<AboutSubpage>) => setDraft((current) => current.map((page, i) => i === index ? { ...page, ...patch } : page));
  const saveAndOpen = async (id: string) => {
    setSaving(true); setError(null);
    try {
      await onSave(draft);
      onEdit(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return <section className="about-subpage-manager" aria-label="Edit About pages">
    <h2>Edit About pages</h2>
    <p className="about-subpage-manager__hint">Every subpage is Markdown. Add up to 15 pages, then open one to edit its content.</p>
    {draft.map((page, index) => <div className="about-subpage-manager__row" key={page.id}>
      <div className="about-subpage-manager__icon-picker-wrap" ref={iconPicker === page.id ? iconPickerRef : undefined}>
        <button type="button" className="btn about-subpage-manager__icon-picker" disabled={saving} aria-expanded={iconPicker === page.id} aria-controls={`about-subpage-icons-${page.id}`} aria-label={`Choose icon for ${page.name || `subpage ${index + 1}`}`} title="Choose icon" onClick={() => setIconPicker((current) => current === page.id ? null : page.id)}><AboutIcon icon={page.icon} size={18} /></button>
        {iconPicker === page.id &&
        <div id={`about-subpage-icons-${page.id}`} className="about-subpage-manager__icons" role="group" aria-label={`Subpage ${index + 1} icon`} style={iconPickerPosition ?? { visibility: "hidden" }}>
          {ABOUT_ICON_CHOICES.map((icon) => <button
            key={icon.value}
            type="button"
            className={`btn about-subpage-manager__icon${page.icon === icon.value ? " is-selected" : ""}`}
            aria-pressed={page.icon === icon.value}
            disabled={saving}
            aria-label={`Use ${icon.label} icon`}
            title={`Use ${icon.label} icon`}
            onClick={() => { replace(index, { icon: icon.value }); setIconPicker(null); }}
          ><AboutIcon icon={icon.value} size={18} /></button>)}
        </div>}
      </div>
      <input aria-label={`Subpage ${index + 1} name`} disabled={saving} value={page.name} onChange={(event) => replace(index, { name: event.target.value })} maxLength={80} />
      <button type="button" className="btn about-subpage-manager__control" disabled={saving} title="Open Markdown editor" aria-label={`Open Markdown editor for ${page.name || `subpage ${index + 1}`}`} onClick={() => void saveAndOpen(page.id)}><FileCode width={18} height={18} aria-hidden="true" /></button>
      <button type="button" className="btn about-subpage-manager__control" disabled={saving} title="Remove subpage" aria-label={`Remove ${page.name || `subpage ${index + 1}`}`} onClick={() => setDraft((current) => current.filter((_, i) => i !== index))}><TrashBin width={18} height={18} aria-hidden="true" /></button>
    </div>)}
    <div className="about-subpage-manager__actions">
      <button type="button" className="btn" disabled={saving || draft.length >= 15} onClick={() => setDraft((current) => [...current, { id: newID(), name: "New page", icon: "info" }])}>Add subpage</button>
      <button type="button" className="btn btn-primary" disabled={saving} onClick={async () => {
        setSaving(true); setError(null);
        try { await onSave(draft); } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); } finally { setSaving(false); }
      }}>{saving ? "Saving…" : "Save subpages"}</button>
    </div>
    {error && <p style={{ color: "var(--color-danger)" }}>{error}</p>}
  </section>;
}
