const { MongoClient } = require("mongodb");
require("dotenv").config();

const state = {
  db: null,
};

const client = new MongoClient(process.env.MONGODB_URI);

module.exports = {
  connect: async function () {
    try {
      await client.connect();

      state.db = client.db("Paadashala");

      console.log("MongoDB Connected");
    } catch (error) {
      console.error("MongoDB Connection Error:", error);
      throw error;
    }
  },

  get: function () {
    return state.db;
  },
};