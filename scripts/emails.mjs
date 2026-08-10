// Builds the Supabase auth email templates from one layout, so six emails cannot drift apart.
// Run: node scripts/emails.mjs
// Output: supabase/templates/*.html, ready to paste into Authentication, Emails in the dashboard.
//
// Supabase substitutes {{ .ConfirmationURL }}, {{ .Token }}, {{ .SiteURL }} and {{ .Email }} itself.
// Tables and inline styles on purpose: Gmail and Outlook drop <style> blocks and most modern CSS.

import { mkdirSync, writeFileSync } from "node:fs";

const BEIGE = "#F3E9D8", CARD = "#FBF5EA", EDGE = "#E3D4BC";
const INK = "#2B2420", MUTED = "#5B5048", FAINT = "#7A6E63";
const BURGUNDY = "#6E2029", OLIVE = "#46583A", BRASS = "#E7C9B0";
const SERIF = "Georgia,'Times New Roman',serif";

const button = (href, label, colour = OLIVE) =>
  `<a href="${href}" style="display:inline-block;background:${colour};color:${BEIGE};text-decoration:none;font:700 15px/1 ${SERIF};padding:13px 24px;border-radius:10px;">${label}</a>`;

const code = token =>
  `<p style="margin:0 0 8px;font:400 13px/1.6 ${SERIF};color:${MUTED};">Or type this code in:</p>
        <p style="margin:0 0 20px;font:700 30px/1 ${SERIF};letter-spacing:.22em;color:${BURGUNDY};">${token}</p>`;

const layout = ({ title, lead, body = "", cta, token = true, foot }) => `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:${BEIGE};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BEIGE};padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${CARD};border:1px solid ${EDGE};border-radius:16px;overflow:hidden;">
          <tr><td style="background:${BURGUNDY};padding:20px 28px;">
            <span style="font:700 20px/1.2 ${SERIF};color:${BEIGE};letter-spacing:.02em;">CueFlow</span>
            <span style="font:400 12px/1.2 ${SERIF};color:${BRASS};padding-left:10px;">Stand by. Go.</span>
          </td></tr>
          <tr><td style="padding:28px;font:400 16px/1.6 ${SERIF};color:${INK};">
            <h1 style="margin:0 0 14px;font:700 22px/1.3 ${SERIF};color:${BURGUNDY};">${title}</h1>
            <p style="margin:0 0 18px;">${lead}</p>
            ${body}
            <p style="margin:0 0 20px;">${cta}</p>
            ${token ? code("{{ .Token }}") : ""}
          </td></tr>
          <tr><td style="padding:16px 28px 24px;border-top:1px solid ${EDGE};font:400 12px/1.6 ${SERIF};color:${FAINT};">
            ${foot} <a href="{{ .SiteURL }}" style="color:${BURGUNDY};">cueflow</a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>
`;

const templates = {
  "confirm-signup": layout({
    title: "Confirm your email and the desk is yours",
    lead: "One press and this address is on the account. After that, your library, sequences, scripts and shows follow you to any browser you sign in from.",
    cta: button("{{ .ConfirmationURL }}", "Confirm and open CueFlow"),
    foot: "If you did not sign up, ignore this and nothing happens.",
  }),
  "magic-link": layout({
    title: "Your way in",
    lead: "No password needed. This link signs you in and expires shortly, so use it while it is warm.",
    cta: button("{{ .ConfirmationURL }}", "Sign in to CueFlow"),
    foot: "Did not ask for this? Someone typed your address by mistake. Nothing has changed.",
  }),
  "reset-password": layout({
    title: "Set a new password",
    lead: "Pick a new one and you are back in. The old password stops working the moment the new one is saved.",
    cta: button("{{ .ConfirmationURL }}", "Choose a new password", BURGUNDY),
    foot: "If you did not ask for a reset, your password is untouched and this link can be ignored.",
  }),
  "change-email": layout({
    title: "Confirm your new address",
    lead: "You asked to move this account to {{ .Email }}. Confirm from the new address and the change takes effect.",
    cta: button("{{ .ConfirmationURL }}", "Confirm the new address"),
    foot: "Until this is confirmed, the old address stays on the account.",
  }),
  invite: layout({
    title: "You have been invited to CueFlow",
    lead: "Someone wants you on their show. Accept, choose a password, and their sequences and script are waiting.",
    body: `<p style="margin:0 0 18px;font:400 14px/1.6 ${SERIF};color:${MUTED};">CueFlow is a cue board that runs in a browser tab: every sound and slide in one numbered list, and one keypress sends the next one to the screen the audience sees.</p>`,
    cta: button("{{ .ConfirmationURL }}", "Accept the invitation"),
    foot: "Not expecting this? You can ignore it and no account is created.",
  }),
  reauthentication: layout({
    title: "Confirm it is you",
    lead: "This code finishes the change you just asked for. It is good for a few minutes.",
    cta: `<span style="font:400 14px/1.6 ${SERIF};color:${MUTED};">Type the code back into the tab you started this from.</span>`,
    foot: "If you did not start this, close the tab and change your password.",
  }),
};

mkdirSync("supabase/templates", { recursive: true });
for (const [name, html] of Object.entries(templates)) {
  writeFileSync(`supabase/templates/${name}.html`, html);
  console.log(`supabase/templates/${name}.html  ${html.length} bytes`);
}
