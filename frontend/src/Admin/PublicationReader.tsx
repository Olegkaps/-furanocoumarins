import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import axios from "axios";
import { api, getToken } from "./utils";
import { MAX_REVIEW_BYTES, readAnalysis, readDocument, readReviewBundle, readStatus, requestSlot } from "./publicationReaderModel";
import type { Analysis, Publication, ReaderStatus } from "./publicationReaderModel";
import { PublicationReaderView } from "./PublicationReaderView";
import "./PublicationReader.css";
import { analyzeInBrowser, defaultModels, validBrowserSettings } from "./browserPublicationAnalysis";
import type { BrowserProvider } from "./browserPublicationAnalysis";

const endpoint = "/admin/publication-reader";
function requestOptions(signal: AbortSignal) { return { signal, headers: { Authorization: `Bearer ${getToken()}` } }; }
function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 403) return "Administrator access is required.";
    if (error.response?.status === 401) return "Your session could not be verified. Sign in again.";
    if (error.response?.status === 413) return "The publication exceeds the server upload limit.";
    const message = error.response?.data?.error;
    if (typeof message === "string") return message;
    return "Request failed. Check the source and service availability, then retry.";
  }
  return error instanceof Error ? error.message : "Request failed.";
}

export default function PublicationReader() {
  const [status, setStatus] = useState<ReaderStatus | null>(null);
  const [statusError, setStatusError] = useState("");
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusAttempt, setStatusAttempt] = useState(0);
  const [mode, setMode] = useState<"file" | "url">("file");
  const [file, setFile] = useState<File | null>(null);
  const [url, setURL] = useState("");
  const [publication, setPublication] = useState<Publication | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState<"import" | "analysis" | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [provider, setProvider] = useState<BrowserProvider | "server">("openrouter");
  const [model, setModel] = useState(defaultModels.openrouter);
  const [apiKey, setAPIKey] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [reviewVersion, setReviewVersion] = useState(0);
  const work = useRef(requestSlot());

  useEffect(() => {
    const controller = new AbortController();
    setStatusLoading(true); setStatusError("");
    void api.get(`${endpoint}/status`, requestOptions(controller.signal)).then(response => {
      if (!controller.signal.aborted) setStatus(readStatus(response.data));
    }).catch(error => { if (!controller.signal.aborted) { setStatus(null); setStatusError(errorMessage(error)); } })
      .finally(() => { if (!controller.signal.aborted) setStatusLoading(false); });
    return () => controller.abort();
  }, [statusAttempt]);
  useEffect(() => { const slot = work.current; return () => slot.cancel(); }, []);

  function cancel() { work.current.cancel(); setBusy(null); setNotice("Request cancelled."); }
  function changeProvider(next: BrowserProvider | "server") {
    work.current.cancel(); setBusy(null); setAPIKey(""); setConfirmed(false); setAnalysis(null); setError("");
    setProvider(next); setModel(next === "server" ? "" : defaultModels[next]);
  }
  async function importReview(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_REVIEW_BYTES) { setError("Extraction JSON exceeds the 8 MiB limit."); return; }
    const request = work.current.begin();
    setBusy("import"); setError(""); setNotice(""); setConfirmed(false);
    try {
      const review = readReviewBundle(JSON.parse(await file.text()));
      if (!request.active()) return;
      setPublication(review.publication); setAnalysis(review.analysis); setReviewVersion(value => value + 1);
      setNotice("Imported unverified extraction. No model request was made.");
    } catch (error) { if (request.active()) setError(errorMessage(error)); }
    finally { if (request.active()) setBusy(null); }
  }
  const canAnalyze = !!status && !statusError && !statusLoading && !busy && confirmed &&
    !!publication?.pages.some(page => page.text.trim()) &&
    (provider === "server" ? status.configured : validBrowserSettings(provider, model, apiKey));
  async function importDocument(event: FormEvent) {
    event.preventDefault();
    let body: FormData | { url: string };
    if (mode === "file") {
      if (!file) return;
      if (status?.sourceBytes && file.size > status.sourceBytes) { setError(`The publication exceeds the ${status.sourceBytes / 1048576} MiB upload limit.`); return; }
      body = new FormData(); body.append("file", file);
    } else {
      try { const parsed = new URL(url.trim()); if (!["http:", "https:"].includes(parsed.protocol)) throw new Error(); }
      catch { setError("Enter an HTTP or HTTPS publication URL."); return; }
      body = { url: url.trim() };
    }
    const request = work.current.begin();
    setBusy("import"); setError(""); setNotice(""); setPublication(null); setAnalysis(null); setConfirmed(false);
    try {
      const response = await api.post(`${endpoint}/document`, body, requestOptions(request.signal));
      if (request.active()) setPublication(readDocument(response.data));
    } catch (error) { if (request.active()) setError(errorMessage(error)); }
    finally { if (request.active()) setBusy(null); }
  }
  async function analyze() {
    if (!publication || !canAnalyze) return;
    const request = work.current.begin();
    setBusy("analysis"); setAnalysis(null); setError(""); setNotice("");
    try {
      // Revalidate admin access immediately before sending text to any external provider.
      const verification = await api.get(`${endpoint}/status`, requestOptions(request.signal));
      const verified = readStatus(verification.data);
      if (!request.active()) return;
      setStatus(verified);
      if (provider === "server") {
        if (!verified.configured) throw new Error("Server Alice analysis is not configured.");
        const response = await api.post(`${endpoint}/analyze`, { document: { title: publication.title, pages: publication.pages } }, requestOptions(request.signal));
        if (request.active()) setAnalysis(readAnalysis(response.data));
      } else {
        const result = await analyzeInBrowser({ provider, model, apiKey, document: publication, confirmed, signal: request.signal });
        if (request.active()) setAnalysis(result);
      }
    } catch (error) { if (request.active()) setError(errorMessage(error)); }
    finally { if (request.active()) setBusy(null); }
  }

  return <div className="publication-reader">
    <form className="publication-reader__source" onSubmit={event => void importDocument(event)}>
      <fieldset disabled={busy === "import"}><legend>Publication source</legend>
        <div className="publication-reader__modes">
          <label><input type="radio" name="source" checked={mode === "file"} onChange={() => setMode("file")} /> File</label>
          <label><input type="radio" name="source" checked={mode === "url"} onChange={() => { setMode("url"); setFile(null); }} /> URL</label>
        </div>
        {mode === "file" ? <label>PDF, TXT or HTML<input type="file" accept=".pdf,.txt,.html,.htm,application/pdf,text/plain,text/html" onChange={event => setFile(event.target.files?.[0] ?? null)} /></label>
          : <label>Publication URL<input type="url" required value={url} onChange={event => setURL(event.target.value)} placeholder="https://" /></label>}
        <button className="btn" type="submit" disabled={mode === "file" ? !file : !url.trim()}>Import publication</button>
        {status?.sourceBytes && <span>Maximum upload: {status.sourceBytes / 1048576} MiB</span>}
      </fieldset>
    </form>
    <div className="publication-reader__review-import">
      <label>Extraction JSON<input type="file" accept=".json,application/json" disabled={!!busy} onChange={event => { void importReview(event.target.files?.[0]); event.target.value = ""; }} /></label>
    </div>
    <fieldset className="publication-reader__analysis-settings">
      <legend>Publication analysis</legend>
      <label>Provider<select value={provider} onChange={event => changeProvider(event.target.value as BrowserProvider | "server")}>
        <option value="openrouter">OpenRouter (browser, free models)</option><option value="groq">Groq (browser)</option><option value="gemini">Gemini (browser)</option><option value="server">Alice (server)</option>
      </select></label>
      {provider !== "server" && <>
        <label>Model<input value={model} disabled={!!busy} onChange={event => { setModel(event.target.value); setConfirmed(false); }} autoComplete="off" spellCheck={false} /></label>
        <label>API key<input type="password" value={apiKey} disabled={!!busy} onChange={event => { setAPIKey(event.target.value); setConfirmed(false); }} autoComplete="off" spellCheck={false} /></label>
      </>}
      <p>{provider === "openrouter" ? "Free models only: openrouter/free or a model ending in :free. Quotas apply; no paid fallback."
        : provider === "server" ? "Uses the server's configured Alice account and quota."
        : "Free-account quotas apply. A paid API key may incur charges; check your provider account. Whole papers may exceed token quotas."}</p>
      {provider !== "server" && <p>API key stays in this page's memory and is cleared when you switch provider or leave. Publication text goes directly to the provider.</p>}
      <label className="publication-reader__consent"><input type="checkbox" checked={confirmed} disabled={!!busy} onChange={event => setConfirmed(event.target.checked)} />I agree to send this publication to the selected provider and use its quota (and charges, if applicable).</label>
    </fieldset>
    <div className="publication-reader__toolbar">
      <p role="status">{statusLoading ? "Verifying administrator access..." : statusError ? `Access unavailable: ${statusError}` : status ? `Administrator access verified.${provider === "server" ? ` Server Alice: ${status.configured ? "configured" : "not configured"}.` : ""}` : "Administrator access has not been verified."}</p>
      <button className="btn" disabled={statusLoading || !!busy} onClick={() => setStatusAttempt(value => value + 1)}>Check configuration</button>
      <button className="btn btn-primary" disabled={!canAnalyze} onClick={() => void analyze()}>Analyze</button>
      {busy && <button className="btn" onClick={cancel}>Cancel</button>}
    </div>
    <p role="status" aria-live="polite">{busy === "import" ? "Importing publication..." : busy === "analysis" ? "Analyzing publication..." : notice}</p>
    {error && <p role="alert">{error}</p>}
    {[...(provider === "server" ? status?.warnings ?? [] : []), ...(publication?.warnings ?? []), ...(analysis?.warnings ?? [])].map((warning, index) => <p className="publication-reader__warning" key={index}>{warning}</p>)}
    {publication ? <PublicationReaderView key={`${reviewVersion}-${analysis ? "analyzed" : "pending"}`} publication={publication} analysis={analysis} /> : <p className="empty-state">No publication loaded.</p>}
  </div>;
}
