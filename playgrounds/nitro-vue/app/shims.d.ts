declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}

declare module "*.css";

// nitro/vite client asset manifest for the SSR entry (`?assets=client`).
declare module "*?assets=client" {
  const assets: { entry: string };
  export default assets;
}
