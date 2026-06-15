import { ofetch } from "ofetch";
import type { $Fetch } from "nitro/types";

// The bare-nitro pattern: bring your own client, typed via nitro's `$Fetch` over the generated
// `InternalApi`. h3-route-tools rewrites `InternalApi` from the route contracts (per method, response
// types `Serialize`d the way they arrive over the wire), so calls below are fully typed and validated
// against the server — no codegen, no manual types.
export const api = ofetch as unknown as $Fetch;
