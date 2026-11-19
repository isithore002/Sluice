"use client";

import { addrUrl, CHAINS, type ChainKey } from "../../lib/config";
import { chipClass } from "./format";

/** Every deployed contract, linked to its explorer page. */
export function ContractsTable({ addresses }: { addresses: Record<string, string> }) {
  const rows: [string, ChainKey, string][] = [
    ["SluiceReactive", "lasna", addresses.sluiceReactive],
    ["SluiceVault", "base", addresses.sluiceVault],
    ["RelayerReserve", "base", addresses.relayerReserve],
    ["Morpho Blue", "base", addresses.morpho],
    ["SiblingVault", "uni", addresses.siblingVault],
  ];
  return (
    <div className="sl-card sl-scroll">
      <table className="sl-table">
        <tbody>
          {rows.map(([name, k, a]) => (
            <tr key={name}>
              <td>{name}</td>
              <td>
                <span className={`sl-chip ${chipClass[k]}`}>{CHAINS[k].label}</span>
              </td>
              <td>
                <a className="sl-link sl-mono" href={addrUrl(k, a)} target="_blank" rel="noreferrer">
                  {a}
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
