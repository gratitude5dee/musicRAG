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
6. Store the credentials in `~/.codex/config.toml` under the MongoDB MCP server env block:

```toml
[mcp_servers.mongodb.env]
MDB_MCP_API_CLIENT_ID = "<paste-client-id>"
MDB_MCP_API_CLIENT_SECRET = "<paste-client-secret>"
```

For read-only inspection, add:

```toml
MDB_MCP_READ_ONLY = "true"
```

Restart Codex after editing `~/.codex/config.toml`.

## Runtime App Secrets

The MusicRAG code itself needs these values in `.env` or Vercel environment variables:

```bash
MONGODB_URI="mongodb+srv://..."
VOYAGE_API_KEY="<atlas-model-api-key>"
AI_GATEWAY_API_KEY="<vercel-ai-gateway-key>"
GENERATION_MODEL="google/gemini-3.5-flash"
```

Verify readiness:

```bash
python -m musicrag.eval.audit_acceptance
```

