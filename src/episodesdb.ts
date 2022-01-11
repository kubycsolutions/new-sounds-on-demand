/** Substantially rewritten from Amazon.com sample code by
    keshlam@Kubyc.Solutions

   TODO: Replace Object with at least a partial type for the
   DocumentClient's returned structure, and with the Episode record
   struct. (Latter's date has to be modified from array to single
   number and multipe records) */


////////////////////////////////////////////////////////////////
// Open the box of Dominos. I mean, Dynamos.

var AWS = require("aws-sdk");

AWS.config.update({
    endpoint: "http://localhost:8000", // Initial development: Local service
    region: "us-east-1",
});
var dynamodb = new AWS.DynamoDB();
var docClient = new AWS.DynamoDB.DocumentClient();

const ITEM_BY_EPISODE_INDEX="ITEM_BY_EPISODE" // Just for static checking

export interface EpisodeRecord {
    program: string
    episode: number;
    title: string;
    tease: string;
    broadcastDateMsec: number
    tags: string[];
    url: string;
}

export interface QueryUniqueResult {
       Item: EpisodeRecord
}

export interface QueryMultipleResults {
       Items: EpisodeRecord[]
}

//================================================================
export function createTable(tableName:string): Promise<Object> {
    var EpisodesSchema = {
	TableName : tableName,
	// Primary key must be unique identifier for Item record, so use date
	KeySchema: [       
	    { AttributeName: "program", KeyType: "HASH"},
	    { AttributeName: "broadcastDateMsec", KeyType: "RANGE" }
	],
	
	// CAVEAT: Secondary Indexes are implemented as child tables,
	// NOT as side-table indexing. (Storage cost vs. CPU cost
	// JOINish tradeoff again; not a decision that feels natural
	// to me.)  Depending on use cases, it may be desirable to
	// Project only columns actually used, to reduce copying (and
	// returned network traffic, as with fetch-time projection).
	//
	// Probably insignificant in my application, given AWS's
	// billing structure and relatively small table(s).
	// Still. Ugh.
	//
	// Note that since secondaries are tested via expression
	// rather than by full hash (!?), it's possible to test the
	// "hash" alone as a pseudo-Simple key to get all contents of
	// that Region sorted by the sort key, then use Limit to pick
	// off just first or last to get reasonably efficient
	// retrieval by secondary sort.  May be any of the Items which
	// match that Secondary, of course, unless you impose
	// filtering before limiting. It's a kluge, but useful. (Or
	// you could test sort alone to get cross- Region results, eg
	// most recent broadcast among all programs.)  Similar for
	// "since"; test sort key but don't set Limit.
	LocalSecondaryIndexes: [
	    {
		// Note: NOT unique if there are multiple dates
		IndexName: ITEM_BY_EPISODE_INDEX, 
		KeySchema: [ 
		    // Must hash be declared even for local? Believe so,
		    // despite the requirement that local shares partition
		    // with primary key.
		    { AttributeName: "program", KeyType: "HASH"},
		    { AttributeName: "episode", KeyType: "RANGE" }
		],
		Projection: { 
		    ProjectionType: "ALL" // vs KEYS_ONLY or INCLUDE
		    // Iff INCLUDE:
		    //NonKeyAttributes: [STRING_VALUE', ],
		}
	    },
	],
	GlobalSecondaryIndexes: [
	    {
		// Sort key may not be useful here; consider dropping.
		IndexName: 'ALL_PROGRAMS_FOR_DATE',
		KeySchema: [ 
		    { AttributeName: "broadcastDateMsec", KeyType: "HASH" },
		    { AttributeName: "program", KeyType: "RANGE"},
		],
		Projection: { 
		    ProjectionType: "ALL" // vs KEYS_ONLY or INCLUDE
		    /// Iff INCLUDE:
		    // NonKeyAttributes: [ 'STRING_VALUE', ],
		}
	    },
	],
	// Only need to define attributes EXPLICITLY REFERENCED IN INDEXES.
	AttributeDefinitions: [       
	    { AttributeName: "program", AttributeType: "S" },
	    { AttributeName: "episode", AttributeType: "N" }, // number
	    { AttributeName: "broadcastDateMsec", AttributeType: "N" } // number
	],
	// CONSIDER PROVISIONED for throttling just to establish upper
	// limit of billing if malfunction (or attack?) occurs
	BillingMode: "PAY_PER_REQUEST", // or PROVISIONED
	ProvisionedThroughput: {   // Throttled max per second
	    ReadCapacityUnits: 0, // Set to 0 if PAY_PER_REQUEST
	    WriteCapacityUnits: 0
	}
    };
    return dynamodb.createTable(EpisodesSchema).promise()
}

export function deleteTable(tableName:string): Promise<Object> {
    var params = {
	TableName : tableName
    };
    return dynamodb.deleteTable(params).promise()
}


// program+date main key is unique, though multiple records may exist
// per episode.
export function getItemForDate(tableName:string,program:string,date:number): Promise<QueryUniqueResult> {
    var params = {
	TableName: tableName,
	Key:{
	    "program": program,
	    "broadcastDateMsec": date
	}
    }

    return docClient.get(params).promise()
}

// Scan sorted, take single result
export function getItemForEarliestDate(tableName:string,program:string): Promise<EpisodeRecord> {
    return getItemForDateLimit(tableName,program,true)
}
export function getItemForLatestDate(tableName:string,program:string): Promise<EpisodeRecord> {
    return getItemForDateLimit(tableName,program,false)
}
// Needs to be a query
export function getItemForDateLimit(tableName:string,program:string, lowest:boolean): Promise<EpisodeRecord> {
    // All for program, in desired order, but return only first found
    var params = {
	TableName: tableName,
	KeyConditionExpression: "program = :program",
	ExpressionAttributeValues: {
	    ":program": program,
	},
	ScanIndexForward: lowest,
	Limit: 1
    }
    return docClient.query(params).promise()
	.then( (data:QueryMultipleResults) => data.Items[0])
}


// Multiple records may exist per episode number.
//
// This is a secondary-index query. It is claimed that, even though an
// expression is used rather than TLU, this should still be faster than
// a Scan with equivalent conditions.
// 
// TODO: Note that ordering here is by the episode number ... which
// we're currently doing exact match on, so it's irrelevant. It
// might be useful to have the group natively ordered by date, but
// that gets a bit messy; to do episode#date as key it has to be
// string, and to make that sort properly we'd need to left-pad both
// numeric values. So optimization is possible, but arguably is overkill
// for our needs.
export function getItemsForEpisode(tableName:string,program:string,episode:number,maxresults:number=Number.MAX_SAFE_INTEGER): Promise<QueryMultipleResults> {
    var params = {
	TableName: tableName,
	IndexName: ITEM_BY_EPISODE_INDEX, 
	KeyConditionExpression: "program = :program and episode = :episode",
	ExpressionAttributeValues: {
	    ":program": program,
	    ":episode": episode
	},
	// I'd prefer to assert Limit only if specified, but Typescript
	// is happier with it not being appended later.
	Limit: maxresults
    }
    return docClient.query(params).promise()
}

export function getItemForLowestEpisode(tableName:string,program:string,episode:number): Promise<EpisodeRecord> {
    return getItemForEpisodeLimit(tableName,program,episode,true)
}
export function getItemForHighestEpisode(tableName:string,program:string,episode:number): Promise<EpisodeRecord> {
    return getItemForEpisodeLimit(tableName,program,episode,false)
}
export function getItemForEpisodeLimit(tableName:string,program:string, episode:number, lowest:boolean): Promise<EpisodeRecord> {
    // Query all for program, in desired order, but return only first found
    var params = {
	TableName: tableName,
	IndexName: ITEM_BY_EPISODE_INDEX, 
	KeyConditionExpression: "program = :program",
	ExpressionAttributeValues: {
	    ":program": program,
	},
	ScanIndexForward: lowest,
	Limit: 1
    }
    return docClient.query(params).promise()
	.then( (data:QueryMultipleResults) => data.Items[0])
}

// program+date must be unique, but multiple Items/records per episode
// with different timestamps are likely due to rebroadcasts.
export function putItem(tableName:string,record:EpisodeRecord): Promise<Object> {
    var params = {
	TableName:tableName,
	Item:record
    }
    return docClient.put(params).promise()
}

export function deleteItemForDate(tableName:string,program:string,date:number): Promise<Object> {
    var params = {
	TableName: tableName,
	Key:{
	    "program": program,
	    "broadcastDateMsec": date
	}
    }
    return docClient.delete(params).promise()
}

export function deleteItem(tableName:string,record:EpisodeRecord): Promise<Object> {
    return deleteItemForDate(tableName,record.program,record.broadcastDateMsec)
}


// Need to implement secondary-key fetch (getItemForNumber),
// consider next/previous (query, condition, ordering, first result),
//
// consider tags (scan, because key condition can't use contains(), iirc)
// ... Can we do anything with sparse columns (true if tag present)?
// ... Probably not, too many and growing.
// ... How about structured value and attribute-exists on subfield?

//================================================================
/**********************************************************************
Stuff here is strictly notes left over from previous examples.
Get rid of it at some point.

function queryYear(tableName): Promise<Object> {
    console.log("Querying for episodes from 1985.");

    var params = {
	TableName : tableName,
	KeyConditionExpression: "#yr = :yyyy",
	ExpressionAttributeNames:{
            "#yr": "year"
	},
	ExpressionAttributeValues: {
            ":yyyy": 1985
	}
    };

    return docClient.query(params).promise()
}

function queryYearTitle(tableName,): Promise<Object> {
// NOTE: SECONDARY KEY WOULD HELP
// See https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/SecondaryIndexes.html
    console.log("Querying for episodes from 1992 - titles A-L, with genres and lead actor");

    var params = {
	TableName : tableName,
	ProjectionExpression:"#yr, title, info.genres, info.actors[0]",
	KeyConditionExpression: "#yr = :yyyy and title between :letter1 and :letter2",
	ExpressionAttributeNames:{
            "#yr": "year"
	},
	ExpressionAttributeValues: {
            ":yyyy": 1992,
            ":letter1": "A",
            ":letter2": "L"
	}
    };

    return docClient.query(params, function(err, datas) {
	if (err) {
            console.log("Unable to query. Error:", JSON.stringify(err, null, 2));
	} else {
            console.log("Query succeeded.");
            datas.forEach(function(item) {
		console.log(" -", item.year + ": " + item.title
			    + " ... " + item.info.genres
			    + " ... " + item.info.actors[0]);
            });
	}
    });
}

function itemDeleteConditionally(tableName,) {
    var table = tableName;
    
    var year = 2015;
    var title = "The Big New Item";

    var params = {
	TableName:table,
	Key:{
            "year": year,
            "title": title
	},
	ConditionExpression:"info.rating <= :val",
	ExpressionAttributeValues: {
            ":val": 5.0
	}
    };

    console.log("Attempting a conditional delete...");
    docClient.delete(params, function(err, data) {
	if (err) {
            console.error("Unable to delete item. Error JSON:", JSON.stringify(err, null, 2));
	} else {
            console.log("DeleteItem succeeded:", JSON.stringify(data, null, 2));
	}
    });
}

// Update runs in place, can delete fields, reduces transaction traffic,
// and is supposedly atomic, though still only eventually consistent unless
// reader forces a wait.
function itemIncrementCounter(tableName,) { // Update example
    var table = tableName;

    var year = 2015;
    var title = "The Big New Item";

    // Increment an atomic counter

    var params = {
	TableName:table,
	Key:{
            "year": year,
            "title": title
	},
	UpdateExpression: "set info.rating = info.rating + :val",
	ExpressionAttributeValues:{
            ":val": 1
	},
	ReturnValues:"UPDATED_NEW"
    };

    console.log("Updating the item...");
    docClient.update(params, function(err, data) {
	if (err) {
            console.error("Unable to update item. Error JSON:", JSON.stringify(err, null, 2));
	} else {
            console.log("UpdateItem succeeded:", JSON.stringify(data, null, 2));
	}
    });
}

function itemUpdate(tableName,) {
    var table = tableName;

    var year = 2015;
    var title = "The Big New Item";

    // Update the item, unconditionally,

    var params = {
	TableName:table,
	Key:{
            "year": year,
            "title": title
	},
	UpdateExpression: "set info.rating = :r, info.plot=:p, info.actors=:a",
	ExpressionAttributeValues:{
            ":r":5.5,
            ":p":"Everything happens all at once.",
            ":a":["Larry", "Moe", "Curly"]
	},
	ReturnValues:"UPDATED_NEW"
    };

    console.log("Updating the item...");
    docClient.update(params, function(err, data) {
	if (err) {
            console.error("Unable to update item. Error JSON:", JSON.stringify(err, null, 2));
	} else {
            console.log("UpdateItem succeeded:", JSON.stringify(data, null, 2));
	}
    });

}

function itemUpdateConditionally(tableName,actors_count_ge) {
    var params = {
	TableName:table,
	Key:{
            "year": year,
            "title": title
	},
	UpdateExpression: "remove info.actors[0]",
	ConditionExpression: "size(info.actors) >= :num",
	ExpressionAttributeValues:{
            ":num": actors_count_ge
	},
	ReturnValues:"UPDATED_NEW"
    };

    console.log("Attempting a conditional update...");
    docClient.update(params, function(err, data) {
	if (err) {
            console.error("Unable to update item. Error JSON:", JSON.stringify(err, null, 2));
	} else {
            console.log("UpdateItem succeeded:", JSON.stringify(data, null, 2));
	}
    });
}

// INEFFICIENT ITERATE-AND-TEST RATHER THAN HASH/KEY TEST, FALLBACK TOOL
function scan(tableName,) {
    var params = {
	TableName: tableName,
	ProjectionExpression: "#yr, title, info.rating",
	FilterExpression: "#yr between :start_yr and :end_yr",
	ExpressionAttributeNames: {
            "#yr": "year",
	},
	ExpressionAttributeValues: {
            ":start_yr": 1950,
            ":end_yr": 1959 
	}
    };

    console.log("Scanning Items table.");
    docClient.scan(params, onScan);

    function onScan(err, data) {
	if (err) {
            console.error("Unable to scan the table. Error JSON:", JSON.stringify(err, null, 2));
	} else {
        // print all the episodes
            console.log("Scan succeeded.");
            data.Items.forEach(function(record) {
		console.log(
                    record.year + ": ",
                    record.title, "- rating:", record.info.rating);
            });

            // continue scanning if we have more episodes, because
            // scan can retrieve a maximum of 1MB of data
            if (typeof data.LastEvaluatedKey != "undefined") {
		console.log("Scanning for more...");
		params.ExclusiveStartKey = data.LastEvaluatedKey;
		docClient.scan(params, onScan);
            }
	}
    }
}

*******************************************************************/
