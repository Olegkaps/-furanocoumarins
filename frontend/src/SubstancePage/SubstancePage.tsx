import React, { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { useParams } from 'react-router-dom';
import { api, getToken } from '../Admin/utils';
import FullNavigation from '../FullNavigation/FullNavigation';

const MAX_CHARS = 10_000;

export default function SubstancePage() {
  const { smiles: smilesEncoded } = useParams<{ smiles: string }>();
  const smiles = smilesEncoded ? decodeURIComponent(smilesEncoded) : '';

  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchPage = useCallback(async () => {
    if (!smiles) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/pages/${encodeURIComponent(smiles)}`, { responseType: 'text' });
      const text = typeof res.data === 'string' ? res.data : '';
      setContent(text);
      setEditText(text);
    } catch (e: unknown) {
      const status = e && typeof e === 'object' && 'response' in e
        ? (e as { response?: { status?: number } }).response?.status
        : undefined;
      const msg = status === 404 ? null : 'Failed to load page';
      setError(msg || null);
      if (!msg) {
        setContent('');
        setEditText('');
      }
    } finally {
      setLoading(false);
    }
  }, [smiles]);

  useEffect(() => {
    fetchPage();
  }, [fetchPage]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!smiles) return;
    const text = editText;
    if ([...text].length > MAX_CHARS) {
      alert(`Text must not exceed ${MAX_CHARS} characters. Current: ${[...text].length}`);
      return;
    }
    setSaving(true);
    try {
      const token = getToken();
      await api.put(`/pages/${encodeURIComponent(smiles)}`, text, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          Authorization: `Bearer ${token}`,
        },
      });
      setContent(text);
      setEditMode(false);
      setEditText(text);
      setTimeout(() => fetchPage(), 1000);
    } catch {
      alert('Save failed');
    } finally {
      setSaving(false);
    }
  };

  const charCount = [...editText].length;
  const overLimit = charCount > MAX_CHARS;

  if (!smiles) {
    return (
      <>
        <FullNavigation />
        <div style={{ padding: '24px', maxWidth: '800px', margin: '0 auto' }}>
          <p style={{ color: '#666' }}>Invalid page.</p>
        </div>
      </>
    );
  }

  if (loading) {
    return (
      <>
        <FullNavigation />
        <div style={{ padding: '24px', maxWidth: '800px', margin: '0 auto' }}>
          Loading…
        </div>
      </>
    );
  }

  return (
    <>
      <FullNavigation />
      <div style={{ padding: '24px', maxWidth: '800px', margin: '0 auto' }}>
      <div key={smiles} style={{ marginBottom: '24px' }}>
        <canvas id={smiles} className="smiles" />
      </div>
      <div style={{ marginBottom: '8px', color: '#666', fontFamily: 'monospace', fontSize: '14px' }}>
        SMILES: {smiles}
      </div>
      {(getToken() ?? '') !== '' && !editMode && (
        <button
          type="button"
          onClick={() => setEditMode(true)}
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            marginBottom: '16px',
            padding: '8px 16px',
            cursor: 'pointer',
            borderRadius: '8px',
            border: '1px solid grey',
            backgroundColor: '#e1c8ff',
          }}
        >
          Edit
        </button>
      )}
      {editMode ? (
        <form onSubmit={handleSave}>
          <div style={{ marginBottom: '8px', color: overLimit ? 'red' : undefined }}>
            Characters: {charCount} / {MAX_CHARS}
          </div>
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            maxLength={MAX_CHARS + 100}
            style={{
              width: '100%',
              minHeight: '300px',
              padding: '12px',
              fontFamily: 'inherit',
              fontSize: '14px',
              border: '1px solid #ccc',
              borderRadius: '8px',
              boxSizing: 'border-box',
            }}
            placeholder="Text in Markdown format…"
          />
          <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
            <button
              type="submit"
              disabled={saving || overLimit}
              style={{
                padding: '8px 20px',
                cursor: overLimit || saving ? 'not-allowed' : 'pointer',
                borderRadius: '8px',
                border: '1px solid #333',
                background: overLimit || saving ? '#ccc' : '#e0e0e0',
              }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditMode(false);
                setEditText(content);
              }}
              style={{
                padding: '8px 20px',
                cursor: 'pointer',
                borderRadius: '8px',
                border: '1px solid #666',
                background: '#f5f5f5',
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          {error && <p style={{ color: 'red' }}>{error}</p>}
          {!error && content === '' && (
            <p style={{ color: '#666' }}>Page content has not been added yet.</p>
          )}
          {!error && content !== '' && (
            <div className="about-markdown" style={{ lineHeight: 1.6 }}>
              <ReactMarkdown>{content}</ReactMarkdown>
            </div>
          )}
        </>
      )}
      </div>
    </>
  );
}
