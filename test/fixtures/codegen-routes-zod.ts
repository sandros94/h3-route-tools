import type { InferRoutes } from "../../src/routes.ts";
import type { app } from "./codegen-app-zod.ts";

export type AppRoutes = InferRoutes<typeof app>;
