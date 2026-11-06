// Starter flow. Copy this folder, rename, and replace the content.
// Schema: reference/data-schema.md. Build: node scripts/build.js <this-folder> <out.html>
window.FLOW = {
  meta: {
    title: "Order checkout",
    subtitle: "How a customer's order becomes a paid, confirmed purchase",
    footnote: "IDs and values are illustrative.",
    phasesPlain: { Payment: "Paying" }
  },

  lanes: {
    web: { name: "Web shop", kind: "React SPA", kindPlain: "Website", plain: "The page the customer clicks Buy on.", tech: [["Repo", "shop-web"]] },
    api: { name: "Orders API", kind: "ASP.NET Core", kindPlain: "Our API", plain: "Takes orders and coordinates payment.", tech: [["Base path", "/v1/orders"]], refs: ["orders-api"] },
    db: { name: "Orders database", kind: "PostgreSQL", kindPlain: "Our database", plain: "Where orders are stored.", store: true, tech: [["Schema", "orders"]] },
    pay: { name: "Payments", kind: "Payment provider (REST)", kindPlain: "Card payments", plain: "Charges the customer's card." }
  },

  seqs: {
    a: {
      code: "A",
      title: "Checkout",
      desc: "Buy → charge → confirm",
      lanes: ["web", "api", "db", "pay"],
      steps: [
        {
          id: "a1", phase: "Order", route: ["web", "api", "db"],
          label: "POST /orders", labelPlain: "place order", resLabel: "201 Created", resLabelPlain: "order id",
          title: "The customer places the order",
          story: "The website sends the basket to our API, which saves it as a new order and returns its number.",
          why: "Saving first means a payment can never exist without an order.",
          call: { verb: "POST", text: "/v1/orders" },
          req: { cap: "Request", lang: "http", body: "POST /v1/orders\nContent-Type: application/json\nIdempotency-Key: 6c1f…\n\n{ \"items\": [{ \"sku\": \"TEA-01\", \"qty\": 2 }] }" },
          res: { cap: "Response", lang: "json", body: "{ \"orderId\": \"ord_9f2\", \"status\": \"PendingPayment\", \"total\": 24.00 }" },
          tables: [
            {
              name: "Orders", op: "INSERT",
              cols: [["Id", "ord_9f2"], ["Status", "PendingPayment"], ["IdempotencyKey", "replays return the same order"]],
              sql: "INSERT INTO \"Orders\" (\"Id\", \"CustomerId\", \"Status\", \"Total\", \"IdempotencyKey\", \"CreatedAt\")\nVALUES ('ord_9f2', @customer, 'PendingPayment', 24.00, @key, now())\nON CONFLICT (\"IdempotencyKey\") DO NOTHING\nRETURNING \"Id\";"
            }
          ],
          notes: ["A repeated request with the same <code>Idempotency-Key</code> returns the first order."],
          refs: ["orders-api · OrdersEndpoints"]
        },
        {
          id: "a2", phase: "Payment", route: ["api", "pay"],
          label: "charge", labelPlain: "charge card", resLabel: "succeeded", resLabelPlain: "paid",
          title: "The card is charged",
          story: "Our API asks the payment provider to charge the card for the order total.",
          call: { verb: "POST", text: "https://payments.example.com/v1/charges" },
          req: { cap: "Request", lang: "json", body: "{ \"amount\": 2400, \"currency\": \"usd\", \"metadata\": { \"orderId\": \"ord_9f2\" } }" },
          res: { cap: "Response", lang: "json", body: "{ \"id\": \"ch_31x\", \"status\": \"succeeded\" }" }
        },
        {
          id: "a2x", alt: true, after: "a2", kind: "failure", phase: "Payment", route: ["api", "db"],
          label: "declined", labelPlain: "declined",
          title: "What if the card is declined?",
          story: "The order is marked declined and the customer is asked for another card. Nothing is shipped.",
          tables: [
            { name: "Orders", op: "UPDATE", cols: [["Status", "PendingPayment → Declined"]],
              sql: "UPDATE \"Orders\" SET \"Status\" = 'Declined', \"UpdatedAt\" = now()\n WHERE \"Id\" = 'ord_9f2' AND \"Status\" = 'PendingPayment';" }
          ]
        },
        {
          id: "a3", phase: "Payment", route: ["api", "db"],
          label: "UPDATE Orders", labelPlain: "mark paid",
          title: "The order is marked paid",
          story: "The API records the payment against the order.",
          tables: [
            { name: "Orders", op: "UPDATE", cols: [["Status", "PendingPayment → Paid"], ["ChargeId", "ch_31x"]],
              sql: "UPDATE \"Orders\" SET \"Status\" = 'Paid', \"ChargeId\" = 'ch_31x', \"PaidAt\" = now()\n WHERE \"Id\" = 'ord_9f2' AND \"Status\" = 'PendingPayment';" }
          ]
        },
        {
          id: "a4", kind: "response", phase: "Payment", route: ["api", "web"],
          label: "200 Paid", labelPlain: "confirmed",
          title: "The customer sees the confirmation",
          story: "The website shows the order number and a thank-you page.",
          res: { cap: "Response", lang: "json", body: "{ \"orderId\": \"ord_9f2\", \"status\": \"Paid\" }" }
        }
      ]
    }
  }
};
