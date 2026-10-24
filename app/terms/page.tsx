// Public terms of service. Reachable signed out (see proxy.ts) because
// Google's OAuth verification fetches it, and linked from the sign-in page.
import type { Metadata } from "next";
import LegalPage, { Section } from "@/components/LegalPage";
import { LEGAL_CONTACT_EMAIL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of Service · TapWorship",
  description: "The terms for using TapWorship.",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      intro="These terms cover your use of TapWorship, scheduling software for teams
        that serve on a rota. By signing in you agree to them."
    >
      <Section title="Your account">
        <p>
          You join an organization with a key from its administrators. Keep your
          password to yourself, use your own account rather than someone else&rsquo;s,
          and tell an administrator if you think your account has been misused. You are
          responsible for what is done through your account.
        </p>
      </Section>

      <Section title="Using the app">
        <p>
          Use it for scheduling your teams. Don&rsquo;t try to reach another
          organization&rsquo;s information or another person&rsquo;s account,
          don&rsquo;t attempt to break or overload the service, and don&rsquo;t use it
          to send anyone anything unlawful or abusive. Administrators of your
          organization can change who is on a team, who plays what, and who is
          scheduled, and can remove accounts.
        </p>
      </Section>

      <Section title="Your content">
        <p>
          Set lists, notes, availability and the rest stay yours and your
          organization&rsquo;s. We store and display them to run the app for you, and nothing
          more. See the Privacy Policy for what is stored and how to have it deleted.
        </p>
      </Section>

      <Section title="Connected services">
        <p>
          Slack, Google Calendar and Spotify are optional. Connecting one means its own
          terms apply to it as well, and that information passes between it and this
          app for the features described in the Privacy Policy. Any of them can be
          disconnected at any time, and the app keeps working without them.
        </p>
      </Section>

      <Section title="Availability and changes">
        <p>
          The app is offered as it is, without a guarantee that it will always be
          reachable or free of faults. Features may change, and this is not a substitute
          for your own record of who is serving when. We may update these terms; the
          date at the top changes when we do, and continuing to use the app means the
          new terms apply.
        </p>
      </Section>

      <Section title="Liability">
        <p>
          To the extent the law allows, TapWorship is not liable for indirect or
          consequential loss arising from use of the app, including a missed set, a
          notification that did not arrive, or information lost through a fault of the
          service or of a connected provider.
        </p>
      </Section>

      <Section title="Ending it">
        <p>
          You can stop using the app at any time and ask an administrator to remove your
          account. We may suspend an account that breaks these terms or puts the service
          or other people at risk.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions about these terms:{" "}
          <a
            href={`mailto:${LEGAL_CONTACT_EMAIL}`}
            className="text-indigo-600 hover:underline dark:text-indigo-400"
          >
            {LEGAL_CONTACT_EMAIL}
          </a>
          .
        </p>
      </Section>
    </LegalPage>
  );
}
