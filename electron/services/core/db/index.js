const { DatabaseService } = require("../../database");

function createDbCore(database) {
  return {
    database,
    close: () => database.closeConnection(),
    prepareForShutdown: () => database.prepareForShutdown()
  };
}

module.exports = {
  DatabaseService,
  createDbCore
};
