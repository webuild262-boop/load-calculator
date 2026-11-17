/*
 * GET /api/datasets/{name} — serve one placed data set as JSON.
 *
 * Read-only. The documents come from the Cosmos DB database "loadcalc",
 * one container per data set, partition key /id. The Function App reads
 * them with its managed identity (DefaultAzureCredential) — there are
 * no account keys in this code or in any configuration. The Cosmos
 * endpoint arrives as the COSMOS_ENDPOINT app setting.
 *
 * The response is the container's documents as a JSON array, with the
 * Cosmos system fields (the ones whose names start with an underscore)
 * taken off, so what the demo receives is exactly the placed data.
 */
'use strict';

const { app } = require('@azure/functions');
const { CosmosClient } = require('@azure/cosmos');
const { DefaultAzureCredential } = require('@azure/identity');

const DATABASE_ID = 'loadcalc';

// The seven placed data sets. The route name and the container id are
// the same word, so the mapping the demo uses is the mapping here.
const DATA_SETS = [
  'warehouse-inventory',
  'production',
  'dock-trailer-schedule',
  'upcoming-orders',
  'cost-table',
  'recycling',
  'common-orders-and-runs'
];

let client = null;
function cosmos() {
  if (client) return client;
  const endpoint = process.env.COSMOS_ENDPOINT;
  if (!endpoint) {
    throw new Error('COSMOS_ENDPOINT app setting is not set on this Function App.');
  }
  client = new CosmosClient({
    endpoint: endpoint,
    aadCredentials: new DefaultAzureCredential()
  });
  return client;
}

function placedFields(doc) {
  const out = {};
  Object.keys(doc).forEach(function (k) {
    if (k.charAt(0) !== '_') out[k] = doc[k];
  });
  return out;
}

app.http('datasets', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'datasets/{name}',
  handler: async function (request, context) {
    const name = request.params.name;
    if (DATA_SETS.indexOf(name) === -1) {
      return {
        status: 404,
        jsonBody: { error: 'unknown data set: ' + name, dataSets: DATA_SETS }
      };
    }
    try {
      const container = cosmos().database(DATABASE_ID).container(name);
      const { resources } = await container.items.readAll().fetchAll();
      return {
        status: 200,
        jsonBody: resources.map(placedFields),
        headers: { 'Cache-Control': 'no-store' }
      };
    } catch (err) {
      context.error('datasets/' + name + ' failed: ' + err.message);
      return {
        status: 500,
        jsonBody: { error: 'the data set could not be read: ' + err.message }
      };
    }
  }
});
