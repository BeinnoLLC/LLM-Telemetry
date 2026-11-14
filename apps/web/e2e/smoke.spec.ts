import { expect, test } from "@playwright/test";

test("scaffold shell serves on :8481", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "LLM Telemetry",
  );
});
