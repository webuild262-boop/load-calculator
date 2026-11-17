# Load Calculator — data-set API

A small read-only Azure Functions app (Node, v4 programming model). It
serves the Load Calculator's seven placed data sets from Azure Cosmos DB
so the demo can build its day from loaded data instead of the seed
inside the page.

## Endpoint

```
GET /api/datasets/{name}
```

`{name}` is one of the seven data sets:

| Data set | Container |
| --- | --- |
| Warehouse Inventory | `warehouse-inventory` |
| Production | `production` |
| Dock and Trailer Schedule | `dock-trailer-schedule` |
| Upcoming Orders | `upcoming-orders` |
| Cost Table | `cost-table` |
| Recycling | `recycling` |
| Common Orders and Runs | `common-orders-and-runs` |

The response is a JSON array of the container's documents, with the
Cosmos system fields (names starting with an underscore) removed. An
unknown name answers 404 with the list of valid names.

## What Azure must provide — the exact contract

- **Cosmos DB account** with a database named **`loadcalc`**.
- **Seven containers**, ids exactly as in the table above, each with
  **partition key `/id`**. Every document carries a unique `id`.
- **App setting `COSMOS_ENDPOINT`** on the Function App, set to the
  account endpoint (`https://<account>.documents.azure.com:443/`).
- **Identity**: the Function App's **system-assigned managed identity**
  does the reading. Grant that identity the **Cosmos DB Built-in Data
  Reader** role on the account (data-plane RBAC, role definition id
  `00000000-0000-0000-0000-000000001001`), scoped to the account or the
  `loadcalc` database. The code uses `DefaultAzureCredential`; there
  are **no account keys** in the code, in app settings, or anywhere
  else — key-based access is never used.
- **CORS** is configured on the Function App itself (portal or ARM,
  app-side settings), not in this code. Allow the Static Web App's
  origin; when the Function App is linked as the Static Web App's
  backend, the demo's relative `/api` path is same-origin and needs
  no CORS at all.
- **Runtime**: Node 18 or later, Functions v4. Deploy this folder's
  contents as the app content (`host.json` at the app root).

## Loading the first day

`tools/export-seed.js` in the repository writes the seeded Judge Mode
day as one JSON file per data set (`tools/seed-data/`). Load each
file's documents into the matching container, unchanged, and the demo's
**Live data** source rebuilds that same day from Cosmos.
`tools/verify-roundtrip.js` proves the loaded day matches the seeded
day number for number before anything is deployed.

## Local development

`tools/standin-server.js` serves the same `/api/datasets/{name}`
contract from the exported JSON files, so the demo's Live data path can
be exercised end to end with no Azure resources at all.
