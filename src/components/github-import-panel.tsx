"use client";

import { useState, useTransition } from "react";
import type {
  GithubRepoFixture,
  RepoSelectionItem,
} from "@/services/github-import";
import {
  importGithubBatchAction,
  syncGithubReposAction,
} from "@/app/actions/projects";

export function GithubImportPanel({
  connected,
  items,
  forkExplainer,
  cap,
}: {
  connected: boolean;
  items: RepoSelectionItem[];
  forkExplainer: string;
  cap: number;
}) {
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const item of items) {
      if (item.preselected && initial.size < cap) {
        initial.add(item.repo.id);
      }
    }
    return initial;
  });
  const [visibleLimit, setVisibleLimit] = useState(cap);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!connected) {
    return (
      <section className="section-card">
        <h2>GitHub repository import</h2>
        <p className="muted">
          Connect your GitHub account through your Clerk profile menu to list
          and import your public repositories. Only public repository metadata
          and dependency manifests are read.
        </p>
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <section className="section-card">
        <h2>GitHub repository import</h2>
        <p className="empty-state">
          No public GitHub repositories were found on your connected account.
        </p>
      </section>
    );
  }

  const visibleItems = items.slice(0, visibleLimit);
  const selectedRepos: GithubRepoFixture[] = items
    .filter((i) => checkedIds.has(i.repo.id))
    .map((i) => i.repo);

  function toggleRepo(id: string) {
    setErrorMessage(null);
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleImport() {
    setErrorMessage(null);
    setStatusMessage(null);
    const batch = selectedRepos.slice(0, cap);
    if (batch.length === 0) {
      setErrorMessage("Select at least one repository to import.");
      return;
    }
    startTransition(async () => {
      const res = await importGithubBatchAction(batch);
      if (!res.ok) {
        setErrorMessage(res.message ?? "Import failed");
      } else {
        setStatusMessage(
          `Imported ${res.importedCount ?? batch.length} repositories into your project bank.`
        );
      }
    });
  }

  function handleSyncNow() {
    setErrorMessage(null);
    setStatusMessage(null);
    const batch = selectedRepos.slice(0, cap);
    if (batch.length === 0) {
      setErrorMessage("Select at least one repository to sync.");
      return;
    }
    startTransition(async () => {
      const res = await syncGithubReposAction(batch);
      if (!res.ok) {
        setErrorMessage(res.message ?? "Sync failed");
      } else {
        setStatusMessage(
          `Synced ${res.syncedCount ?? batch.length} repositories on demand.`
        );
      }
    });
  }

  return (
    <section className="section-card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h2>GitHub repository import</h2>
          <p className="muted" style={{ marginTop: "0.25rem" }}>
            Active non-forks with commits, README, and recent activity start
            selected. Batch limit: {cap} repositories per import (
            {selectedRepos.length} selected).
          </p>
        </div>
        <div className="row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={isPending || selectedRepos.length === 0}
            onClick={handleImport}
          >
            {isPending
              ? "Working..."
              : `Import selected (${Math.min(selectedRepos.length, cap)})`}
          </button>
          <button
            type="button"
            className="btn"
            disabled={isPending || selectedRepos.length === 0}
            onClick={handleSyncNow}
          >
            Sync now
          </button>
        </div>
      </div>

      <p className="muted" style={{ marginTop: "0.5rem" }}>
        Fork rule: {forkExplainer}. Forks selected manually import with zero
        evidence points.
      </p>

      {errorMessage && (
        <div className="alert alert-danger" role="alert">
          {errorMessage}
        </div>
      )}
      {statusMessage && (
        <div className="alert" role="status">
          {statusMessage}
        </div>
      )}

      <ul className="item-list" style={{ marginTop: "0.75rem" }}>
        {visibleItems.map(({ repo, reason }) => {
          const isChecked = checkedIds.has(repo.id);
          return (
            <li key={repo.id} className="item-row">
              <label
                className="row"
                style={{ cursor: "pointer", flex: 1, alignItems: "flex-start" }}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggleRepo(repo.id)}
                  style={{ width: "auto", marginTop: "0.25rem" }}
                />
                <div>
                  <div className="row">
                    <strong>{repo.fullName}</strong>
                    {repo.language && (
                      <span className="badge badge-neutral">
                        {repo.language}
                      </span>
                    )}
                    {repo.fork && (
                      <span className="badge badge-warn">Fork (0 pts)</span>
                    )}
                  </div>
                  {repo.description && (
                    <p className="muted" style={{ marginTop: "0.2rem" }}>
                      {repo.description}
                    </p>
                  )}
                  <p className="muted" style={{ fontSize: "0.78rem" }}>
                    {reason}
                  </p>
                </div>
              </label>
            </li>
          );
        })}
      </ul>

      {visibleLimit < items.length && (
        <div style={{ marginTop: "0.75rem" }}>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setVisibleLimit((prev) => prev + cap)}
          >
            Import more ({items.length - visibleLimit} remaining)
          </button>
        </div>
      )}
    </section>
  );
}
