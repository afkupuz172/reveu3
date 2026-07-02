import { useEffect, useState } from "react";
import type { CompanyHit, SourceStatus } from "../shared/types";
import { apiStatus } from "./api";
import DashboardPage from "./DashboardPage";
import OverviewPage from "./OverviewPage";

export default function App() {
  const [tab, setTab] = useState<"dashboard" | "overview">("dashboard");
  const [status, setStatus] = useState<SourceStatus | null>(null);
  // Owned here so the Overview's company links can drive the Dashboard tab.
  const [company, setCompany] = useState<CompanyHit | null>(null);

  useEffect(() => {
    apiStatus().then(setStatus).catch(() => setStatus(null));
    // Returning from the QBO OAuth redirect: refresh status and clean the URL.
    if (new URLSearchParams(location.search).get("qbo") === "connected") {
      history.replaceState(null, "", "/");
      apiStatus().then(setStatus).catch(() => {});
    }
  }, []);

  const openCompany = (c: CompanyHit) => {
    setCompany(c);
    setTab("dashboard");
  };

  return (
    <>
      <header className="header">
        <div className="logo">
          Re<span>Vue</span>3
        </div>
        <nav className="tabs">
          <button className={`tab ${tab === "dashboard" ? "active" : ""}`} onClick={() => setTab("dashboard")}>
            Dashboard
          </button>
          <button className={`tab ${tab === "overview" ? "active" : ""}`} onClick={() => setTab("overview")}>
            Overview
          </button>
        </nav>
        <div className="status">
          <span className={`pill ${status?.hubspot ? "on" : ""}`}>
            <span className="dot" /> HubSpot
          </span>
          <span className={`pill ${status?.stripe ? "on" : ""}`}>
            <span className="dot" /> Stripe
          </span>
          <span className={`pill ${status?.quickbooks === "connected" ? "on" : status?.quickbooks === "configured" ? "warn" : ""}`}>
            <span className="dot" /> QuickBooks
            {status?.quickbooks === "configured" && <a href="/api/qbo/connect">connect</a>}
          </span>
        </div>
      </header>
      {/* Dashboard stays mounted (hidden) so its state survives tab switches. */}
      <main className="page" style={{ display: tab === "dashboard" ? "block" : "none" }}>
        <DashboardPage company={company} onSelectCompany={setCompany} />
      </main>
      {tab === "overview" && (
        <main className="page wide">
          <OverviewPage onOpenCompany={openCompany} />
        </main>
      )}
    </>
  );
}
