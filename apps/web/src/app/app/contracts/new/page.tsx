import { aiEnabled } from "@proofbill/ai";
import { ActionForm, Submit } from "@/components/action-form";
import { uploadContractAction } from "../../../actions";

export default function NewContract() {
  return (
    <main className="container narrow stack-lg">
      <div>
        <h1>Upload a contract</h1>
        <p className="muted" style={{ marginTop: 6 }}>
          SOW, contract or email thread — PDF, DOCX, TXT or Markdown. {aiEnabled() ? "Claude" : "The offline extractor"} proposes the billing terms with
          the clause each one came from; nothing is used until you confirm it.
        </p>
      </div>
      <div className="card card-pad">
        <ActionForm action={uploadContractAction} className="stack">
          <label className="field">
            Contract file
            <input type="file" name="file" accept=".pdf,.docx,.txt,.md,.markdown,.eml,text/plain,application/pdf" />
          </label>
          <div className="row" style={{ gap: 10 }}>
            <span className="divider" style={{ flex: 1 }} />
            <small>or paste text</small>
            <span className="divider" style={{ flex: 1 }} />
          </div>
          <label className="field">
            Contract text
            <textarea name="text" rows={10} placeholder="Paste the statement of work or email thread…" />
          </label>
          <div className="row">
            <Submit className="btn primary" pendingText="Extracting terms…">Extract terms</Submit>
            <small>Extraction takes a few seconds.</small>
          </div>
        </ActionForm>
      </div>
    </main>
  );
}
