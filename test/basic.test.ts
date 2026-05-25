import { describe, it, expect, beforeEach } from "vitest";
import { H3 } from "h3";

describe("Basic test", () => {
  let app: H3;

  beforeEach(() => {
    app = new H3();
  });

  it("Hello World!", async () => {
    app.get("/", () => "Hello World!");

    const res = await app.request("/");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Hello World!");
  });
});
