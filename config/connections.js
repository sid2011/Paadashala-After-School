const { MongoClient, ServerApiVersion } = require("mongodb");
require("dotenv").config();

const state = {
  db: null,
};
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

module.exports = {
  connect: async function () {
    await client.connect();

    state.db = client.db("DoubtHub"); // Your database name

    console.log(" MongoDB Connected");
  },

  get: function () {
    return state.db;
  },
};
