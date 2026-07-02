// Shared persona definitions for the three seed scripts, designed so the
// $5k–$50k / 2025 overview cohort exercises every NRR outcome, and the
// dashboard's fuzzy matching has genuinely messy billing names to untangle.
export const TAG = "ReVue3 seed";

export interface PersonaDeal {
  key: string;
  name: string;
  amount: number;
  close: string; // yyyy-mm-dd; open deals = expected close
  stage: "closedwon" | "closedlost" | "qualifiedtobuy" | "decisionmakerboughtin" | "presentationscheduled";
  type: "newbusiness" | "existingbusiness";
  pairWith?: string; // key of the associated (baseline) deal
  lineItems: { name: string; price: number; quantity: number; recurring?: "monthly" | "annually" }[];
}

export interface Persona {
  key: string;
  name: string;
  domain: string;
  industry: string;
  city: string;
  contacts: { first: string; last: string; email: string }[];
  deals: PersonaDeal[];
  tickets: { subject: string; stage: "1" | "2" | "3" | "4"; priority: "LOW" | "MEDIUM" | "HIGH" }[];
  // billing placement drives the "disorganized sources" demo
  stripe?: { customerName: string; email: string; invoices: { amount: number; date: string; paid: boolean; dueInDays?: number; memo: string }[]; monthlySub?: { product: string; amount: number } };
  qbo?: { customerName: string; email: string; invoices: { amount: number; txnDate: string; dueDate: string; payAmount: number; docNumber: string; memo: string }[] };
}

export const PERSONAS: Persona[] = [
  {
    key: "bluepeak",
    name: "Bluepeak Software",
    domain: "bluepeak.io",
    industry: "COMPUTER_SOFTWARE",
    city: "Denver",
    contacts: [
      { first: "Jane", last: "Okafor", email: "jane.okafor@bluepeak.io" },
      { first: "Sam", last: "Reyes", email: "sam.reyes@bluepeak.io" },
    ],
    deals: [
      {
        key: "bp-2025", name: "Bluepeak Platform 2025", amount: 24000, close: "2025-03-15",
        stage: "closedwon", type: "newbusiness",
        lineItems: [
          { name: "Platform subscription", price: 2000, quantity: 1, recurring: "monthly" },
          { name: "Onboarding package", price: 4000, quantity: 1 },
        ],
      },
      {
        key: "bp-2026", name: "Bluepeak Platform Renewal 2026", amount: 30000, close: "2026-03-10",
        stage: "closedwon", type: "existingbusiness", pairWith: "bp-2025",
        lineItems: [{ name: "Platform subscription", price: 2500, quantity: 1, recurring: "monthly" }],
      },
      {
        key: "bp-addon", name: "Bluepeak Add-on Seats", amount: 6000, close: "2026-10-15",
        stage: "qualifiedtobuy", type: "existingbusiness",
        lineItems: [{ name: "Additional seats", price: 120, quantity: 50, recurring: "monthly" }],
      },
    ],
    tickets: [
      { subject: "SSO login intermittently fails", stage: "2", priority: "MEDIUM" },
      { subject: "Request: export API rate increase", stage: "4", priority: "LOW" },
    ],
    stripe: {
      customerName: "Bluepeak Software, Inc.",
      email: "billing@bluepeak.io",
      invoices: [
        { amount: 24000, date: "2025-03-20", paid: true, memo: "Platform 2025 annual" },
        { amount: 30000, date: "2026-03-15", paid: true, memo: "Platform renewal 2026" },
      ],
      monthlySub: { product: "Bluepeak Platform (monthly)", amount: 2500 },
    },
  },
  {
    key: "coastal",
    name: "Coastal Media Group",
    domain: "coastalmedia.com",
    industry: "MARKETING_AND_ADVERTISING",
    city: "Charleston",
    contacts: [{ first: "Priya", last: "Nair", email: "priya@coastalmedia.com" }],
    deals: [
      {
        key: "cm-2025", name: "Coastal Analytics Suite 2025", amount: 18000, close: "2025-05-20",
        stage: "closedwon", type: "newbusiness",
        lineItems: [{ name: "Analytics suite", price: 1500, quantity: 1, recurring: "monthly" }],
      },
      {
        key: "cm-2026", name: "Coastal Analytics Renewal 2026", amount: 13500, close: "2026-05-18",
        stage: "closedwon", type: "existingbusiness", pairWith: "cm-2025",
        lineItems: [{ name: "Analytics suite (reduced)", price: 1125, quantity: 1, recurring: "monthly" }],
      },
    ],
    tickets: [
      { subject: "Dashboard numbers don't match report export", stage: "3", priority: "HIGH" },
      { subject: "Add two users to workspace", stage: "4", priority: "LOW" },
      { subject: "Renewal pricing question", stage: "1", priority: "MEDIUM" },
    ],
    qbo: {
      customerName: "Coastal Media Group LLC",
      email: "ar@coastalmedia.com",
      invoices: [
        { amount: 18000, txnDate: "2025-05-25", dueDate: "2025-06-24", payAmount: 18000, docNumber: "CMG-1042", memo: "Analytics Suite 2025" },
        { amount: 13500, txnDate: "2026-05-20", dueDate: "2026-06-19", payAmount: 6750, docNumber: "CMG-1187", memo: "Analytics renewal 2026 (50% net-30)" },
      ],
    },
  },
  {
    key: "ferrostar",
    name: "Ferrostar Manufacturing",
    domain: "ferrostar.com",
    industry: "MACHINERY",
    city: "Pittsburgh",
    contacts: [{ first: "Dale", last: "Kowalski", email: "d.kowalski@ferrostar.com" }],
    deals: [
      {
        key: "fs-2025", name: "Ferrostar Automation 2025", amount: 32000, close: "2025-02-10",
        stage: "closedwon", type: "newbusiness",
        lineItems: [
          { name: "Automation platform", price: 2400, quantity: 1, recurring: "monthly" },
          { name: "Hardware sensors", price: 3200, quantity: 1 },
        ],
      },
      {
        key: "fs-2026", name: "Ferrostar Renewal 2026", amount: 32000, close: "2026-02-01",
        stage: "closedlost", type: "existingbusiness", pairWith: "fs-2025",
        lineItems: [{ name: "Automation platform", price: 2400, quantity: 1, recurring: "monthly" }],
      },
    ],
    tickets: [
      { subject: "Sensor data gaps on line 3", stage: "3", priority: "HIGH" },
      { subject: "Contract cancellation confirmation", stage: "4", priority: "MEDIUM" },
    ],
    // Same 32k invoice lives in BOTH systems → cross-source duplicate demo.
    stripe: {
      customerName: "Ferrostar Mfg",
      email: "ap@ferrostar.com",
      invoices: [{ amount: 32000, date: "2025-02-15", paid: true, memo: "Automation 2025 annual" }],
    },
    qbo: {
      customerName: "Ferrostar Manufacturing Corp.",
      email: "accounts@ferrostar.com",
      invoices: [
        { amount: 32000, txnDate: "2025-02-15", dueDate: "2025-03-17", payAmount: 32000, docNumber: "FER-2201", memo: "Automation platform 2025 (also billed via Stripe)" },
      ],
    },
  },
  {
    key: "helios",
    name: "Helios Energy",
    domain: "heliosenergy.com",
    industry: "UTILITIES",
    city: "Phoenix",
    contacts: [{ first: "Maria", last: "Duarte", email: "maria.duarte@heliosenergy.com" }],
    deals: [
      {
        key: "he-2025", name: "Helios Monitoring 2025", amount: 12000, close: "2025-08-05",
        stage: "closedwon", type: "newbusiness",
        lineItems: [{ name: "Monitoring service", price: 1000, quantity: 1, recurring: "monthly" }],
      },
      {
        key: "he-2026", name: "Helios Monitoring Renewal 2026", amount: 16000, close: "2026-08-01",
        stage: "decisionmakerboughtin", type: "existingbusiness", pairWith: "he-2025",
        lineItems: [{ name: "Monitoring service (expanded)", price: 1333, quantity: 1, recurring: "monthly" }],
      },
    ],
    tickets: [{ subject: "Alert thresholds misfiring at night", stage: "2", priority: "MEDIUM" }],
    stripe: {
      customerName: "Helios Energy Company",
      email: "accounts@heliosenergy.com",
      invoices: [
        { amount: 12000, date: "2025-08-10", paid: true, memo: "Monitoring 2025 annual" },
        { amount: 4000, date: "2026-06-20", paid: false, dueInDays: 20, memo: "Site survey add-on" },
      ],
      monthlySub: { product: "Helios Monitoring (monthly)", amount: 1000 },
    },
  },
  {
    key: "marlowe",
    name: "Marlowe & Finch Consulting",
    domain: "marlowefinch.com",
    industry: "MANAGEMENT_CONSULTING",
    city: "Boston",
    contacts: [{ first: "Ted", last: "Marlowe", email: "ted@marlowefinch.com" }],
    deals: [
      {
        key: "mf-2025", name: "M&F Advisory Retainer 2025", amount: 9500, close: "2025-11-12",
        stage: "closedwon", type: "newbusiness",
        lineItems: [{ name: "Advisory retainer", price: 9500, quantity: 1, recurring: "annually" }],
      },
      {
        key: "mf-2026", name: "M&F Advisory Retainer 2026", amount: 9500, close: "2026-11-10",
        stage: "closedwon", type: "existingbusiness", pairWith: "mf-2025",
        lineItems: [{ name: "Advisory retainer", price: 9500, quantity: 1, recurring: "annually" }],
      },
    ],
    tickets: [
      { subject: "Invoice copy request for FY25 audit", stage: "4", priority: "LOW" },
      { subject: "Portal access for new partner", stage: "1", priority: "LOW" },
    ],
    // QBO-only, and the ledger name doesn't match CRM ("and" vs "&", no "Consulting").
    qbo: {
      customerName: "Marlowe and Finch",
      email: "billing@marlowefinch.com",
      invoices: [
        { amount: 9500, txnDate: "2025-11-15", dueDate: "2025-12-15", payAmount: 9500, docNumber: "MF-118", memo: "Advisory retainer 2025" },
        { amount: 9500, txnDate: "2026-06-01", dueDate: "2026-07-01", payAmount: 0, docNumber: "MF-131", memo: "Advisory retainer 2026 (prebill)" },
        { amount: 1200, txnDate: "2026-04-10", dueDate: "2026-05-10", payAmount: 0, docNumber: "MF-127", memo: "Workshop expenses" },
      ],
    },
  },
  {
    key: "quantum",
    name: "Quantum Dynamics",
    domain: "quantumdyn.com",
    industry: "RESEARCH",
    city: "Austin",
    contacts: [{ first: "Lin", last: "Zhao", email: "lin.zhao@quantumdyn.com" }],
    deals: [
      {
        // Won deal with NO associated pair → shows up in the range scan but is
        // excluded from pairs (the "unpaired" counter on the overview).
        key: "qd-2025", name: "QD Pilot Program 2025", amount: 7500, close: "2025-06-30",
        stage: "closedwon", type: "newbusiness",
        lineItems: [{ name: "Pilot program", price: 7500, quantity: 1 }],
      },
      {
        key: "qd-exp", name: "QD Facility Expansion", amount: 40000, close: "2026-12-01",
        stage: "presentationscheduled", type: "existingbusiness",
        lineItems: [{ name: "Facility license", price: 3333, quantity: 1, recurring: "monthly" }],
      },
    ],
    tickets: [{ subject: "Data retention policy question", stage: "4", priority: "LOW" }],
    // Stripe name is an alias — only the contact email domain gives it away.
    stripe: {
      customerName: "Q.D. Labs",
      email: "finance@quantumdyn.com",
      invoices: [{ amount: 7500, date: "2025-07-05", paid: true, memo: "Pilot program 2025" }],
    },
  },
];
