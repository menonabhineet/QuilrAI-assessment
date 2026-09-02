import { z } from "zod";

/**
 * Customer ID must strictly follow the format: CUST-XXXXX (5 decimal digits)
 * Example: CUST-10001
 */
export const CUSTOMER_ID_REGEX = /^CUST-[0-9]{5}$/;

export const CustomerIdSchema = z
  .string({
    required_error: "customer_id is required",
    invalid_type_error: "customer_id must be a string",
  })
  .regex(CUSTOMER_ID_REGEX, {
    message: "customer_id must strictly match format ^CUST-[0-9]{5}$ (e.g., CUST-12345)",
  });

export const GetCustomerRecordSchema = z.object({
  customer_id: CustomerIdSchema,
});

export type GetCustomerRecordInput = z.infer<typeof GetCustomerRecordSchema>;

export const TriggerRefundSchema = z.object({
  customer_id: CustomerIdSchema,
  amount: z
    .number({
      required_error: "amount is required",
      invalid_type_error: "amount must be a number",
    })
    .positive({
      message: "amount must be a positive float greater than 0",
    }),
  reason: z
    .string({
      required_error: "reason is required",
      invalid_type_error: "reason must be a string",
    })
    .min(10, {
      message: "reason must have a minimum length of 10 characters",
    }),
});

export type TriggerRefundInput = z.infer<typeof TriggerRefundSchema>;

export interface CustomerRecord {
  customer_id: string;
  name: string;
  email: string;
  tier: "standard" | "pro" | "enterprise";
  account_balance: number;
  status: "active" | "suspended" | "pending";
  created_at: string;
}

export interface RefundRecord {
  refund_id: string;
  customer_id: string;
  amount: number;
  reason: string;
  status: "processed" | "failed";
  timestamp: string;
}

/**
 * Helper to flatten Zod error messages into a clear string for JSON-RPC error payloads
 */
export function formatZodError(error: z.ZodError): string {
  return error.errors
    .map((err) => {
      const field = err.path.join(".");
      return field ? `Field '${field}': ${err.message}` : err.message;
    })
    .join("; ");
}
