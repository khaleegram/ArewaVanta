import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const base = process.env.PREVIEW_URL ?? "http://localhost:5173";
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: "chrome" }),
  headless: true,
});

try {
  for (const width of [360, 390, 430, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let submittedReset = null;

    await page.route("**/api/v1/auth/forgot-password", (route) =>
      route.fulfill({
        status: 202,
        json: {
          message:
            "If an ArewaVanta account exists for that address, a reset link will be sent.",
        },
      }),
    );
    await page.route("**/api/v1/auth/reset-password", async (route) => {
      submittedReset = route.request().postDataJSON();
      if (submittedReset.token === "expired-token") {
        return route.fulfill({
          status: 422,
          json: { message: "This reset link is invalid or has expired." },
        });
      }
      return route.fulfill({
        json: { message: "Your password has been reset." },
      });
    });

    await page.goto(`${base}/forgot-password?email=player%40arewavanta.test`);
    await page.getByLabel("Email", { exact: true }).fill("player@arewavanta.test");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await page.getByRole("status").waitFor();
    assert.match(await page.getByRole("status").innerText(), /Check your inbox/);

    const forgotOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    assert.equal(forgotOverflow, false, `Forgot page overflow at ${width}px`);

    await page.goto(
      `${base}/reset-password?token=${"a".repeat(64)}&email=player%40arewavanta.test`,
    );
    await page.getByLabel("New password", { exact: true }).fill("a new secure password");
    await page.getByLabel("Confirm new password", { exact: true }).fill("a new secure password");
    await page.getByRole("button", { name: "Update password" }).click();
    await page.getByRole("status").waitFor();
    assert.match(await page.getByRole("status").innerText(), /password has been updated/i);
    assert.equal(submittedReset.email, "player@arewavanta.test");
    assert.equal(submittedReset.token, "a".repeat(64));
    assert.equal(new URL(page.url()).search, "");

    await page.goto(
      `${base}/reset-password?token=expired-token&email=player%40arewavanta.test`,
    );
    await page.getByLabel("New password", { exact: true }).fill("a new secure password");
    await page.getByLabel("Confirm new password", { exact: true }).fill("a new secure password");
    await page.getByRole("button", { name: "Update password" }).click();
    await page.getByRole("alert").waitFor();
    assert.match(await page.getByRole("alert").innerText(), /invalid or has expired/i);

    const resetOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    assert.equal(resetOverflow, false, `Reset page overflow at ${width}px`);
    assert.deepEqual(errors, [], `Browser errors at ${width}px`);
    await page.close();
  }

  console.log("Password recovery UI passed at 360, 390, 430, 768, and 1440px.");
} finally {
  await browser.close();
}
