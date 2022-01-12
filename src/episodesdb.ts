/** Substantially rewritten from Amazon.com sample code by
    keshlam@Kubyc.Solutions

   TODO: Replace Object with at least a partial type for the
   DocumentClient's returned structure, and with the Episode record
   struct. (Latter's date has to be modified from array to single
   number and multipe records) */


////////////////////////////////////////////////////////////////
// Open the box of Dominos. I mean, Dynamos.
// Basic database interface config.

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

// I chose to parameterize tableName. Overkill, but for now...
function getEpisodesSchema(tableName) {
    return {
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
    }
}

//================================================================
// NOTE: For validation purposes, I believe we can comment out
// any fields we aren't actually using and gain performance thereby.
// I'm already leaving some stuff typed as any because I don't need
// it and don't want to spend time spelling it out/validating it.
interface StationEpisodeAttributes {
    "analytics-code": string;
    appearances: any;
    audio: string|string[]; // uri; occasionally an array (past error?)
    "audio-available": boolean;
    "audio-eventually": boolean;
    "audio-may-download": boolean;
    "audio-may-embed": boolean;
    "audio-may-stream": boolean;
    // Body is an (X?)HTML string. Parsing out the
    // text description and playlist may be possible;
    // or we might want to display it on units with screens.
    // Unfortunately playlist gives only run lengths; not
    // offsets; so even if parsed we can't derive
    // "what's playing now" from it. And unfortunately the
    // recording-source URIs are of varying types (bandcamp;
    // store; etc) and are not all current; so we can't
    // easily implement "hey; put that on my shopping list".
    body: string;
    "canonical-url": null|string;
    channel: null|string;
    "channel-title": null|string;
    chunks: any; // ...
    "cms-pk": number;
    "comments-count": number;
    "enable-comments": boolean;
    "date-line-ts": number; // msec since epoch?
    "edit-link": string; // protected; I hope!
    "embed-code": string; // HTML for the iframe
    "estimated-duration": number; // seconds?
    headers: any; // ... 
    "header-donate-chunk": any; // null|string?
    "image-caption": null|string;
    "image-main": {
	"alt-text": null|string;
	name: null|string;
	source: null|string;
	url: null|string; // TODO: May want to display
	h: number;
	"is-display": boolean;
	crop: string; // containing number
	caption: string;
	"credits-url": string; // TODO: Display?
	template: string; // URI with substitution slots?
	w: number;
	id: number;
	"credits-name": string; // eg "courtesy of the artist"
    };
    "item-type": string;
    "item-type-id": number;
    newscast: string;
    newsdate: string; // containing ISO date/time/offset stamp
    "npr-analytics-dimensions": string[]; // mostly replicates
    playlist: any[]; // ?
    "podcast-links": any[]; //?
    "producing-organizations": [{
	url: string;
	logo: any; // often null
	name: string
    }];
    "publish-at": string; // containing ISO date/time/offset stamp
    "publish-status": string;
    show: string; // "newsounds"
    "show-tease": string; // HTML for "teaser" description of SHOW
    "show-title": string; // "New Sounds"
    "show-producing-orgs": [{ // TODO: Make org an interface?
	url: string;
	logo: any; // often null
	name: string;
    }];
    series: any[] // often empty
    segments: any[] // often empty
    "short-title": string // often empty
    "site-id": number
    slug: string // Brief description eg "4569-late-night-jazz"
    slideshow: any[] // often empty
    tags: string[] // "artist_name", "music", ...
    tease: string // NON-HTML brief description of EPISODE
    template: string // editing guidance
    title: string // Brief description eg "#4569, Late Night Jazz",
    transcript: string // usually empty for New Sounds
    "twitter-headline": string // usually === title
    "twitter-handle": string // eg "newsounds"
    url: string // for episode description page. Display?
    video: null|string // usually null
}
interface StationEpisodeDescription{
    type: string;
    id: string; // containing number
    attributes: StationEpisodeAttributes
}
interface StationEpisodeData {
    links: {
	first:string;
	last:string;
	next:string|null;
	prev:string|null;
    };
    data: StationEpisodeDescription[] // interface for clarity
    meta: {
	pagination: {
	    page: number
	    pages: number
	    count: number
	}
    }
}
// Type Guard for above interface, TS's answer to ducktype downcasting.
// (http://www.typescriptlang.org/docs/handbook/advanced-types.html)
function isStationEpisodeData(duckObject: any): duckObject is StationEpisodeData {
    if((duckObject as StationEpisodeData).data){
	return true
    }
    console.error("vvvvv DEBUG vvvvv")
    console.error("DEBUG: isStationEpisodeData failed on:")
    console.error(objToString(duckObject))
    console.error("^^^^^ DEBUG ^^^^^")
    return false
}

//================================================================
// DynamoDB calls. Generally these return Promises which can be handled/chained
// to manage asynchronous logic flow. 
//
// Note that we are running in Eventually Consistent mode; if stronger
// time sequencing was needed across threads, we'd have to explicitly
// request it.

export function createTable(tableName:string): Promise<Object> {
    var episodesSchema=getEpisodesSchema(tableName);
    return dynamodb.createTable(episodesSchema).promise()
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
    return getTerminalItemByDate(tableName,program,true)
}
export function getItemForLatestDate(tableName:string,program:string): Promise<EpisodeRecord> {
    return getTerminalItemByDate(tableName,program,false)
}

// Needs to be a query
export function getTerminalItemByDate(tableName:string,program:string, forward:boolean): Promise<EpisodeRecord> {
    // All for program, in desired order, but return only first found
    var params = {
	TableName: tableName,
	KeyConditionExpression: "program = :program",
	ExpressionAttributeValues: {
	    ":program": program,
	},
	ScanIndexForward: forward,
	Limit: 1
    }
    return docClient.query(params).promise()
	.then( (data:QueryMultipleResults) => data.Items[0])
}

// QUESTION: Can ExclusiveStartKey be used to optimize this, iff
// we know that program/date does exist? (Normally it's used to restart
// a second query chunk from LastEvaluatedKey.)
// ... Or is DynamoDB already clever enough to recognize that the
// expression implies this optimization?
export function getNextItemByDate(tableName:string,program:string,date:number,forward:boolean): Promise<EpisodeRecord> {
    // All for program, in desired order, but return only first found
    var params = {
	TableName: tableName,
	KeyConditionExpression: "program = :program AND broadcastDateMsec" (forward?">":"<") ":date"
	ExpressionAttributeValues: {
	    ":program": program,
	    ":date": date
	},
	ScanIndexForward: forward,
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
    return getTerminalItemByEpisode(tableName,program,episode,true)
}
export function getItemForHighestEpisode(tableName:string,program:string,episode:number): Promise<EpisodeRecord> {
    return getTerminalItemByEpisode(tableName,program,episode,false)
}
export function getTerminalItemByEpisode(tableName:string,program:string, episode:number, forward:boolean): Promise<EpisodeRecord> {
    // Query all for program, in desired order, but return only first
    // found ... which, since the sort key is episode, will yield an
    // item for first or last episode number. NOTE that there might be
    // multiple dates for that episode; I don't think there's any
    // promise that .data will contain more than one, or which one.
    // You can get the others by getting from the found episode
    // number.
    var params = {
	TableName: tableName,
	IndexName: ITEM_BY_EPISODE_INDEX, 
	KeyConditionExpression: "program = :program",
	ExpressionAttributeValues: {
	    ":program": program,
	},
	ScanIndexForward: forward,
	Limit: 1
    }
    return docClient.query(params).promise()
	.then( (data:QueryMultipleResults) => data.Items[0])
}

// Given an episode number, find the next lower or higher.  There may
// be several instances with different dates; this arbitrarily grabs
// the first found.
export function getNextItemByEpisode(tableName:string,program:string,episode:number, forward:boolean): Promise<EpisodeRecord> {
    var params = {
	TableName: tableName,
	IndexName: ITEM_BY_EPISODE_INDEX, 
	KeyConditionExpression: "program = :program AND espisode" (forward:">":"<") ":episode",
	ExpressionAttributeValues: {
	    ":program": program,
	    ":episode": episode
	},
	ScanIndexForward: forward
	Limit: 1
    }
    return docClient.query(params).promise()
	.then( (data:QueryMultipleResults) => data.Items[0])
}

// program+date must be unique, but multiple Items/records per episode
// with different timestamps are common due to rebroadcasts.
export function putItem(tableName:string,record:EpisodeRecord): Promise<Object> {
    var params = {
	TableName:tableName,
	Item:record
    }
    return docClient.put(params).promise()
}

// Removes only one record. Same episode may still be present on other dates.
// If you want to remove them all, use the secondary key.
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

// Convenience, if you have the record on hand.
export function deleteItem(tableName:string,record:EpisodeRecord): Promise<Object> {
    return deleteItemForDate(tableName,record.program,record.broadcastDateMsec)
}

// Consider searching tags. Can contains() be used in keyCondition? If
// not, can we leverage attributeExists on structured data with sparse
// properties (scan keys rather than values)? This also gets us into
// the playlist space, since we don't have usable offsets even when we
// do have the playlists and lengths.

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

    //================================================================
    // Check the newsounds.org database to find out which (if any) new
    // episodes have been published. This can be run in three modes,
    // depending on the value of maxdepth:
    //
    // <0 incremental, ==0 rescan all, N>0 check only first N pages
    //
    // Incremental is most common mode of operation. Rescan is mostly
    // used when I'm adding a field to the table, though it may be
    // worth running periodically just in case a missing episode
    // appears. First-N is mostly used as a debug tool when testing
    // new update logic.
    //
    // Note sequenced invocation of asynchronous fetch and process,
    // since we want to support incremental to reduce delay and server
    // load.  (Before you ask: No, I don't trust Javascript to
    // optimize tail-recursion.)
    //
    // TODO REVIEW: Move this into a separate file for easier
    // replacement, to handle other sources? Update *is* closely linked to
    // the cache database and player code...
    static async updateEpisodes(maxdepth:number) {
	console.log("Checking server for new episodes...")

	// Run Got HTTP query, returning object via a Promise
	const getStationEpisodeData = (page:number) => {
	    console.log("  Fetch index page",page)
	    const page_size=10 // Number of results per fetch
	    return new Promise((resolve, reject) => {
		// Fetch a page from the list of episodes,
		// date-descending order This uses a function variable
		// because I think I want to move it out to a per-show
		// initialization file.
		var uri=formatEpisodeDatabaseQueryURI(page,page_size)
		got.get(uri) // default content-type is 'text'
		    .then( (response:any) => {
			return resolve(JSON.parse(response.body));
		    })
		    .catch( (e:any) => {
			console.log(e)
			if(e instanceof Error) {
			    let error:Error=e
			    return reject(error.message)
			}
			else {
			    return reject(e.toString())
			}
		    })
	    })
	};

	const handlePage = async() => {
	    var hasMore=true
	    var page=1
	    while(hasMore) {
		// Issue query, wait for Promise to be completed,
		// and handle. The await is needed so we can determine
		// when incremental load has reached already-known data.
		await getStationEpisodeData(page)
		    .then( data => {
			// Typescript's approach to downcasting is
			// apparently to condition upon a Type Guard.
			if(! (isStationEpisodeData(data))) {
			    console.error("UNEXPECTED DATA STRUCTURE FROM STATION")
			    return;
			}

			// Note that episodesByNumber array will be mostly
			// preallocated during the first pass through
			// this list, since highest numbered will usually be
			// among most recent.

			// PROCESS EPISODES IN THIS CHUNK
			var episodes=data.data
			for (let ep of episodes) {
			    var attributes=ep.attributes;
			    // Shows may be in database before release;
			    // skip if not playable. (TODO: Someday we
			    // might have a "what's coming soon" feature,
			    // but that's very future.)
			    if(attributes.audio!="" && attributes.audio!=undefined) {
				// Some titles have unusual boilerplate that
				// we need to adapt.
				//
				// I'm not bothering to process
				// "pre-empted" shows; I trust that
				// they will have no audio and be
				// dropped later.  (In some cases
				// those had special podcasts
				// available, though, which I don't see
				// a way to recover an ep# or title for.)
				var title=attributes.title
				    .replace(/The Undead # ?[0-9]*/gi," ")
				    .replace(/The Undead/gi,"")
				    .replace(/Undead # ?[0-9]*/gi," ")
				    .replace(/ Pt. /gi," Part ")
				if(!title.startsWith("#"))
				    title=title.replace(/(^[^#].*)(#.*)/i,"$2, $1")
				
				// Nominally, number is easier to parse off
				// attributes.slug. But that doesn't produce
				// the right results for the "undead"
				// episodes; slug puts those up in the 60K
				// range but we really want the human number,
				// and title processing should ensure it's at
				// the start of that string (after '#').
				// Exception: pre-empted 
				var episodeNumber=parseInt(title.slice(1))

				// New Sounds prefers to route these
				// as podtrac URIs, though the direct
				// URI can be extracted therefrom if
				// one had reason to cheat. As of this
				// writing the database hasn't
				// included URI parameters, but I'm
				// not ruling that out.
				//
				// For New Sounds, this can actually be reconstructed from
				// broadcast date, in form 
				// "https://pdst.fm/e/www.podtrac.com/pts/redirect.mp3/audio.wnyc.org/newsounds/newsounds072521.mp3"
				// Haven't verified for Sound Check etc.
				// Consider saving just show ID and ep#?
				// 
				// Occasionally coming thru as array
				// in odd format (historical
				// accident?), be prepared to unpack
				// that.
				// 
				var mp3url=attributes.audio
				if(Array.isArray(mp3url)) {
				    mp3url=mp3url[0]
				}

				// Trim off time to work just with dates.
				// Convert to real date value now, or later?
				// See also newsdate, "(First Aired...)" in descr
				// Publication date is not actually useful;
				// that's when it was added to the DB.
				// published=attributes["publish-at"].replace(/T.*/,'')
				// publishedDate=new Date(published)

				var now=new Date()
				// Take broadcast date from mp3url,
				// rather that other fields; applied
				// paranoia.  Note: In at least one
				// case the database reports an
				// unusually formed URI
				// .../newsounds050610apod.mp3?awCollectionId=385&awEpisodeId=66200
				// so be prepared to truncate after
				// datestamp.
				var urlDateFields=mp3url
				    .replace(/.*\/newsounds([0-9]+)/i,"$1")
				    .match(/.{1,2}/g)
				if(! urlDateFields) {
				    // Should never happen but Typescript
				    // wants us to promise it won't.
				    throw new RangeError("invalid date in: "+mp3url)
				}
				// Sloppy mapping of 2-digit year to 4-digit
				var year=parseInt(urlDateFields[2])+2000
				if(year > now.getUTCFullYear())
				    year=year-100
				var broadcastDate=new Date(
				    Date.UTC(
					year,
					parseInt(urlDateFields[0])-1, // 0-based
					parseInt(urlDateFields[1])
				    )
				)

				// For Echo View and the like, long
				// description is attributes.body, and
				// attributes["image-main"] can be
				// used for the image. TODO

				// The database has &nbsp; and
				// similar. Clean up for voice.
				//
				// For spoken description, use tease
				// rather than body. But NOTE: Tease
				// sometimes truncates long text with
				// "...", which is not ideal for
				// humans. Workaround: If that is
				// seen, take the first sentence of
				// body instead.
				var tease=deHTMLify(attributes.tease)
				if (tease.endsWith("..."))
				    tease=deHTMLify(attributes.body+" ")
					.split(". ")[0]+"."

				// TODO: Someday, is it worth parsing
				// out the ARTIST/WORK/SOURCE/INFO
				// <span/>s from the body? Alas, can't
				// map durations to offsets, since the
				// duration table doesn't include
				// John's commentary.
				
				// TODO: Tag searchability some day.
				// Note processing into sounds-like
				// match form.  Other music skills
				// seem to handle this; I'm not sure
				// what their approach is.
				//
				// We want to both handle "redbone" finding
				// Martha Redbone, and distinguish
				// Kronos Quartet from
				// Mivos Quartet.
				var tags=[]
				for(let tag of attributes.tags) {
				    // TODO: Should we make this array
				    // for direct matching, or reconcatentate
				    // into a string for contains matching?
				    // Unclear which is more robust given
				    // possibly fuzzy matching. String is
				    // more human-readable in JSON.
				    var tagset=" " // For ease of exact-matching
				    for(let token of tag.split("_")) {
					// TODO: Match on sounds-like.
					// token=metaphone(stemmer(token))
					tagset=tagset+token+" "
				    }
				    tags.push(tagset)
				}

				// Some array entries may be missing
				// and the array will contain the null
				// value if so.  JSON is content with
				// that, but our navigation will need
				// to recognize and skip those slots.
				//
				// NOTE: Episodes are broadcast out of
				// order and repeated, so incremental
				// must continue until it sees a
				// broadcast date we already know
				// about. (Reminder: we're still
				// handling only one radio show at a
				// time, hence one added entry per
				// date.)
				//
				// NOTE: There is at least one
				// un-episodeNumbered episode of New
				// Sounds ("With Ravi Shankar"). For
				// now, I'm simply dropping that,
				// which will unfortunately drop
				// rebroadcasts as well. (A pity; it's
				// a good interview!) The general case
				// of rediscovered early archives will
				// have to be dealt with if we want to
				// let users access these.
				if(episodeNumber > 0) {
				    // Some juggling here to get types right...
				    // Unfortunately while Typescript realizes
				    // that after the first test ep is non-null,
				    // Javascript needs manual help.
				    let ep = episodesByNumber[episodeNumber]
				    if(ep===null) {
					var tempObject=newEpisodeRecord(
					    episodeNumber,
					    title,
					    tease,
					    [broadcastDate.getTime()],
					    tags,
					    mp3url
					)
					episodesByNumber[episodeNumber]=tempObject
					// maintain broadcast dates index
					episodeNumbersByDateMsec[broadcastDate.getTime()]=episodeNumber
				    }
				    else if (ep!=null && ep.broadcastDatesMsec
					     .includes(broadcastDate.getTime())
					    ) {
					if(maxdepth<0 && hasMore) {
					    console.log("Scan found known episode ",episodeNumber,"with known date",broadcastDate)
					    console.log("Stopping incremental database update.")
					    hasMore=false
					}
				    }					
				    else if (ep!=null) { // MUST be true!!!
					// GONK: As we move to database
					// there is the question of whether
					// broadcastDatesMsec remains an
					// array of values (more compact), or
					// if we wind up with a row per date
					// (fewer transactions?)
					ep.broadcastDatesMsec
					    .push(broadcastDate.getTime())
					// maintain broadcast dates index
					episodeNumbersByDateMsec[broadcastDate.getTime()]=episodeNumber
				    }
				} // end if numbered
			    } // end if released audio exists.
			} // end for episodes in this fetch

			if(page == maxdepth) hasMore=false
			
			if(page == data.meta.pagination.pages)
			    hasMore=false;// can't use break in async loop
			++page
		    }) // end await.then
		    .catch(e => {
			var stack;
			if(e instanceof Error)
			    stack=e.stack
			else
			    stack="(not Error, so no stack)"
			console.error("Update failed on Page",page,"\n",e,stack)
			// Recovery: Run with what we've previously loaded
			throw e
		    }) 
	    } // end while

	    let numberOfEpisodes=episodesByNumber.length
	    let ep=episodesByNumber[numberOfEpisodes-1]
	    // Really could/should use non-null assertion here?
	    console.log("Highest numbered:",ep===null ? null : ep.title)
	    let mostRecentDate=this.getMostRecentBroadcastDate()
	    let mostRecentNumber=episodeNumbersByDateMsec[mostRecentDate.toString()]! // Should never be null
	    let lastep=episodesByNumber[mostRecentNumber]
	    console.log("Most recent daily:",
			lastep===null ? null : lastep.title,
			"at",new Date(mostRecentDate).toUTCString())

	    // Cache to local file
	    fs.writeFile(EPISODES_FILE,
			 JSON.stringify(episodesCache,null,2), // prettyprint
			 "utf8",
			 function (err:any) {
			     if (err) {
				 console.error("An error occured while writing updates to",EPISODES_FILE);
				 console.error(err);
			     }
			 }
			)
	} // end handlePage

	// Launch sequenced async queries, eventually updating ep list.
	//
	// Eventually we'll probably want to generalize this to handle
	// Soundcheck etc. Just a matter of setting the show name, I think,
	// and having the app run against the right index files.
	await handlePage()
    } // end update
