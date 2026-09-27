import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { HowToRunSection as HowToRunSectionType } from "@devdigest/shared";
import messages from "@messages/en/onboarding.json";
import { HowToRunSection } from "./HowToRunSection";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const SECTION: HowToRunSectionType = {
  packageManager: "pnpm",
  commands: ["pnpm install", "pnpm dev"],
  envVars: ["DATABASE_URL", "API_KEY"],
  entrypoint: "server/src/index.ts",
};

describe("HowToRunSection", () => {
  it("copies a command to the clipboard when its copy button is clicked (AC-30)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderWithIntl(<HowToRunSection section={SECTION} />);

    expect(screen.getByText("pnpm install")).toBeInTheDocument();
    const copyButtons = screen.getAllByTitle("Copy");
    fireEvent.click(copyButtons[0]!);

    expect(writeText).toHaveBeenCalledWith("pnpm install");
    expect(await screen.findAllByTitle("Copied!")).not.toHaveLength(0);
  });

  it("copies the entrypoint when its copy button is clicked", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderWithIntl(<HowToRunSection section={SECTION} />);
    const copyButtons = screen.getAllByTitle("Copy");
    // Two commands + one entrypoint copy button = last one is the entrypoint.
    fireEvent.click(copyButtons[copyButtons.length - 1]!);
    expect(writeText).toHaveBeenCalledWith("server/src/index.ts");
  });

  it("renders env var names and package manager", () => {
    renderWithIntl(<HowToRunSection section={SECTION} />);
    expect(screen.getByText("DATABASE_URL")).toBeInTheDocument();
    expect(screen.getByText("API_KEY")).toBeInTheDocument();
    expect(screen.getByText("pnpm")).toBeInTheDocument();
  });

  it("shows the no-env-vars message when envVars is empty", () => {
    renderWithIntl(<HowToRunSection section={{ ...SECTION, envVars: [] }} />);
    expect(screen.getByText("No env vars required")).toBeInTheDocument();
  });
});
