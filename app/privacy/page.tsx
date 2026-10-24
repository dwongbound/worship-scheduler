// Public privacy policy. Reachable signed out (see proxy.ts) because Google's
// OAuth verification fetches it, and linked from the sign-in page so it isn't
// a URL only Google knows about.
import type { Metadata } from "next";
import LegalPage, { Section } from "@/components/LegalPage";
import { LEGAL_CONTACT_EMAIL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Policy · TapWorship",
  description: "What TapWorship stores about you, why, and how to have it deleted.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro="TapWorship is scheduling software for teams that serve on a rota. The
        organization you belong to runs it for its own teams, and this page explains what
        the app stores about you, why it needs it, and how to have it removed."
    >
      <Section title="Who holds your information">
        <p>
          Each organization decides who is on its teams and who administers it.
          TapWorship stores that information on the organization&rsquo;s behalf.
          Your organization&rsquo;s administrators can see
          everything in their own organization; they cannot see other organizations.
        </p>
      </Section>

      <Section title="What the app stores">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Your account</strong>: your name, username, email address and a
            one-way hash of your password. The password itself is never stored.
          </li>
          <li>
            <strong>Your scheduling information</strong>: the teams you are on, the
            roles you play, the sets you are assigned to, swap and cover requests, and
            the times you mark yourself unavailable.
          </li>
          <li>
            <strong>Messaging</strong>: if your organization connects Slack, the app stores
            your Slack user ID so it can send you your own notifications.
          </li>
          <li>
            <strong>Google Calendar</strong>: see the next section.
          </li>
        </ul>
        <p>
          The app does not use advertising or third-party analytics trackers, and it
          never sells your information.
        </p>
      </Section>

      <Section title="Google user data">
        <p>
          Google Calendar is optional and off until someone turns it on. There are two
          separate uses, each asking your permission first:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>An administrator connects the organization&rsquo;s calendar.</strong> The
            app then creates one calendar event per upcoming set on the calendar they
            chose, invites the people scheduled on that set, and keeps the event in step
            when the roster or the time changes. It reads the invitation replies on
            those events only, so that accepting an invitation can confirm your spot in
            the app. It does not read anything else on that calendar.
          </li>
          <li>
            <strong>You import your own calendars</strong> when filling in your
            availability. The app lists the calendars in your Google account and reads
            the events on the ones you own or can edit, for the dates being asked about,
            and turns the times you are busy into blocks on your availability. Calendars
            you only subscribe to, such as holidays or someone else&rsquo;s, are not
            read. It stores the resulting blocks, which you can then edit or delete, not
            your events, their titles or their guests.
          </li>
        </ul>
        <p>
          TapWorship&rsquo;s use of information received from Google APIs follows
          Google&rsquo;s{" "}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-600 hover:underline dark:text-indigo-400"
          >
            API Services User Data Policy
          </a>
          , including its Limited Use requirements. Google information is used only to
          provide the features above, is never sold or transferred for advertising, and
          is never used to train generalized AI or machine-learning models. No human
          reads it except where you ask for support, where the law requires it, or to
          keep the service secure.
        </p>
        <p>
          The permission you grant is kept as an access token stored encrypted, and you
          can withdraw it at any time: an administrator uses Disconnect in Organization
          settings, and anyone can revoke the app at{" "}
          <a
            href="https://myaccount.google.com/permissions"
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-600 hover:underline dark:text-indigo-400"
          >
            myaccount.google.com/permissions
          </a>
          .
        </p>
      </Section>

      <Section title="How long it is kept, and deleting it">
        <p>
          Your information is kept while your account exists. Ask an administrator of
          your organization to remove your account, or write to{" "}
          <a
            href={`mailto:${LEGAL_CONTACT_EMAIL}`}
            className="text-indigo-600 hover:underline dark:text-indigo-400"
          >
            {LEGAL_CONTACT_EMAIL}
          </a>{" "}
          and ask for it to be deleted. Deleting your account removes your profile, your
          availability and your assignments. Calendar events already sent to people
          stay in their own Google calendars, since the app cannot reach those.
        </p>
      </Section>

      <Section title="Security">
        <p>
          Traffic is encrypted in transit, passwords are stored only as hashes, and
          access tokens for connected services are encrypted at rest. No system is
          perfect; if you believe an account has been misused, tell an administrator and
          write to the address above.
        </p>
      </Section>

      <Section title="Children">
        <p>
          The app is for members of an organization&rsquo;s teams and is not aimed at
          children under 13. Where a minor serves on a team, their account is created
          and managed by the organization&rsquo;s administrators.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          If this policy changes, the date at the top changes with it. Material changes
          will be announced in the app.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions about this policy or your information:{" "}
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
