/** Substantially rewritten from Amazon.com sample code by
    keshlam@Kubyc.Solutions

    AWS endpoint is persistant/shared state, though settable.
    Currently table and program names must be passed in every
    time. Could wrap in object and keep some or all of those in
    instance properties. TODO: Consider.

    TODO: Make endpoint, station URI, server/table, program settable
    from environment. Any others that might want to be parameterized
    for reuse? App would also have values to be adjusted for that.
    (See below re AWS SDK env properties.)
 */
const DEBUG=("DEBUG"==process.env.EPISODESDB_DEBUG)

import got from 'got'

// Sounds-like processing, for tag searches, eventually.
const Phonetics = require('phonetics')

//================================================================

////////////////////////////////////////////////////////////////
// Open the box of Dominos. I mean, Dynamos.
// Basic database interface config.

const AWS = require("aws-sdk");

// This one's just a literal. TODO: Is it really worth handling this way?
const ITEM_BY_EPISODE_INDEX = "ITEM_BY_EPISODE"

// Environment variable configuiration, with defaults if not set
// Defaults are as I've been running on my local machine for testing.
// They can be overridden to target a DynamoDB service on AWS, and/or
// to switch between databases thereupon.
// 
// NOTE: Table name and program are currently passed in each time from
// higher-level code. One or both may want to be stateful, eg as
// object context, if we generalize this.
const DYNAMODB_ENDPOINT = process.env.DYNAMODB_ENDPOINT || "http://localhost:8000"
const DYNAMODB_REGION = process.env.DYNAMODB_REGION || "us-east-1"

// Set default, but allow for convenient later
export function set_AWS_endpoint(endpoint=DYNAMODB_ENDPOINT,region=DYNAMODB_REGION) {
    if(DEBUG) console.error("DEBUG: set_AWS_endpoint(\""+endpoint+"\",\""+region+"\")")
    AWS.config.update({
	"endpoint": endpoint,
	"region": region,
    });
    return AWS // mostly for testing
}

// AWS config must be set BEFORE DynamoDB connection is opened, sigh.
// Definite risk in that we also open a DDB connection for Jovo state;
// the two *must* agree. There's hazard in having those occur in different
// files, not least the ordering issue.
// TODO: Asynchrony risks?
set_AWS_endpoint(DYNAMODB_ENDPOINT,DYNAMODB_REGION); 

// Note that the DynamoDB factory depends on AWS Endpoint having
// previously been set. BEWARE ASYNCHRONY!
var dynamodb = new AWS.DynamoDB();
var docClient = new AWS.DynamoDB.DocumentClient();



export interface EpisodeRecord {
    program: string;
    episode: number;
    title: string;
    tease: string;
    broadcastDateMsec: number
    tags: string[];
    url: string;
    imageurl: string|null;
}

export interface QueryUniqueResult {
    Item: EpisodeRecord
}

export interface QueryMultipleResults {
    Items: EpisodeRecord[]
}

// I chose to parameterize tableName. Overkill, but for now...
function getEpisodesSchema(tableName:string) {
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
	/* Now must only be specified in PROVISIONED billing mode
	ProvisionedThroughput: {   // Throttled max per second
	    ReadCapacityUnits: 1, // Apparently must now be >0
	    WriteCapacityUnits: 1
	}
	*/
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
    headers: any; // ... Not relevant right now
    "header-donate-chunk": any; // null|string?
    "image-caption": null|string;
    "image-main": { // We may want to display this on SHOW-like devices
	"alt-text": null|string;
	name: null|string;
	source: null|string;
	url: null|string; // TODO: May want to display
	h: number;
	"is-display": boolean;
	crop: string; // typ. containing number
	caption: string;
	"credits-url": string; 
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
    "producing-organizations": [{ // TODO: Make org an interface?
	url: string;
	logo: any; // often null
	name: string
    }];
    "publish-at": string; // containing ISO date/time/offset stamp
    "publish-status": string;
    show: string; // PROGRAM
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
    tease: string // NON-HTML brief episode descr. May be absent or truncated.
    template: string // editing guidance
    title: string // Includes ep#, eg "#4569, Late Night Jazz",
    transcript: string // usually empty for New Sounds
    "twitter-headline": string // usually == title
    "twitter-handle": string // usually == show
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
// Type Guard for above interface, Typescript's answer to ducktype downcasting.
// (http://www.typescriptlang.org/docs/handbook/advanced-types.html)
function isStationEpisodeData(duckObject: any): duckObject is StationEpisodeData {
    if((duckObject as StationEpisodeData).data){
	return true
    }
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
    if(DEBUG) console.error("DEBUG: createTable(\""+tableName+"\") ")
    var episodesSchema=getEpisodesSchema(tableName);
    return dynamodb.createTable(episodesSchema).promise()
}

export function waitForTable(tableName:string): Promise<Object> {
    if(DEBUG) console.error("DEBUG: waitForTable(\""+tableName+"\")")
    var params = {
	TableName : tableName
    };
    return dynamodb.waitFor("tableExists",params).promise()	
}
export function waitForNoTable(tableName:string): Promise<Object> {
    if(DEBUG) console.error("DEBUG: waitForNoTable(\""+tableName+"\")")
    var params = {
	TableName : tableName
    };
    return dynamodb.waitFor("tableNotExists",params).promise()	
}

export function describeTable(tableName:string): Promise<Object> {
    if(DEBUG) console.error("DEBUG: describeTable(\""+tableName+"\")")
    var params = {
	TableName : tableName
    };
    return dynamodb.describeTable(params).promise()	
}

export function deleteTable(tableName:string): Promise<Object> {
    if(DEBUG) console.error("DEBUG: deleteTable(\""+tableName+"\")")
    var params = {
	TableName : tableName
    };
    return dynamodb.deleteTable(params).promise()
}

// program+date main key is unique, though multiple records may exist
// per episode.
//
// TODO GONK: Rework as query for most recent <= the timestamp?
// Before timestamp+almost_24_hours? Think about how that resolves.
// (Goal would be to switch to using straight timestamps and rational
// matching rather than the round-off-to-UTC-Zulu. Complication in how
// we are obtaining the datestamps; I don't know that we have the
// additional UTC precision needed to make this work in reality, and
// while more elegant it *would* increase cost of database retrievals.)
export function getItemForDate(tableName:string,program:string,date:number): Promise<QueryUniqueResult> {
    if(DEBUG) console.error("DEBUG: getItemForDate(\""+tableName+"\",\""+program+"\","+date+")")
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
export function getTerminalItemByDate(tableName:string,program:string, forward:boolean): Promise<EpisodeRecord> {
    if(DEBUG) console.error("DEBUG: getTerminalItemByDate(\""+tableName+"\",\""+program+"\","+forward+")")
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
        .then( (data:QueryMultipleResults) => {
	    //if(DEBUG) console.error("DEBUG getTerminalItemByDate:",JSON.stringify(data))
	    return data.Items[0]
	})
}

export function getNextItemByDate(tableName:string,program:string,date:number): Promise<EpisodeRecord> {
    return getAdjacentItemByDate(tableName,program,date,true)
}      
export function getPreviousItemByDate(tableName:string,program:string,date:number): Promise<EpisodeRecord> {
    return getAdjacentItemByDate(tableName,program,date,false)
}      
export function getAdjacentItemByDate(tableName:string,program:string,date:number,forward:boolean): Promise<EpisodeRecord> {
    if(DEBUG) console.error("DEBUG: getAdjacentItemByDate(\""+tableName+"\",\""+program+"\","+date+","+forward+")")
    // All for program, in desired order, but return only first found
    var params = {
	TableName: tableName,
	KeyConditionExpression: "program = :program AND broadcastDateMsec"+(forward?">":"<")+":date",
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
    if(DEBUG) console.error("DEBUG: getItemsForEpisode(\""+tableName+"\",\""+program+"\","+episode+","+maxresults+")")
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

export function getItemForLowestEpisode(tableName:string,program:string): Promise<EpisodeRecord> {
    return getTerminalItemByEpisode(tableName,program,true)
}
export function getItemForHighestEpisode(tableName:string,program:string): Promise<EpisodeRecord> {
    return getTerminalItemByEpisode(tableName,program,false)
}
export function getTerminalItemByEpisode(tableName:string,program:string, forward:boolean): Promise<EpisodeRecord> {
    if(DEBUG) console.error("DEBUG: getTerminalItemByEpisode(\""+tableName+"\",\""+program+"\","+forward+")")
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

export function getNextItemByEpisode(tableName:string,program:string,episode:number): Promise<EpisodeRecord> {
    return getAdjacentItemByEpisode(tableName,program,episode,true)
}
export function getPreviousItemByEpisode(tableName:string,program:string,episode:number): Promise<EpisodeRecord> {
    return getAdjacentItemByEpisode(tableName,program,episode,false)
}
// Given an episode number, find the next lower or higher.  There may
// be several instances with different dates; this arbitrarily grabs
// the first found.
export function getAdjacentItemByEpisode(tableName:string,program:string,episode:number, forward:boolean): Promise<EpisodeRecord> {
    if(DEBUG) console.error("DEBUG: getAdjacentItemByEpisode(\""+tableName+"\",\""+program+"\","+episode+","+forward+")")
    var params = {
	TableName: tableName,
	IndexName: ITEM_BY_EPISODE_INDEX, 
	KeyConditionExpression: "program = :program AND espisode"+(forward?">":"<")+":episode",
	ExpressionAttributeValues: {
	    ":program": program,
	    ":episode": episode
	},
	ScanIndexForward: forward,
	Limit: 1
    }
    return docClient.query(params).promise()
	.then( (data:QueryMultipleResults) => data.Items[0])
}

// This is currently hardwired to New Sounds' epoch (starting date).
// As we move toward supporting other shows, it too may need to be
// parameterized with default.
const EPOCH_DATE=new Date(1986,2,23).getTime() // 23 Mar 1986

export function getRandomItem(tableName:string,program:string): Promise<EpisodeRecord> {
    if(DEBUG) console.error("DEBUG: getRandomItem(\""+tableName+"\",\""+program+"\","+")")
    // We know the first broadcast date of first episode.  We know
    // today's date. Randomize within that range, then find the first show
    // at or after the random timestamp (which is why this calls Next).
    var earliest=EPOCH_DATE; // fallback epoch date. Parameterize? GONK
    var latest=Date.now() - 7*24*60*60*1000 // Roll back one day, paranoia
    if(DEBUG) console.error("DEBUG: getRandomItem: getNextItemByDate Inteval ("+earliest+","+latest+")")
    var pickDate=Math.floor(earliest +Math.random()*(latest-earliest))
    return getNextItemByDate(tableName,program,pickDate)
}

// program+date must be unique, but multiple Items/records per episode
// with different timestamps are common due to rebroadcasts.
// This will overwrite.
export function putItem(tableName:string,record:EpisodeRecord): Promise<Object> {
    var params = {
	TableName:tableName,
	Item:record
    }
    return docClient.put(params).promise()
}

// program+date must be unique, but multiple Items/records per episode
// with different timestamps are common due to rebroadcasts.  This
// version will NOT overwrite -- it tests for prior presence of the
// (required!)  Hash Key.
export function putNewItem(tableName:string,record:EpisodeRecord): Promise<Object> {
    var params = {
	TableName:tableName,
	Item:record,
	ConditionExpression: "attribute_not_exists(#p)",
	ExpressionAttributeNames: { "#p": "program" }
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

// Unfortunately playlists don't have usable offsets even when we do
// have the track lengths; talk between/over isn't accounted for.

//================================================================
// Read published episode data from the newsounds.org database.  This
// can be run in three modes, depending on the value of maxdepth:
//
// <0 incremental, ==0 rescan all, N>0 check only first N pages
//
// Incremental from most recent date is most common mode of
// operation. Rescan is mostly used when I'm adding a field to the
// table or developing, though it may be worth running periodically
// just in case a missing episode appears. First-N is mostly used as a
// debug tool when developing new update logic.
//
// NOTE: I _don't_ fully trust Javascript to optimize tail-recursion
// of Promises/asyncs. We might want to go back to an eplicit await
// loop instead, which was my original sketch; I was confused about
// whether promise or async/await was currently preferred Javascript
// style. TODO: POLISH.
export async function updateEpisodes(table:string,maxdepth:number) {
    console.log("Checking server for new episodes...")

    // Run Got HTTP query, returning object via a Promise
    const getStationEpisodeData = (page:number) => {
	console.log("  Fetch index page",page)
	const page_size=50 // Number of results per fetch
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
		    console.error(e)
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

    function handlePage(table:string,page:number=1): Promise<any> {
	// Issue query, wait for Promise to be completed,
	// and handle. The while/await was needed so we could determine
	// when incremental load had reached already-known data.
	return getStationEpisodeData(page)
	    .then( data => {
		// Typescript's approach to ducktype-downcasting is
		// apparently to condition upon a Type Guard.
		if(! (isStationEpisodeData(data))) {
		    console.error("vvvvvvvvvvvvvv")
		    console.error("UNEXPECTED DATA STRUCTURE FROM STATION")
		    console.error(JSON.stringify(data,null,2))
		    console.error("^^^^^^^^^^^^^")
		    return Promise.reject("unexpected");
		}

		// PROCESS EPISODES IN THIS CHUNK
		var episodes=data.data
		//for (let ep of episodes) {
		var promises:Promise<string>[] = episodes.map( ep => {
		    return new Promise<string> ( (resolve,reject) => {
			if(ep==null) 
			    resolve("null record")
			else {
			    // Note that this is a synchronous operation,
			    // unlike most of this package.
			    var episodeRecord:(EpisodeRecord|null) =
				attributesToEpisodeRecord(ep.attributes)
			    
			    if(episodeRecord!=null)
			    {
				// If doing a full-depth scan, force replacement
				// (because we may be restructuring data)
				var putOperation= maxdepth==0 ? putItem : putNewItem
				return putOperation(table,episodeRecord)
				    .then(() => {
					return resolve("NEW")
				    })
				    .catch( (err:any) => {
					return reject(err) 
				    })
			    } // end if episodeRecord converted OK
			    else {
				return reject("Unconvertable data from station server.")
			    }
			}
		    }) // end new Promise
		}) // end episodes.map
		return Promise.allSettled(promises)
		    .then(results => {
			if(results.some(r => r.status=="rejected"))
			{
			    // Some rejection is normal when in overwrite mode.
			    // In incremental, it means stop.
			    if(maxdepth >=0 &&
			       page!=maxdepth &&
			       page!=data.meta.pagination.pages) { // more
				return handlePage(table,page+1)
				    .catch(err => {
					Promise.reject("handlePage("+(page+1)+") failed a recursion: "+err)
				    })
			    }
			    else return Promise.resolve("done")
			}
			else {
			    // All successful. Stop only on depth or no-more
			    if(page!=maxdepth && 
			       page!=data.meta.pagination.pages) {
				return handlePage(table,page+1)
				    .catch( (err) => {
					Promise.reject("handlePage("+(page+1)+") failed an update: "+err)
				    })
			    }
			}
			return Promise.resolve("done")
		    })
		    .catch(err => {
			console.error("\nPaErr:",err)
			// Should we continue scanning (full, and more remain)?
			// ... I'm voting no for now; this is unexpected
			return Promise.reject("Unexpected update failure: "+err)
		    })
	    }) // end Promise.all.then
	    .catch(e => {
		var stack;
		if(e instanceof Error)
		    stack=e.stack
		else
		    stack="(not Error, so no stack)"
		console.error("Update failed on Page",page,"\n",e,stack)
		// Recovery: Leave DB running with what we've previously loaded
		return Promise.reject("Update failed on Page"+page+"\n"+e+stack)
	    }) // end Promise.all.catch 
    } // end handlePage

    // Launch sequenced async queries, eventually updating ep list.
    //
    // Eventually we'll probably want to generalize this to handle
    // Soundcheck etc. Just a matter of setting the show name, I think,
    // and having the app run against the right index files.
    handlePage(table)
	.then( () => reportSnapshotStats(table))
} // end update

/* NOTE: Due to the asynchrony, results may be displayed in any
   order. We could migrate to await as an easy way to make this
   appear sequential, but then this call would have to be declared async.
   Reordering is harmless; leave it for now.
   */
function reportSnapshotStats(table:string,program:string="newsounds") {
    // Probe the updated table. Diagnostic logging. 
    console.log("STATISTICS DUMP for",program+":")
    getItemForHighestEpisode(table,program)
	.then (ep => {
	    console.log("\tHighest numbered:",ep.title,
			"at",new Date(ep.broadcastDateMsec).toUTCString())
	})
    getItemForLowestEpisode(table,program)
	.then (ep => {
	    console.log("\tLowest numbered:",ep.title,
			"at",new Date(ep.broadcastDateMsec).toUTCString())
	})
    getItemForLatestDate(table,program)
	.then (ep => {
	    console.log("\tMost recent daily:",
			ep.title,
			"at",new Date(ep.broadcastDateMsec).toUTCString())
	})
    getItemForEarliestDate(table,program)
	.then (ep => {
	    console.log("\tEarliest daily:",
			ep.title,
			"at",
			new Date(ep.broadcastDateMsec).toUTCString()
		       )
	})
    for(let i in [1,2,3,4,5]) {
	getRandomItem(table,program)
	    .then (ep => {
		console.log("\tRandom:",
			    ep.title,
			    "at",
			    new Date(ep.broadcastDateMsec).toUTCString()
			   )
	    })
    }
}

// Convert HTML escapes to speakable. Note RE syntax in .replace().
function deHTMLify(text:string):string {
    return text
	.replace(/<.*>/gi," ") // Discard markup
	.replace(/&nbsp;/gi," ")
	.replace(/&amp;/gi," & ")
	.replace(/&[lr]squo;/gi,"'")
	.replace(/&[lr]dquo;/gi,'"')
	.replace(/&[lr]ndash;/gi," -- ")
    // TODO: (case sensitive?) aelig, eacute, aacute, iacute, oacute,
    // hellip, Uuml, uacute, auml, oslash -- unless speech synths
    // handle them properly.

    // While we're here, convert newlines to spaces, then drop repeated spaces
	.replace(/\n/g," ")
	.replace(/ */g," ")
}

const APP_URI_PARAMETERS="user=keshlam@kubyc.solutions&nyprBrowserId=NewSoundsOnDemand.smartspeaker.player"

// URI to query the station's episode database. Pages start from 1, ordered
// newest-first. Page size can be up to 100 episodes per query. NOTE that this
// doesn't issue the query, just produces the URI.
//
// TODO: Parameterize by show name?
function formatEpisodeDatabaseQueryURI(page:number,page_size:number) {
    return "https://api.wnyc.org/api/v3/story/?item_type=episode&ordering=-newsdate&show=newsounds&"+APP_URI_PARAMETERS+"&page="+page+"&page_size="+page_size
}

// Read a broadcast record returned by the station's database, convert
// it into our representation
function attributesToEpisodeRecord(attributes:StationEpisodeAttributes):(EpisodeRecord|null) {
    // If no audio, they don't help my application. Skip 'em for now.
    if(!attributes.audio || attributes.audio==undefined || attributes.audio=="") {
	console.log("(Skipping record, no audio:",attributes.title+")")
	return null;
    }
    else {
	// New Sounds prefers to route these as podtrac URIs, though
	// the direct URI can be extracted therefrom if one had reason
	// to cheat. As of this writing the database hasn't included
	// URI parameters, but I'm not ruling that out.
	//
	// For New Sounds, this can actually be reconstructed from
	// broadcast date, in form
	// "https://pdst.fm/e/www.podtrac.com/pts/redirect.mp3/audio.wnyc.org/newsounds/newsounds072521.mp3"
	// Haven't verified for Sound Check etc.  Could micro-optimize
	// storage using that fact, but for this size database not worth it
	// (and would violate NoSQL's assertion that storage is cheaper
	// than computation).
	// 
	// Occasionally these come thru as array and/or in odd format
	// (historical accident?).  Be prepared to unpack that.
	// 
	var mp3url=attributes.audio
	if(Array.isArray(mp3url)) {
	    mp3url=mp3url[0]
	}

	// Some titles have unusual boilerplate that we need to adapt,
	// or have the episode number buried in the middle.
	//
	// I'm not bothering to process "preempted" shows; I trust
	// that they will have no audio and be dropped later.
	//
	// TODO: Some early titles were just entered in the station
	// database as "Program #1595" and the like. (Many in that
	// range.)  There may be another field we can pull descriptive
	// text from, such as the tease or slug. (See below re
	// tease. Re-order?)
	var title=attributes.title
	    .replace(/The Undead # ?[0-9.]*/gi," ")
	    .replace(/The Undead/gi,"")
	    .replace(/Undead # ?[0-9.]*/gi," ")
	    .replace(/ Pt. /gi," Part ") // For pronouncability
	// Deal with buried episode number (#nnnn:) by pulling it to
	// front. 
	if(!title.startsWith("#")) {
	    title=title.replace(/(^[^#]*)(#[0-9.]+)(.*)/i,"$2: $1 $3")
	}
	title=title.trim()
	if(title.endsWith("-"))
	    title=title.substr(0,title.length-1)
	
	// Nominally, number should be easier to parse off
	// attributes.slug. But that doesn't produce the right results
	// for the "undead" episodes; slug puts those up in the 60K
	// range but we really want the human number, and title
	// processing above should have ensured it's at the start of that
	// string (after '#').
	//
	// However, some episodes don't have the ep# in their title at
	// all. The folks at New Sounds are working on this, so I don't have
	// to implement a workaround; if there is no number, this will
	// get set to 0 and I will take that as a signal to simply skip
	// inserting this record.
	var episodeNumber=parseInt(title.slice(1))

	// Extract broadcast date from mp3url.  Note: In at least one
	// case the database reports an unusually formed URI
	// .../newsounds050610apod.mp3?awCollectionId=385&awEpisodeId=66200
	// so be prepared to truncate after datestamp.
	//
	// Yes, this is ugly. But the alternatives are unreliable, for
	// unknown reasons:
	//
	// .newsdate usually works but appears to sometimes differ
	// from the URL-in-NYC fields by years (28 to 50K hours rather
	// than the 4 or 5 expected. 
	//
	// .publish-at also usually works, but has similar excursions,
	// sometimes negative.
	//
	// .npr-analytics-dimensions[11] is SOMETIMES another
	// timestamp field.  It seems to have the same problems when
	// it is present, plus sometimes being absent. Wrong direction.
	//
	// Looks like I'm stuck with pulling date back out of the URI,
	// unless the folks at the studio have a better idea.
	
	var urlDateFields=mp3url
	    .replace(/.*\/newsounds([0-9]+)/i,"$1")
	    .match(/.{1,2}/g)
	if(! urlDateFields) {
	    // Should never happen but Typescript wants us to promise
	    // it won't. Might be able to use !. syntax instead, if
	    // we're willing to have less-useful diagnostics if/when
	    // this fails.
	    throw new RangeError("invalid date in: "+mp3url)
	}
	// Sloppy mapping of 2-digit year back to 4-digit: 100-year bracket
	// centered on today.
	var year=parseInt(urlDateFields[2])+2000
	if(year > new Date().getUTCFullYear())
	    year=year-100
	var broadcastDate=new Date(
	    Date.UTC(
		year,
		parseInt(urlDateFields[0])-1, // 0-based
		parseInt(urlDateFields[1])
	    )
	)

	// For spoken description, take the one-phrase tease rather
	// than the extended HTML-markup body. But NOTE: Tease
	// sometimes truncates long text with "...", which is not
	// ideal for humans. Workaround: If that is seen, take the
	// first sentence or two of body instead.
	var tease=deHTMLify(attributes.tease)
	if (tease.endsWith("..."))
	    tease=deHTMLify(attributes.body+" ")
	    .split(". ")[0]+"."

	// TODO: Someday, is it worth parsing out the
	// ARTIST/WORK/SOURCE/INFO <span/>s from the HTML-markup body?
	// Alas, can't map durations to offsets, since the duration
	// table doesn't include John's commentary, so there isn't a
	// lot the player can usefully do with that. It might eventually
	// want to display the body on smartspeakers with screens, I s'pose...
	
	// Tag searchability: TODO.  Sounds-like handling can be
	// achieved by matching under metaphone transformation.
	// Unfortunately we can't navigate to the specific tracks, but
	// we could filter shows. Other music apps seem to be
	// surprisingly good at recognizing performer and band and
	// album names; I wonder how they're doing it. Note that to
	// make this work as more than a one-shot, we'd need to go to
	// a tag-filtered playlist mode.
	//
	// Implementation thoughts: Can contains() be used in a
	// DynamoDB keyCondition without giving up Query efficiency?
	// If not, can we leverage attributeExists on structured
	// values with sparse properties (keys rather than values,
	// hashset style)? Or would we be forced to scan rather than
	// query (more expensive, but this isn't a huge database).
	var tags:string[]=[]
	for(let tag of attributes.tags) {
	    // TODO: Should we make this array for direct matching, or
	    // reconcatentate into a string for contains matching?
	    // Unclear which is more robust given possibly fuzzy
	    // matching. String is more human-readable in JSON.
	    //
	    // We want to both handle "redbone" finding Martha
	    // Redbone, and distinguish Kronos Quartet from Mivos
	    // Quartet, so tags currently remain as token sets which are
	    // searched within rather than exploding into separated
	    // tokens. That's subject to redesign as search evolves.
	    //
	    // Note that metaphone codes a word that starts with a
	    // vowel sound as starting with A. So Yo Yo Ma becomes "A
	    // A M". Unless the system mishears it as "yoyo Ma", in
	    // which case it would become "A M". Which might still be
	    // able to sorta work if our test checks presence without
	    // order, but that might be too shaggy a dog. Double-metaphone
	    // might help in this case.
	    //
	    // TODO: DESIGN THE UI, DRIVE THE MATCH FROM THAT.
	    var tagset=" " // Treat words as equal tokens within tag.
	    for(let token of tag.split("_")) {
		// Match on sounds-like.
		token=Phonetics.metaphone(token)
		// Could use double-metaphone and match against either,
		// for increased fuzz plus and minus.
		tagset=tagset+token+" "
	    }
	    tags.push(tagset)
	}

	// image-main.url should be the show banner image, if present.
	var imageurl= attributes["image-main"] ? attributes["image-main"].url : null

	if(episodeNumber > 0) {
	    var newEpisode:EpisodeRecord={
		program: attributes.show,
		episode: episodeNumber,
		title: title,
		tease: tease,
		broadcastDateMsec: broadcastDate.getTime(),
		tags: tags,
		url: mp3url,
		imageurl: imageurl
	    }
	    return newEpisode
	}
	else {
	    console.log("SKIPPING: No ep# in \""+title+"\", ",mp3url)
	    return null
	}
    }

    // TODO: Try dynamically fetching the title field of the MP3's
    // metadate with https://github.com/Borewit/tokenizer-http.  
    //
    // USUAL PROBLEM: As network I/O, it must run async.  But since I
    // want to return the value, I would need to await -- and that can
    // only be done from another async function. We're being called within
    // an async context, several layers up, so that's doable, but...
    // UGH.
    //
    // Have I said recently that I hate Javascript?
    async function getMetadataTitleFromAudioURI(audioURI:String) {
	const mm = require('music-metadata'); 
	const {makeTokenizer} = require('@tokenizer/http');
	var httpTokenizer = await makeTokenizer(audioURI);
	var metadata = await mm.parseFromTokenizer(httpTokenizer);
	return metadata
    }
}
