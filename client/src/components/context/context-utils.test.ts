import { describe, it, expect } from "vitest";
import { getDocType, BADGE_COLORS, DOC_TYPE_I18N } from "./context-utils";
import contextEn from "@messages/en/context.json";

describe("getDocType()", () => {
  // AC-007
  it("returns 'readme' for a bare root file (README.md)", () => {
    expect(getDocType("README.md")).toBe("readme");
  });

  it("returns 'readme' for a module-root file (server/README.md)", () => {
    expect(getDocType("server/README.md")).toBe("readme");
  });

  it("returns 'insight' for paths containing insights segment", () => {
    expect(getDocType("insights/gotchas.md")).toBe("insight");
    expect(getDocType("client/insights/gotchas.md")).toBe("insight");
  });

  it("returns 'spec' for paths containing specs segment", () => {
    expect(getDocType("specs/pages.md")).toBe("spec");
    expect(getDocType("client/specs/pages.md")).toBe("spec");
  });

  it("returns 'doc' for paths containing docs segment", () => {
    expect(getDocType("docs/arch.md")).toBe("doc");
    expect(getDocType("server/docs/api.md")).toBe("doc");
  });
});

describe("BADGE_COLORS", () => {
  // AC-008
  it("has a defined readme color distinct from insight", () => {
    expect(BADGE_COLORS.readme).toBeDefined();
    expect(BADGE_COLORS.readme).not.toBe(BADGE_COLORS.insight);
  });

  it("has all four DocType entries", () => {
    expect(BADGE_COLORS.spec).toBeDefined();
    expect(BADGE_COLORS.doc).toBeDefined();
    expect(BADGE_COLORS.insight).toBeDefined();
    expect(BADGE_COLORS.readme).toBeDefined();
  });
});

describe("DOC_TYPE_I18N", () => {
  // AC-009
  it("maps readme to 'badgeReadme'", () => {
    expect(DOC_TYPE_I18N.readme).toBe("badgeReadme");
  });

  it("badgeReadme key exists in en/context.json attach section", () => {
    expect(
      (contextEn.attach as Record<string, string>)["badgeReadme"],
    ).toBeDefined();
  });

  it("has all four DocType entries", () => {
    expect(DOC_TYPE_I18N.spec).toBe("badgeSpec");
    expect(DOC_TYPE_I18N.doc).toBe("badgeDoc");
    expect(DOC_TYPE_I18N.insight).toBe("badgeInsight");
    expect(DOC_TYPE_I18N.readme).toBe("badgeReadme");
  });
});
