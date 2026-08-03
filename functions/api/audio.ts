import { audio } from "../_handlers";

// Typed inline rather than via @cloudflare/workers-types: the whole contract is Request -> Response,
// and a build dependency for one parameter is not worth it.
export const onRequestGet = ({ request }: { request: Request }) => audio(request);
