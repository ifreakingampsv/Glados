import { AuthSection } from "@/components/auth-section";
import { joinWaitlistAction } from "@/app/actions/waitlist";

export default function Landing() {
  return (
    <main>
      <h1>GLaDOS</h1>
      <p>
        One spine for your job prep: evidenced skills, projects, target role.
      </p>
      <AuthSection />
      <section style={{ marginTop: "2rem" }}>
        <h2>Join the waitlist</h2>
        <form action={joinWaitlistAction}>
          <input
            name="email"
            type="email"
            placeholder="you@example.com"
            required
            style={{ padding: "0.4rem", width: "18rem" }}
          />
          <button type="submit" style={{ padding: "0.4rem 1rem" }}>
            Join
          </button>
        </form>
      </section>
    </main>
  );
}
