import type { ReactNode } from "react";
import { STATUS_LABEL, tone } from "@/lib/format";

export function Badge({ status, label }: { status: string; label?: string }) {
  return <span className={`badge ${tone(status)}`}>{label ?? STATUS_LABEL[status] ?? status}</span>;
}

export function Card({ title, sub, actions, children, pad = true, id }: { title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; pad?: boolean; id?: string }) {
  return (
    <section className="card" id={id}>
      {(title || actions) && (
        <div className="card-head">
          <div className="section-title">
            {typeof title === "string" ? <h2>{title}</h2> : title}
            {sub && <small className="muted">{sub}</small>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      <div className={pad ? "card-body" : undefined}>{children}</div>
    </section>
  );
}

export function Source({ source }: { source: { section: string; quote: string } | null | undefined }) {
  if (!source) return <div className="source">Not found in the document</div>;
  return (
    <div className="source">
      <b>{source.section}</b> — “{source.quote}”
    </div>
  );
}

export function Confidence({ value }: { value: number | null | undefined }) {
  if (value == null) return null;
  return (
    <span className="row" style={{ gap: 6 }} title={`AI confidence ${Math.round(value * 100)}%`}>
      <span className="confidence">
        <span style={{ width: `${Math.round(value * 100)}%`, background: value < 0.6 ? "var(--warn)" : undefined }} />
      </span>
      <small>{Math.round(value * 100)}%</small>
    </span>
  );
}

export function EvidenceIcon({ type }: { type: string }) {
  const icon: Record<string, string> = { github_pr: "⑂", link: "↗", file: "▤", url_check: "◎" };
  return <span className="ev-icon" aria-hidden>{icon[type] ?? "•"}</span>;
}

export function ActorTag({ actor }: { actor: string }) {
  return <span className={`actor ${actor}`}>{actor === "ai" ? "AI" : actor}</span>;
}

/** Evidence title as a link when it has a URL; plain text (marked "sample" for seeded demo data) otherwise. */
export function EvidenceLink({
  url,
  title,
  className = "link",
  sample,
  children,
}: {
  url: string | null | undefined;
  title: string;
  className?: string;
  sample?: boolean;
  children?: ReactNode;
}) {
  const body = children ?? title;
  if (!url)
    return (
      <span className={className === "link" ? undefined : className}>
        {body}
        {sample && <span className="chip" style={{ marginLeft: 6 }}>sample</span>}
      </span>
    );
  return (
    <a className={className} href={url} target="_blank" rel="noreferrer">
      {body}
    </a>
  );
}
