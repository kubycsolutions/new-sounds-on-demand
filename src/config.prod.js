// config.prod.js is a "staging" configuration -- specifically, for
// production we want to override from using FileDb (easier to debug)
// to DynamoDb (more efficient, available in Lambda environment)
//
// By referencing process.env, we are able to pick up the table name
// from the runtime environment.
//
// TODO REVIEW: If I wanted to move the episodes.json file into tables, what
// would we have to do?

module.exports = {
    db: {
        DynamoDb: {
	    tableName: "NewSoundsUserStates",
        }
    }
};
