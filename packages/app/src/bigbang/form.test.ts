import { expect, it } from "vitest";
import { openBigbangForm } from "./form";

it("retains input after a failed save and prevents duplicate submission", async () => {
  let resolve: (() => void) | undefined;
  let calls = 0;
  const form = openBigbangForm({ name: "Ada" }, async () => {
    calls++;
    await new Promise<void>((done) => {
      resolve = done;
    });
    throw new Error("Host disconnected");
  });
  form.set("name", "Grace");
  const pending = form.submit();
  await form.submit();
  expect(calls).toBe(1);
  expect(form.getSnapshot().status).toBe("submitting");
  resolve!();
  await pending;
  expect(form.getSnapshot()).toEqual({
    values: { name: "Grace" },
    status: "editing",
    error: "Host disconnected",
  });
});
