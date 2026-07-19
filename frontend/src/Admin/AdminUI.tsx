import React, { useState, useEffect } from "react";
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

const AdminPage: React.FC = () => {
  const [tables, setTables] = useState(Array<Table>);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [googleSheetFile, setGoogleSheetFile] = useState<File>();
  const [googleSheetName, setGoogleSheetName] = useState("");
  const [googleMetaList, setGoogleMetaList] = useState("");
  const [showSaveBibtex, setShowSaveBibtex] = useState(false);
  const [bibtexFile, setBibtexFile] = useState<File>();
  const [tokenBroken, setTokenBroken] = useState(false);

  if (!isTokenExists() || tokenBroken) {
    return <Navigate to="/login" />;
  }
  const token = getToken();

  const fetchTables = async () => {
    const token = getToken();
    if (!token) {
      setTokenBroken(true);
      return;
    }
    const response = await api
      .post(
        "/get-tables-list",
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      )
      .catch((err) => err.response);

    if (response?.status === 401) {
      delToken();
      setTokenBroken(true);
      return;
    }

    setTables(
      response.data?.sort((a: Table, b: Table) => {
        const date_b = new Date(b.created_at);
        const date_a = new Date(a.created_at);
        if (date_a < date_b) return -1;
        if (date_a > date_b) return 1;
        return 0;
      }),
    );

    if (response?.status >= 400) {
      alert("Error request");
    }
  };

  useEffect(() => {
    fetchTables();
  }, [token]);

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
    setShowCreateForm(false);

    const response = await api
      .post("/create-table", bodyFormData, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .catch((err) => err.response);

    if (response?.status === 400) {
      alert("Incorrect link");
    }

    setTimeout(() => fetchTables(), 3000);
  };

  const handleSetActiveTable = async (
    e: React.FormEvent,
    tableTimestamp: string,
  ) => {
    e.preventDefault();
    const token = getToken();

    await api
      .post(
        "/make-table-active/" + tableTimestamp,
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      )
      .catch((err) => err.response);

    setTimeout(() => fetchTables(), 3000);
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
