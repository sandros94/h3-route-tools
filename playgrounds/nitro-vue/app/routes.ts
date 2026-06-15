import type { RouteRecordRaw } from "vue-router";

export const routes: RouteRecordRaw[] = [
  {
    path: "/",
    name: "app",
    component: () => import("./app.vue"),
    children: [
      { path: "/", name: "home", component: () => import("./pages/index.vue") },
      {
        path: "/:catchAll(.*)",
        name: "not-found",
        component: () => import("./pages/not-found.vue"),
      },
    ],
  },
];
