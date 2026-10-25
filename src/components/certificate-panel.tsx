"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  proposeCertificateMappingAction,
  retryCertificateVerificationAction,
  submitCertificateAction,
} from "@/app/actions/certificates";
import type { ProposedCertificateMapping } from "@/services/certificates";
import type { CertProviderConfig } from "@/services/seed-config";

export interface CertificateRowView {
  id: string;
  provider: string;
  verifyUrl: string;
  verifiedAtIso: string | null;
  courseName: string;
  issuedOnIso: string;
  skillLabels: string[];
  hasStorageKey: boolean;
}

export function CertificatePanel({
  providers,
  certificates,
  quizNudgeCopy,
}: {
  providers: CertProviderConfig[];
  certificates: CertificateRowView[];
  quizNudgeCopy: string;
}) {
  const [pending, startTransition] = useTransition();
  const [selectedProvider, setSelectedProvider] = useState<string>(
    providers[0]?.slug ?? "coursera"
  );
  const [customProvider, setCustomProvider] = useState<string>("");
  const [verifyUrl, setVerifyUrl] = useState<string>("");
  const [courseName, setCourseName] = useState<string>("");
  const [issuedOn, setIssuedOn] = useState<string>("");

  const [mapping, setMapping] = useState<ProposedCertificateMapping | null>(
    null
  );
  const [confirmedSkillIds, setConfirmedSkillIds] = useState<string[]>([]);
  const [pdfBytesBase64, setPdfBytesBase64] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeProviderConfig = providers.find(
    (p) => p.slug === selectedProvider
  );

  return (
    <section className="section-card">
      <h2>Certificates ({certificates.length})</h2>
      <p className="muted" style={{ marginBottom: "0.75rem" }}>
        Submit certificates from allowlisted providers with a public verify URL
        to record externally anchored evidence (decaying from the issue date).
        Off-list or unverified certificates are stored as claims with a one-line
        quiz verification path.{" "}
        <Link href="/how-levels-work">How levels work</Link>
      </p>

      {error && (
        <div
          className="alert alert-danger"
          role="alert"
          style={{ marginBottom: "0.75rem" }}
        >
          {error}
        </div>
      )}
      {warning && (
        <div
          className="alert"
          role="status"
          style={{ marginBottom: "0.75rem" }}
        >
          <strong>Name check warning:</strong> {warning}
        </div>
      )}
      {message && (
        <div
          className="alert"
          role="status"
          style={{ marginBottom: "0.75rem" }}
        >
          {message}
        </div>
      )}

      {!mapping ? (
        <form
          className="stack"
          style={{ marginBottom: "1rem" }}
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            setMessage(null);
            setWarning(null);
            const form = e.currentTarget;
            const fd = new FormData(form);
            const effectiveProvider =
              selectedProvider === "__custom__"
                ? customProvider.trim() || "custom"
                : selectedProvider;
            fd.set("provider", effectiveProvider);

            startTransition(async () => {
              const res = await proposeCertificateMappingAction(fd);
              if (!res.ok) {
                setError(res.message);
                return;
              }
              setMapping(res.mapping);
              setCourseName(res.mapping.courseName);
              if (!issuedOn && res.mapping.issuedOnHint) {
                setIssuedOn(
                  new Date(res.mapping.issuedOnHint).toISOString().slice(0, 10)
                );
              }
              setConfirmedSkillIds(
                res.mapping.suggestedSkills.map((s) => s.id)
              );
              setPdfBytesBase64(res.pdfBytesBase64);
            });
          }}
        >
          <div className="row" style={{ flexWrap: "wrap" }}>
            <label htmlFor="cert-provider" className="muted">
              Provider
            </label>
            <select
              id="cert-provider"
              name="providerSelect"
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value)}
            >
              {providers.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.name}
                </option>
              ))}
              <option value="__custom__">
                Other / off-list provider (stored as claim)
              </option>
            </select>

            {selectedProvider === "__custom__" && (
              <input
                name="customProvider"
                placeholder="Provider name (e.g. Udemy)"
                value={customProvider}
                onChange={(e) => setCustomProvider(e.target.value)}
                required
              />
            )}

            <input
              name="courseName"
              placeholder="Course or certification title"
              value={courseName}
              onChange={(e) => setCourseName(e.target.value)}
              required
            />
          </div>

          <div className="row" style={{ flexWrap: "wrap" }}>
            <input
              name="verifyUrl"
              placeholder={
                activeProviderConfig
                  ? `Verify URL (e.g. ${activeProviderConfig.exampleUrl})`
                  : "Public verification URL (optional for off-list)"
              }
              value={verifyUrl}
              onChange={(e) => setVerifyUrl(e.target.value)}
              style={{ flex: 1 }}
            />
            <input
              type="date"
              name="issuedOn"
              aria-label="Certificate issue date"
              value={issuedOn}
              onChange={(e) => setIssuedOn(e.target.value)}
            />
            <input
              type="file"
              name="pdfFile"
              accept="application/pdf"
              aria-label="Optional certificate PDF"
            />
          </div>

          <div>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={pending}
            >
              {pending
                ? "Mapping course to canonical skills..."
                : "Step 1: Preview skill mapping"}
            </button>
          </div>
        </form>
      ) : (
        <div className="item-row stack" style={{ marginBottom: "1rem" }}>
          <div>
            <strong>
              Step 2: Confirm course-to-skill mapping for &quot;
              {mapping.courseName}&quot;
            </strong>
            <p className="muted" style={{ fontSize: "0.875rem" }}>
              Select the canonical skills this certificate should credit before
              saving.
            </p>
          </div>

          <div className="row" style={{ flexWrap: "wrap" }}>
            {mapping.suggestedSkills.map((skill) => {
              const checked = confirmedSkillIds.includes(skill.id);
              return (
                <label
                  key={skill.id}
                  className="row"
                  style={{ cursor: "pointer" }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setConfirmedSkillIds((prev) => [...prev, skill.id]);
                      } else {
                        setConfirmedSkillIds((prev) =>
                          prev.filter((id) => id !== skill.id)
                        );
                      }
                    }}
                    style={{ width: "auto" }}
                  />
                  <span className="badge badge-accent">{skill.display}</span>
                </label>
              );
            })}
          </div>

          <div className="row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={pending || confirmedSkillIds.length === 0}
              onClick={() => {
                setError(null);
                const effectiveProvider =
                  selectedProvider === "__custom__"
                    ? customProvider.trim() || "custom"
                    : selectedProvider;
                startTransition(async () => {
                  const res = await submitCertificateAction({
                    provider: effectiveProvider,
                    verifyUrl,
                    courseName: courseName || mapping.courseName,
                    issuedOn: issuedOn || undefined,
                    confirmedSkillIds,
                    pdfBytesBase64,
                  });
                  if (!res.ok) {
                    setError(res.message);
                    return;
                  }
                  if (res.result.nameWarning) {
                    setWarning(res.result.nameWarning);
                  }
                  setMessage(
                    res.result.verified
                      ? `Verified certificate "${res.result.certificate.courseName}" recorded as external evidence.`
                      : `${res.result.quizNudge ?? quizNudgeCopy}`
                  );
                  setMapping(null);
                  setVerifyUrl("");
                  setCourseName("");
                  setIssuedOn("");
                  setPdfBytesBase64(null);
                });
              }}
            >
              {pending ? "Verifying & saving..." : "Confirm & save certificate"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={pending}
              onClick={() => setMapping(null)}
            >
              Back
            </button>
          </div>
        </div>
      )}

      {certificates.length === 0 ? (
        <p className="empty-state">
          No certificates added yet. Submit an allowlisted verify URL above to
          anchor external coursework.
        </p>
      ) : (
        <ul className="item-list">
          {certificates.map((cert) => {
            const isVerified = Boolean(cert.verifiedAtIso);
            return (
              <li key={cert.id} className="item-row stack">
                <div className="row-between">
                  <div>
                    <strong>{cert.courseName}</strong>{" "}
                    <span className="muted">
                      ({cert.provider} · issued {cert.issuedOnIso.slice(0, 10)})
                    </span>
                  </div>
                  <div className="row">
                    {isVerified ? (
                      <span className="badge badge-accent">
                        verified certificate (1.0x)
                      </span>
                    ) : (
                      <span className="badge badge-warn">
                        unverified certificate claim (0.5x)
                      </span>
                    )}
                    {cert.hasStorageKey && (
                      <span className="badge">PDF stored</span>
                    )}
                  </div>
                </div>

                {cert.skillLabels.length > 0 && (
                  <div className="row">
                    {cert.skillLabels.map((label) => (
                      <span key={label} className="badge">
                        {label}
                      </span>
                    ))}
                  </div>
                )}

                {!isVerified && (
                  <div className="row-between" style={{ flexWrap: "wrap" }}>
                    <span className="muted" style={{ fontSize: "0.875rem" }}>
                      {quizNudgeCopy}{" "}
                      <Link href="/skills">Verify with a 6-question check</Link>{" "}
                      · <Link href="/how-levels-work">How levels work</Link>
                    </span>
                    {cert.verifyUrl && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={pending}
                        onClick={() => {
                          setError(null);
                          startTransition(async () => {
                            const res =
                              await retryCertificateVerificationAction(cert.id);
                            if (!res.ok) {
                              setError(res.message);
                              return;
                            }
                            if (res.result.nameWarning) {
                              setWarning(res.result.nameWarning);
                            }
                            setMessage(
                              res.result.verified
                                ? `Certificate "${cert.courseName}" verified!`
                                : "Verification check still could not confirm the public verify URL."
                            );
                          });
                        }}
                      >
                        Retry verification
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
