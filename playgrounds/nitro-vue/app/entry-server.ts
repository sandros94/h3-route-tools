import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { RouterView, createMemoryHistory, createRouter } from "vue-router";

import { routes } from "./routes.ts";
import clientAssets from "./entry-client.ts?assets=client";

async function handler(request: Request): Promise<Response> {
  const app = createSSRApp(RouterView);
  const router = createRouter({ history: createMemoryHistory(), routes });
  app.use(router);

  const url = new URL(request.url);
  await router.push(url.href.slice(url.origin.length));
  await router.isReady();

  const rendered = await renderToString(app);
  return new Response(htmlTemplate(rendered, clientAssets.entry), {
    headers: { "Content-Type": "text/html;charset=utf-8" },
  });
}

function htmlTemplate(body: string, entry: string): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>h3-route-tools × nitro</title>
  <script type="module" src="${entry}"></script>
</head>
<body>
  <div id="root">${body}</div>
</body>
</html>`;
}

export default { fetch: handler };
