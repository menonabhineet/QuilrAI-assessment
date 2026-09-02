import { CustomerRecord, RefundRecord } from "./types.js";
import { logger } from "./logger.js";

/**
 * In-memory customer record store.
 * Seeded with realistic enterprise and retail mock profiles.
 */
const initialCustomers: CustomerRecord[] = [
  {
    customer_id: "CUST-10001",
    name: "Alice Montgomery",
    email: "alice.montgomery@enterprise-corp.com",
    tier: "enterprise",
    account_balance: 14250.75,
    status: "active",
    created_at: "2024-01-15T08:30:00.000Z",
  },
  {
    customer_id: "CUST-10002",
    name: "Bob Henderson",
    email: "bob.h@fintech-solutions.io",
    tier: "pro",
    account_balance: 850.25,
    status: "active",
    created_at: "2024-03-22T11:15:00.000Z",
  },
  {
    customer_id: "CUST-10003",
    name: "Carol Danvers",
    email: "carol.d@aero-dynamics.org",
    tier: "standard",
    account_balance: 120.0,
    status: "suspended",
    created_at: "2024-06-10T14:45:00.000Z",
  },
  {
    customer_id: "CUST-20001",
    name: "David Zhang",
    email: "david.zhang@global-tech.cn",
    tier: "enterprise",
    account_balance: 55000.0,
    status: "active",
    created_at: "2023-11-05T09:00:00.000Z",
  },
];

class MockDatabase {
  private customers: Map<string, CustomerRecord> = new Map();
  private refunds: Map<string, RefundRecord> = new Map();
  private refundSequence = 1000;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.customers.clear();
    this.refunds.clear();
    this.refundSequence = 1000;

    for (const cust of initialCustomers) {
      this.customers.set(cust.customer_id, { ...cust });
    }
    logger.info("Mock database reset to initial seed state", {
      customerCount: this.customers.size,
    });
  }

  getCustomer(customerId: string): CustomerRecord | null {
    logger.info("Querying customer record", { customerId });
    const record = this.customers.get(customerId);
    return record ? { ...record } : null;
  }

  processRefund(
    customerId: string,
    amount: number,
    reason: string
  ): { refund: RefundRecord; newBalance: number } {
    logger.info("Attempting refund transaction", { customerId, amount, reason });

    const customer = this.customers.get(customerId);
    if (!customer) {
      throw new Error(`Customer with ID '${customerId}' not found in database.`);
    }

    if (customer.status !== "active") {
      throw new Error(
        `Cannot issue refund to customer '${customerId}' because account status is '${customer.status}'.`
      );
    }

    if (customer.account_balance < amount) {
      throw new Error(
        `Insufficient customer account balance (${customer.account_balance.toFixed(2)}) for refund amount (${amount.toFixed(2)}).`
      );
    }

    // Deduct balance and record refund
    customer.account_balance = Math.round((customer.account_balance - amount) * 100) / 100;
    this.refundSequence += 1;
    const refundId = `REF-${this.refundSequence}`;

    const refund: RefundRecord = {
      refund_id: refundId,
      customer_id: customerId,
      amount,
      reason,
      status: "processed",
      timestamp: new Date().toISOString(),
    };

    this.refunds.set(refundId, refund);
    logger.info("Refund successfully processed", {
      refundId,
      customerId,
      amount,
      newBalance: customer.account_balance,
    });

    return {
      refund,
      newBalance: customer.account_balance,
    };
  }

  getRefund(refundId: string): RefundRecord | null {
    const refund = this.refunds.get(refundId);
    return refund ? { ...refund } : null;
  }

  getAllRefunds(): RefundRecord[] {
    return Array.from(this.refunds.values());
  }
}

export const db = new MockDatabase();
