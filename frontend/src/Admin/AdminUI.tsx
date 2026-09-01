import React, { useState, useEffect, useRef } from "react";
import { api, getToken, isTokenExists, delToken } from "./utils";
import { Navigate } from "react-router-dom";
import {
  CirclePlus,
  TrashBin,
  CrownDiamond,
  FileArrowDown,
} from "@gravity-ui/icons";
import config from "../config";
import "./Admin.css";

class Table {
  version: string;
  name: string;
  created_at: string;
  is_active: boolean;
  is_ok: boolean;

  constructor(
    version: string,
    name: string,
    created_at: string,
    is_active: boolean,
    is_ok: boolean,
  ) {
    this.version = version;
    this.name = name;
    this.created_at = created_at;
    this.is_active = is_active;
    this.is_ok = is_ok;
  }
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(new DOMException("Import status polling cancelled", "AbortError"));
			return;
		}
		const onAbort = () => {
			window.clearTimeout(timer);
			reject(new DOMException("Import status polling cancelled", "AbortError"));
		};
		const timer = window.setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, milliseconds);
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

const AdminPage: React.FC = () => {
  const [tables, setTables] = useState(Array<Table>);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [googleSheetFile, setGoogleSheetFile] = useState<File>();
  const [googleSheetName, setGoogleSheetName] = useState("");
  const [googleMetaList, setGoogleMetaList] = useState("");
  const [showSaveBibtex, setShowSaveBibtex] = useState(false);
  const [bibtexFile, setBibtexFile] = useState<File>();
  const [tokenBroken, setTokenBroken] = useState(false);
	const [tableNotice, setTableNotice] = useState("");
	const importPoll = useRef<AbortController | null>(null);

  const token = getToken();

  const fetchTables = async (signal?: AbortSignal): Promise<Table[]> => {
    const token = getToken();
    if (!token) {
      setTokenBroken(true);
      return [];
    }
    const response = await api.post(
	  "/get-tables-list",
	  {},
	  { headers: { Authorization: `Bearer ${token}` }, signal },
	);

    if (response?.status === 401) {
      delToken();
      setTokenBroken(true);
      return [];
    }

	const nextTables = (response.data ?? []).sort((a: Table, b: Table) => {
        const date_b = new Date(b.created_at);
        const date_a = new Date(a.created_at);
        if (date_a < date_b) return -1;
        if (date_a > date_b) return 1;
        return 0;
	});
	setTables(nextTables);
	return nextTables;
  };

  useEffect(() => {
	if (token && !tokenBroken) void fetchTables().catch(() => setTableNotice("Could not load tables; retry the page."));
  }, [token, tokenBroken]);

	useEffect(() => () => importPoll.current?.abort(), []);

  if (!isTokenExists() || tokenBroken) {
    return <Navigate to="/login" />;
  }

  const handleCreateTable = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = getToken();
    const bodyFormData = new FormData();

    if (!googleSheetFile) {
      alert("error: no file");
      return;
    }
    bodyFormData.append("file", googleSheetFile);
    bodyFormData.append("meta", googleMetaList);
    bodyFormData.append("name", googleSheetName);
	const submittedName = googleSheetName;
	setTableNotice(`Uploading ${submittedName}…`);
	importPoll.current?.abort();
	const controller = new AbortController();
	importPoll.current = controller;
	let accepted = false;
	try {
		const response = await api.post("/create-table", bodyFormData, {
			headers: { Authorization: `Bearer ${token}` },
			signal: controller.signal,
		});
		accepted = true;
		setShowCreateForm(false);
		const importID = String(response.data?.import_id ?? "");
		if (!importID) throw new Error("missing import identifier");
		setTableNotice(`Importing ${submittedName}…`);
		await waitForImport(importID, submittedName, controller.signal);
	} catch (error: unknown) {
		if (controller.signal.aborted) return;
		const status = (error as { response?: { status?: number } })?.response?.status;
		if (!accepted && status === 409) {
			setShowCreateForm(true);
			setTableNotice("Another import is running. Your file and form values are preserved; wait for it to finish, then retry.");
			return;
		}
		setTableNotice(accepted
			? `Could not determine the final status of ${submittedName}. Reload the table list before retrying.`
			: `Upload failed for ${submittedName}; check the file and retry.`);
	}
  };

	const waitForImport = async (importID: string, name: string, signal: AbortSignal) => {
		const deadline = Date.now() + 120_000;
		while (Date.now() < deadline) {
			let status: { data?: { state?: unknown } };
			try {
				status = await api.get(`/table-imports/${encodeURIComponent(importID)}`, {
					headers: { Authorization: `Bearer ${getToken()}` },
					signal,
				});
			} catch (error: unknown) {
				if (signal.aborted) throw error;
				const code = (error as { response?: { status?: number } })?.response?.status;
				try { await fetchTables(signal); } catch { /* retain terminal recovery text */ }
				setTableNotice(code === 404
					? `${name} import status is unavailable; the server may have restarted. Check the table list before retrying.`
					: `Could not read ${name} import status. Reload the table list before retrying.`);
				return;
			}
			const state = status.data?.state;
			if (state === "ready") {
				try {
					await fetchTables(signal);
					setTableNotice(`${name} is Ready`);
				} catch {
					setTableNotice(`${name} is Ready, but the table list could not refresh. Reload the page.`);
				}
				return;
			}
			if (state === "broken") {
				try { await fetchTables(signal); } catch { /* keep the terminal failure visible */ }
				setTableNotice(`${name} import failed (Broken). Check your email or backend logs, then correct the workbook and retry.`);
				return;
			}
			if (state !== "importing") {
				try { await fetchTables(signal); } catch { /* retain malformed-response notice */ }
				setTableNotice(`${name} import returned an invalid status. Reload the table list before retrying.`);
				return;
			}
			await abortableDelay(1000, signal);
		}
		setTableNotice(`${name} import timed out. It may still be running; reload the table list before retrying.`);
	};

  const handleSetActiveTable = async (
    e: React.FormEvent,
    tableTimestamp: string,
  ) => {
    e.preventDefault();
    const token = getToken();
	setTableNotice("Activating table…");
	try {
		await api.post(
			"/make-table-active/" + tableTimestamp,
			{},
			{ headers: { Authorization: `Bearer ${token}` } },
		);
		await fetchTables();
		setTableNotice("Table is Active");
	} catch (error: unknown) {
		const detail = (error as { response?: { data?: { error?: unknown } } })?.response?.data?.error;
		setTableNotice(typeof detail === "string" && detail.length > 0
			? detail
			: "Could not activate the table. The previous active table was preserved; retry or inspect backend logs.");
	}
  };

  const handleDeleteTable = async (
    e: React.FormEvent,
    tableTimestamp: string,
  ) => {
    e.preventDefault();
    const token = getToken();

    await api
      .delete(`/table/` + tableTimestamp, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .catch((err) => err.response);

    setTimeout(() => fetchTables(), 3000);
  };

  const handleDeleteBadTables = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = getToken();

    await api
      .delete(`/tables`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .catch((err) => err.response);

    setTimeout(() => fetchTables(), 3000);
  };

  const handleSaveBibtex = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = getToken();
    const bodyFormData = new FormData();

    if (!bibtexFile) {
      alert("error: no file");
      return;
    }
    bodyFormData.append("file", bibtexFile);

    setTimeout(async () => {
      const response = await api
        .put("/bibtex", bodyFormData, {
          headers: { Authorization: `Bearer ${token}` },
        })
        .catch((err) => err.response);

      if (response?.status >= 400) {
        alert("cannot update file");
      }
    }, 100);
    setShowSaveBibtex(false);
  };

  return (
    <div className="admin-page">
      <div className="admin-topbar" data-tour="admin-topbar">
        <div>
          <h2 className="admin-topbar__title">Tables</h2>
          <p className="admin-topbar__meta">
            {tables.length} / {config["MAX_TABLES_COUNT"]} used
          </p>
        </div>
        <div className="admin-topbar__actions">
          <button
            type="button"
            className="btn"
            onClick={() => setShowSaveBibtex(true)}
            title="Update BibTeX"
          >
            <FileArrowDown width={18} height={18} />
            Update BibTeX
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={handleDeleteBadTables}
            title="Remove broken tables"
          >
            <TrashBin width={18} height={18} />
            Clear broken
          </button>
        </div>
      </div>
	  {tableNotice && <p role="status" data-testid="table-notice">{tableNotice}</p>}

      {showCreateForm && (
        <div className="admin-modal" role="dialog" aria-modal="true">
          <form className="admin-modal__dialog" onSubmit={handleCreateTable}>
            <h3>Create table from XLSX</h3>
            <label>
              Spreadsheet file
              <input
                type="file"
                required
                onChange={(e) => setGoogleSheetFile(e.target.files?.[0])}
              />
            </label>
            <label>
              Table name
              <input
                type="text"
                required
                value={googleSheetName}
                onChange={(e) => setGoogleSheetName(e.target.value)}
                placeholder="Name of table"
              />
            </label>
            <label>
              Metadata list
              <input
                type="text"
                required
                value={googleMetaList}
                onChange={(e) => setGoogleMetaList(e.target.value)}
                placeholder="List with metadata"
              />
            </label>
            <div className="admin-modal__actions">
              <button type="submit" className="btn btn-primary">
                Create
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setShowCreateForm(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {showSaveBibtex && (
        <div className="admin-modal" role="dialog" aria-modal="true">
          <form className="admin-modal__dialog" onSubmit={handleSaveBibtex}>
            <h3>Update BibTeX file</h3>
            <label>
              BibTeX file
              <input
                type="file"
                required
                onChange={(e) => setBibtexFile(e.target.files?.[0])}
              />
            </label>
            <div className="admin-modal__actions">
              <button type="submit" className="btn btn-primary">
                Update
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setShowSaveBibtex(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {!showCreateForm && (
        <div className="admin-tables" data-tour="admin-tables">
          {tables?.map((table) => {
            const statusClass = table.is_active
              ? "is-active"
              : table.is_ok
                ? ""
                : "is-broken";
            return (
              <div
                key={table.created_at}
                className={`admin-table-card ${statusClass}`.trim()}
				data-table-name={table.name}
              >
                {table.is_active && (
                  <span className="admin-table-card__badge is-active">
                    <CrownDiamond width={14} height={14} />
                    Active
                  </span>
                )}
                {!table.is_active && !table.is_ok && (
                  <span className="admin-table-card__badge is-broken">
                    Broken
                  </span>
                )}
                {!table.is_active && table.is_ok && (
                  <span className="admin-table-card__badge">Ready</span>
                )}
                <h3>{table.name}</h3>
                <p>
                  <b>Created:</b>{" "}
                  {table.created_at.replace("T", " ").replace("Z", "")}
                </p>
                <p>Version: {table.version}</p>

                {!table.is_active && (
                  <div className="admin-table-card__actions">
                    {table.is_ok && (
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={(e) =>
                          handleSetActiveTable(e, table.created_at)
                        }
                      >
                        <CrownDiamond width={16} height={16} />
                        Activate
                      </button>
                    )}
                    {CheckTimeBeforeDeletion(table.created_at) && (
                      <button
                        type="button"
                        className="btn btn-danger"
                        onClick={(e) => handleDeleteTable(e, table.created_at)}
                        title="Delete table"
                        aria-label="Delete table"
                      >
                        <TrashBin width={18} height={18} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {tables.length < config["MAX_TABLES_COUNT"] && (
            <button
              type="button"
              className="admin-create-card"
              data-tour="admin-create"
              onClick={() => setShowCreateForm(true)}
            >
              <CirclePlus width={36} height={36} />
              Create table
            </button>
          )}
        </div>
      )}
    </div>
  );
};

const CheckTimeBeforeDeletion = (time: string) => {
  const date = new Date(time);
  const curr_time = new Date();
  curr_time.setMinutes(curr_time.getMinutes() - 5);
  return date < curr_time;
};

export default AdminPage;
