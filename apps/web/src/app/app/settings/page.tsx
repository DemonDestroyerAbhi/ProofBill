import { requireUser } from "@/lib/session";
import { ActionForm, Submit } from "@/components/action-form";
import { updateProfileAction } from "../../actions";

export default async function SettingsPage() {
  const user = await requireUser();
  return (
    <main className="container narrow stack-lg">
      <div>
        <h1>Settings</h1>
        <p className="muted" style={{ marginTop: 6 }}>How you appear to clients.</p>
      </div>
      <div className="card card-pad">
        <ActionForm action={updateProfileAction} className="stack">
          <label className="field">
            Display name
            <input name="name" defaultValue={user.name ?? user.login} required minLength={2} maxLength={80} />
          </label>
          <small>Shown in the client evidence portal and in payment reminders. Defaults to your GitHub name.</small>
          <div>
            <Submit className="btn primary">Save</Submit>
          </div>
        </ActionForm>
      </div>
    </main>
  );
}
