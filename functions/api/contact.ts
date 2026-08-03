import { contact } from "../_handlers";

/** SLACK_WEBHOOK_URL is a Pages environment variable (Settings -> Environment variables). */
export const onRequestPost = ({ request, env }: { request: Request; env: { SLACK_WEBHOOK_URL?: string } }) =>
  contact(request, env.SLACK_WEBHOOK_URL);
