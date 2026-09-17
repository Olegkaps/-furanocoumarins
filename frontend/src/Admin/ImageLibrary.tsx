import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { api, getToken } from "./utils";

type Image = { id: string; url: string; name: string; size: number };
const endpoint = "/admin/images";

function errorMessage(error: unknown) {
  const response = (error as { response?: { status?: number; data?: { error?: unknown } } })?.response;
  const message = response?.data?.error;
  if (typeof message === "string" && message.trim()) return message;
  if (response?.status === 404) return "The image library is not available on this server yet. Deploy or restart the backend, then try again.";
  if (response?.status && response.status >= 500) return "Image storage is unavailable. Check the backend's S3 configuration and storage connection, then try again.";
  return "Could not update the image library. Please retry.";
}

export default function ImageLibrary() {
  const [images, setImages] = useState<Image[]>([]);
  const [notice, setNotice] = useState("Loading images…");
  const [busy, setBusy] = useState(false);
  const [pendingDeletion, setPendingDeletion] = useState<Image | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const headers = useCallback(() => ({ Authorization: `Bearer ${getToken()}` }), []);
  const load = useCallback(async () => {
    try { const { data } = await api.get<Image[]>(endpoint, { headers: headers() }); setImages(Array.isArray(data) ? data : []); setNotice(""); }
    catch (error) { setNotice(errorMessage(error)); }
  }, [headers]);
  useEffect(() => { void load(); }, [load]);

  const upload = async (event: ChangeEvent<HTMLInputElement>, id?: string) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setNotice("Images must be no larger than 5 MiB."); return; }
    const form = new FormData(); form.append("file", file);
    setBusy(true); setNotice(id ? "Replacing image…" : "Uploading image…");
    try {
      await (id ? api.put(`${endpoint}/${encodeURIComponent(id)}`, form, { headers: headers() }) : api.post(endpoint, form, { headers: headers() }));
      await load(); setNotice(id ? "Image replaced. Existing Markdown links keep working." : "Image uploaded. Copy its link for Markdown.");
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setBusy(false); }
  };
  const remove = async (image: Image) => {
    setBusy(true); setNotice("Deleting image…");
    try { await api.delete(`${endpoint}/${encodeURIComponent(image.id)}`, { headers: headers() }); await load(); setPendingDeletion(null); setNotice("Image deleted."); }
    catch (error) { setNotice(errorMessage(error)); }
    finally { setBusy(false); }
  };
  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); setNotice("Direct S3 image link copied."); }
    catch { setNotice("Could not access the clipboard. Copy the displayed link manually."); }
  };

  return <section className="image-library" aria-labelledby="image-library-title">
    <div className="image-library__heading"><div><h2 id="image-library-title">Image library</h2><p>Shared by all administrators. PNG, JPEG, or GIF; up to 5 MiB each; {images.length} / 100 images.</p></div>
      <button className="btn btn-primary" type="button" disabled={busy || images.length >= 100} onClick={() => input.current?.click()}>Upload image</button>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/gif" hidden onChange={event => void upload(event)} />
    </div>
    {notice && <p role="status" className="image-library__notice">{notice}</p>}
    <div className="image-library__grid">
      {images.map(image => <article className="image-library__card" key={image.id}>
        <img src={image.url} alt="" />
        <p title={image.name}>{image.name}</p><code>{image.url}</code>
        <div className="image-library__actions">
          {pendingDeletion?.id === image.id ? <>
            <span className="image-library__delete-warning" role="status">Delete this image?</span>
            <button className="btn btn-danger" type="button" disabled={busy} onClick={() => void remove(image)}>Delete image</button>
            <button className="btn" type="button" disabled={busy} onClick={() => setPendingDeletion(null)}>Cancel</button>
          </> : <>
            <button className="btn" type="button" disabled={busy} onClick={() => void copy(image.url)}>Copy direct link</button>
            <label className="btn" aria-disabled={busy}>Replace<input type="file" accept="image/png,image/jpeg,image/gif" hidden disabled={busy} onChange={event => void upload(event, image.id)} /></label>
            <button className="btn" type="button" disabled={busy} onClick={() => setPendingDeletion(image)}>Delete</button>
          </>}
        </div>
      </article>)}
    </div>
  </section>;
}
