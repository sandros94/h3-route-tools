import { describe, it, expect } from "vitest";
import {
  matchMediaType,
  parseMediaType,
  PARSER_BY_MEDIA_TYPE,
} from "../../src/internal/media-type.ts";

describe("parseMediaType", () => {
  it("returns lowercased media type without parameters", () => {
    expect(parseMediaType("application/json")).toBe("application/json");
    expect(parseMediaType("Application/JSON")).toBe("application/json");
    expect(parseMediaType("application/json; charset=utf-8")).toBe("application/json");
    expect(parseMediaType("multipart/form-data; boundary=---x")).toBe("multipart/form-data");
  });

  it("returns undefined for nullish or empty input", () => {
    expect(parseMediaType(null)).toBeUndefined();
    expect(parseMediaType(undefined)).toBeUndefined();
    expect(parseMediaType("")).toBeUndefined();
    expect(parseMediaType("   ")).toBeUndefined();
  });
});

describe("matchMediaType", () => {
  it("returns the declared key for an exact match (preserving original casing)", () => {
    expect(matchMediaType(["application/json"], { against: "application/json" })).toBe(
      "application/json",
    );
    expect(matchMediaType(["Application/JSON"], { against: "application/json" })).toBe(
      "Application/JSON",
    );
  });

  it("matches when incoming carries parameters", () => {
    expect(
      matchMediaType(["application/json"], { against: "application/json; charset=utf-8" }),
    ).toBe("application/json");
    expect(
      matchMediaType(["multipart/form-data"], { against: "multipart/form-data; boundary=---x" }),
    ).toBe("multipart/form-data");
  });

  it("supports declared-side wildcards (type/*)", () => {
    expect(matchMediaType(["application/*"], { against: "application/json" })).toBe(
      "application/*",
    );
    expect(matchMediaType(["text/*"], { against: "text/plain" })).toBe("text/*");
    expect(matchMediaType(["text/*"], { against: "application/json" })).toBeUndefined();
  });

  it("returns undefined for nullish / unmatched incoming", () => {
    expect(matchMediaType(["application/json"], { against: null })).toBeUndefined();
    expect(matchMediaType(["application/json"], { against: undefined })).toBeUndefined();
    expect(matchMediaType(["application/json"], { against: "text/plain" })).toBeUndefined();
    expect(matchMediaType([], { against: "application/json" })).toBeUndefined();
  });

  it("prefers the first declared match on order", () => {
    expect(
      matchMediaType(["application/*", "application/json"], { against: "application/json" }),
    ).toBe("application/*");
    expect(
      matchMediaType(["application/json", "application/*"], { against: "application/json" }),
    ).toBe("application/json");
  });
});

describe("PARSER_BY_MEDIA_TYPE", () => {
  it("maps known media types to the right parser", () => {
    expect(PARSER_BY_MEDIA_TYPE["application/json"]).toBe("json");
    expect(PARSER_BY_MEDIA_TYPE["multipart/form-data"]).toBe("formData");
    expect(PARSER_BY_MEDIA_TYPE["application/x-www-form-urlencoded"]).toBe("formData");
    expect(PARSER_BY_MEDIA_TYPE["text/plain"]).toBe("text");
  });
});
