/** Header toggle for the sample workspace. A form POST, so it works without client JS. */
export function DemoSwitch({ on }: { on: boolean }) {
  return (
    <form action={on ? "/api/auth/demo/exit" : "/api/auth/demo"} method="post">
      <button className="switch" role="switch" aria-checked={on} title={on ? "Leave the sample workspace" : "Explore with sample data"}>
        <span className="track" aria-hidden />
        Demo
      </button>
    </form>
  );
}
