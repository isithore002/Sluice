"use client";

import { CHAINS, txUrl } from "../../lib/config";
import type { FeedEvent } from "../../lib/useLive";
import { ago, chipClass, isReactiveSigner, whoSent } from "./format";

/** Recent events from all three chains, newest first. Callbacks show who sent them, so "no bot" is visible. */
export function EventFeed({ events }: { events: FeedEvent[] }) {
  if (events.length === 0) return <p className="sl-note">No recent events.</p>;
  return (
    <ul className="dash-feed">
      {events.map((e) => (
        <li key={e.id}>
          <span className="when">
            <span className={`sl-chip ${chipClass[e.chain]}`}>{CHAINS[e.chain].label.split(" ")[0]}</span> <span>{ago(e.time)}</span>
          </span>
          <span>
            {e.text}
            {e.from && <span className={`who${isReactiveSigner(e.from) ? " reactive" : ""}`}>{whoSent(e.from)}</span>}
          </span>
          <a className="sl-link" href={txUrl(e.chain, e.tx)} target="_blank" rel="noreferrer">
            tx ↗
          </a>
        </li>
      ))}
    </ul>
  );
}
