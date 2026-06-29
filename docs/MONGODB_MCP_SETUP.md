# MongoDB MCP Setup

The runtime app uses `MONGODB_URI`, but the MongoDB MCP server needs its own credentials when Codex should inspect Atlas projects, clusters, search indexes, or database schema directly.

This Codex desktop thread currently has no `MDB_MCP_*` values configured.

## Recommended Atlas Setup

Use MongoDB Atlas service account credentials so MCP can use Atlas Admin API tools and dynamic cluster access.

1. Open [MongoDB Atlas](https://cloud.mongodb.com).
2. Select the organization and project for MusicRAG.
3. Go to Project Identity and Access, then Applications.
4. Create a service account with project-level permissions suitable for inspection and setup.
5. Add your current IP address to the service account API Access List.
6. Store the credentials in the MCP client config. The server is the official
   `mongodb-mcp-server` (npm), launched via `npx`. Note the env var names follow
   the Atlas service-account schema (`mdb_sa_id_*` / `mdb_sa_sk_*`).

### Codex — `~/.codex/config.toml`

The full server block (command + args + env), not just the env sub-table:

```toml
[mcp_servers.mongodb]
command = "npx"
args = ["-y", "mongodb-mcp-server@latest"]

[mcp_servers.mongodb.env]
MDB_MCP_API_CLIENT_ID = "<paste-client-id>"        # mdb_sa_id_...
MDB_MCP_API_CLIENT_SECRET = "<paste-client-secret>" # mdb_sa_sk_...
MDB_MCP_READ_ONLY = "true"                           # drop for write/setup access
```

Restart Codex after editing `~/.codex/config.toml`.

### Claude Desktop — `claude_desktop_config.json`

Same server, JSON form (macOS path: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "mongodb": {
      "command": "npx",
      "args": ["-y", "mongodb-mcp-server@latest"],
      "env": {
        "MDB_MCP_API_CLIENT_ID": "<paste-client-id>",
        "MDB_MCP_API_CLIENT_SECRET": "<paste-client-secret>",
        "MDB_MCP_READ_ONLY": "true"
      }
    }
  }
}
```

Restart Claude Desktop after editing. (`--readOnly` as a CLI arg is equivalent to `MDB_MCP_READ_ONLY=true`.)

> Once the MCP is live, the same service account can read cluster details and
> create a database user / fetch the connection string via the Atlas Admin API —
> so the runtime `MONGODB_URI` below can be provisioned through the MCP itself.
> **Service-account creds (`MDB_MCP_*`) are for the MCP only; they are not the
> runtime DB credentials.** Keep both out of git (they belong in global client
> config / a gitignored `.env`, never in the repo).

## Runtime App Secrets

The MusicRAG code itself needs these values in `.env` or Vercel environment variables:

```bash
MONGODB_URI="mongodb+srv://..."
VOYAGE_API_KEY="<atlas-model-api-key>"
AI_GATEWAY_API_KEY="<vercel-ai-gateway-key>"
GENERATION_MODEL="google/gemini-3.5-flash"
```

If you copied an Atlas shell command such as:

```bash
mongosh "mongodb+srv://<cluster-host>/" --apiVersion 1 --username <db-user>
```

you can avoid composing a full URI by using split runtime values:

```bash
MONGODB_HOST="<cluster-host>"
MONGODB_USERNAME="<db-user>"
MONGODB_PASSWORD="<paste-db-password-locally>"
MONGODB_OPTIONS="retryWrites=true&w=majority&appName=musicRAG"
```

Verify readiness:

```bash
python -m musicrag.eval.audit_acceptance
```
