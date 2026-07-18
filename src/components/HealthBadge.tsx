import { useEffect, useState } from "react";
import { regshield, API_URL } from "../lib/api";

type Status = "checking" | "ok" | "down";

export default function HealthBadge() {
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        await regshield.health();
        if (alive) setStatus("ok");
      } catch {
        if (alive) setStatus("down");
      }
    };
    check();
    const id = setInterval(check, 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const label =
    status === "ok"
      ? "API online"
      : status === "down"
        ? "API offline"
        : "Checking…";

  return (
    <span className="health" title={API_URL}>
      <span className={`dot ${status === "ok" ? "ok" : status === "down" ? "down" : ""}`} />
      {label}
    </span>
  );
}
