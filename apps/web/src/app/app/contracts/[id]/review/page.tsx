import { notFound, redirect } from "next/navigation";
import type { ExtractedTerms } from "@proofbill/core";
import { extractedToConfirmed, getContract, NotFoundError } from "@proofbill/services";
import { requireFreelancer } from "@/lib/session";
import { TermsReview } from "@/components/terms-review";
import { deleteDraftAction } from "../../../../actions";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireFreelancer();
  const c = await getContract(user.id, id).catch((e) => (e instanceof NotFoundError ? null : Promise.reject(e)));
  if (!c) notFound();
  if (c.status !== "draft") redirect(`/app/contracts/${id}`);
  const extracted = c.extracted as ExtractedTerms;
  return (
    <main className="container stack-lg">
      <div className="row-between">
        <div>
          <div className="eyebrow">Step 1 · Review extracted terms</div>
          <h1 style={{ marginTop: 6 }}>{c.title}</h1>
          <p className="muted" style={{ marginTop: 6 }}>
            Extracted from <span className="mono">{c.sourceDocName}</span> by <span className="chip ai">{c.extractedBy}</span>. Every value shows the clause it came
            from. Edit anything that's wrong — ProofBill only bills from what you confirm here.
          </p>
        </div>
        <form action={deleteDraftAction.bind(null, c.id)}>
          <button className="btn danger sm">Discard</button>
        </form>
      </div>
      <TermsReview contractId={c.id} extracted={extracted} initial={extractedToConfirmed(extracted)} sourceText={c.sourceText} />
    </main>
  );
}
