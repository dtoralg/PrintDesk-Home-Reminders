import { describe, expect, it } from "vitest";
import { requestInputSchema } from "./index";

describe("requestInputSchema", () => {
  it("normaliza el payload mínimo", () => {
    const value = requestInputSchema.parse({ type: "task", title: "  Comprar pan  " });
    expect(value).toEqual({
      type: "task",
      title: "Comprar pan",
      body: "",
      important: false,
      dueAt: null,
    });
  });

  it("rechaza campos controlados por el servidor", () => {
    const result = requestInputSchema.safeParse({
      type: "task",
      title: "Comprar pan",
      createdBy: { uid: "spoofed" },
    });
    expect(result.success).toBe(false);
  });
});
