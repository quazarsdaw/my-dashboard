import {
  type Change,
  type DataRecord,
  MAX_DOCUMENT_BYTES,
  type Snapshot,
  WriteError,
} from "../_shared/dashboard-write/contracts.ts";
import { validateSnapshot } from "../_shared/dashboard-write/documents.ts";
import { type Access } from "./auth.ts";
import { boundedJson, rpcData, unavailable } from "./errors.ts";

type Rpc =
  | "dashboard_read_agent_documents"
  | "dashboard_agent_prepare"
  | "dashboard_agent_load"
  | "dashboard_agent_commit"
  | "dashboard_agent_status"
  | "dashboard_agent_cancel";
const fault = new WriteError("upstream_unavailable", 502);

export class Repository {
  private signal = AbortSignal.timeout(15000);
  constructor(private access: Access, private fetcher: typeof fetch) {}
  private async call(
    name: Rpc,
    args: DataRecord,
    limit = 1024 * 1024,
  ): Promise<unknown> {
    const response = await this.fetcher(
      this.access.project + "/rest/v1/rpc/" + name,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          apikey: this.access.serviceKey,
          authorization: "Bearer " + this.access.serviceKey,
        },
        body: JSON.stringify({ ...args, p_owner: this.access.owner }),
        redirect: "error",
        signal: this.signal,
      },
    );
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      unavailable();
    }
    return boundedJson(response.body, limit, fault, fault);
  }
  private async rpc(
    name: Exclude<Rpc, "dashboard_read_agent_documents">,
    args: DataRecord,
  ): Promise<DataRecord> {
    return rpcData(
      await this.call(name, { ...args, p_credential: this.access.generation }),
    );
  }
  async read(keys: string[]): Promise<Snapshot[]> {
    const raw = await this.call("dashboard_read_agent_documents", {
      p_keys: keys,
    }, 64 * 1024 * 1024);
    if (!Array.isArray(raw) || raw.length !== keys.length) unavailable();
    try {
      const rows = raw.map(validateSnapshot);
      if (
        new Set(rows.map((r) => r.key)).size !== keys.length ||
        rows.some((r) =>
          !keys.includes(r.key) ||
          new TextEncoder().encode(r.valueText ?? "").length >
            MAX_DOCUMENT_BYTES
        )
      ) {
        unavailable();
      }
      return rows;
    } catch {
      unavailable();
    }
  }
  prepare(requestId: string, hash: string, payload: DataRecord | null) {
    return this.rpc("dashboard_agent_prepare", {
      p_request: requestId,
      p_command_hash: hash,
      p_payload: payload,
    });
  }
  load(requestId: string, draftId: string) {
    return this.rpc("dashboard_agent_load", {
      p_request: requestId,
      p_draft: draftId,
    });
  }
  commit(requestId: string, draftId: string, documents: Change[]) {
    return this.rpc("dashboard_agent_commit", {
      p_request: requestId,
      p_draft: draftId,
      p_documents: documents,
    });
  }
  status(requestId: string | null) {
    return this.rpc("dashboard_agent_status", { p_request: requestId });
  }
  cancel(requestId: string, draftId: string) {
    return this.rpc("dashboard_agent_cancel", {
      p_request: requestId,
      p_draft: draftId,
    });
  }
}
