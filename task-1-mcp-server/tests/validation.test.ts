import { describe, it, expect } from "vitest";
import {
  CustomerIdSchema,
  GetCustomerRecordSchema,
  AdminTriggerRefundSchema,
  formatZodError,
} from "../src/types.js";

describe("Task 1: Zod Schema Input Validation", () => {
  describe("CustomerIdSchema", () => {
    it("accepts valid customer_id formats (CUST-XXXXX)", () => {
      const validIds = ["CUST-10001", "CUST-00000", "CUST-99999", "CUST-20482"];
      for (const id of validIds) {
        const result = CustomerIdSchema.safeParse(id);
        expect(result.success).toBe(true);
      }
    });

    it("rejects invalid customer_id formats", () => {
      const invalidIds = [
        "cust-10001", // lowercase prefix
        "CUST-1234", // 4 digits instead of 5
        "CUST-123456", // 6 digits instead of 5
        "CUST-ABCDE", // non-numeric
        "10001", // missing prefix
        "CUST_10001", // underscore instead of hyphen
        "", // empty
        12345, // wrong type
        null,
        undefined,
      ];

      for (const id of invalidIds) {
        const result = CustomerIdSchema.safeParse(id);
        expect(result.success).toBe(false);
      }
    });
  });

  describe("GetCustomerRecordSchema", () => {
    it("validates valid input object", () => {
      const result = GetCustomerRecordSchema.safeParse({ customer_id: "CUST-10001" });
      expect(result.success).toBe(true);
    });

    it("rejects missing customer_id", () => {
      const result = GetCustomerRecordSchema.safeParse({});
      expect(result.success).toBe(false);
      if (!result.success) {
        const msg = formatZodError(result.error);
        expect(msg).toContain("customer_id");
      }
    });

    it("rejects malformed customer_id", () => {
      const result = GetCustomerRecordSchema.safeParse({ customer_id: "BAD-ID" });
      expect(result.success).toBe(false);
      if (!result.success) {
        const msg = formatZodError(result.error);
        expect(msg).toContain("^CUST-[0-9]{5}$");
      }
    });
  });

  describe("AdminTriggerRefundSchema", () => {
    it("validates fully compliant refund payload", () => {
      const payload = {
        customer_id: "CUST-10001",
        amount: 149.99,
        reason: "Duplicate charge on monthly enterprise subscription",
      };
      const result = AdminTriggerRefundSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it("rejects negative refund amounts", () => {
      const payload = {
        customer_id: "CUST-10001",
        amount: -50.0,
        reason: "Customer requested return for defective product",
      };
      const result = AdminTriggerRefundSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        const msg = formatZodError(result.error);
        expect(msg).toContain("positive float");
      }
    });

    it("rejects zero refund amount", () => {
      const payload = {
        customer_id: "CUST-10001",
        amount: 0,
        reason: "Zero dollar adjustment request",
      };
      const result = AdminTriggerRefundSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        const msg = formatZodError(result.error);
        expect(msg).toContain("positive float");
      }
    });

    it("rejects reasons shorter than 10 characters", () => {
      const payload = {
        customer_id: "CUST-10001",
        amount: 25.0,
        reason: "Defective", // 9 characters
      };
      const result = AdminTriggerRefundSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        const msg = formatZodError(result.error);
        expect(msg).toContain("minimum length of 10 characters");
      }
    });

    it("rejects missing fields in refund payload", () => {
      const resultNoReason = AdminTriggerRefundSchema.safeParse({
        customer_id: "CUST-10001",
        amount: 50.0,
      });
      expect(resultNoReason.success).toBe(false);

      const resultNoAmount = AdminTriggerRefundSchema.safeParse({
        customer_id: "CUST-10001",
        reason: "Detailed explanation of the return reason",
      });
      expect(resultNoAmount.success).toBe(false);
    });
  });
});
