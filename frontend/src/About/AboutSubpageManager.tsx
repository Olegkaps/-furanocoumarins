import { useState } from "react";
import { ABOUT_ICON_CHOICES, type AboutSubpage } from "./aboutSubpageTypes";

function newID() {
  return `page-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

export function AboutSubpageManager({ pages, onSave }: { pages: AboutSubpage[]; onSave: (pages: AboutSubpage[]) => Promise<void> }) {
  const [draft, setDraft] = useState(pages);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const replace = (index: number, patch: Partial<AboutSubpage>) => setDraft((current) => current.map((page, i) => i === index ? { ...page, ...patch } : page));

  return <section className="about-subpage-manager" aria-label="Manage About subpages">
    <h2>About subpages</h2>
    <p className="about-subpage-manager__hint">Add up to 15 links. Select a link on this page to edit its Markdown content.</p>
    {draft.map((page, index) => <div className="about-subpage-manager__row" key={page.id}>
      <input aria-label={`Subpage ${index + 1} name`} value={page.name} onChange={(event) => replace(index, { name: event.target.value })} maxLength={80} />
      <select aria-label={`Subpage ${index + 1} icon`} value={page.icon} onChange={(event) => replace(index, { icon: event.target.value })}>
        {ABOUT_ICON_CHOICES.map((icon) => <option key={icon.value} value={icon.value}>{icon.label}</option>)}
      </select>
      <button type="button" className="btn" onClick={() => setDraft((current) => current.filter((_, i) => i !== index))}>Remove</button>
    </div>)}
    <div className="about-subpage-manager__actions">
      <button type="button" className="btn" disabled={draft.length >= 15} onClick={() => setDraft((current) => [...current, { id: newID(), name: "New page", icon: "document" }])}>Add subpage</button>
      <button type="button" className="btn btn-primary" disabled={saving} onClick={async () => {
        setSaving(true); setError(null);
        try { await onSave(draft); } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); } finally { setSaving(false); }
      }}>{saving ? "Saving…" : "Save subpages"}</button>
    </div>
    {error && <p style={{ color: "var(--color-danger)" }}>{error}</p>}
  </section>;
}
